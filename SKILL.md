---
name: "hqlite-lean"
description: "Lean one-pass extraction of high-quality references from academic paper PDFs using a rank file. Use when the user wants Hqlite-style journal-tier filtering with fewer questions, lower token use, automatic top-tier selection, and a single Excel output."
---

# HqLean

Run Hqlite in low-token mode: do not ask the user for domain, language, or tier choices unless inference fails. Preserve the original rank parsing, reference extraction, matching, and Excel generation logic as much as possible.

## Input Folder

The user provides an absolute folder path:

```text
<folder>/
├── rank.pdf|rank.xlsx|rank.xls|rank.csv|rank.txt
├── paper1.pdf
├── paper2.pdf
└── ...
```

Only process files in the folder root. Treat `rank.*` as the journal-tier file and all other PDFs as papers.

## Workflow

1. Check Node.js:

```bash
node --version
```

If unavailable, tell the user Node.js v16+ is required.

2. Run prepare:

```bash
node <skill-path>/scripts/main.js "<folder>" prepare
```

This creates `.hq_temp/rank_data.json`, `.hq_temp/rank_parse_report.md`, `.hq_temp/paper_*.txt`, `.hq_temp/paper_*_reference_blocks.json`, and `.hq_temp/model_input/paper_*.json`.

3. Infer tiers automatically:

```bash
node <skill-path>/scripts/main.js "<folder>" infer-tiers
```

Use the inferred top two tiers. Do not ask the user when the result is confident.

4. Extract references with the smallest useful context:

- Read `.hq_temp/model_input/paper_*.json` first.
- Use its `reference_blocks` as the extraction source.
- Read full `.hq_temp/paper_*.txt` only if blocks are missing, clearly incomplete, or title/author cannot be inferred.
- For each paper, write references with this schema:

```json
{
  "paper_title": "Full Paper Title",
  "first_author": "LastName",
  "sheet_name": "T-LastName",
  "references": [
    { "title": "Paper Title", "year": "2023", "journal": "Journal Name", "authors": "Smith et al." }
  ]
}
```

Merge all papers into `.hq_temp/all_refs.json`.

5. Run lean export:

```bash
node <skill-path>/scripts/main.js "<folder>" lean-export ".hq_temp/all_refs.json"
```

`lean-export` defaults to all domains, all languages, inferred top two tiers, and only writes `hq_references.xlsx`.

## Fallbacks

Ask the user only when one of these happens:

- Tier order cannot be inferred confidently.
- No reliable reference blocks are detected.
- Extracted references have many empty `journal` fields.
- JSON validation fails.
- The user explicitly wants a different domain, language, tier, or unmatched-reference diagnosis.

## Optional Diagnostics

Use full mode only when the user asks to inspect missing matches:

```bash
node <skill-path>/scripts/main.js "<folder>" export ".hq_temp/all_refs.json" "<tiers>" "" "all" --with-unmatched
```

Detailed extraction rules live in `references/extraction-rules.md`; read them only when block-based extraction is ambiguous.
