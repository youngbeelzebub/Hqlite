/**
 * parse_rank.js - 通用解析期刊等级文件（PDF/Excel/CSV）
 *
 * 用法: node parse_rank.js <rank文件路径> <输出JSON路径>
 *
 * 输出 JSON 格式:
 * {
 *   "domains": {
 *     "经济学": {
 *       "tiers": { "A+": ["期刊名1", ...], "A": [...], ... },
 *       "chinese_journals": { "A+": ["中文期刊1", ...], ... },
 *       "english_journals": { "A+": ["English Journal 1", ...], ... }
 *     },
 *     "心理学": { ... },
 *     ...
 *   },
 *   "all_domains": ["经济学", "心理学", ...],
 *   "all_tiers": ["A+", "A", "B", "C", ...]
 * }
 *
 * 等级名称从文件内容中自动发现，不硬编码。
 * 支持的等级格式: A+级, A级, B级, C级, T1级, T2级, 一类, 二类, 顶级, 权威, 核心, 等
 * 支持按专业领域分组（如"经济学"、"心理学"等）。
 * 每个领域内区分中文期刊和英文期刊。
 */

const fs = require('fs');
const path = require('path');

// ===================== PDF 读取 =====================

async function readPdf(filePath) {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await pdfjsLib.getDocument({ data }).promise;
    let fullText = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map(item => item.str);
      fullText += strings.join(' ') + '\n\n';
    }
    return fullText;
  } catch (err) {
    throw new Error(`无法读取PDF文件: ${err.message}`);
  }
}

// ===================== Excel/CSV 读取 =====================

async function readExcel(filePath) {
  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    let fullText = '';
    workbook.eachSheet(ws => {
      ws.eachRow(row => {
        const cells = [];
        row.eachCell({ includeEmpty: true }, cell => {
          cells.push(String(cell.value || ''));
        });
        fullText += cells.join(' ') + '\n';
      });
      fullText += '\n';
    });
    return fullText;
  } catch (err) {
    throw new Error(`无法读取Excel文件: ${err.message}`);
  }
}

function readCsv(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`无法读取CSV文件: ${err.message}`);
  }
}

// ===================== 自动发现等级 =====================

/**
 * 从文本中自动发现所有等级标记。
 * 返回 Set<string>，如 {"A+", "A", "B", "C"} 或 {"T1", "T2", "T3"} 或 {"一类", "二类"}
 *
 * 策略: 先统计所有候选等级的出现次数，只保留出现次数 >= MIN_OCCURRENCES 的。
 * 真正的等级标记会在文件中反复出现，而误匹配通常只出现1-2次。
 */
function discoverTiers(text) {
  const MIN_OCCURRENCES = 3;
  const counter = new Map();

  function addCandidate(tier) {
    const t = tier.trim();
    if (t) counter.set(t, (counter.get(t) || 0) + 1);
  }

  // 模式1: "X级" 格式 — 如 A+级, A级, B级, C级, D级, E级, T1级, T2级, S级
  // 要求: 等级标记紧跟"级"字，避免误匹配
  const xLevelPattern = /([A-Z]\+?|[A-Z]\d*|S{1,3})\s*级/g;
  let m;
  while ((m = xLevelPattern.exec(text)) !== null) {
    addCandidate(m[1]);
  }

  // 模式2: "X类" 格式 — 如 一类, 二类, 三类
  const xCategoryPattern = /([一二三四五六])\s*类/g;
  while ((m = xCategoryPattern.exec(text)) !== null) {
    addCandidate(m[1].trim() + '类');
  }

  // 模式3: 中文等级名 — 如 顶级, 权威, 核心, 重点, 一般, 扩展
  // 要求: 紧跟"级"或"类"或"期刊"，避免误匹配
  const chineseTierPattern = /(顶级|权威|核心|重点|一般|扩展|重要|优秀|普通|补充)\s*(?:级|类|期刊)/g;
  while ((m = chineseTierPattern.exec(text)) !== null) {
    addCandidate(m[1]);
  }

  // 模式4: 数字等级 — 如 1级, 2级, 3级
  const numLevelPattern = /(\d)\s*级/g;
  while ((m = numLevelPattern.exec(text)) !== null) {
    addCandidate(m[1].trim() + '级');
  }

  // 过滤: 只保留出现次数 >= MIN_OCCURRENCES 的
  const tiers = new Set();
  for (const [tier, count] of counter.entries()) {
    if (count >= MIN_OCCURRENCES) {
      tiers.add(tier);
    }
  }

  return tiers;
}

