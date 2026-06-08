/**
 * read_pdf.js - 从 PDF 文件提取纯文本
 *
 * 用法: node read_pdf.js <pdf路径> <输出txt路径>
 */

const fs = require('fs');

async function readPdf(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`找不到PDF文件: ${filePath}\n请确认文件路径是否正确。`);
  }

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
    if (err.message.includes('Invalid PDF')) {
      throw new Error(`PDF文件格式无效: ${filePath}\n文件可能已损坏或不是有效的PDF。`);
    }
    throw new Error(`读取PDF文件失败: ${err.message}\n如果是扫描版PDF，文字无法被提取，请尝试使用文字版PDF。`);
  }
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('用法: node read_pdf.js <pdf路径> <输出txt路径>');
  process.exit(1);
}

readPdf(args[0])
  .then(text => {
    fs.writeFileSync(args[1], text, 'utf-8');
    console.log(`✓ 文本已保存到: ${args[1]}`);
    console.log(`  文本长度: ${text.length} 字符`);

    if (text.trim().length === 0) {
      console.warn('⚠ 警告: 提取的文本为空！');
      console.warn('  可能的原因:');
      console.warn('  1. 这是扫描版PDF（图片形式），无法提取文字');
      console.warn('  2. PDF使用了特殊编码');
      console.warn('  建议: 请使用文字版PDF，或先用OCR工具转换');
    }
  })
  .catch(err => {
    console.error(`❌ 错误: ${err.message}`);
    process.exit(1);
  });
