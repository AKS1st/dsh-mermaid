# Mermaid compatibility matrix

Current lockfile baseline (Mermaid 11.16.1): all 38 registered public diagram
detectors render successfully. The catalog also keeps `zenuml` as a known
external syntax that the bundled full Mermaid build must reject.

The runtime dependency currently uses `^11.16.0`, so this is a tested baseline,
not a promise about future Mermaid releases. Re-run both suites whenever the
lockfile changes; detector coverage makes newly added or removed types fail
until the catalog is reviewed.

The compatibility catalog lives in
`tests/fixtures/mermaid-cases.ts`. It contains one minimal source example for
every detector registered by the Mermaid UMD bundled with this plugin, plus
known external/unsupported syntaxes.

Run the focused matrix with:

```sh
npm run test:compat
```

Run every renderer in a real Chromium browser with:

```sh
npx playwright install chromium # once per machine
npm run test:compat:browser
```

Each test name reports the syntax maturity, case id, and expected support
state. The suite uses the real `node_modules/mermaid/dist/mermaid.min.js` with
the same strict security and size limits as the plugin. A supported case must:

1. be recognized by `detectType()`;
2. pass `parse()`;
3. complete `render()` and emit SVG without Mermaid's error diagram (in the
   jsdom fast suite where supported, and always in the browser suite).

The final coverage test compares the catalog with Mermaid's registered
detectors. Upgrading Mermaid therefore fails loudly when a diagram type is
added or removed until the catalog and its expected support state are reviewed.

The jsdom geometry shims make the fast suite a parser/render smoke test, not a
visual snapshot. Renderers that require a real layout engine, such as mindmap,
are parsed there and rendered by the browser suite. Both suites preserve the
original Mermaid exception in their failure output so an agent can revise the
source instead of seeing a generic “render failed” result.

`PLAYWRIGHT_EXECUTABLE_PATH` may point to an existing Chromium-family browser
for local development. CI installs Playwright Chromium instead, so the suite
has no operating-system-specific browser dependency.
