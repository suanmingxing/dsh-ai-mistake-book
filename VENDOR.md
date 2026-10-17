# 内置依赖说明（vendored）

本插件的 `node_modules/` 里放了**随插件发布**的依赖副本，不是安装时下载的：

| 包 | 版本 | 来源 |
|---|---|---|
| `@deepseek-ai/schemastery` | 3.18.4 | DSH 发布版（公开 npm 同版本；非未加 scope 的 `schemastery`） |
| `@deepseek-ai/cosmokit` | 1.8.5 | 同上（`schemastery` 的运行时依赖） |
| `katex` | 0.16.47 | 公开 npm（只保留 `dist/katex.js` 与 LICENSE，用于会话内公式预览） |

## 两种安装方式各走哪条路

- **`dsh plugin add github:<repo>`**：pnpm 会把本包的 `package.json` 里 `dependencies` 声明的三个包正常装进虚拟 store，bare import 自然解析。**这是"一键安装"的主路径。**
- **`dsh plugin add link:<目录>`**：pnpm **不会**替本地链接的包安装 `dependencies`，插件目录下的 bare import 会解析失败（实测：`failed to import`）。此时靠的就是这里提交的 `node_modules/` 副本。

两条路都覆盖，所以既提交了副本，也在 `package.json` 里声明了依赖。

## 为什么必须是 DSH 那一份 schemastery

`schemastery` 的 `Config` 必须用 **DSH 发布版**：只有它会把 `meta.volatile` 字段包成 cosmokit 的 Volatile 引用，而 Loader 的实时提交路径依赖这个引用。用未加 scope 的公开包会**静默丢弃所有实时设置写入**。

升级 DSH 时若希望同步更新：从
`<DSH 安装目录>/resources/app.asar.unpacked/dsh/node_modules/@deepseek-ai/`（或当前 profile 的 `node_modules/@deepseek-ai/`）
重新复制这两个包的 `package.json`、`LICENSE`、`lib/` 即可。
