# Excel Output Template

This document defines the exact format for the output Excel file.

## File Specification

- **Format**: `.xlsx` (Office Open XML)
- **Filename**: `hq_references.xlsx`
- **Location**: Same folder as the user-specified input folder

## Sheet Structure

### Sheet Naming Convention

Format: `{FirstLetter}-{FirstAuthorLastName}`

Rules:
- `FirstLetter`: The first letter of the paper title (uppercase), excluding articles ("A", "An", "The")
  - Example: "The Impact of Climate Change" → use "I" (skip "The")
- `FirstAuthorLastName`: The last name of the first author
  - Example: "John Smith" → "Smith"
- Combined: "I-Smith"
- Max length: 31 characters (Excel limit)
- Invalid characters for sheet names: `\ / ? * [ ] :` — replace with `_`
- If the name is too long, truncate the author name portion first

### Column Structure

Each sheet has exactly 4 columns:

| Column | Header | Width | Alignment | Description |
|--------|--------|-------|-----------|-------------|
| A | Title | 50 | Left | Full paper title |
| B | Year | 10 | Center | Publication year |
| C | Journal | 35 | Left | Journal name as extracted |
| D | Author(s) | 30 | Left | Author names |

### Formatting Rules

1. **Header row**:
   - Bold text
   - Background color: `#4472C4` (medium blue)
   - Font color: `#FFFFFF` (white)
   - Font size: 11
   - Freeze the header row (row 1 stays visible when scrolling)

2. **Data rows**:
   - Font size: 10
   - Alternating row colors: white (`#FFFFFF`) and light gray (`#F2F2F2`)
   - No bold text in data rows

3. **Borders**:
   - Thin borders around all cells
   - Border color: `#D9D9D9`

4. **Sorting**:
   - Sort by Year (descending) as primary sort
   - Then by Journal (ascending) as secondary sort
   - Then by Title (ascending) as tertiary sort

5. **Auto-filter**:
   - Enable auto-filter on the header row so users can filter by any column

### Example Sheet

Sheet name: `I-Smith`

| Title | Year | Journal | Author(s) |
|-------|------|---------|-----------|
| Impact of Monetary Policy on Growth | 2023 | Journal of Finance | Smith et al. |
| Interest Rates and Market Dynamics | 2022 | Review of Economic Studies | Smith and Jones |
| Capital Allocation Strategies | 2021 | American Economic Review | Smith et al. |

## Multi-Paper Output

When multiple papers are processed:
- Each paper gets its own sheet
- Sheets are ordered alphabetically by sheet name
- No summary sheet is created unless the user explicitly requests one

## Single-Paper Output

When only one paper is processed:
- One sheet with the same naming convention
- Same column structure and formatting
