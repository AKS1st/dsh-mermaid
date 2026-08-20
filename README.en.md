# dsh-mermaid

[中文](README.md)

A standalone plugin that renders ` ```mermaid ` code fences in DSH Web conversation messages as SVG diagrams. Install it into a web profile with `dsh plugin`.

> This is an independently maintained community plugin, not an official DeepSeek AI component.
> DSH is still in developer preview; this project records its tested baseline and host-interface dependencies explicitly.

## Preview

| Light theme · in conversation (not zoomed) | Dark theme · in conversation (not zoomed) |
| --- | --- |
| ![Light theme, in conversation](https://raw.githubusercontent.com/AKS1st/dsh-mermaid/main/assets/main-page-white.png) | ![Dark theme, in conversation](https://raw.githubusercontent.com/AKS1st/dsh-mermaid/main/assets/main-page-dark.png) |

| Light theme · zoom overlay | Dark theme · zoom overlay |
| --- | --- |
| ![Light theme, zoom overlay](https://raw.githubusercontent.com/AKS1st/dsh-mermaid/main/assets/fangda-white.png) | ![Dark theme, zoom overlay](https://raw.githubusercontent.com/AKS1st/dsh-mermaid/main/assets/fangda-dark.png) |

The zoom overlay auto-fits the diagram to the screen (near full-screen with a small margin), zooms with the mouse wheel, and pans by dragging with the left or middle button. With `theme: auto` the diagram colors follow the GUI light/dark theme.

## How it works

- **Host half** (`src/index.ts`): registers the `webServer` prefix route `/mermaid-dist`, lazily serves the mermaid UMD build from the plugin's own `node_modules/mermaid`, and exposes a fixed `config.json` endpoint.
- **Client half** (`src/client/`): watches the conversation DOM and renders fences whose infostring is `mermaid` to SVG:
  1. Only **settled** fences are processed (nothing renders mid-stream);
  2. The mermaid bundle is loaded lazily on first use (cached by the browser afterwards);
  3. **Viewport-driven rendering**: a fence only starts rendering when it scrolls into view (with a 300px preload margin) — render where you look; a diagram that leaves the viewport while queued or loading stops rendering and resumes on re-entry;
  4. **Async queue rendering**: with many diagrams they render one at a time and yield the main thread between renders, so the page never freezes; a loading placeholder is shown while a first render is in flight and is swapped for the SVG when done;
  5. `mermaid.render()` produces an SVG that replaces the fence's `<pre>` body; the language banner and copy button stay (copy still copies the source);
  6. `securityLevel` is always `strict`: labels are DOMPurify-sanitized by mermaid itself and click handlers are never bound;
  7. Theme follows the GUI: `theme: auto` reads `body[data-ds-dark-theme]` and re-renders **visible** diagrams when the attribute flips (offscreen diagrams refresh when they re-enter the viewport);
  8. The banner zoom button opens a **full-screen overlay**: the diagram is auto-fitted to the screen on open (near full-screen, centered, with a small margin), the wheel zooms relative to that size, **dragging with the left or middle button pans** at any zoom (clamped so the diagram can't be lost), and clicking the backdrop or pressing Esc closes it;
  9. **Visible render failures**: when a first render fails the source code block is kept and an error summary appears below it (long messages are truncated, hover for the full text), with one-click **copy the error** or **send to the Agent to fix** (orders the error before the Mermaid source and submits it directly to the current agent).

The client package is ~10 KB (gzip ~4 KB); mermaid (~700 KB) is fetched on demand only when a mermaid fence actually appears — it never enters the boot graph.

## Install

From the GitHub repository:

```sh
dsh plugin --profile web add github:AKS1st/dsh-mermaid
dsh web   # restart the web service for the profile to take effect
```

The repository commits reproducible `lib/` artifacts, so GitHub installation does not need to run dependency lifecycle scripts.

Local development (build first, then install):

```sh
npm install
npm run build
dsh plugin --profile web add .
dsh web
```

Uninstall:

```sh
dsh plugin --profile web remove dsh-mermaid
```

## Configuration

The bundle applies this configuration by default:

```yaml
- insert:
    - id: mermaid
      name: 'dsh-mermaid'
      config:
        theme: auto
        maxTextSize: 50000
        maxEdges: 2000
        securityLevel: strict
```

| Key             | Default | Description |
| --------------- | ------: | ----------- |
| `theme`         | `auto`  | Diagram theme: `auto` (follows light/dark), `default`, `dark`, `neutral`, `forest`, `base` |
| `maxTextSize`   | 50000   | Per-diagram text cap (guards against oversized diagrams) |
| `maxEdges`      | 2000    | Edge-count guard |
| `securityLevel` | `strict`| Fixed to `strict`; `loose` is never accepted |

Override with `- set:` or `- update:` in the profile's `cordis.patch.yml`.

## Security model

- Assistant output is untrusted: `securityLevel` is locked to `strict`; HTML in labels is DOMPurify-sanitized by mermaid itself; `bindFunctions` is never called and click handlers stay inert.
- On a render failure the plain-text code block is kept (error HTML is never rendered), and an error summary appears below the block (copyable, or directly sendable to the current agent to fix); the full error also goes to the console.

## Known limitations

- Depends on the host frontend `CodeBlock`'s stable hooks (the literal `md-code-block` class and the infostring text); selectors need to be kept in sync if the upstream renderer is refactored.
- Nothing renders during streaming; rendering happens after a message settles.
- Under `securityLevel: strict`, mermaid's click interactions are unavailable.

## DSH compatibility

- DSH `0.1.0-rc.5`: locally exercised end to end.
- DSH `0.1.0-rc.8`: official `CodeBlock`, composer, and Chinese/English locale source contracts audited.
- Mermaid is pinned to `11.16.1`; all 38 registered public diagram types pass the real-browser render matrix,
  with external ZenUML syntax retained as an expected unsupported case.

DSH does not yet expose a fenced-code renderer extension point, so this release uses a tested,
centralized DOM compatibility adapter. See [DSH compatibility](docs/dsh-compatibility.md)
for the host hooks, upgrade checklist, and proposed migration to a public API.

## Mermaid compatibility checks

The repository lockfile's Mermaid 11.16.1 baseline covers all 38 registered
public diagram types and keeps external `zenuml` syntax as a negative case.
Run `npm run test:compat` for the fast parser/render checks and
`npm run test:compat:browser` for full SVG rendering in a real browser. See
[docs/mermaid-support.md](docs/mermaid-support.md) for maintenance rules.
