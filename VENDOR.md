# 内置依赖说明（vendored）

本插件的 `node_modules/` 里放了两份**随插件发布**的依赖副本，不是安装时下载的：

| 包 | 版本 | 来源 |
|---|---|---|
| `@deepseek-ai/schemastery` | 3.18.4 | 本机 DSH profile 的 `node_modules`（DSH 发布版，非公开 npm 的 `schemastery`） |
| `@deepseek-ai/cosmokit` | 1.8.5 | 同上（`schemastery` 的运行时依赖） |

## 为什么这样做

1. **本地目录插件是 `link:`/junction 安装**，pnpm 不会替它安装 `dependencies`，插件目录下的 bare import 会解析失败（实测：`failed to import`）。
2. 安装期拉取 npm 源在本机不稳定（实测多次 `ECONNRESET`），会让安装变成碰运气。
3. `schemastery` 的 `Config` 必须用 **DSH 那一份**：只有它会把 `meta.volatile` 字段包成 cosmokit 的 Volatile 引用，而 Loader 的实时提交路径依赖这个引用。用公开包会**静默丢弃所有实时设置写入**。

因此把这两份（合计 113 KB）直接放进插件的 `node_modules/`，Node 的解析顺序会自然命中，无需修改任何第三方源码。

升级 DSH 时若希望同步更新：从
`<DSH 安装目录>/resources/app.asar.unpacked/dsh/node_modules/@deepseek-ai/`（或当前 profile 的 `node_modules/@deepseek-ai/`）
重新复制这两个包的 `package.json`、`LICENSE`、`lib/` 即可。
