/**
 * split_references.js - Pre-split paper text into reference blocks for model extraction.
 *
 * Usage:
 *   node split_references.js <paper_txt> <output_json>
 */

const fs = require('fs');
const path = require('path');

const HEADER_PATTERN = /(?:^|\n)\s*(references|bibliography|works cited|literature cited|参考文献)\s*(?:\n|$)/gi;
const REPEATED_AUTHOR_PREFIX_PATTERN = /^[\u2012\u2013\u2014\u2015-]{1,3}\s*,?\s+/;

function normalizeLines(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/-\n(?=[a-z])/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function locateReferences(text) {
  let match;
  let lastMatch = null;
  while ((match = HEADER_PATTERN.exec(text)) !== null) {
    lastMatch = match;
  }

  if (!lastMatch) {
    return {
      found: false,
      start_index: -1,
      header: null,
      text: '',
    };
  }

  return {
    found: true,
    start_index: lastMatch.index,
    header: lastMatch[1],
    text: text.slice(lastMatch.index).trim(),
  };
}

function splitNumberedReferences(refText) {
  const normalized = refText.replace(/\n(?=\s{2,}\S)/g, ' ');
  const patterns = [
    /(?:^|\n)\s*(?:\[(\d{1,4})\]|(\d{1,4})[.)])\s+/g,
    /(?:^|\n)\s*\((\d{1,4})\)\s+/g,
  ];

  for (const pattern of patterns) {
    const matches = [...normalized.matchAll(pattern)];
    if (matches.length < 3) continue;

    const blocks = [];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
      const raw = normalized.slice(start, end).trim();
      if (raw.length > 20) {
        blocks.push({
          index: blocks.length + 1,
          marker: matches[i][0].trim(),
          raw,
        });
      }
    }
    if (blocks.length >= 3) return blocks;
  }

  return [];
}

function splitByParagraphs(refText) {
  const withoutHeader = refText
    .replace(/^\s*(references|bibliography|works cited|literature cited|参考文献)\s*/i, '')
    .trim();

  const paragraphs = withoutHeader
    .replace(/\n\s*(?=[\u2012\u2013\u2014\u2015-]{1,3}\s*,?\s+)/g, '\n\n')
    .split(/\n\s*\n+/)
    .map(p => p.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 30);

  if (paragraphs.length >= 3) {
    return paragraphs.map((raw, index) => ({ index: index + 1, marker: '', raw }));
  }

  const lines = withoutHeader.split('\n').map(line => line.trim()).filter(Boolean);
  const blocks = [];
  let current = '';

  for (const line of lines) {
    const repeatedAuthorEntry = REPEATED_AUTHOR_PREFIX_PATTERN.test(line);
    const looksLikeNewEntry = repeatedAuthorEntry ||
      /^[A-Z\u4e00-\u9fff][^.!?。！？]{2,120}(?:\(\d{4}\)|,\s*\d{4}|\.?\s+\d{4}\.)/.test(line);
    if (looksLikeNewEntry && current.length > 30) {
      blocks.push(current.trim());
      current = line;
    } else {
      current = current ? `${current} ${line}` : line;
    }
  }
  if (current.length > 30) blocks.push(current.trim());

  return blocks.map((raw, index) => ({ index: index + 1, marker: '', raw }));
}

function createSummary(inputPath, located, blocks) {
  return {
    source_file: path.basename(inputPath),
    references_header_found: located.found,
    references_header: located.header,
    references_start_index: located.start_index,
    block_count: blocks.length,
    notes: blocks.length === 0
      ? 'No reliable reference blocks were detected. The model should inspect the full paper text.'
      : 'Use these blocks as extraction candidates; the model should still verify titles, years, journals, and authors.',
  };
}

function splitReferences(inputPath, outputPath) {
  const text = normalizeLines(fs.readFileSync(inputPath, 'utf-8'));
  const located = locateReferences(text);
  const candidateText = located.found ? located.text : text.slice(Math.floor(text.length * 0.6));
  let blocks = splitNumberedReferences(candidateText);

  if (blocks.length === 0) {
    blocks = splitByParagraphs(candidateText);
  }

  const result = {
    summary: createSummary(inputPath, located, blocks),
    blocks,
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`✓ 参考文献预切分完成: ${outputPath} (${blocks.length} blocks)`);
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('用法: node split_references.js <paper_txt> <output_json>');
  process.exit(1);
}

try {
  splitReferences(args[0], args[1]);
} catch (err) {
  console.error(`❌ 参考文献预切分失败: ${err.message}`);
  process.exit(1);
}
