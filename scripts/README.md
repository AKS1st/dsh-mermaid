# Browser-level verification

`browser-inject.mjs` opens a live `dsh web` instance (default
http://127.0.0.1:3080, override with `DSH_WEB_BASE`), injects a settled
```` ```mermaid ```` fence into the page DOM exactly as ui-primitives renders
it, and asserts the plugin replaces the `<pre>` with an SVG host. Exits
non-zero when the plugin does not render.

Prerequisites: a running `dsh web` with this plugin installed, and
`npx playwright install chromium` (once).

```sh
node scripts/browser-inject.mjs
```
