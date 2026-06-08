---
name: "hq-literature-extract"
description: "Extracts references from academic papers, matches them against user-specified journal quality tiers from a PDF, and exports filtered high-quality references to an Excel file. Invoke when user wants to filter paper references by journal ranking or extract high-quality literature from reference lists."
---

# HQ Literature Extract

从论文中提取参考文献，按期刊等级筛选，输出高质量文献 Excel 表。

## 何时调用

- 用户提供文件夹路径，想从中提取高质量参考文献
- 用户想按期刊等级筛选论文参考文献
- 用户想要一个 Excel 输出的筛选后高质量参考文献

## 前置条件

需要 **Node.js** (v16+)。在运行任何命令之前，先检测 Node.js 是否可用：

```bash
node --version
```

如果报错（如 `'node' 不是内部或外部命令`），提示用户：
> 本工具需要 Node.js v16+，请先安装：https://nodejs.org/

依赖会在首次运行时自动安装，无需手动操作。

## 文件夹结构（用户准备）

```
<用户指定文件夹>/
├── rank.pdf          # 期刊等级认定文件（必须命名为 rank，支持 .pdf/.xlsx/.xls/.csv/.txt）
├── paper1.pdf        # 论文 1
├── paper2.pdf        # 论文 2
└── ...
```

### 规则
1. **文件夹路径**：用户必须提供文件夹的绝对路径
2. **rank 文件**：必须命名为 `rank`（如 rank.pdf, rank.xlsx），这是学校指定的期刊等级认定文件
3. **论文文件**：除 rank 文件外的 PDF 文件会被当作论文处理
4. **不扫描子文件夹**：只处理指定文件夹根目录下的文件
5. **缺少 rank 文件**：如果没有 rank 文件，提示用户添加

## 工作流

### Step 1: 运行 prepare 命令

```bash
node <skill-path>/scripts/main.js "<文件夹路径>" prepare
```

此命令自动完成：
- 扫描文件夹，找到 rank 文件和论文 PDF
- 解析 rank 文件，识别专业领域，提取期刊等级数据 → `.hq_temp/rank_data.json`
- 将每篇论文 PDF 转为纯文本 → `.hq_temp/paper_1.txt`, `.hq_temp/paper_2.txt`, ...

运行后，读取输出的领域摘要和等级摘要。

### Step 1.5: 用户选择领域和语言（由你完成）

**这一步必须由模型与用户交互完成。**

1. 读取 prepare 命令输出的领域列表
2. 使用 AskUserQuestion 工具，让用户选择要筛选的专业领域（多选）
3. 使用 AskUserQuestion 工具，询问用户要提取中文期刊、英文期刊还是全部
4. 读取等级摘要，让用户选择要筛选的等级（多选）

用户选择后，记录以下信息：
- **选中的领域**: 如 "经济学,心理学"
- **语言类型**: "chinese" / "english" / "all"
- **选中的等级**: 如 "A+,A"

### Step 2: 模型解析参考文献（由你完成）

**这一步无法自动化，必须由模型完成。**

1. 读取 `.hq_temp/paper_*.txt` 文件
2. 在文本中找到 References/参考文献 部分
3. 从第一页提取论文标题和第一作者（用于 sheet 命名）
4. 逐条解析参考文献，提取四个字段：Title, Year, Journal, Authors
5. 将结果写入 JSON 文件

详细解析规则见 [references/extraction-rules.md](references/extraction-rules.md)

#### JSON 格式

每篇论文一个 JSON 文件，格式如下：

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

**sheet 命名规则**：`{论文标题首字母}-{第一作者姓氏}`，如 "Behavioral Economics of AI" by Bini → `B-Bini`

#### 合并 JSON

将所有论文的 JSON 合并为一个数组，保存为 `.hq_temp/all_refs.json`：

```json
[
  { "paper_title": "...", "sheet_name": "...", "references": [...] },
  { "paper_title": "...", "sheet_name": "...", "references": [...] }
]
```

### Step 3: 运行 export 命令

```bash
node <skill-path>/scripts/main.js "<文件夹路径>" export "<refs_json路径>" "<等级>" "<领域>" "<语言>"
```

例：
```bash
node <skill-path>/scripts/main.js "D:\论文" export ".hq_temp/all_refs.json" "A+,A" "经济学,心理学" "all"
node <skill-path>/scripts/main.js "D:\论文" export ".hq_temp/all_refs.json" "A+" "经济学" "chinese"
```

此命令自动完成：
- 根据用户选择的领域和语言，筛选对应的期刊等级数据
- 匹配参考文献与筛选后的期刊等级数据
- 筛选用户选择的等级
- 生成格式化 Excel 文件 → `<文件夹>/hq_references.xlsx`
- 清理临时文件（`.hq_temp` 目录）

## 输出

- **文件**：`hq_references.xlsx`，保存在用户指定的文件夹中
- **工作表**：每篇论文一个 sheet，命名为 `{标题首字母}-{第一作者姓氏}`
- **列**：Title | Year | Journal | Author(s)
- **排序**：年份降序 → 期刊升序

## 脚本说明

| 脚本 | 功能 |
|------|------|
| [scripts/main.js](scripts/main.js) | 主入口：prepare、list-domains 和 export 三条命令 |
| [scripts/read_pdf.js](scripts/read_pdf.js) | PDF 转纯文本 |
| [scripts/parse_rank.js](scripts/parse_rank.js) | 解析等级文件 → 识别领域 → 期刊等级 JSON（含中文/英文分类） |
| [scripts/match_journals.js](scripts/match_journals.js) | 匹配参考文献与等级数据（支持领域和语言筛选） |
| [scripts/generate_xlsx.js](scripts/generate_xlsx.js) | 生成格式化 Excel |

## 参考文档

| 文件 | 内容 |
|------|------|
| [references/extraction-rules.md](references/extraction-rules.md) | 参考文献解析规则和示例 |
| [references/journal-matching.md](references/journal-matching.md) | 期刊名匹配策略 |
| [assets/excel-output-template.md](assets/excel-output-template.md) | Excel 格式规范 |
