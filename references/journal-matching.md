# Journal Matching Rules

This document defines the rules for matching extracted reference journal names against the journal ranking data.

## Domain and Language Filtering

The rank file may contain journals organized by professional domains (e.g., "经济学", "心理学"). The matching process supports filtering by domain and language:

### Domain Filtering
- After `prepare` command, the model reads the domain list and presents it to the user
- User selects one or more domains (multi-select)
- Only journals from selected domains are included in the matching pool
- If no domain is selected, all domains are included

### Language Filtering
- Each domain's journals are classified as Chinese or English based on the journal name
  - Chinese journals: journal name contains Chinese characters
  - English journals: journal name does not contain Chinese characters
- User can choose to filter by language:
  - `chinese`: Only match against Chinese journals
  - `english`: Only match against English journals
  - `all`: Match against all journals (default)

### Combined Filtering
- Domain and language filters are applied together
- Example: domain="经济学", language="chinese" → only match against Chinese journals in the economics domain
- Example: domain="经济学,心理学", language="all" → match against all journals in both economics and psychology domains

## Matching Strategy

Use a multi-level matching approach, from strict to relaxed:

### Level 1: Exact Match (Case-Insensitive)
- Normalize both strings: lowercase, strip leading/trailing whitespace
- Compare directly
- Example: "Journal of Finance" matches "journal of finance"

### Level 2: Abbreviation Match
- Compare against known common abbreviations
- The rank file may use abbreviations (e.g., "J. Financ." for "Journal of Finance")
- Build an abbreviation map from the rank file itself: if both "J. Financ." and "Journal of Finance" appear in the same tier, treat them as equivalent
- Common abbreviation patterns:
  - "J." = "Journal"
  - "Rev." = "Review"
  - "Proc." = "Proceedings"
  - "Acad." = "Academy"
  - "Econ." = "Economics" / "Economic"
  - "Financ." = "Finance" / "Financial"
  - "Mgmt." = "Management"
  - "Sci." = "Science" / "Scientific"
  - "Int." = "International"
  - "Res." = "Research"
  - "Stud." = "Studies"
  - "Q." = "Quarterly"
  - "Ann." = "Annals" / "Annual"

### Level 3: Substring Match
- Check if the shorter name is a substring of the longer name
- Minimum substring length: 8 characters (to avoid false positives)
- Example: "Energy Economics" matches "Energy Economics and Policy"

### Level 4: Token-Based Fuzzy Match
- Split both names into tokens (words)
- Compare token overlap using Jaccard similarity
- Threshold: ≥ 0.7 similarity (at least 70% of tokens overlap)
- Example: "Journal of Financial Economics" vs "Financial Economics Journal" → tokens overlap significantly

## Matching Priority

1. Always prefer the highest-level match (Level 1 > Level 2 > Level 3 > Level 4)
2. If multiple journals in the rank file match at the same level, prefer the one with the higher tier
3. If a reference matches journals in different tiers, report the highest tier match

## Rank File Parsing

### Domain Detection
- Scan the text for domain/field headers (e.g., "经济学", "心理学", "管理学")
- Common patterns: "XX学", "XX科学", "XX工程", "XX医学", "XX类", "XX学科", "XX领域"
- Numbered headers: "一、经济学", "1.经济学", "(一)经济学"
- Each domain section contains its own set of journals and tiers
- If no domains are detected, the entire file is treated as a single "默认" (default) domain

### Chinese/English Classification
- Within each domain, journals are automatically classified by language:
  - Journal names containing Chinese characters → Chinese journals
  - Journal names without Chinese characters → English journals
- This classification is stored in `chinese_journals` and `english_journals` fields

### Output JSON Structure
```json
{
  "domains": {
    "经济学": {
      "tiers": { "A+": ["经济研究", ...], "A": [...], ... },
      "chinese_journals": { "A+": ["经济研究", ...], ... },
      "english_journals": { "A+": ["American Economic Review", ...], ... }
    },
    "心理学": { ... }
  },
  "all_domains": ["经济学", "心理学", ...],
  "all_tiers": ["A+", "A", "B", "C", ...]
}
```

### PDF Format
- Scan for tables or structured text containing journal names and tier labels
- Common tier labels: "A+", "A", "B", "C", "D", "T1", "T2", "T3", "Q1", "Q2", "顶级", "权威", "核心"
- Tier labels may appear as column headers, row prefixes, or section headers
- Build a mapping: `{tier_label: [list of journal names]}`

### Excel Format (.xlsx/.xls)
- Read each sheet; each sheet may represent a tier or contain a tier column
- Identify the column containing journal names and the column/sheet containing tier labels
- Build the same mapping structure

### CSV Format
- Parse rows; identify journal name column and tier column
- Handle different delimiters (comma, semicolon, tab)

## Output Format

After matching, each reference should be augmented with tier information:

```json
{
  "title": "Paper Title",
  "year": "2023",
  "journal": "Journal of Finance",
  "authors": "Smith et al.",
  "matched_tier": "A",
  "match_level": 1
}
```

- `matched_tier`: The tier from the rank file, or `null` if no match found
- `match_level`: The matching level used (1-4), useful for debugging

## Filtering Rules

- Only include references where `matched_tier` is in the user's selected tier(s)
- References with no match are excluded from the final output
- If a reference matches a journal in a non-selected tier, exclude it
