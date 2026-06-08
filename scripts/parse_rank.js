/**
 * parse_rank.js - 通用解析期刊等级文件（PDF/Excel/CSV）
 *
 * 用法: node parse_rank.js <rank文件路径> <输出JSON路径>
 *
 * 输出 JSON 格式:
 * {
 *   "tiers": {
 *     "A+": ["期刊名1", ...],
 *     "A":  [...],
 *     "B":  [...],
 *     "C":  [...],
 *     ...  (自动发现所有等级)
 *   }
 * }
 *
 * 等级名称从文件内容中自动发现，不硬编码。
 * 支持的等级格式: A+级, A级, B级, C级, T1级, T2级, 一类, 二类, 顶级, 权威, 核心, 等
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

// ===================== 通用解析逻辑 =====================

function parseRankText(text) {
  // Step 1: 自动发现等级
  const discoveredTiers = discoverTiers(text);
  console.log(`  自动发现等级: ${[...discoveredTiers].join(', ')}`);

  if (discoveredTiers.size === 0) {
    console.warn('  ⚠ 未发现任何等级标记！');
    return {};
  }

  // 动态构建 tiers 对象
  const tiers = {};
  for (const tier of discoveredTiers) {
    tiers[tier] = [];
  }

  // 构建等级匹配正则
  const tierPattern = buildTierPattern(discoveredTiers);

  let match;

  // ---- 策略1: 中文期刊 - 用 CN 号做锚点 ----
  // 格式: 序号 期刊名 CN号 等级
  // 例: "1 经济研究 CN11 - 1081/F A+ 级"
  // 例: "2 管理世界 CN11 - 1235/F 权威"
  const tierRegexStr = [...discoveredTiers].sort((a, b) => b.length - a.length)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
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
  // 格式: 序号 [分类名] 期刊名 ISSN号 等级
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

  // 移除空等级
  for (const tier of Object.keys(tiers)) {
    if (tiers[tier].length === 0) {
      delete tiers[tier];
    }
  }

  return tiers;
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

  const tiers = parseRankText(text);

  // 统计
  let total = 0;
  for (const [tier, journals] of Object.entries(tiers)) {
    console.log(`  ${tier}: ${journals.length} 个期刊`);
    journals.slice(0, 3).forEach(j => console.log(`    - ${j}`));
    if (journals.length > 3) console.log(`    ... 还有 ${journals.length - 3} 个`);
    total += journals.length;
  }

  if (total === 0) {
    console.warn('⚠ 警告: 未解析到任何期刊等级数据！');
    console.warn('  可能的原因:');
    console.warn('  1. 文件格式不符合预期（不是表格格式）');
    console.warn('  2. 等级标记格式无法识别（当前支持: X级, X类, 顶级/权威/核心 等）');
    console.warn('  3. PDF 文本提取失败（扫描版 PDF 无法提取文字）');
    console.warn('  建议: 请将等级文件转为 Excel 或 CSV 格式后重试');
  }

  const result = { tiers };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`等级数据已保存到: ${outputPath}`);
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