/**
 * 构建一个通用的等级匹配正则。
 * 根据发现的等级动态生成，而非硬编码。
 */
function buildTierPattern(discoveredTiers) {
  if (discoveredTiers.size === 0) return null;

  // 按长度降序排列，确保长名称优先匹配（如 A+ 优先于 A）
  const sorted = [...discoveredTiers].sort((a, b) => b.length - a.length);

  // 转义特殊字符
  const escaped = sorted.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  return new RegExp(`(${escaped.join('|')})`, 'g');
}

// ===================== 领域识别 =====================

/**
 * 从文本中识别专业领域。
 *
 * 策略:
 * 1. 查找明确的领域标题行，如 "经济学"、"心理学" 等
 * 2. 查找 "XX学"、"XX科学"、"XX工程" 等学科名称
 * 3. 查找常见的领域分类关键词
 *
 * 返回: Map<领域名, { startLine: number, endLine: number }>
 */
function discoverDomains(text) {
  const lines = text.split('\n');
  const domainHeaders = [];

  // 常见学科/领域名称模式
  const domainPatterns = [
    // "XX学" 格式 — 经济学, 心理学, 社会学, 法学, 哲学, 文学, 历史学, 管理学, 教育学, 政治学...
    /^[\s]*(.{1,6}学)\s*$/,
    // "XX科学" 格式 — 计算机科学, 政治科学...
    /^[\s]*(.{1,6}科学)\s*$/,
    // "XX工程" 格式 — 软件工程, 土木工程...
    /^[\s]*(.{1,6}工程)\s*$/,
    // "XX医学" 格式 — 临床医学, 基础医学...
    /^[\s]*(.{1,6}医学)\s*$/,
    // 常见领域名（无"学"后缀）
    /^[\s]*(经济学|心理学|社会学|法学|哲学|文学|历史学|管理学|教育学|政治学|数学|物理学|化学|生物学|计算机|医学|工学|理学|农学|艺术学|军事学|交叉学科|马克思主义|新闻传播学|图书情报|公共管理|工商管理|理论经济学|应用经济学|统计学|力学|机械工程|材料科学|电子科学|信息通信|控制科学|计算机科学|建筑学|土木工程|化学工程|矿业工程|石油工程|纺织科学|轻工技术|交通运输|船舶海洋|航空宇航|兵器科学|核科学|农业工程|林业工程|环境科学|生物医学|食品科学|城乡规划|风景园林|软件工程|安全科学|生物工程|网络空间|系统科学|科学技术史|考古学|民族学|马克思主义理论|中共党史|党建|体育学|音乐舞蹈|戏剧影视|美术学|设计学)\s*$/,
    // "XX类" 格式 — 人文社科类, 理工类, 经管类...
    /^[\s]*(.{1,8}类)\s*$/,
    // "XX领域" 格式
    /^[\s]*(.{1,8}领域)\s*$/,
    // "XX学科" 格式
    /^[\s]*(.{1,8}学科)\s*$/,
    // 带编号的领域标题，如 "一、经济学" "1.经济学" "(一)经济学"
    /^[一二三四五六七八九十]+[、.．]\s*(.{1,8}学)\s*$/,
    /^\(\s*[一二三四五六七八九十]+\s*\)\s*(.{1,8}学)\s*$/,
    /^\d+[、.．]\s*(.{1,8}学)\s*$/,
  ];

  // 排除词 — 这些不是领域名
  const excludeWords = new Set([
    '级', '类', '等级', '级别', '认定', '目录', '附件', '序号', '编号',
    '分类', '说明', '备注', '总计', '合计', '小计', '期刊', '中文', '英文',
    '外文', '核心', '权威', '顶级', '一般', '扩展', '重要', '优秀', '普通',
    '补充', 'A+', 'A', 'B', 'C', 'D', 'E',
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 2) continue;

    for (const pattern of domainPatterns) {
      const match = line.match(pattern);
      if (match) {
        let domainName = match[1] || match[0];
        domainName = domainName.trim();

        // 过滤排除词
        if (excludeWords.has(domainName)) continue;
        // 过滤太短的（单字）
        if (domainName.length < 2) continue;
        // 过滤纯等级标记
        if (/^[A-Z]\+?$/.test(domainName)) continue;

        domainHeaders.push({ name: domainName, lineIndex: i });
        break;
      }
    }
  }

  // 去重（同名领域只保留第一个）
  const seen = new Set();
  const uniqueHeaders = domainHeaders.filter(h => {
    if (seen.has(h.name)) return false;
    seen.add(h.name);
    return true;
  });

  // 确定每个领域的行范围
  const domainMap = new Map();
  for (let i = 0; i < uniqueHeaders.length; i++) {
    const startLine = uniqueHeaders[i].lineIndex;
    const endLine = i + 1 < uniqueHeaders.length ? uniqueHeaders[i + 1].lineIndex - 1 : lines.length - 1;
    domainMap.set(uniqueHeaders[i].name, {
      startLine,
      endLine,
      text: lines.slice(startLine, endLine + 1).join('\n'),
    });
  }

  return domainMap;
}

