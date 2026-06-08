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

## License

MIT
