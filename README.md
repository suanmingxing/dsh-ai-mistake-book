# AI 错题本 · DSH 插件

把**扫描试卷**变成一本**以知识点为索引的错题本**：投喂 PDF/图片 → 插件建批次并光栅化 → 模型在会话里读卷面、提取错题 → 生成卡片草稿 → **你确认后**归档进 `library/`，并自动重建索引。

不是"AI 帮你解题"，而是"AI 帮你把卷面上**已经存在**的东西整理成可复习的结构"。

## 功能

- **扫描件直读**：PDF 自动光栅化（默认 400 dpi），切成整页概览 + 高清横带；看不清时按需索取原生分辨率重切
- **只在错题上花力气**：按你报的题号逐题提取，题干、作答、划改、页边演算、卷面标注、知识点、错因、难度
- **绝不编造**：读不准的内容写进"待人工确认"，交给人核对
- **卡片即 Markdown**：`library/<学科>/<卷子>/cards/*.md`，带 front-matter，可手改、可 diff、可进版本库
- **知识点索引**：自动重建 `index.md` / `index.json`，按 学科 → 一级 → 二级知识点 归类
- **导出打印版 PDF**：每道错题的板块可勾选；**公式以 Word 原生公式（OMML）排版**，不是 Unicode 拼凑
- **回收站**：删除先进 `_trash/`，可逐项还原，清空才真正销毁
- **会话可追溯**：待归档页可跳回分析会话继续修改

## 环境要求

- **DSH（DeepSeek Harness）桌面版**，Web/桌面 profile 均可。要求 DSH `>= 0.2.1-rc.2`
- 分析模型需要**支持图片输入**（插件启动前会校验，不支持会直接报错而不是静默失败）
- Node.js ≥ 22（DSH 自带运行时已满足）

## 安装

### 方式一：从 npm 安装（最快，推荐）

```bash
dsh plugin --profile desktop add ai-mistake-book
```

### 方式二：从 GitHub 安装

```bash
dsh plugin --profile desktop add github:suanmingxing/dsh-ai-mistake-book
```

> 把 `desktop` 换成你实际使用的 profile（桌面版通常是 `desktop`，`dsh web` 用 `web`）。
> 装完**重启 DeepSeek Harness** 生效。

### 方式三：本地目录（开发/调试）

```bash
git clone https://github.com/suanmingxing/dsh-ai-mistake-book.git D:\tools\dsh-ai-mistake-book
dsh plugin --profile desktop add "link:D:/tools/dsh-ai-mistake-book"
```

> `link:` 安装时 pnpm 不会替插件装 `dependencies`，所以本仓库**已把必要依赖放在 `node_modules/` 里一并提交**（见 [VENDOR.md](VENDOR.md)）。若你删掉了它，请手动补装：`npm i @deepseek-ai/schemastery @deepseek-ai/cosmokit katex`。

## 首次使用

1. **设置归档根**：设置 → 插件 → AI 错题本 → `archiveRoot`，填一个你希望存放错题本的绝对路径（默认 `~/.dsh/ai-mistake-book`）。改这个字段需要重启插件。
2. **建一个"归档工作区"会话**：在 DSH 里打开该目录作为工作区（首次 `/mistake` 会自动创建）。
3. **投喂试卷**：
   ```
   /mistake 错题为 3、5、6、8、9、11 题  @"C:\path\to\扫描卷.pdf"
   ```
   或在插件页用模型工具 `mistake_ingest` 指定文件路径。
4. **等分析**：分析在当前会话里进行；期间该会话的工具会被临时收窄到 4 个（读页面、提交候选、提交决定、问用户确认），结束后自动恢复。
5. **确认归档**：插件页 →「待归档」核对候选 →「管理」里导出 PDF 或删除；正式归档需在插件页确认。

## 数据与隐私

- **所有数据都在你自己的机器上**：试卷、转录、卡片、导出件都在 `archiveRoot` 下，插件不向任何第三方服务上传内容
- 模型调用走你 DSH 里配置的 provider（同样的调用链路，不会额外外发）
- 归档根结构：

```
<archiveRoot>/
├─ inbox/<batchId>/     进行中的批次（原始扫描、光栅图）
├─ library/<学科>/<卷子>/cards/*.md   归档后的错题卡片
├─ templates/           可编辑的提示词模板（analysis / background / error-taxonomy）
├─ exports/             导出的 PDF
├─ _trash/              回收站
└─ index.md / index.json  自动生成的索引
```

## 主要设置项

| 设置 | 默认 | 说明 |
|---|---|---|
| `archiveRoot` | `~/.dsh/ai-mistake-book` | 错题本存放位置 |
| `pdfDpi` / `overviewDpi` | 400 / 200 | 横带与整页概览的分辨率 |
| `pagesPerRequest` | 2 | 一次投喂几页（每页 1 概览 + N 横带） |
| `maxRecutsPerPage` | 4 | 每页原生重切配额 |
| `restrictAnalysisTools` | true | 分析期间收窄会话工具集 |
| `analysisProvider` / `analysisModel` | 空 | 空 = 用部署默认；必须支持图片 |
| `deleteToTrash` | true | 删除进回收站而非销毁 |

## 自定义提示词

设置页可编辑三份内置模板（`templates/`），也可以新增**自定义模板**：每条有标题、说明、正文，启用后自动并入分析任务书的「用户自定义要求」一节。

## 依赖说明

本插件在 `node_modules/` 里**随包提交**了三份依赖（合计约 0.7 MB）：`@deepseek-ai/schemastery`、`@deepseek-ai/cosmokit`（DSH 发布版，公开 npm 同版本）、`katex`。原因与升级方式见 [VENDOR.md](VENDOR.md)。

`katex` 仅用于会话内的公式预览（MathML），缺失时会降级为纯文本，不影响归档。

## 已知限制

- 公式排版覆盖错题卡常见写法（分数、根式、上下标、向量、`\left…\right`、希腊字母与常用运算符）；矩阵、分段函数等结构暂不支持，会退化为可读文本
- 分析依赖模型的视觉能力；看不清的字段会进入"待人工确认"，不会猜测
- 仅支持中文界面（`locale/` 目前只有 meta）

## 许可证

[MIT](LICENSE) © 2026 suanmingxing