// ===================== 中文/英文期刊判断 =====================

/**
 * 判断期刊名是否为中文期刊。
 * 如果期刊名中包含中文字符，则认为是中文期刊。
 */
function isChineseJournal(name) {
  return /[\u4e00-\u9fff]/.test(name);
}

// ===================== 英文期刊名清理 =====================

/**
 * 从英文期刊名中去除领域分类前缀。
 *
 * 很多等级文件中，英文期刊名前面会带有学科分类名，如：
 *   "ECONOMICS AMERICAN ECONOMIC REVIEW" → "AMERICAN ECONOMIC REVIEW"
 *   "COMPUTER SCIENCE IEEE TRANSACTIONS ON NEURAL NETWORKS" → "IEEE TRANSACTIONS ON NEURAL NETWORKS"
 *   "INFORMATION SCIENCE & LIBRARY SCIENCE JOURNAL OF INFORMATION TECHNOLOGY" → "JOURNAL OF INFORMATION TECHNOLOGY"
 *
 * 此函数识别并去除这些前缀。
 */
function cleanEnglishJournalName(name) {
  // 常见的学科分类前缀（大写，用空格分隔）
  const domainPrefixes = [
    // 单学科
    'ECONOMICS', 'BUSINESS', 'MANAGEMENT', 'FINANCE', 'ACCOUNTING',
    'PSYCHOLOGY', 'SOCIOLOGY', 'POLITICAL SCIENCE', 'LAW', 'PHILOSOPHY',
    'HISTORY', 'EDUCATION', 'COMMUNICATION', 'LINGUISTICS', 'LITERATURE',
    'MATHEMATICS', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'MEDICINE',
    'ENGINEERING', 'COMPUTER SCIENCE', 'AGRICULTURE', 'ENVIRONMENTAL SCIENCE',
    'ENERGY', 'MATERIALS SCIENCE', 'EARTH SCIENCE', 'GEOLOGY',
    'PUBLIC HEALTH', 'NURSING', 'PHARMACY', 'VETERINARY',
    'ARCHITECTURE', 'DESIGN', 'ART', 'MUSIC', 'THEATER',
    'SPORT SCIENCE', 'TOURISM', 'TRANSPORT', 'URBAN STUDIES',
    'INFORMATION SCIENCE', 'LIBRARY SCIENCE', 'INFORMATION SCIENCE & LIBRARY SCIENCE',
    'STATISTICS', 'DEMOGRAPHY', 'GEOGRAPHY', 'REGIONAL STUDIES',
    'INTERNATIONAL RELATIONS', 'PUBLIC ADMINISTRATION', 'SOCIAL WORK',
    'ANTHROPOLOGY', 'ARCHAEOLOGY', 'CULTURAL STUDIES', 'ETHICS',
    'CRIMINOLOGY', 'FORENSIC SCIENCE', 'LAW',
    'MARKETING', 'OPERATIONS RESEARCH', 'MANAGEMENT SCIENCE',
    'INDUSTRIAL ENGINEERING', 'CIVIL ENGINEERING', 'MECHANICAL ENGINEERING',
    'ELECTRICAL ENGINEERING', 'CHEMICAL ENGINEERING', 'BIOMEDICAL ENGINEERING',
    'OCEAN ENGINEERING', 'AEROSPACE ENGINEERING', 'NUCLEAR ENGINEERING',
    'METALLURGY', 'MINING', 'PETROLEUM ENGINEERING',
    'FOOD SCIENCE', 'TEXTILE SCIENCE', 'FORESTRY',
    'MIS', 'OPERATIONS', 'INSURANCE', 'BANKING',
    'LABOUR', 'LABOR', 'INDUSTRIAL RELATIONS',
    'PLANNING', 'DEVELOPMENT', 'DEVELOPMENT STUDIES',
    'AREA STUDIES', 'ASIAN STUDIES', 'EUROPEAN STUDIES',
    'FAMILY STUDIES', 'GENDER STUDIES', 'WOMEN\'S STUDIES',
    'GERONTOLOGY', 'REHABILITATION', 'SOCIAL SCIENCES',
    'HUMANITIES', 'MULTIDISCIPLINARY', 'INTERDISCIPLINARY',
    'LOGIC', 'RELIGION', 'THEOLOGY',
    // 缩写形式
    'ECON', 'BUS', 'MGT', 'FIN', 'ACCT',
    'PSYCH', 'SOC', 'POL SCI', 'ED',
    'COMP SCI', 'INFO SCI', 'LIB SCI',
    'ENVIRON SCI', 'MATER SCI', 'EARTH SCI',
  ];

  // 按长度降序排列，确保长前缀优先匹配
  const sortedPrefixes = [...domainPrefixes].sort((a, b) => b.length - a.length);

  let cleaned = name.trim();

  for (const prefix of sortedPrefixes) {
    // 匹配前缀在名称开头，后面跟空格和实际期刊名
    const prefixPattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i');
    if (prefixPattern.test(cleaned)) {
      cleaned = cleaned.replace(prefixPattern, '').trim();
      break; // 只去除一次前缀
    }
  }

  return cleaned;
}

