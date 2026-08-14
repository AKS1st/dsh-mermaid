# dsh-mermaid

在 DSH Web 会话消息中把 ` ```mermaid ` 代码围栏渲染为 SVG 图表的独立插件。
独立于 harness 主仓库维护，通过 `dsh plugin` 安装进 web profile。

## 为什么需要它（根因）

DSH Web 前端的 Markdown 渲染管线位于
`packages/client/ui-primitives/src/markdown/`，是一个直接的 mdast→React 渲染器：

- `render.tsx` 的 `renderCode()` 只对 `math` 围栏做了特判（渲染为 KaTeX），
  其余所有围栏一律走 `CodeBlock` 组件；
- `CodeBlock` 把语言交给 shiki（`highlight.ts`）高亮，而 shiki 的语法允许表
  （`LANG_ALIASES`）**没有 mermaid 语法**；
- `mermaid` npm 包**不是任何 client 包的依赖**，web 产物从不打包它（只在
  docs 站点与 `scripts/verify-mermaid.ts` 的 Node 侧语法校验里用到）。

因此 ` ```mermaid ` 围栏在会话消息里只会以纯文本等宽代码块展示，永远不会
渲染成图。

## 设计

- **Host 半部**（`src/index.ts`）：注册 `webServer` 前缀路由 `/mermaid-dist`，
  从插件自己的 `node_modules/mermaid` 惰性提供 UMD 构建（`mermaid.min.js`，
  自带全部图表与依赖、无 ESM chunk），并提供一个固定的 `config.json` 端点。
  客户端 boot 清单不带 config，所以由 Host 校验并把生效配置交给客户端读取。
- **Client 半部**（`src/client/`）：一个 `MutationObserver` 监听会话 DOM，
  找到 `.md-code-block` 中 infostring 为 `mermaid` 的围栏：

  1. 只处理**已定格**的围栏——消息流式输出时 `CodeBlock` 会抑制语言名
     （infostring 为空），与产品对 KaTeX 的 settle-only 策略一致；
  2. 惰性加载 mermaid（首次遇到围栏才注入 `<script>`，浏览器缓存一次）；
  3. `mermaid.render()` 产出 SVG，替换围栏的 `<pre>` 主体，语言横幅与
     复制按钮保留（复制仍复制源码）；
  4. `securityLevel` 恒为 `strict`：标签经 mermaid 内置 DOMPurify 消毒，
     且从不绑定点击处理——与主前端对不可信助手文本的输出策略一致；
  5. 主题跟随 GUI：`theme: auto` 读取 `body[data-ds-dark-theme]`，属性翻转
     时自动重渲染既有图表。

client 包体积约 10 KB（gzip ~4 KB）；mermaid（~700 KB）只在真正出现 mermaid
围栏时才按需加载，不进入 boot 图。

## 安装

```sh
# 方式一：本地目录（先构建）
npm install
npm run build
dsh plugin --profile web add .

# 方式二：从 git 仓库安装（构建在 prepare 脚本里自动执行）
dsh plugin --profile web add github:<owner>/dsh-mermaid

# 重启 web 服务使 profile 生效
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
| `maxTextSize`  | 50000     | mermaid 的单图文本上限（防超大图拖垮渲染）                   |
| `maxEdges`     | 2000      | mermaid 的边数守卫（默认 500 对真实架构图太紧，与仓库 docs 校验一致放宽） |
| `securityLevel`| `strict`  | 固定为 `strict`，不接受 `loose`（不可信输出必须消毒）         |

在 profile 的 `cordis.patch.yml` 里以 `- set:` 或 `- update:` 覆盖即可。

## 安全模型

- 助手输出不可信：`securityLevel` 锁定 `strict`，标签中的 HTML 由 mermaid
  内部 DOMPurify 消毒；不调用 `bindFunctions`，点击处理保持惰性。
- 渲染失败时保留原纯文本代码块（绝不渲染错误 HTML），控制台可见错误。
- 与主前端一致：相对链接、内联 HTML、其他不安全协议在渲染管线上游已被禁用，
  本插件只消费已经过安全过滤的围栏内容。

## 开发

```sh
npm install
npm run build    # tsc + tsdown：产出 lib/index.js（Host）与 lib/client.js（Client）
npm run test     # vitest：Host 路由守卫/配置校验 + Client DOM 渲染逻辑（jsdom）
npm run check    # tsc --noEmit
```

## 已知限制

- 依赖主前端 `CodeBlock` 的稳定钩子（字面量类 `md-code-block` 与 infostring
  文本）；若上游渲染器重构，需要同步更新选择器。
- 流式输出期间不渲染（与 KaTeX 一致，定格后渲染），这是刻意为之。
- 图表为惰性、无交互的 SVG；`securityLevel: strict` 下 mermaid 的点击交互
  不可用——这是安全取舍，不是 bug。
