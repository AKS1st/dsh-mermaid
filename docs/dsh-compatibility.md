# DSH compatibility

DeepSeek Harness is in developer preview and does not currently expose a
fenced-code renderer extension point. `dsh-mermaid` therefore keeps one small,
tested compatibility adapter around the host's rendered DOM. The adapter is a
temporary integration boundary, not a claim that private markup is a public
DSH API.

## Current baseline

| Component | Baseline | Evidence |
| --- | --- | --- |
| DSH runtime | `0.1.0-rc.5` | Local install, restart, host route, and Web UI smoke test |
| DSH source | `0.1.0-rc.8` | Official `CodeBlock`, `InputBar`, and locale contracts reviewed |
| Mermaid | `11.16.1` (exact) | 38 registered public types rendered in a real Chromium-family browser |

## Host hooks in use

| Hook | Purpose | Failure mode |
| --- | --- | --- |
| `.md-code-block` | Find settled fenced code blocks | Diagram remains a normal source fence |
| infostring/action CSS-module name segments | Read the language and place the zoom action | Diagram remains source-only or has no zoom action |
| `body[data-ds-dark-theme]` | Follow the DSH color theme | Mermaid keeps its previous/default theme |
| `textarea[data-phase]` | Hand a render-failure report to the current composer | Report is copied to the clipboard |
| `[data-composer-card]` and the localized Send label | Invoke the real DSH submit control | Enter submission is attempted; unavailable input falls back to copy |

All selectors live in `src/client/dom.ts`; tests build host-shaped fixtures and
assert the safe fallback. The renderer does not replace DSH's message tree or
bind Mermaid interactions.

## Upgrade checklist

For every DSH release:

1. Compare the official `CodeBlock.tsx`, `InputBar.tsx`, and conversation
   locale keys with the hooks above.
2. Install the plugin into a clean profile for that DSH version.
3. Verify settled rendering, theme changes, zoom/pan, source copying, a syntax
   error, direct error submission while idle, and submission while a turn is
   running.
4. Run `npm run check`, `npm test`, `npm run build`, `npm pack --dry-run`, and
   `npm run test:compat:browser`.
5. Update this baseline only after those checks pass.

## Requested public seam

The durable fix is a DSH-owned renderer registry or Slot for settled fenced
code blocks. A minimal contract would provide:

- the normalized info string and exact source;
- whether the message is still streaming;
- a lifecycle-owned renderer registration and disposer;
- the ordinary session-scoped client context, allowing the existing
  `conversation.send(text)` service to submit a repair report without touching
  the composer DOM;
- an explicit fallback to the stock `CodeBlock` when a renderer declines or
  fails.

This keeps Markdown parsing, session routing, accessibility, localization, and
submission policy owned by DSH while allowing community renderers such as
Mermaid to remain independent packages.
