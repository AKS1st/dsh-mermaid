// Browser-level verification: open a live dsh web instance, inject a settled
// ```mermaid fence exactly as ui-primitives renders it (the `.md-code-block`
// wrapper + hashed infostring class), and assert the plugin replaces the
// `<pre>` with an SVG host.
//
// Usage: node scripts/browser-inject.mjs  (requires a running `dsh web` and
// `npx playwright install chromium` once). Fails (exit 1) when the plugin
// does not render the injected fence.
import { chromium } from 'playwright'

const BASE = process.env.DSH_WEB_BASE ?? 'http://127.0.0.1:3080'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const errors = []
const requests = []
page.on('pageerror', err => errors.push(`PAGEERROR: ${err.message}`))
page.on('requestfailed', req => errors.push(`REQFAIL: ${req.url()} ${req.failure()?.errorText}`))
page.on('request', req => { const url = req.url(); if (url.includes('mermaid')) requests.push(url) })

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)

// Inject a settled mermaid fence EXACTLY as ui-primitives renders it. The
// infostring class is matched by its readable segment ([class*="infostring"]),
// so the hash suffix is irrelevant to the plugin.
await page.evaluate(() => {
  const block = document.createElement('div')
  block.className = '_block_abc md-code-block'
  block.innerHTML = '<div class="_bannerWrap_abc"><div class="_banner_abc"><div class="_infostring_abc">mermaid</div><div class="_action_abc"><button>复制</button></div></div></div><pre class="_plain_abc"><code>graph TD\n  A[Start] --> B{Decision}\n  B -->|yes| C[Go]\n  B -->|no| D[Stop]</code></pre>'
  document.body.append(block)
})

await page.waitForTimeout(6000)

const result = await page.evaluate(() => {
  const block = document.querySelector('.md-code-block')
  return {
    rendered: block?.getAttribute('data-dsh-mermaid') ?? null,
    err: block?.getAttribute('data-dsh-mermaid-error') ?? null,
    hasHost: !!block?.querySelector('.dsh-mermaid'),
    svgLen: block?.querySelector('.dsh-mermaid')?.innerHTML?.length ?? 0,
    mermaidGlobal: typeof window.mermaid,
  }
})
console.log('RESULT:', JSON.stringify(result, null, 1))
console.log('mermaid requests:', requests)
if (errors.length > 0) {
  console.log('--- page errors ---')
  console.log(errors.join('\n'))
}
await browser.close()

if (result.rendered !== '1' || !result.hasHost || result.svgLen === 0) {
  process.exit(1)
}
