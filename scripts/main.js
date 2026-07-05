/**
 * main.js - HqLean 主入口脚本
 *
 * 用法:
 *   node main.js <文件夹路径> prepare
 *     → 扫描文件夹，解析 rank 文件，转换论文 PDF 为文本
 *     → 输出: temp/rank_data.json, temp/paper_1.txt, temp/paper_2.txt, ...
 *
 *   node main.js <文件夹路径> list-domains
 *     → 列出等级文件中识别到的所有专业领域
 *     → 输出: JSON 格式的领域列表和每个领域的期刊统计
 *
 *   node main.js <文件夹路径> infer-tiers
 *     → 从 rank_data.json 自动推断等级从高到低排序，默认取最高和次高
 *
 *   node main.js <文件夹路径> lean-export <refs_json>
 *     → 使用自动推断的最高和次高等级、全部领域、全部语言生成 Excel
 *
 *   node main.js <文件夹路径> export <refs_json> <tiers> [domains] [language] [--with-unmatched]
 *     → 匹配参考文献并生成 Excel
 *     → refs_json: 模型解析后的合并 JSON 文件路径
 *     → tiers: 要筛选的等级，逗号分隔，如 "A+,A"
 *     → domains: 要筛选的领域，逗号分隔，如 "经济学,心理学"（可选，默认全部领域）
 *     → language: 语言筛选，"chinese"/"english"/"all"（可选，默认 "all"）
 *
 * 完整工作流:
 *   1. node main.js "D:\论文" prepare        ← 脚本自动完成
 *   2. 脚本自动推断最高和次高等级             ← 无需询问用户
 *   3. 模型优先读取 model_input/paper_*.json  ← 低 token 解析参考文献
 *   4. node main.js "D:\论文" lean-export refs.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SCRIPTS_DIR = __dirname;

// ===================== 自动安装依赖 =====================

function ensureDependencies() {
  const nodeModulesPath = path.join(SCRIPTS_DIR, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    console.log('首次运行，正在安装依赖...');
    try {
      execSync('npm install', { cwd: SCRIPTS_DIR, stdio: 'inherit' });
      console.log('依赖安装完成。\n');
    } catch (e) {
      console.error('依赖安装失败，请手动运行: cd scripts && npm install');
      process.exit(1);
    }
  }
}

// ===================== 工具函数 =====================

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function findFiles(dir, predicate) {
  if (!fs.existsSync(dir)) {
    throw new Error(`文件夹不存在: ${dir}\n请确认路径是否正确。`);
  }
  return fs.readdirSync(dir)
    .filter(f => predicate(f))
    .map(f => path.join(dir, f));
}

function runNodeScript(scriptName, args) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  const cmd = `node "${scriptPath}" ${args.map(a => `"${a}"`).join(' ')}`;
  try {
    execSync(cmd, { encoding: 'utf-8', stdio: 'inherit', cwd: SCRIPTS_DIR });
  } catch (err) {
    throw new Error(`脚本 ${scriptName} 执行失败。请查看上方错误信息。`);
  }
}

function buildRankParseReport(rankData, rankFileName) {
  const lines = [];
  lines.push('# Rank Parse Report');
  lines.push('');
  lines.push(`Source file: ${rankFileName}`);
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Domains detected: ${(rankData.all_domains || []).length}`);
  lines.push(`- Tiers detected: ${(rankData.all_tiers || []).join(', ') || 'None'}`);
  lines.push('');

  const warnings = [];
  if (!rankData.all_domains || rankData.all_domains.length === 0) {
    warnings.push('No domains were detected.');
  }
  if (!rankData.all_tiers || rankData.all_tiers.length === 0) {
    warnings.push('No tiers were detected.');
  }

  lines.push('## Domains');
  lines.push('');
  for (const domainName of rankData.all_domains || []) {
    const domainData = rankData.domains[domainName];
    const total = Object.values(domainData.tiers || {}).reduce((sum, arr) => sum + arr.length, 0);
    const cnCount = Object.values(domainData.chinese_journals || {}).reduce((sum, arr) => sum + arr.length, 0);
    const enCount = Object.values(domainData.english_journals || {}).reduce((sum, arr) => sum + arr.length, 0);
    lines.push(`### ${domainName}`);
    lines.push('');
    lines.push(`- Total journals: ${total}`);
    lines.push(`- Chinese journals: ${cnCount}`);
    lines.push(`- English journals: ${enCount}`);
    lines.push('');
    lines.push('| Tier | Count | Chinese | English | Samples |');
    lines.push('|---|---:|---:|---:|---|');
    for (const [tier, journals] of Object.entries(domainData.tiers || {})) {
      const chinese = (domainData.chinese_journals && domainData.chinese_journals[tier] || []).length;
      const english = (domainData.english_journals && domainData.english_journals[tier] || []).length;
      const samples = journals.slice(0, 5).join('; ');
      lines.push(`| ${tier} | ${journals.length} | ${chinese} | ${english} | ${samples} |`);
      if (journals.length === 0) {
        warnings.push(`Domain "${domainName}" tier "${tier}" has no journals.`);
      }
    }
    lines.push('');
  }

  lines.push('## Warnings');
  lines.push('');
  if (warnings.length === 0) {
    lines.push('- None.');
  } else {
    warnings.forEach(warning => lines.push(`- ${warning}`));
  }
  lines.push('');
  lines.push('## Next Checks');
  lines.push('');
  lines.push('- Confirm that the detected domains match the rank file.');
  lines.push('- Confirm that each selected tier has plausible journal counts.');
  lines.push('- If counts look too low, convert the rank file to XLSX or CSV and rerun prepare.');
  lines.push('');

  return lines.join('\n');
}

function resolveInputPath(folderPath, inputPath) {
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.join(folderPath, inputPath);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''));
}

function tierScore(tier) {
  const raw = String(tier || '').trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/\s+/g, '')
    .replace(/[级類类刊]$/g, '')
    .toUpperCase();

  if (/^S\+*$/.test(normalized)) return 120 + (normalized.match(/\+/g) || []).length;

  const letter = normalized.match(/^([A-E])(\+*)$/);
  if (letter) {
    const base = { A: 100, B: 80, C: 60, D: 40, E: 20 }[letter[1]];
    return base + (letter[2] || '').length * 5;
  }

  const orderedPrefix = normalized.match(/^(T|Q)(\d+)$/);
  if (orderedPrefix) return 100 - Number(orderedPrefix[2]);

  const numeric = normalized.match(/^(\d+)(档|等|级)?$/);
  if (numeric) return 100 - Number(numeric[1]);

  const chineseNumber = raw.match(/^([一二三四五六七八九十])(类|档|等|级)$/);
  if (chineseNumber) {
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    return 100 - map[chineseNumber[1]];
  }

  const semanticScores = {
    顶级: 120,
    权威: 110,
    优秀: 105,
    优: 105,
    重要: 100,
    重点: 100,
    核心: 90,
    良: 80,
    中: 60,
    一般: 50,
    普通: 40,
    扩展: 30,
    补充: 20,
    差: 10,
    劣: 10,
  };

  return Object.prototype.hasOwnProperty.call(semanticScores, raw) ? semanticScores[raw] : null;
}

function inferTierOrder(rankData) {
  const tiers = rankData.all_tiers || [];
  const scored = tiers.map((tier, index) => ({
    tier,
    index,
    score: tierScore(tier),
  }));
  const known = scored.filter(item => item.score !== null);

  if (known.length >= 2 && known.length === tiers.length) {
    const sorted = [...scored].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });
    return {
      ordered_tiers: sorted.map(item => item.tier),
      selected_tiers: sorted.slice(0, 2).map(item => item.tier),
      confidence: 'high',
      reason: 'All tier labels matched known ordered patterns.',
    };
  }

  if (known.length >= 2) {
    const sortedKnown = [...known].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });
    return {
      ordered_tiers: sortedKnown.map(item => item.tier),
      selected_tiers: sortedKnown.slice(0, 2).map(item => item.tier),
      confidence: 'medium',
      reason: 'At least two tier labels matched known ordered patterns; unrecognized labels were ignored.',
      ignored_tiers: scored.filter(item => item.score === null).map(item => item.tier),
    };
  }

  return {
    ordered_tiers: tiers,
    selected_tiers: [],
    confidence: 'low',
    reason: 'Could not infer at least two ordered tiers from known patterns.',
  };
}

function inferTiers(folderPath) {
  const rankDataPath = path.join(folderPath, '.hq_temp', 'rank_data.json');
  if (!fs.existsSync(rankDataPath)) {
    console.error('❌ 错误: 等级数据文件不存在！请先运行 prepare 命令。');
    process.exit(1);
  }

  const rankData = readJsonFile(rankDataPath);
  const inference = inferTierOrder(rankData);
  const outputPath = path.join(folderPath, '.hq_temp', 'tier_inference.json');
  fs.writeFileSync(outputPath, JSON.stringify(inference, null, 2), 'utf-8');

  console.log('========================================');
  console.log('  HqLean - 自动等级推断');
  console.log('========================================\n');
  console.log(`置信度: ${inference.confidence}`);
  console.log(`原因: ${inference.reason}`);
  console.log(`等级顺序: ${(inference.ordered_tiers || []).join(', ') || '无法判断'}`);
  console.log(`默认筛选: ${(inference.selected_tiers || []).join(', ') || '无'}`);
  if (inference.ignored_tiers && inference.ignored_tiers.length > 0) {
    console.log(`忽略的未知等级: ${inference.ignored_tiers.join(', ')}`);
  }
  console.log(`\n推断结果已保存到: ${outputPath}`);

  if (!inference.selected_tiers || inference.selected_tiers.length < 2) {
    console.error('\n❌ 无法可靠推断最高和次高等级。请改用 export 命令手动指定等级。');
    process.exit(1);
  }

  return inference;
}

function createModelInput(folderPath, tempDir, paperIndex, paperFileName, txtPath, blocksPath) {
  const text = fs.readFileSync(txtPath, 'utf-8');
  const blocksData = readJsonFile(blocksPath);
  const modelInputDir = path.join(tempDir, 'model_input');
  ensureDir(modelInputDir);

  const modelInput = {
    paper_index: paperIndex,
    source_pdf: paperFileName,
    paper_text_path: txtPath,
    reference_blocks_path: blocksPath,
    first_page_preview: text.slice(0, 4500),
    block_summary: blocksData.summary || {},
    reference_blocks: blocksData.blocks || [],
    fallback: {
      read_full_text_when: [
        'reference_blocks is empty',
        'references_header_found is false and blocks look incomplete',
        'paper title or first author cannot be inferred from first_page_preview',
        'many extracted references have empty journal fields',
      ],
    },
  };

  const outputPath = path.join(modelInputDir, `paper_${paperIndex}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(modelInput, null, 2), 'utf-8');
  return outputPath;
}

// ===================== prepare 命令 =====================

function prepare(folderPath) {
  console.log('========================================');
  console.log('  HqLean - 准备阶段');
  console.log('========================================\n');

  // 1. 检查文件夹
  if (!fs.existsSync(folderPath)) {
    console.error(`❌ 错误: 文件夹不存在: ${folderPath}`);
    console.error('   请确认路径是否正确。');
    process.exit(1);
  }

  // 2. 创建临时目录
  const tempDir = path.join(folderPath, '.hq_temp');
  ensureDir(tempDir);
  console.log(`临时目录: ${tempDir}\n`);

  // 3. 查找 rank 文件
  const allFiles = fs.readdirSync(folderPath);
  const rankFile = allFiles.find(f => {
    const name = path.parse(f).name.toLowerCase();
    return name === 'rank';
  });

  if (!rankFile) {
    console.error('❌ 错误: 未找到等级文件！');
    console.error('   请在文件夹中放置一个名为 "rank" 的文件（如 rank.pdf, rank.xlsx）。');
    console.error('   该文件应包含学校指定的期刊等级认定信息。');
    process.exit(1);
  }

  const rankPath = path.join(folderPath, rankFile);
  console.log(`✓ 找到等级文件: ${rankFile}`);

  // 4. 解析 rank 文件
  console.log('\n--- 解析等级文件 ---');
  const rankOutput = path.join(tempDir, 'rank_data.json');
  runNodeScript('parse_rank.js', [rankPath, rankOutput]);
  console.log('');

  const rankData = readJsonFile(rankOutput);
  const rankReportPath = path.join(tempDir, 'rank_parse_report.md');
  fs.writeFileSync(rankReportPath, buildRankParseReport(rankData, rankFile), 'utf-8');
  console.log(`✓ 等级解析诊断报告: ${rankReportPath}`);

  // 5. 查找论文 PDF
  const paperFiles = allFiles.filter(f => {
    const ext = path.extname(f).toLowerCase();
    const name = path.parse(f).name.toLowerCase();
    return ext === '.pdf' && name !== 'rank';
  });

  if (paperFiles.length === 0) {
    console.error('❌ 错误: 未找到论文 PDF 文件！');
    console.error('   请在文件夹中放置要处理的论文 PDF 文件。');
    console.error('   注意: 名为 "rank" 的文件会被识别为等级文件，不会作为论文处理。');
    process.exit(1);
  }

  console.log(`✓ 找到 ${paperFiles.length} 篇论文:`);
  paperFiles.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));

  // 6. 转换论文 PDF 为文本
  console.log('\n--- 提取论文文本 ---');
  const paperTextPaths = [];
  const modelInputPaths = [];
  for (let i = 0; i < paperFiles.length; i++) {
    const pdfPath = path.join(folderPath, paperFiles[i]);
    const txtPath = path.join(tempDir, `paper_${i + 1}.txt`);
    console.log(`\n[${i + 1}/${paperFiles.length}] ${paperFiles[i]}`);
    runNodeScript('read_pdf.js', [pdfPath, txtPath]);
    const blocksPath = path.join(tempDir, `paper_${i + 1}_reference_blocks.json`);
    runNodeScript('split_references.js', [txtPath, blocksPath]);
    const modelInputPath = createModelInput(folderPath, tempDir, i + 1, paperFiles[i], txtPath, blocksPath);
    console.log(`✓ 模型精简输入: ${modelInputPath}`);
    paperTextPaths.push(txtPath);
    modelInputPaths.push(modelInputPath);
  }

  // 7. 输出摘要
  console.log('\n========================================');
  console.log('  准备完成！');
  console.log('========================================\n');
  console.log('下一步: 请让模型优先读取以下精简输入并解析参考文献:');
  modelInputPaths.forEach((p, i) => console.log(`  论文 ${i + 1}: ${p}`));
  console.log('\n仅在精简输入不足时回看完整文本:');
  paperTextPaths.forEach((p, i) => console.log(`  论文 ${i + 1}: ${p}`));
  console.log(`\n等级数据: ${rankOutput}`);

  console.log('\n可用领域:');
  for (const domainName of rankData.all_domains) {
    const domainData = rankData.domains[domainName];
    const total = Object.values(domainData.tiers).reduce((sum, arr) => sum + arr.length, 0);
    const cnCount = Object.values(domainData.chinese_journals).reduce((sum, arr) => sum + arr.length, 0);
    const enCount = Object.values(domainData.english_journals).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`  ${domainName}: ${total} 个期刊 (中文: ${cnCount}, 英文: ${enCount})`);
    for (const [tier, journals] of Object.entries(domainData.tiers)) {
      console.log(`    ${tier}: ${journals.length} 个期刊`);
    }
  }

  console.log('\n可用等级:');
  for (const tier of rankData.all_tiers) {
    console.log(`  ${tier}`);
  }

  const inference = inferTierOrder(rankData);
  const tierInferencePath = path.join(tempDir, 'tier_inference.json');
  fs.writeFileSync(tierInferencePath, JSON.stringify(inference, null, 2), 'utf-8');
  console.log('\n自动等级推断:');
  console.log(`  置信度: ${inference.confidence}`);
  console.log(`  默认筛选: ${(inference.selected_tiers || []).join(', ') || '无法自动判断'}`);
  console.log(`  推断结果: ${tierInferencePath}`);

  console.log('\n模型解析完成后，请运行:');
  console.log(`  node main.js "${folderPath}" lean-export <refs_json_path>`);
  console.log('\n例:');
  console.log(`  node main.js "${folderPath}" lean-export ".hq_temp/all_refs.json"`);
}

// ===================== list-domains 命令 =====================

function listDomains(folderPath) {
  const tempDir = path.join(folderPath, '.hq_temp');
  const rankDataPath = path.join(tempDir, 'rank_data.json');

  if (!fs.existsSync(rankDataPath)) {
    console.error('❌ 错误: 等级数据文件不存在！');
    console.error('   请先运行 prepare 命令。');
    process.exit(1);
  }

  const rankData = readJsonFile(rankDataPath);

  console.log('========================================');
  console.log('  可用专业领域');
  console.log('========================================\n');

  const domainSummary = [];

  for (const domainName of rankData.all_domains) {
    const domainData = rankData.domains[domainName];
    const total = Object.values(domainData.tiers).reduce((sum, arr) => sum + arr.length, 0);
    const cnCount = Object.values(domainData.chinese_journals).reduce((sum, arr) => sum + arr.length, 0);
    const enCount = Object.values(domainData.english_journals).reduce((sum, arr) => sum + arr.length, 0);
    const tiers = Object.keys(domainData.tiers);

    console.log(`领域: ${domainName}`);
    console.log(`  期刊总数: ${total} (中文: ${cnCount}, 英文: ${enCount})`);
    console.log(`  等级: ${tiers.join(', ')}`);
    for (const [tier, journals] of Object.entries(domainData.tiers)) {
      const cnInTier = (domainData.chinese_journals[tier] || []).length;
      const enInTier = (domainData.english_journals[tier] || []).length;
      console.log(`    ${tier}: ${journals.length} 个 (中文: ${cnInTier}, 英文: ${enInTier})`);
    }
    console.log('');

    domainSummary.push({
      name: domainName,
      total_journals: total,
      chinese_journals: cnCount,
      english_journals: enCount,
      tiers: tiers,
    });
  }

  // 同时输出 JSON 格式方便模型解析
  const summaryPath = path.join(tempDir, 'domains_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(domainSummary, null, 2), 'utf-8');
  console.log(`领域摘要已保存到: ${summaryPath}`);
}

// ===================== export 命令 =====================

function exportExcel(folderPath, refsJsonPath, tiersStr, domainsStr, language, options = {}) {
  console.log('========================================');
  console.log(options.lean ? '  HqLean - 导出阶段' : '  HqLean - 手动导出阶段');
  console.log('========================================\n');

  const tempDir = path.join(folderPath, '.hq_temp');
  const rankDataPath = path.join(tempDir, 'rank_data.json');

  // 1. 检查必要文件
  if (!fs.existsSync(refsJsonPath)) {
    console.error(`❌ 错误: 参考文献JSON文件不存在: ${refsJsonPath}`);
    console.error('   请确认模型已解析参考文献并保存为JSON文件。');
    process.exit(1);
  }

  if (!fs.existsSync(rankDataPath)) {
    console.error(`❌ 错误: 等级数据文件不存在: ${rankDataPath}`);
    console.error('   请先运行 prepare 命令。');
    process.exit(1);
  }

  const tiers = tiersStr.split(',').map(t => t.trim());
  console.log(`筛选等级: ${tiers.join(', ')}`);

  // 解析领域参数
  let selectedDomains = null;
  if (domainsStr && domainsStr.trim() !== '') {
    selectedDomains = domainsStr.split(',').map(d => d.trim());
    console.log(`筛选领域: ${selectedDomains.join(', ')}`);
  } else {
    console.log('筛选领域: 全部');
  }

  // 解析语言参数
  const lang = (language || 'all').toLowerCase();
  if (!['chinese', 'english', 'all'].includes(lang)) {
    console.error(`❌ 错误: 无效的语言参数: ${language}`);
    console.error('   可选值: chinese, english, all');
    process.exit(1);
  }
  console.log(`语言筛选: ${lang === 'chinese' ? '中文期刊' : lang === 'english' ? '英文期刊' : '全部'}`);

  // 2. 匹配参考文献
  console.log('\n--- 匹配参考文献 ---');
  const filteredPath = path.join(tempDir, 'filtered_refs.json');
  const unmatchedPath = path.join(tempDir, 'unmatched_refs.json');
  const matchArgs = [refsJsonPath, rankDataPath, tiersStr, filteredPath, domainsStr || '', lang];
  if (options.withUnmatched) matchArgs.push(unmatchedPath);
  runNodeScript('match_journals.js', matchArgs);
  console.log('');

  // 3. 生成 Excel
  console.log('--- 生成 Excel ---');
  const outputPath = path.join(folderPath, 'hq_references.xlsx');
  runNodeScript('generate_xlsx.js', ['--input', filteredPath, '--output', outputPath]);

  let unmatchedOutputPath = null;
  if (options.withUnmatched) {
    unmatchedOutputPath = path.join(folderPath, 'unmatched_refs.xlsx');
    runNodeScript('generate_xlsx.js', ['--input', unmatchedPath, '--output', unmatchedOutputPath]);
  }

  // 4. 清理临时文件
  console.log('\n--- 清理临时文件 ---');
  try {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log('✓ 临时文件已清理');
    }
  } catch (err) {
    console.warn(`⚠ 清理临时文件失败: ${err.message}`);
    console.warn('  你可以手动删除 .hq_temp 文件夹。');
  }

  console.log('\n========================================');
  console.log('  完成！');
  console.log('========================================\n');
  console.log(`Excel 文件已保存到: ${outputPath}`);
  if (unmatchedOutputPath) {
    console.log(`未匹配参考文献已保存到: ${unmatchedOutputPath}`);
  } else {
    console.log('轻量模式未生成未匹配参考文献表。需要诊断时请使用 --with-unmatched。');
  }
}

function leanExport(folderPath, refsJsonPath) {
  const inference = inferTiers(folderPath);
  if (inference.confidence === 'low') {
    console.error('❌ 等级推断置信度过低。请改用 export 命令手动指定等级。');
    process.exit(1);
  }
  const tiersStr = inference.selected_tiers.join(',');
  exportExcel(folderPath, refsJsonPath, tiersStr, '', 'all', { lean: true, withUnmatched: false });
}

// ===================== CLI =====================

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('HqLean - 低 token 高质量参考文献筛选');
  console.log('');
  console.log('用法:');
  console.log('  node main.js <文件夹路径> prepare');
  console.log('    扫描文件夹，解析等级文件，提取论文文本');
  console.log('');
  console.log('  node main.js <文件夹路径> list-domains');
  console.log('    列出等级文件中识别到的所有专业领域');
  console.log('');
  console.log('  node main.js <文件夹路径> infer-tiers');
  console.log('    自动推断等级顺序并默认选择最高、次高等级');
  console.log('');
  console.log('  node main.js <文件夹路径> lean-export <refs_json>');
  console.log('    使用最高和次高等级、全部领域、全部语言生成 Excel');
  console.log('');
  console.log('  node main.js <文件夹路径> export <refs_json> <tiers> [domains] [language] [--with-unmatched]');
  console.log('    手动指定筛选条件并生成 Excel');
  console.log('    refs_json: 模型解析后的参考文献 JSON 路径');
  console.log('    tiers: 要筛选的等级，逗号分隔，如 "A+,A"');
  console.log('    domains: 要筛选的领域，逗号分隔，如 "经济学,心理学"（可选，默认全部）');
  console.log('    language: 语言筛选 "chinese"/"english"/"all"（可选，默认 "all"）');
  console.log('');
  console.log('示例:');
  console.log('  node main.js "D:\\论文" prepare');
  console.log('  node main.js "D:\\论文" infer-tiers');
  console.log('  node main.js "D:\\论文" lean-export ".hq_temp/all_refs.json"');
  console.log('  node main.js "D:\\论文" list-domains');
  console.log('  node main.js "D:\\论文" export ".hq_temp/all_refs.json" "A+,A"');
  console.log('  node main.js "D:\\论文" export ".hq_temp/all_refs.json" "A+,A" "经济学,心理学" "all"');
  console.log('  node main.js "D:\\论文" export ".hq_temp/all_refs.json" "A+" "经济学" "chinese"');
  process.exit(0);
}

const folderPath = path.resolve(args[0]);
const command = args[1].toLowerCase();

if (['prepare', 'lean-export', 'export'].includes(command)) {
  ensureDependencies();
}

if (command === 'prepare') {
  prepare(folderPath);
} else if (command === 'list-domains') {
  listDomains(folderPath);
} else if (command === 'infer-tiers') {
  inferTiers(folderPath);
} else if (command === 'lean-export') {
  if (args.length < 3) {
    console.error('❌ 错误: lean-export 命令需要提供参考文献 JSON 路径。');
    console.error('   用法: node main.js <文件夹路径> lean-export <refs_json>');
    process.exit(1);
  }
  leanExport(folderPath, resolveInputPath(folderPath, args[2]));
} else if (command === 'export') {
  const positionalArgs = args.filter(arg => arg !== '--with-unmatched');
  if (positionalArgs.length < 4) {
    console.error('❌ 错误: export 命令需要提供参考文献 JSON 路径和筛选等级。');
    console.error('   用法: node main.js <文件夹路径> export <refs_json> <tiers> [domains] [language]');
    console.error('   例: node main.js "D:\\论文" export ".hq_temp/all_refs.json" "A+,A" "经济学" "all"');
    process.exit(1);
  }
  const domainsStr = positionalArgs[4] || '';
  const language = positionalArgs[5] || 'all';
  const withUnmatched = args.includes('--with-unmatched');
  exportExcel(folderPath, resolveInputPath(folderPath, positionalArgs[2]), positionalArgs[3], domainsStr, language, { withUnmatched });
} else {
  console.error(`❌ 未知命令: ${command}`);
  console.error('   可用命令: prepare, list-domains, infer-tiers, lean-export, export');
  process.exit(1);
}
