# HQ Literature Extract

从学术论文中提取参考文献，按期刊等级筛选，输出高质量文献 Excel 表。

## 功能

- 自动解析学校期刊等级认定文件（PDF/Excel/CSV），自动发现等级分类
- 从论文 PDF 中提取参考文献文本
- 模型智能解析参考文献（标题、年份、期刊、作者）
- 多级期刊名匹配（精确 → 子串 → 缩写 → 模糊）
- 输出格式化 Excel 文件，每篇论文一个工作表

## 前置条件

- **Node.js** v16+
- 首次使用安装依赖：
  ```bash
  cd scripts && npm install
  ```

## 使用方法

### 1. 准备文件夹

```
你的文件夹/
├── rank.pdf          # 期刊等级认定文件（必须命名为 rank）
├── paper1.pdf        # 论文 1
├── paper2.pdf        # 论文 2
└── ...
```

- `rank` 文件支持格式：`.pdf`, `.xlsx`, `.xls`, `.csv`, `.txt`
- 等级标记格式不限，自动识别（如 A+级/B级/C级、T1/T2/T3、一类/二类、顶级/权威/核心 等）

### 2. 运行准备命令

```bash
node scripts/main.js "文件夹路径" prepare
```

输出示例：
```
自动发现等级: A+, A, B, C
可用等级:
  A+: 52 个期刊
  A: 2025 个期刊
  B: 3142 个期刊
  C: 2508 个期刊
```

### 3. 模型解析参考文献

将 `.hq_temp/paper_*.txt` 中的参考文献部分交给 AI 模型解析，生成结构化 JSON。

### 4. 运行导出命令

```bash
node scripts/main.js "文件夹路径" export ".hq_temp/all_refs.json" "A+,A"
```

输出：`文件夹/hq_references.xlsx`

## 项目结构

```
├── SKILL.md                          # Skill 定义文件
├── scripts/
│   ├── main.js                       # 主入口（prepare / export）
│   ├── read_pdf.js                   # PDF 转纯文本
│   ├── parse_rank.js                 # 解析等级文件（自动发现等级）
│   ├── match_journals.js             # 匹配参考文献与等级数据
│   ├── generate_xlsx.js             # 生成格式化 Excel
│   ├── package.json
│   └── package-lock.json
├── references/
│   ├── extraction-rules.md           # 参考文献解析规则
│   └── journal-matching.md           # 期刊名匹配策略
├── assets/
│   └── excel-output-template.md      # Excel 格式规范
├── LICENSE
└── .gitignore
```

## 支持的等级格式

| 格式 | 示例 |
|------|------|
| 字母+级 | A+级, A级, B级, C级, D级, S级 |
| 字母+数字+级 | T1级, T2级, T3级 |
| 中文+类 | 一类, 二类, 三类 |
| 中文等级名 | 顶级, 权威, 核心, 重点, 一般, 扩展 |
| 数字+级 | 1级, 2级, 3级 |

等级从文件内容中自动发现，无需预配置。

## License

MIT
