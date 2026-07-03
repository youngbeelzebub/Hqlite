# Reference Extraction Rules

This document defines the rules for extracting references from academic paper text. **This step is performed by the model (you), not by a script.**

## Overview

After the PDF is converted to plain text by `read_pdf.js`, you must read the text output and parse the references section into structured JSON. This cannot be reliably automated because citation formats vary widely across papers.

## Step-by-Step Process

### 1. Locate the References Section

Search the text for common reference section headers:
- "References", "REFERENCES", "Bibliography", "Works Cited", "Literature Cited", "参考文献"
- These are typically near the end of the document
- If no explicit header is found, look for a section where entries follow a consistent citation pattern

### 2. Extract Paper Metadata

From the **first page** of the text, extract:
- **Paper title**: Usually the largest/most prominent text at the top
- **First author's last name**: From the author list immediately after the title
- **Sheet name**: Combine as `{First letter of title}-{First author last name}` (e.g., `B-Bini`)

### 3. Identify Individual References

References are typically separated by:
- Numbered entries: `[1]`, `(1)`, `1.`, `1)` — use the numbering as delimiters
- Unnumbered entries: separated by newlines with a hanging indent pattern
- Repeated-author entries: lines beginning with an em dash or long dash, such as `—,`, `——,`, or `---,`, are separate references and inherit the author(s) from the immediately preceding reference
- Each entry is one complete reference — do not split across lines

### 4. Extract Four Fields Per Reference

#### Title
- Usually the most prominent text element in the entry
- For APA/Harvard style: the title follows the author(s) and year, often in quotes
- For Vancouver/numbered style: the title follows the authors, typically ending with a period
- If the title is in a non-English language, preserve it as-is

#### Year
- Look for a 4-digit number between 1900–2030
- Common patterns: `(2023)`, `, 2023,`, `. 2023.`
- If multiple years appear (e.g., original publication + reprint), use the most recent
- If no year is found, record as "N/A"

#### Journal
- The journal name typically appears after the title
- Common indicators: "Journal of", "Review of", "Proceedings of", "Annals of", "Quarterly"
- For conference papers: extract the conference name
- For books: extract the publisher name (e.g., "Princeton University Press")
- For working papers/preprints: extract the series name (e.g., "NBER Working Paper", "SSRN", "arXiv")

#### Author(s)
- Authors typically appear at the beginning of the reference
- Common formats:
  - `Smith, J., & Jones, R.` (APA)
  - `Smith J, Jones R.` (Vancouver)
  - `Smith, John, and Robert Jones.` (Chicago)
- If an entry begins with a repeated-author dash (`—`, `——`, `---`) followed by additional authors, replace the dash with the immediately preceding reference's author prefix. Example: after `Kahneman, Daniel and Amos Tversky`, the next entry `—, Jack L. Knetsch, and Richard Thaler` should be interpreted as `Kahneman, Daniel, Jack L. Knetsch, and Richard Thaler`.
- For multiple authors (>3), list the first author followed by "et al."
- Preserve the original name format as much as possible

### 5. Output JSON

Write a JSON file with this exact structure:

```json
{
  "paper_title": "Full Paper Title",
  "first_author": "LastName",
  "sheet_name": "T-LastName",
  "references": [
    { "title": "Paper Title", "year": "2023", "journal": "Journal Name", "authors": "Smith et al." },
    { "title": "Another Title", "year": "2019", "journal": "Science", "authors": "Zhang and Li" }
  ]
}
```

## Common Citation Formats (Examples)

### APA Style
```
Smith, J. A., & Jones, R. B. (2023). The impact of AI on labor markets. Quarterly Journal of Economics, 138(2), 789-845.
```
→ Title: "The impact of AI on labor markets", Year: "2023", Journal: "Quarterly Journal of Economics", Authors: "Smith and Jones"

### Vancouver Style
```
3. Smith JA, Jones RB. The impact of AI on labor markets. Q J Econ. 2023;138(2):789-845.
```
→ Title: "The impact of AI on labor markets", Year: "2023", Journal: "Q J Econ", Authors: "Smith and Jones"

### Chicago Style
```
Smith, John A., and Robert B. Jones. "The Impact of AI on Labor Markets." Quarterly Journal of Economics 138, no. 2 (2023): 789-845.
```
→ Title: "The Impact of AI on Labor Markets", Year: "2023", Journal: "Quarterly Journal of Economics", Authors: "Smith and Jones"

## Handling Edge Cases

| Situation | Rule |
|-----------|------|
| Reference with no clear title | Use the first substantive phrase after the author/year |
| Reference with no journal (e.g., book chapter) | Use the publisher name or "Book: [Title]" |
| Reference with no author | Mark author as "N/A" |
| Entry begins with `—,` / `——,` / `---,` | Treat it as a new reference and inherit the previous reference's repeated author prefix |
| Non-English reference | Extract as-is, do not translate |
| Duplicate reference | Keep the first occurrence, skip duplicates |
| Incomplete reference | Still extract available fields, mark missing ones as "N/A" |
| Working paper (NBER, SSRN, arXiv) | Use series as journal (e.g., "NBER Working Paper") |
| Conference proceedings | Use conference name as journal |

## Important Notes

- **Accuracy matters more than completeness**: It's better to correctly parse 80% of references than to incorrectly parse 100%.
- **When in doubt, use your judgment**: You understand academic citation conventions — trust your knowledge.
- **Journal names are critical**: The journal field is used for tier matching, so it must be as accurate as possible.
- **Don't over-parse**: If a reference is too garbled or incomplete, skip it rather than producing garbage data.
