/**
 * match_journals.js - 将提取的参考文献与期刊等级数据匹配
 *
 * 用法: node match_journals.js <refs_json> <rank_json> <筛选等级> <输出json>
 *   筛选等级: 逗号分隔，如 "A+,A"
 */

const fs = require('fs');

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildJournalMap(rankData) {
  const map = new Map();
  for (const [tier, journals] of Object.entries(rankData.tiers)) {
    for (const journal of journals) {
      const key = normalize(journal);
      if (key.length > 2) {
        map.set(key, tier);
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
    return journalMap.get(normalized);
  }

  // 策略2: 子串包含匹配
  for (const [rankedJournal, tier] of journalMap.entries()) {
    if (normalized.includes(rankedJournal) || rankedJournal.includes(normalized)) {
      return tier;
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
      return journalMap.get(expanded);
    }
    for (const [rankedJournal, tier] of journalMap.entries()) {
      if (rankedJournal.includes(expanded) || expanded.includes(rankedJournal)) {
        return tier;
      }
    }
  }

  // 策略4: 模糊词匹配
  const journalWords = normalized.split(' ').filter(w => w.length > 3);
  if (journalWords.length >= 2) {
    let bestMatch = null;
    let bestScore = 0;
    for (const [rankedJournal, tier] of journalMap.entries()) {
      const rankedWords = rankedJournal.split(' ').filter(w => w.length > 3);
      const overlap = journalWords.filter(w => rankedWords.includes(w)).length;
      const score = overlap / Math.max(journalWords.length, rankedWords.length);
      if (score > bestScore && score >= 0.6) {
        bestScore = score;
        bestMatch = tier;
      }
    }
    if (bestMatch) return bestMatch;
  }

  return null;
}

function matchJournals(refsData, rankData, tiersToFilter) {
  const journalMap = buildJournalMap(rankData);
  console.log(`已加载 ${journalMap.size} 个期刊等级条目`);

  const results = [];
  const papers = Array.isArray(refsData) ? refsData : [refsData];

  for (const paper of papers) {
    const filtered = [];

    for (const ref of paper.references) {
      const matchedTier = matchJournal(ref.journal, journalMap);
      if (matchedTier && tiersToFilter.includes(matchedTier)) {
        filtered.push({ ...ref, matched_tier: matchedTier });
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
  }

  return results;
}

// CLI
const args = process.argv.slice(2);
if (args.length < 4) {
  console.error('用法: node match_journals.js <refs_json> <rank_json> <筛选等级> <输出json>');
  console.error('  筛选等级: 逗号分隔，如 "A+,A"');
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

const results = matchJournals(refsData, rankData, tiersToFilter);

fs.writeFileSync(args[3], JSON.stringify(results, null, 2), 'utf-8');
console.log(`✓ 匹配结果已保存到: ${args[3]}`);
