# dsh-mermaid

在 DSH Web 会话消息中把 ` ```mermaid ` 代码围栏渲染为 SVG 图表的独立插件，通过 `dsh plugin` 安装进 web profile。

## 工作方式

- **Host 半部**（`src/index.ts`）：注册 `webServer` 前缀路由 `/mermaid-dist`，从插件自己的 `node_modules/mermaid` 惰性提供 UMD 构建，并提供固定的 `config.json` 端点。
- **Client 半部**（`src/client/`）：监听会话 DOM，把 infostring 为 `mermaid` 的围栏渲染为 SVG：
  1. 只处理**已定格**的围栏（流式输出期间不渲染）；
  2. 首次遇到围栏才惰性加载 mermaid（浏览器缓存一次）；
  3. `mermaid.render()` 产出 SVG，替换围栏的 `<pre>` 主体，语言横幅与复制按钮保留（复制仍复制源码）；
  4. `securityLevel` 恒为 `strict`，标签经 mermaid 内置 DOMPurify 消毒，且从不绑定点击处理；
  5. 主题跟随 GUI：`theme: auto` 读取 `body[data-ds-dark-theme]`，属性翻转时自动重渲染既有图表。

client 包体积约 10 KB（gzip ~4 KB）；mermaid（~700 KB）只在真正出现 mermaid 围栏时才按需加载，不进入 boot 图。

## 安装

从 GitHub 仓库安装（构建在 `prepare` 脚本里自动执行）：

```sh
dsh plugin --profile web add github:AKS1st/dsh-mermaid
dsh web   # 重启 web 服务使 profile 生效
```

> 若 pnpm 提示 git 依赖需要执行构建脚本（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`），
> 按提示把包加入 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 后重试即可。

本地开发（先构建再安装）：

```sh
npm install
npm run build
dsh plugin --profile web add .
dsh web
```

卸载：

```sh
dsh plugin --profile web remove @dsh-external/dsh-mermaid
```

## 配置

组合包默认生效以下配置：

```yaml
- insert:
    - id: mermaid
      name: '@dsh-external/dsh-mermaid'
      config:
        theme: auto
        maxTextSize: 50000
        maxEdges: 2000
        securityLevel: strict
```

| 配置项         | 默认值    | 说明                                                        |
| -------------- | --------: | ----------------------------------------------------------- |
| `theme`        | `auto`    | 图表主题：`auto`（跟随亮/暗）、`default`、`dark`、`neutral`、`forest`、`base` |
| `maxTextSize`  | 50000     | 单图文本上限（防超大图拖垮渲染）                             |
| `maxEdges`     | 2000      | 边数守卫                                                    |
| `securityLevel`| `strict`  | 固定为 `strict`，不接受 `loose`                             |

在 profile 的 `cordis.patch.yml` 里以 `- set:` 或 `- update:` 覆盖即可。

## 安全模型

- 助手输出不可信：`securityLevel` 锁定 `strict`，标签中的 HTML 由 mermaid 内部 DOMPurify 消毒；不调用 `bindFunctions`，点击处理保持惰性。
- 渲染失败时保留原纯文本代码块（绝不渲染错误 HTML），控制台可见错误。

## 已知限制

- 依赖主前端 `CodeBlock` 的稳定钩子（字面量类 `md-code-block` 与 infostring 文本）；上游渲染器重构时需要同步更新选择器。
- 流式输出期间不渲染，定格后才渲染。
- `securityLevel: strict` 下 mermaid 的点击交互不可用。
