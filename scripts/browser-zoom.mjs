// Zoom overlay end-to-end: inject a settled mermaid fence, click the zoom
// button, verify the overlay opens, wheel-zoom scales the stage, and Escape
// closes it.
import { chromium } from 'playwright'

const BASE = process.env.DSH_WEB_BASE ?? 'http://127.0.0.1:3080'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const errors = []
page.on('pageerror', err => errors.push(`PAGEERROR: ${err.message}`))

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)

// Inject the fence and wait for the plugin to render it + inject the button.
await page.evaluate(() => {
  const block = document.createElement('div')
  block.className = '_block_abc md-code-block'
  block.innerHTML = '<div class="_bannerWrap_abc"><div class="_banner_abc"><div class="_infostring_abc">mermaid</div><div class="_action_abc"><button>复制</button></div></div></div><pre class="_plain_abc"><code>graph TD\n  A[Start] --> B{Decision}\n  B -->|yes| C[Go]\n  B -->|no| D[Stop]</code></pre>'
  document.body.append(block)
})
await page.waitForTimeout(5000)

const pre = await page.evaluate(() => {
  const block = document.querySelector('.md-code-block')
  return {
    rendered: block?.getAttribute('data-dsh-mermaid') ?? null,
    zoomBtn: !!block?.querySelector('.dsh-mermaid-zoom'),
    copyBtn: block?.querySelector('[class*="action"] button')?.textContent ?? null,
    actionChildren: [...(block?.querySelector('[class*="action"]')?.children ?? [])].map(b => b.className || b.textContent),
  }
})
console.log('PRE-CLICK:', JSON.stringify(pre))

// Click the zoom button.
await page.evaluate(() => {
  const btn = document.querySelector('.dsh-mermaid-zoom')
  if (btn) btn.click()
})
await page.waitForTimeout(300)

const opened = await page.evaluate(() => {
  const overlay = document.querySelector('.dsh-mermaid-overlay')
  return {
    overlayOpen: !!overlay,
    stageHasSvg: !!overlay?.querySelector('.dsh-mermaid-stage svg'),
    stageTransform: overlay?.querySelector('.dsh-mermaid-stage')?.style.transform ?? null,
  }
})
console.log('OPENED:', JSON.stringify(opened))

// Wheel-zoom in and out.
await page.evaluate(() => {
  const overlay = document.querySelector('.dsh-mermaid-overlay')
  overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
  overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
})
const zoomed = await page.evaluate(() => document.querySelector('.dsh-mermaid-stage')?.style.transform)
console.log('ZOOMED:', zoomed)

// Escape closes.
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
const afterEsc = await page.evaluate(() => !!document.querySelector('.dsh-mermaid-overlay'))
console.log('AFTER-ESC open:', afterEsc)

// Backdrop click closes.
await page.evaluate(() => {
  const block = document.createElement('div')
  block.className = '_block_abc md-code-block'
  block.innerHTML = '<div class="_bannerWrap_abc"><div class="_banner_abc"><div class="_infostring_abc">mermaid</div><div class="_action_abc"><button>复制</button></div></div></div><pre class="_plain_abc"><code>graph TD\n  A --> B</code></pre>'
  document.body.append(block)
})
await page.waitForTimeout(4000)
await page.evaluate(() => {
  const btns = document.querySelectorAll('.dsh-mermaid-zoom')
  btns[btns.length - 1].click()
})
await page.waitForTimeout(300)
await page.evaluate(() => {
  const overlay = document.querySelector('.dsh-mermaid-overlay')
  overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(200)
const afterBackdrop = await page.evaluate(() => !!document.querySelector('.dsh-mermaid-overlay'))
console.log('AFTER-BACKDROP open:', afterBackdrop)

console.log('--- errors ---')
console.log(errors.slice(-5).join('\n') || '(none)')
await browser.close()

if (pre.zoomBtn !== true || !opened.overlayOpen || !opened.stageHasSvg || zoomed === null || afterEsc !== false || afterBackdrop !== false) {
  process.exit(1)
}
