/**
 * main.js - HQ Literature Extract 主入口脚本
 *
 * 用法:
 *   node main.js <文件夹路径> prepare
 *     → 扫描文件夹，解析 rank 文件，转换论文 PDF 为文本
 *     → 输出: temp/rank_data.json, temp/paper_1.txt, temp/paper_2.txt, ...
 *
 *   node main.js <文件夹路径> export <refs_json> <tiers>
 *     → 匹配参考文献并生成 Excel
 *     → refs_json: 模型解析后的合并 JSON 文件路径
 *     → tiers: 要筛选的等级，逗号分隔，如 "A+,A"
 *
 * 完整工作流:
 *   1. node main.js "D:\论文" prepare        ← 脚本自动完成
 *   2. 模型读取 paper_*.txt，手动解析参考文献   ← 模型完成
 *   3. node main.js "D:\论文" export refs.json "A+,A"  ← 脚本自动完成
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

ensureDependencies();

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

// ===================== prepare 命令 =====================

function prepare(folderPath) {
  console.log('========================================');
  console.log('  HQ Literature Extract - 准备阶段');
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
  for (let i = 0; i < paperFiles.length; i++) {
    const pdfPath = path.join(folderPath, paperFiles[i]);
    const txtPath = path.join(tempDir, `paper_${i + 1}.txt`);
    console.log(`\n[${i + 1}/${paperFiles.length}] ${paperFiles[i]}`);
    runNodeScript('read_pdf.js', [pdfPath, txtPath]);
    paperTextPaths.push(txtPath);
  }

  // 7. 输出摘要
  console.log('\n========================================');
  console.log('  准备完成！');
  console.log('========================================\n');
  console.log('下一步: 请让模型读取以下文件并解析参考文献:');
  paperTextPaths.forEach((p, i) => console.log(`  论文 ${i + 1}: ${p}`));
  console.log(`\n等级数据: ${rankOutput}`);

  // 读取等级数据摘要
  const rankData = JSON.parse(fs.readFileSync(rankOutput, 'utf-8'));
  console.log('\n可用等级:');
  for (const [tier, journals] of Object.entries(rankData.tiers)) {
    if (journals.length > 0) {
      console.log(`  ${tier}: ${journals.length} 个期刊`);
    }
  }

  console.log('\n模型解析完成后，请运行:');
  console.log(`  node main.js "${folderPath}" export <refs_json_path> "<tiers>"`);
  console.log('\n例:');
  console.log(`  node main.js "${folderPath}" export temp/all_refs.json "A+,A"`);
}

// ===================== export 命令 =====================

function exportExcel(folderPath, refsJsonPath, tiersStr) {
  console.log('========================================');
  console.log('  HQ Literature Extract - 导出阶段');
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
  console.log(`筛选等级: ${tiers.join(', ')}\n`);

  // 2. 匹配参考文献
  console.log('--- 匹配参考文献 ---');
  const filteredPath = path.join(tempDir, 'filtered_refs.json');
  runNodeScript('match_journals.js', [refsJsonPath, rankDataPath, tiersStr, filteredPath]);
  console.log('');

  // 3. 生成 Excel
  console.log('--- 生成 Excel ---');
  const outputPath = path.join(folderPath, 'hq_references.xlsx');
  runNodeScript('generate_xlsx.js', ['--input', filteredPath, '--output', outputPath]);

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
}

// ===================== CLI =====================

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('HQ Literature Extract - 从论文中提取高质量参考文献');
  console.log('');
  console.log('用法:');
  console.log('  node main.js <文件夹路径> prepare');
  console.log('    扫描文件夹，解析等级文件，提取论文文本');
  console.log('');
  console.log('  node main.js <文件夹路径> export <refs_json> <tiers>');
  console.log('    匹配参考文献并生成 Excel');
  console.log('    refs_json: 模型解析后的参考文献 JSON 路径');
  console.log('    tiers: 要筛选的等级，逗号分隔，如 "A+,A"');
  console.log('');
  console.log('示例:');
  console.log('  node main.js "D:\\论文" prepare');
  console.log('  node main.js "D:\\论文" export ".hq_temp/all_refs.json" "A+,A"');
  process.exit(0);
}

const folderPath = path.resolve(args[0]);
const command = args[1].toLowerCase();

if (command === 'prepare') {
  prepare(folderPath);
} else if (command === 'export') {
  if (args.length < 4) {
    console.error('❌ 错误: export 命令需要提供参考文献 JSON 路径和筛选等级。');
    console.error('   用法: node main.js <文件夹路径> export <refs_json> <tiers>');
    console.error('   例: node main.js "D:\\论文" export ".hq_temp/all_refs.json" "A+,A"');
    process.exit(1);
  }
  exportExcel(folderPath, path.resolve(args[2]), args[3]);
} else {
  console.error(`❌ 未知命令: ${command}`);
  console.error('   可用命令: prepare, export');
  process.exit(1);
}
