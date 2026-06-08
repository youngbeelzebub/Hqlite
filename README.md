# HQ Literature Extract

从学术论文中提取参考文献，按期刊等级筛选，输出高质量文献 Excel 表。

## 功能

- 自动提取文献的参考文献列表
- 自动解析期刊认定等级文件，用户针对等级进行筛选
- 匹配参考文献列表与期刊等级过滤器，对高质量参考文献进行筛选
- 筛选结果输出为 Excel 文件

## 使用步骤

### 安装

1. 前置条件配置：**Node.js** v16+

2. 让 Agent 自行安装

   ```
   帮我安装这个 skill： https://github.com/youngbeelzebub/hq-literature-extract.git
   ```

### 使用

3. 创建文件夹，将期刊认定等级文件（PDF）与原始论文文献放入其中

4. 将期刊认定等级文献重命名为 rank

5. 复制文件夹路径，与 Agent 进行交互：

   ```
   使用 hq-literature-extract 对「复制的文件夹路径」里的文件进行处理
   ```

## 更新日志

### v1.1 (2026-06-08)

**领域筛选与语言分类**
- 新增领域识别功能：自动解析期刊等级文件中的专业领域划分（如经济学、心理学等），供用户多选锁定
- 新增中英文期刊分类：用户可选择筛选中文期刊、英文期刊或全部
- 新增 `list-domains` 命令：查看等级文件中可用的专业领域列表
- `prepare` 命令输出领域摘要，`export` 命令支持领域和语言参数

**期刊匹配精度优化**
- 收紧模糊匹配阈值（0.6 → 0.8），排除 50+ 通用词（如 information、processing、management 等），大幅降低误匹配率
- 收紧子串匹配条件：要求双方长度 ≥ 8、长度比 ≥ 0.6，且匹配发生在词边界上
- 新增去空格匹配策略：解决 PDF 断词问题（如 "QUART ERLY JOURNAL" → "QUARTERLY JOURNAL"）
- 新增连字符断词合并：解决 PDF 跨行断词问题（如 "Economet- rica" → "Econometrica"）
- 新增常见期刊缩写扩展（如 AER → American Economic Review、JPE → Journal of Political Economy 等）
- 移除短名期刊（如 Science、Nature）的最小长度限制，通过子串匹配策略限制短名期刊只能精确匹配

**期刊等级文件解析优化**
- 新增 `cleanEnglishJournalName` 函数：自动去除期刊名前的领域分类前缀（如 "COMPUTER SCIENCE IEEE TRANSACTIONS..." → "IEEE TRANSACTIONS..."）
- 新增中英文期刊自动分类功能
- 解析后自动去重和清理

## License

MIT
