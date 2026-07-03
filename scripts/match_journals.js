/**
 * match_journals.js - 将提取的参考文献与期刊等级数据匹配
 *
 * 用法: node match_journals.js <refs_json> <rank_json> <筛选等级> <输出json> [domains] [language] [unmatched_json]
 *   筛选等级: 逗号分隔，如 "A+,A"
 *   domains: 逗号分隔的领域名，如 "经济学,心理学"（可选，默认全部领域）
 *   language: "chinese"/"english"/"all"（可选，默认 "all"）
 */

const fs = require('fs');

function normalize(str) {
  return str
    .toLowerCase()
    // 合并连字符断词：如 "economet- rica" → "econometrica"
    // 模式：字母 + 可选连字符 + 空格 + 小写字母开头（说明是断词续行）
    .replace(/(\w)-\s+(\w)/g, '$1$2')
    .replace(/[^\w\s\u4e00-\u9fff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildJournalMap(rankData, selectedDomains, language) {
  const map = new Map();

  // 确定要处理的领域
  const domainsToProcess = selectedDomains && selectedDomains.length > 0
    ? selectedDomains
    : rankData.all_domains || Object.keys(rankData.domains || {});

  for (const domainName of domainsToProcess) {
    const domainData = rankData.domains[domainName];
    if (!domainData) {
      console.warn(`  ⚠ 领域 "${domainName}" 不存在，跳过`);
      continue;
    }

    // 确定要使用的期刊集合
    let journalSource;
    if (language === 'chinese') {
      journalSource = domainData.chinese_journals || {};
    } else if (language === 'english') {
      journalSource = domainData.english_journals || {};
    } else {
      // "all" - 合并中文和英文期刊
      journalSource = domainData.tiers || {};
    }

    for (const [tier, journals] of Object.entries(journalSource)) {
      for (const journal of journals) {
        const key = normalize(journal);
        if (key.length > 2) {
          // 如果已有映射，保留（不覆盖），因为同一期刊可能出现在多个领域
          if (!map.has(key)) {
            map.set(key, { tier, journal, domain: domainName });
          }
        }
      }
    }
  }

  return map;
}

function matchJournal(journalName, journalMap) {
  if (!journalName || journalName === 'N/A') return null;

  const normalized = normalize(journalName);

  // 策略1: 精确匹配
  if (journalMap.has(normalized)) {
    return { ...journalMap.get(normalized), match_level: 1, match_score: 1 };
  }

  // 策略1.5: 去空格匹配
  // PDF 解析常导致期刊名断词，如 "QUART ERLY JOURNAL" 代替 "QUARTERLY JOURNAL"
  // 去掉所有空格后比较，可修复此类问题
  const collapsed = normalized.replace(/\s/g, '');
  for (const [rankedJournal, tier] of journalMap.entries()) {
    const rankedCollapsed = rankedJournal.replace(/\s/g, '');
    if (rankedCollapsed === collapsed) {
      return { ...tier, match_level: 1.5, match_score: 1 };
    }
  }

  // 策略2: 子串包含匹配
  // 条件:
  //   - 双方长度都 >= 8（短名期刊如 "science"、"nature" 只走精确匹配）
  //   - 较短者占较长者长度比例 >= 0.6（避免 "journal of economics" 匹配到 "journal"）
  //   - 较短者必须是较长者的完整词组边界（避免部分词组重叠）
  for (const [rankedJournal, info] of journalMap.entries()) {
    if (normalized.length < 8 || rankedJournal.length < 8) continue;
    const shorter = Math.min(normalized.length, rankedJournal.length);
    const longer = Math.max(normalized.length, rankedJournal.length);
    if (shorter / longer < 0.6) continue;
    // 检查是否是完整词组边界匹配
    const isSubstr = normalized.includes(rankedJournal) || rankedJournal.includes(normalized);
    if (isSubstr) {
      // 确保匹配在词边界上（被包含的字符串前后是空格或字符串首尾）
      const [container, contained] = normalized.length >= rankedJournal.length
        ? [normalized, rankedJournal]
        : [rankedJournal, normalized];
      const idx = container.indexOf(contained);
      const beforeOk = idx === 0 || container[idx - 1] === ' ';
      const afterOk = idx + contained.length === container.length || container[idx + contained.length] === ' ';
      if (beforeOk && afterOk) {
        return { ...info, match_level: 2, match_score: shorter / longer };
      }
    }
  }

  // 策略3: 常见缩写匹配
  const abbreviations = {
    'aer': 'american economic review',
    'qje': 'quarterly journal of economics',
    'jpe': 'journal of political economy',
    'res': 'review of economic studies',
    'restud': 'review of economic studies',
    'jel': 'journal of economic literature',
    'jep': 'journal of economic perspectives',
    'jfe': 'journal of financial economics',
    'jf': 'journal of finance',
    'rfs': 'review of financial studies',
    'jme': 'journal of monetary economics',
    'jue': 'journal of urban economics',
    'jhe': 'journal of health economics',
    'jpubl': 'journal of public economics',
    'jie': 'journal of international economics',
    'ier': 'international economic review',
    'restat': 'review of economics and statistics',
    'pnas': 'proceedings of the national academy of sciences',
    'nature': 'nature',
    'science': 'science',
    'ms': 'management science',
    'or': 'operations research',
    'misq': 'mis quarterly',
    'isr': 'information systems research',
    'mksc': 'marketing science',
    'jmr': 'journal of marketing research',
    'jm': 'journal of marketing',
    'jcr': 'journal of consumer research',
    'orgsci': 'organization science',
    'jom': 'journal of operations management',
    'rp': 'research policy',
    'amj': 'academy of management journal',
    'amr': 'academy of management review',
    'asq': 'administrative science quarterly',
    'smj': 'strategic management journal',
    'jibs': 'journal of international business studies',
    'os': 'organization studies',
    'obhdp': 'organizational behavior and human decision processes',
    'jap': 'journal of applied psychology',
  };

  const lowerJournal = journalName.toLowerCase().trim();
  if (abbreviations[lowerJournal]) {
    const expanded = abbreviations[lowerJournal];
    if (journalMap.has(expanded)) {
      return { ...journalMap.get(expanded), match_level: 3, match_score: 1 };
    }
    for (const [rankedJournal, info] of journalMap.entries()) {
      if (rankedJournal.includes(expanded) || expanded.includes(rankedJournal)) {
        return { ...info, match_level: 3, match_score: 0.95 };
      }
    }
  }

  // 策略4: 模糊词匹配
  // 排除常见通用词，避免误匹配
  const stopWords = new Set([
    'journal', 'review', 'proceedings', 'annals', 'quarterly',
    'science', 'sciences', 'research', 'studies', 'letters',
    'international', 'national', 'american', 'european', 'british',
    'association', 'society', 'institute', 'university', 'college',
    'transactions', 'advances', 'progress', 'current', 'annual',
    'applied', 'theoretical', 'computational', 'general', 'special',
    'series', 'bulletin', 'report', 'communication', 'communications',
    'information', 'systems', 'technology', 'technologies',
    'management', 'engineering', 'medicine', 'medical',
    'social', 'natural', 'environmental', 'public',
    'analysis', 'theory', 'practice', 'perspectives',
    'policy', 'affairs', 'development', 'education',
    'economic', 'economics', 'political', 'psychology',
    'sociology', 'philosophy', 'history', 'law',
    'mathematical', 'physical', 'chemical', 'biological',
    'computer', 'computing', 'data', 'digital',
    'health', 'clinical', 'surgical',
    'processing', 'processing systems',
  ]);

  const journalWords = normalized.split(' ').filter(w => w.length > 3 && !stopWords.has(w));
  if (journalWords.length >= 2) {
    let bestMatch = null;
    let bestScore = 0;
    for (const [rankedJournal, info] of journalMap.entries()) {
      const rankedWords = rankedJournal.split(' ').filter(w => w.length > 3 && !stopWords.has(w));
      if (rankedWords.length < 2) continue;
      const overlap = journalWords.filter(w => rankedWords.includes(w)).length;
      const score = overlap / Math.max(journalWords.length, rankedWords.length);
      if (score > bestScore && score >= 0.8) {
        bestScore = score;
        bestMatch = { ...info, match_level: 4, match_score: score };
      }
    }
    if (bestMatch) return bestMatch;
  }

  return null;
}

function matchJournals(refsData, rankData, tiersToFilter, selectedDomains, language) {
  const journalMap = buildJournalMap(rankData, selectedDomains, language);
  console.log(`已加载 ${journalMap.size} 个期刊等级条目 (领域: ${selectedDomains && selectedDomains.length > 0 ? selectedDomains.join(', ') : '全部'}, 语言: ${language || 'all'})`);

  const results = [];
  const unmatchedResults = [];
  const papers = Array.isArray(refsData) ? refsData : [refsData];

  for (const paper of papers) {
    const filtered = [];
    const unmatched = [];

    for (const ref of paper.references) {
      const match = matchJournal(ref.journal, journalMap);
      if (match && tiersToFilter.includes(match.tier)) {
        filtered.push({
          ...ref,
          matched_tier: match.tier,
          matched_journal: match.journal,
          matched_domain: match.domain,
          match_level: match.match_level,
          match_score: match.match_score,
        });
      } else if (!match) {
        unmatched.push({
          ...ref,
          unmatched_reason: 'No journal match in selected domain/language pool',
        });
      }
    }

    // 排序: 年份降序 → 期刊升序
    filtered.sort((a, b) => {
      const yearDiff = (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
      if (yearDiff !== 0) return yearDiff;
      return (a.journal || '').localeCompare(b.journal || '');
    });

    console.log(`论文 "${paper.paper_title}": 共 ${paper.references.length} 条参考文献, ${filtered.length} 条匹配`);

    results.push({
      sheet_name: paper.sheet_name,
      paper_title: paper.paper_title,
      references: filtered,
    });
    unmatchedResults.push({
      sheet_name: paper.sheet_name,
      paper_title: paper.paper_title,
      references: unmatched,
    });
  }

  return { results, unmatchedResults };
}

// CLI
const args = process.argv.slice(2);
if (args.length < 4) {
  console.error('用法: node match_journals.js <refs_json> <rank_json> <筛选等级> <输出json> [domains] [language] [unmatched_json]');
  console.error('  筛选等级: 逗号分隔，如 "A+,A"');
  console.error('  domains: 逗号分隔的领域名，如 "经济学,心理学"（可选，默认全部）');
  console.error('  language: "chinese"/"english"/"all"（可选，默认 "all"）');
  process.exit(1);
}

let refsData, rankData;
try {
  refsData = JSON.parse(fs.readFileSync(args[0], 'utf-8'));
} catch (err) {
  console.error(`❌ 无法读取参考文献JSON: ${args[0]}`);
  console.error('   请确认模型已解析参考文献并保存为JSON文件。');
  process.exit(1);
}

try {
  rankData = JSON.parse(fs.readFileSync(args[1], 'utf-8'));
} catch (err) {
  console.error(`❌ 无法读取等级数据JSON: ${args[1]}`);
  console.error('   请先运行 prepare 命令生成等级数据。');
  process.exit(1);
}

const tiersToFilter = args[2].split(',').map(t => t.trim());
console.log(`筛选等级: ${tiersToFilter.join(', ')}`);

// 解析领域参数
const domainsStr = args[4] || '';
const selectedDomains = domainsStr.trim() !== '' ? domainsStr.split(',').map(d => d.trim()) : null;
if (selectedDomains) {
  console.log(`筛选领域: ${selectedDomains.join(', ')}`);
} else {
  console.log('筛选领域: 全部');
}

// 解析语言参数
const language = (args[5] || 'all').toLowerCase();
console.log(`语言筛选: ${language === 'chinese' ? '中文期刊' : language === 'english' ? '英文期刊' : '全部'}`);

const { results, unmatchedResults } = matchJournals(refsData, rankData, tiersToFilter, selectedDomains, language);

fs.writeFileSync(args[3], JSON.stringify(results, null, 2), 'utf-8');
console.log(`✓ 匹配结果已保存到: ${args[3]}`);

if (args[6]) {
  fs.writeFileSync(args[6], JSON.stringify(unmatchedResults, null, 2), 'utf-8');
  console.log(`✓ 未匹配参考文献已保存到: ${args[6]}`);
}
