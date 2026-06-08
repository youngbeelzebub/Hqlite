/**
 * generate_xlsx.js - 从筛选后的参考文献生成格式化 Excel 文件
 *
 * 用法: node generate_xlsx.js --input <json文件> --output <xlsx路径>
 */

const fs = require('fs');
const ExcelJS = require('exceljs');

const COLUMNS = [
  { header: 'Title', key: 'title', width: 50, align: 'left' },
  { header: 'Year', key: 'year', width: 10, align: 'center' },
  { header: 'Journal', key: 'journal', width: 35, align: 'left' },
  { header: 'Author(s)', key: 'authors', width: 30, align: 'left' },
];

const HEADER_BG = 'FF4472C4';
const HEADER_FONT_COLOR = 'FFFFFFFF';
const ALT_ROW_COLOR = 'FFF2F2F2';
const BORDER_COLOR = 'FFD9D9D9';
const MAX_SHEET_NAME_LEN = 31;

function sanitizeSheetName(name) {
  let sanitized = name.replace(/[\\/?*\[\]:]/g, '_');
  if (sanitized.length > MAX_SHEET_NAME_LEN) {
    sanitized = sanitized.substring(0, MAX_SHEET_NAME_LEN);
  }
  return sanitized;
}

function createStyledWorkbook(data) {
  const workbook = new ExcelJS.Workbook();

  for (const paper of data) {
    const sheetName = sanitizeSheetName(paper.sheet_name || 'Sheet');
    const refs = paper.references || [];

    const ws = workbook.addWorksheet(sheetName);

    ws.columns = COLUMNS.map(col => ({
      header: col.header,
      key: col.key,
      width: col.width,
    }));

    const headerRow = ws.getRow(1);
    headerRow.font = { name: 'Calibri', size: 11, bold: true, color: { argb: HEADER_FONT_COLOR } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.border = {
      top: { style: 'thin', color: { argb: BORDER_COLOR } },
      left: { style: 'thin', color: { argb: BORDER_COLOR } },
      bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
      right: { style: 'thin', color: { argb: BORDER_COLOR } },
    };

    ws.views = [{ state: 'frozen', ySplit: 1 }];

    refs.forEach((ref, idx) => {
      const row = ws.addRow([ref.title || '', ref.year || 'N/A', ref.journal || '', ref.authors || '']);
      row.font = { name: 'Calibri', size: 10 };
      row.border = {
        top: { style: 'thin', color: { argb: BORDER_COLOR } },
        left: { style: 'thin', color: { argb: BORDER_COLOR } },
        bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
        right: { style: 'thin', color: { argb: BORDER_COLOR } },
      };

      if (idx % 2 === 1) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_ROW_COLOR } };
      }

      row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };
      row.getCell(4).alignment = { horizontal: 'left', vertical: 'middle' };
    });

    if (refs.length > 0) {
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: refs.length + 1, column: COLUMNS.length },
      };
    }
  }

  return workbook;
}

// CLI
const args = process.argv.slice(2);
let inputPath = '';
let outputPath = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--input' && args[i + 1]) inputPath = args[i + 1];
  if (args[i] === '--output' && args[i + 1]) outputPath = args[i + 1];
}

if (!inputPath || !outputPath) {
  console.error('用法: node generate_xlsx.js --input <json文件> --output <xlsx路径>');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
} catch (err) {
  console.error(`❌ 无法读取输入文件: ${inputPath}`);
  console.error('   请确认文件存在且格式正确。');
  process.exit(1);
}

createStyledWorkbook(data)
  .xlsx.writeFile(outputPath)
  .then(() => {
    console.log(`✓ Excel 文件已保存到: ${outputPath}`);
    const totalRefs = data.reduce((sum, p) => sum + (p.references || []).length, 0);
    console.log(`  共 ${data.length} 个工作表, ${totalRefs} 条参考文献`);
  })
  .catch(err => {
    console.error(`❌ 生成Excel文件失败: ${err.message}`);
    console.error('   可能的原因:');
    console.error('   1. 输出路径没有写入权限');
    console.error('   2. 文件正在被其他程序占用');
    process.exit(1);
  });