// ===================== 通用解析逻辑 =====================

/**
 * 解析单个领域的文本，提取期刊等级数据。
 * 返回: { tiers, chinese_journals, english_journals }
 */
function parseDomainText(text) {
  // Step 1: 自动发现等级
  const discoveredTiers = discoverTiers(text);

  if (discoveredTiers.size === 0) {
    return null;
  }

  // 动态构建 tiers 对象
  const tiers = {};
  for (const tier of discoveredTiers) {
    tiers[tier] = [];
  }

  // 构建等级匹配正则
  const tierPattern = buildTierPattern(discoveredTiers);

  let match;

  const tierRegexStr = [...discoveredTiers].sort((a, b) => b.length - a.length)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  // ---- 策略1: 中文期刊 - 用 CN 号做锚点 ----
  const cnPattern = new RegExp(
    `\\d+\\s+([\\u4e00-\\u9fff（）\\w：·\\-]+(?:\\s[\\u4e00-\\u9fff\\w：·\\-]+)*)\\s+(?:CN\\d+\\s*-\\s*\\d+\\/[\\w]+|ISSN\\s*[\\dX]+|-)\\s*(${tierRegexStr})\\s*级?`,
    'g'
  );
  while ((match = cnPattern.exec(text)) !== null) {
    const journalName = match[1].trim();
    const tier = match[2].trim();
    if (journalName.length >= 2 && tiers[tier]) {
      tiers[tier].push(journalName);
    }
  }

  // ---- 策略2: 英文期刊 - 用 ISSN 号做锚点 ----
  const issnPattern = new RegExp(
    `(\\d+)\\s+([A-Z][A-Z\\s&',.\\-]+?)\\s+\\d{4}\\s*-\\s*[\\dX]{4}\\s*(${tierRegexStr})\\s*级?`,
    'g'
  );
  while ((match = issnPattern.exec(text)) !== null) {
    let remaining = match[2].trim();
    const tier = match[3].trim();

    const journalKeywords = /\b(JOURNAL|REVIEW|PROCEEDINGS|ANNALS|QUARTERLY|SCIENCE|STUDIES|LETTERS|MANAGEMENT|FINANCE|RESEARCH|ECONOMICS|PSYCHOLOGY|SOCIOLOGY|POLITICAL|ANALYSIS|AFFAIRS|POLICY|THEORY|PRACTICE|PERSPECTIVES|MEDICINE|ENGINEERING|COMPUTER|MATH|PHYSICS|CHEMISTRY|BIOLOGY|LAW|HISTORY|PHILOSOPHY|EDUCATION|COMMUNICATION|ENVIRONMENT|ENERGY|OPERATIONS|STATISTICS|MARKETING|ACCOUNTING|BANKING|INSURANCE|TRANSPORT|URBAN|RURAL|AGRICULTURE|HEALTH|CLINICAL|SURGICAL|NURSING|DENTAL|VETERINARY)\b/i;

    const kwMatch = remaining.match(journalKeywords);
    if (kwMatch) {
      const kwIndex = remaining.indexOf(kwMatch[0]);
      const beforeKw = remaining.substring(0, kwIndex).trim();
      const words = beforeKw.split(/\s+/);

      let journalStart = kwIndex;
      if (words.length > 0) {
        const lastWord = words[words.length - 1];
        if (lastWord.length > 2 && /^[A-Z]+$/.test(lastWord)) {
          const categoryWords = new Set([
            'ECONOMICS', 'BUSINESS', 'MANAGEMENT', 'LAW', 'FINANCE',
            'MEDICINE', 'ENGINEERING', 'SCIENCE', 'ARTS', 'HUMANITIES',
            'SOCIAL', 'NATURAL', 'APPLIED', 'PURE', 'INTERDISCIPLINARY',
          ]);
          if (!categoryWords.has(lastWord)) {
            journalStart = remaining.lastIndexOf(lastWord, kwIndex);
          }
        }
      }

      let journalName = remaining.substring(journalStart).trim();
      journalName = journalName.replace(/\s+/g, ' ').trim();

      if (journalName.length >= 5 && tiers[tier]) {
        tiers[tier].push(journalName);
      }
    } else {
      const parts = remaining.split(/\s{2,}/);
      if (parts.length >= 2) {
        const journalName = parts[parts.length - 1].trim();
        if (journalName.length >= 5 && tiers[tier]) {
          tiers[tier].push(journalName);
        }
      }
    }
  }

  // ---- 策略3: 直接匹配 "中文期刊名 等级" 格式 ----
  const directChinesePattern = new RegExp(
    `([\\u4e00-\\u9fff]{2,}(?:[\\u4e00-\\u9fff（）\\w：·]*)?)\\s+(${tierRegexStr})\\s*级?`,
    'g'
  );
  while ((match = directChinesePattern.exec(text)) !== null) {
    const journalName = match[1].trim();
    const tier = match[2].trim();
    if (journalName.length >= 2 && tiers[tier] && !tiers[tier].includes(journalName)) {
      if (!journalName.match(/^(中文|英文|外文|西南|学术|期刊|目录|附件|序号|编号|分类|学科|领域|等级|级别|认定|附件)/)) {
        tiers[tier].push(journalName);
      }
    }
  }

  // ---- 策略4: 英文 "JOURNAL_NAME 等级" 格式 ----
  const directEnglishPattern = new RegExp(
    `([A-Z][A-Z\\s&',.\\-]{5,}?)\\s+(${tierRegexStr})\\s*级?`,
    'g'
  );
  while ((match = directEnglishPattern.exec(text)) !== null) {
    let journalName = match[1].trim();
    const tier = match[2].trim();
    journalName = journalName.replace(/\s+/g, ' ').trim();
    if (journalName.length >= 5 && tiers[tier] && !tiers[tier].includes(journalName)) {
      tiers[tier].push(journalName);
    }
  }

  // ---- 去重和清理 ----
  for (const tier of Object.keys(tiers)) {
    const seen = new Set();
    tiers[tier] = tiers[tier].filter(j => {
      const normalized = j.replace(/\s+/g, ' ').trim();
      if (normalized.length < 2 || seen.has(normalized.toLowerCase())) return false;
      seen.add(normalized.toLowerCase());
      return true;
    });
  }

  // ---- 清理英文期刊名中的领域前缀 ----
  for (const tier of Object.keys(tiers)) {
    tiers[tier] = tiers[tier].map(j => {
      if (!isChineseJournal(j)) {
        return cleanEnglishJournalName(j);
      }
      return j;
    });
  }

  // 清理后再次去重（因为去除前缀后可能出现重复）
  for (const tier of Object.keys(tiers)) {
    const seen = new Set();
    tiers[tier] = tiers[tier].filter(j => {
      const normalized = j.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.length < 2 || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  // 移除空等级
  for (const tier of Object.keys(tiers)) {
    if (tiers[tier].length === 0) {
      delete tiers[tier];
    }
  }

  // 如果没有解析到任何期刊，返回 null
  const totalJournals = Object.values(tiers).reduce((sum, arr) => sum + arr.length, 0);
  if (totalJournals === 0) return null;

  // ---- 区分中文/英文期刊 ----
  const chineseJournals = {};
  const englishJournals = {};

  for (const [tier, journals] of Object.entries(tiers)) {
    for (const journal of journals) {
      if (isChineseJournal(journal)) {
        if (!chineseJournals[tier]) chineseJournals[tier] = [];
        chineseJournals[tier].push(journal);
      } else {
        if (!englishJournals[tier]) englishJournals[tier] = [];
        englishJournals[tier].push(journal);
      }
    }
  }

  return { tiers, chinese_journals: chineseJournals, english_journals: englishJournals };
}

/**
 * 解析完整文本，识别领域并提取各领域的期刊等级数据。
 */
function parseRankText(text) {
  // Step 1: 识别领域
  const domainMap = discoverDomains(text);
  console.log(`  识别到 ${domainMap.size} 个专业领域: ${[...domainMap.keys()].join(', ')}`);

  const domains = {};
  const allTiers = new Set();

  if (domainMap.size > 0) {
    // 按领域分别解析
    for (const [domainName, domainInfo] of domainMap.entries()) {
      console.log(`\n  解析领域: ${domainName}`);
      const result = parseDomainText(domainInfo.text);
      if (result) {
        domains[domainName] = result;
        for (const tier of Object.keys(result.tiers)) {
          allTiers.add(tier);
        }
        const total = Object.values(result.tiers).reduce((sum, arr) => sum + arr.length, 0);
        const cnCount = Object.values(result.chinese_journals).reduce((sum, arr) => sum + arr.length, 0);
        const enCount = Object.values(result.english_journals).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`    共 ${total} 个期刊 (中文: ${cnCount}, 英文: ${enCount})`);
      } else {
        console.log(`    未解析到期刊等级数据，跳过`);
      }
    }
  } else {
    // 没有识别到领域，将整个文件作为一个默认领域
    console.log('  未识别到明确的领域划分，将整个文件作为"默认"领域处理');
    const result = parseDomainText(text);
    if (result) {
      domains['默认'] = result;
      for (const tier of Object.keys(result.tiers)) {
        allTiers.add(tier);
      }
    }
  }

  // 如果没有解析到任何数据，尝试回退到无领域模式
  if (Object.keys(domains).length === 0) {
    console.log('  领域模式未解析到数据，尝试无领域回退模式...');
    const discoveredTiers = discoverTiers(text);
    console.log(`  自动发现等级: ${[...discoveredTiers].join(', ')}`);

    if (discoveredTiers.size > 0) {
      // 使用旧的解析逻辑作为回退
      const tiers = {};
      for (const tier of discoveredTiers) {
        tiers[tier] = [];
      }

      const tierRegexStr = [...discoveredTiers].sort((a, b) => b.length - a.length)
        .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');

      let match;

      // 策略1: CN号
      const cnPattern = new RegExp(
        `\\d+\\s+([\\u4e00-\\u9fff（）\\w：·\\-]+(?:\\s[\\u4e00-\\u9fff\\w：·\\-]+)*)\\s+(?:CN\\d+\\s*-\\s*\\d+\\/[\\w]+|ISSN\\s*[\\dX]+|-)\\s*(${tierRegexStr})\\s*级?`,
        'g'
      );
      while ((match = cnPattern.exec(text)) !== null) {
        const journalName = match[1].trim();
        const tier = match[2].trim();
        if (journalName.length >= 2 && tiers[tier]) {
          tiers[tier].push(journalName);
        }
      }

      // 策略2: ISSN号
      const issnPattern = new RegExp(
        `(\\d+)\\s+([A-Z][A-Z\\s&',.\\-]+?)\\s+\\d{4}\\s*-\\s*[\\dX]{4}\\s*(${tierRegexStr})\\s*级?`,
        'g'
      );
      while ((match = issnPattern.exec(text)) !== null) {
        let remaining = match[2].trim();
        const tier = match[3].trim();
        const journalKeywords = /\b(JOURNAL|REVIEW|PROCEEDINGS|ANNALS|QUARTERLY|SCIENCE|STUDIES|LETTERS|MANAGEMENT|FINANCE|RESEARCH|ECONOMICS|PSYCHOLOGY|SOCIOLOGY|POLITICAL|ANALYSIS|AFFAIRS|POLICY|THEORY|PRACTICE|PERSPECTIVES|MEDICINE|ENGINEERING|COMPUTER|MATH|PHYSICS|CHEMISTRY|BIOLOGY|LAW|HISTORY|PHILOSOPHY|EDUCATION|COMMUNICATION|ENVIRONMENT|ENERGY|OPERATIONS|STATISTICS|MARKETING|ACCOUNTING|BANKING|INSURANCE|TRANSPORT|URBAN|RURAL|AGRICULTURE|HEALTH|CLINICAL|SURGICAL|NURSING|DENTAL|VETERINARY)\b/i;
        const kwMatch = remaining.match(journalKeywords);
        if (kwMatch) {
          const kwIndex = remaining.indexOf(kwMatch[0]);
          const beforeKw = remaining.substring(0, kwIndex).trim();
          const words = beforeKw.split(/\s+/);
          let journalStart = kwIndex;
          if (words.length > 0) {
            const lastWord = words[words.length - 1];
            if (lastWord.length > 2 && /^[A-Z]+$/.test(lastWord)) {
              const categoryWords = new Set(['ECONOMICS', 'BUSINESS', 'MANAGEMENT', 'LAW', 'FINANCE', 'MEDICINE', 'ENGINEERING', 'SCIENCE', 'ARTS', 'HUMANITIES', 'SOCIAL', 'NATURAL', 'APPLIED', 'PURE', 'INTERDISCIPLINARY']);
              if (!categoryWords.has(lastWord)) {
                journalStart = remaining.lastIndexOf(lastWord, kwIndex);
              }
            }
          }
          let journalName = remaining.substring(journalStart).trim().replace(/\s+/g, ' ').trim();
          if (journalName.length >= 5 && tiers[tier]) {
            tiers[tier].push(journalName);
          }
        } else {
          const parts = remaining.split(/\s{2,}/);
          if (parts.length >= 2) {
            const journalName = parts[parts.length - 1].trim();
            if (journalName.length >= 5 && tiers[tier]) {
              tiers[tier].push(journalName);
            }
          }
        }
      }

      // 策略3: 中文直接匹配
      const directChinesePattern = new RegExp(
        `([\\u4e00-\\u9fff]{2,}(?:[\\u4e00-\\u9fff（）\\w：·]*)?)\\s+(${tierRegexStr})\\s*级?`,
        'g'
      );
      while ((match = directChinesePattern.exec(text)) !== null) {
        const journalName = match[1].trim();
        const tier = match[2].trim();
        if (journalName.length >= 2 && tiers[tier] && !tiers[tier].includes(journalName)) {
          if (!journalName.match(/^(中文|英文|外文|西南|学术|期刊|目录|附件|序号|编号|分类|学科|领域|等级|级别|认定|附件)/)) {
            tiers[tier].push(journalName);
          }
        }
      }

      // 策略4: 英文直接匹配
      const directEnglishPattern = new RegExp(
        `([A-Z][A-Z\\s&',.\\-]{5,}?)\\s+(${tierRegexStr})\\s*级?`,
        'g'
      );
      while ((match = directEnglishPattern.exec(text)) !== null) {
        let journalName = match[1].trim().replace(/\s+/g, ' ').trim();
        const tier = match[2].trim();
        if (journalName.length >= 5 && tiers[tier] && !tiers[tier].includes(journalName)) {
          tiers[tier].push(journalName);
        }
      }

      // 去重和清理
      for (const tier of Object.keys(tiers)) {
        const seen = new Set();
        tiers[tier] = tiers[tier].filter(j => {
          const normalized = j.replace(/\s+/g, ' ').trim();
          if (normalized.length < 2 || seen.has(normalized.toLowerCase())) return false;
          seen.add(normalized.toLowerCase());
          return true;
        });
        if (tiers[tier].length === 0) delete tiers[tier];
      }

      const total = Object.values(tiers).reduce((sum, arr) => sum + arr.length, 0);
      if (total > 0) {
        const chineseJournals = {};
        const englishJournals = {};
        for (const [tier, journals] of Object.entries(tiers)) {
          for (const journal of journals) {
            if (isChineseJournal(journal)) {
              if (!chineseJournals[tier]) chineseJournals[tier] = [];
              chineseJournals[tier].push(journal);
            } else {
              if (!englishJournals[tier]) englishJournals[tier] = [];
              englishJournals[tier].push(journal);
            }
          }
        }
        domains['默认'] = { tiers, chinese_journals: chineseJournals, english_journals: englishJournals };
        for (const tier of Object.keys(tiers)) allTiers.add(tier);
      }
    }
  }

  return {
    domains,
    all_domains: Object.keys(domains),
    all_tiers: [...allTiers],
  };
}

// ===================== 主函数 =====================

async function parseRank(filePath, outputPath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`找不到等级文件: ${filePath}\n请确认文件路径是否正确。`);
  }

  const ext = path.extname(filePath).toLowerCase();
  console.log(`正在读取等级文件: ${filePath}`);

  let text;
  if (ext === '.pdf') {
    text = await readPdf(filePath);
  } else if (ext === '.xlsx' || ext === '.xls') {
    text = await readExcel(filePath);
  } else if (ext === '.csv' || ext === '.txt') {
    text = readCsv(filePath);
  } else {
    throw new Error(`不支持的文件格式: ${ext}\n支持的格式: .pdf, .xlsx, .xls, .csv, .txt`);
  }

  console.log(`文件内容长度: ${text.length} 字符`);

  const result = parseRankText(text);

  // 统计
  let total = 0;
  for (const [domainName, domainData] of Object.entries(result.domains)) {
    console.log(`\n领域: ${domainName}`);
    for (const [tier, journals] of Object.entries(domainData.tiers)) {
      console.log(`  ${tier}: ${journals.length} 个期刊`);
      journals.slice(0, 3).forEach(j => console.log(`    - ${j}`));
      if (journals.length > 3) console.log(`    ... 还有 ${journals.length - 3} 个`);
      total += journals.length;
    }
    const cnCount = Object.values(domainData.chinese_journals).reduce((sum, arr) => sum + arr.length, 0);
    const enCount = Object.values(domainData.english_journals).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`  中文期刊: ${cnCount}, 英文期刊: ${enCount}`);
  }

  if (total === 0) {
    console.warn('⚠ 警告: 未解析到任何期刊等级数据！');
    console.warn('  可能的原因:');
    console.warn('  1. 文件格式不符合预期（不是表格格式）');
    console.warn('  2. 等级标记格式无法识别（当前支持: X级, X类, 顶级/权威/核心 等）');
    console.warn('  3. PDF 文本提取失败（扫描版 PDF 无法提取文字）');
    console.warn('  建议: 请将等级文件转为 Excel 或 CSV 格式后重试');
  }

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\n等级数据已保存到: ${outputPath}`);
  console.log(`\n可用领域: ${result.all_domains.join(', ')}`);
  console.log(`可用等级: ${result.all_tiers.join(', ')}`);
}

// CLI
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('用法: node parse_rank.js <等级文件路径> <输出JSON路径>');
  console.error('支持的格式: PDF, Excel (.xlsx/.xls), CSV, TXT');
  process.exit(1);
}

parseRank(args[0], args[1]).catch(err => {
  console.error(`❌ 错误: ${err.message}`);
  process.exit(1);
});
