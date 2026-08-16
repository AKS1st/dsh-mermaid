# dsh-mermaid

[English](README.en.md)

在 DSH Web 会话消息中把 ` ```mermaid ` 代码围栏渲染为 SVG 图表的独立插件，通过 `dsh plugin` 安装进 web profile。

## 效果预览

| 亮色主题 · 会话内（未放大） | 暗色主题 · 会话内（未放大） |
| --- | --- |
| ![亮色主题会话内渲染](assets/main-page-white.png) | ![暗色主题会话内渲染](assets/main-page-dark.png) |

| 亮色主题 · 放大浮层 | 暗色主题 · 放大浮层 |
| --- | --- |
| ![亮色主题放大浮层](assets/fangda-white.png) | ![暗色主题放大浮层](assets/fangda-dark.png) |

放大浮层自动适配屏幕（接近全屏、四周留白），滚轮缩放，按住左键/中键可拖动平移；`theme: auto` 时图表颜色跟随 GUI 亮/暗主题。

## 工作方式

- **Host 半部**（`src/index.ts`）：注册 `webServer` 前缀路由 `/mermaid-dist`，从插件自己的 `node_modules/mermaid` 惰性提供 UMD 构建，并提供固定的 `config.json` 端点。
- **Client 半部**（`src/client/`）：监听会话 DOM，把 infostring 为 `mermaid` 的围栏渲染为 SVG：
  1. 只处理**已定格**的围栏（流式输出期间不渲染）；
  2. 首次遇到围栏才惰性加载 mermaid（浏览器缓存一次）；
  3. **视口驱动渲染**：围栏进入视口（带 300px 预加载余量）才开始渲染，滚到哪渲染到哪；还在排队/加载中离开视口的图会停止渲染，回到视口再继续；
  4. **异步队列渲染**：多图时逐个渲染并在渲染之间让出主线程，页面不卡顿；首次渲染期间围栏位置显示加载动画，渲染完成后替换为 SVG；
  5. `mermaid.render()` 产出 SVG，替换围栏的 `<pre>` 主体，语言横幅与复制按钮保留（复制仍复制源码）；
  6. `securityLevel` 恒为 `strict`，标签经 mermaid 内置 DOMPurify 消毒，且从不绑定点击处理；
  7. 主题跟随 GUI：`theme: auto` 读取 `body[data-ds-dark-theme]`，属性翻转时自动重渲染**视口内**的既有图表（视口外的图在重新进入视口时更新）；
  8. 横幅放大按钮打开**全屏浮层**：图表打开时自动适配屏幕（接近全屏、四周留白、垂直/水平居中），滚轮在此基础上缩放，**按住左键或中键拖动**可平移画面（不放大也能拖，边界自动限制不让图跑丢），背景点击或 Esc 关闭；
  9. **渲染失败可见化**：首次渲染失败时保留源码块，并在图框下方显示错误摘要（超长自动截断、悬停查看全文），支持一键**复制报错**或**发送给 AI 修复**（自动把报错+源码填入输入框并发送，模拟用户将报错发给 AI）。

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
- 渲染失败时保留原纯文本代码块（绝不渲染错误 HTML），并在图框下方显示错误摘要（可复制、可一键发送给 AI 修复）；控制台同时输出完整错误。

## 已知限制

- 依赖主前端 `CodeBlock` 的稳定钩子（字面量类 `md-code-block` 与 infostring 文本）；上游渲染器重构时需要同步更新选择器。
- 流式输出期间不渲染，定格后才渲染。
- `securityLevel: strict` 下 mermaid 的点击交互不可用。
