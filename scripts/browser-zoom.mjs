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

// A headless page is not logged in, so the dsh-login gate covers the viewport
// and stacks above the overlay. Remove it to simulate the logged-in state the
// real user sees (the overlay is then the topmost layer and real mouse input
// reaches it).
await page.evaluate(() => {
  document.querySelector('.dsh-login-gate')?.remove()
})

// Inject the fence and wait for the plugin to render it + inject the button.
// Rendering is viewport-driven, so the injected fence must be scrolled into
// view for the lazy IntersectionObserver to pick it up.
await page.evaluate(() => {
  const block = document.createElement('div')
  block.className = '_block_abc md-code-block'
  block.innerHTML = '<div class="_bannerWrap_abc"><div class="_banner_abc"><div class="_infostring_abc">mermaid</div><div class="_action_abc"><button>复制</button></div></div></div><pre class="_plain_abc"><code>graph TD\n  A[Start] --> B{Decision}\n  B -->|yes| C[Go]\n  B -->|no| D[Stop]</code></pre>'
  document.body.append(block)
  block.scrollIntoView({ block: 'center' })
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
    // The fitted diagram is scaled up to near full-screen on open.
    svgTransform: overlay?.querySelector('.dsh-mermaid-stage svg')?.getAttribute('style') ?? null,
  }
})
console.log('OPENED:', JSON.stringify(opened))

// Wheel-zoom in and out.
await page.evaluate(() => {
  const overlay = document.querySelector('.dsh-mermaid-overlay')
  overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
  overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
})
const zoomed = await page.evaluate(() => document.querySelector('.dsh-mermaid-stage svg')?.getAttribute('style'))
console.log('ZOOMED:', zoomed)

// Zoom in further so the diagram overflows the stage, then middle-button drag
// to pan: the pan rides the SVG transform translate (content follows cursor).
// The diagram is narrow, so horizontal pan clamps — assert on the vertical
// axis, which is unclamped at this zoom.
const svgStyle = () => page.evaluate(() => document.querySelector('.dsh-mermaid-stage svg')?.getAttribute('style') ?? '')
const panY = async () => {
  const m = (await svgStyle()).match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/)
  return m ? parseFloat(m[2]) : 0
}
await page.evaluate(() => {
  const overlay = document.querySelector('.dsh-mermaid-overlay')
  for (let i = 0; i < 4; i++) {
    overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
  }
})
const stageBox = await page.locator('.dsh-mermaid-stage').boundingBox()
const cx = stageBox.x + stageBox.width / 2
const cy = stageBox.y + stageBox.height / 2
await page.mouse.move(cx, cy)
await page.mouse.down({ button: 'middle' })
await page.mouse.move(cx - 140, cy - 100, { steps: 5 })
await page.mouse.up({ button: 'middle' })
const panMiddleY = await panY()
const panned = panMiddleY === -100
console.log('PAN(middle):', JSON.stringify({ panY: panMiddleY, panned }))

// Left-button drag also pans (same window-capture path); deltas accumulate.
await page.mouse.move(cx, cy)
await page.mouse.down({ button: 'left' })
await page.mouse.move(cx - 100, cy - 80, { steps: 5 })
await page.mouse.up({ button: 'left' })
const panLeftY = await panY()
const leftPanned = panLeftY === -180
console.log('PAN(left):', JSON.stringify({ panY: panLeftY, leftPanned }))

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
  block.scrollIntoView({ block: 'center' })
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

// Regression: a diagram TALLER than the stage must pan symmetrically — both
// the top and bottom edges must become flush with the stage at the drag
// limits (flex centering keeps the transform-origin at the stage center).
await page.evaluate(() => {
  const block = document.createElement('div')
  block.className = '_block_abc md-code-block'
  block.innerHTML = '<div class="_bannerWrap_abc"><div class="_banner_abc"><div class="_infostring_abc">mermaid</div><div class="_action_abc"><button>复制</button></div></div></div><pre class="_plain_abc"><code>flowchart TD\n  subgraph A["tall"]\n    X1["x"]\n    X2["x"]\n    X3["x"]\n    X4["x"]\n  end\n  X1 --> X2\n  X2 --> X3\n  X3 --> X4</code></pre>'
  document.body.append(block)
  block.scrollIntoView({ block: 'center' })
})
await page.waitForTimeout(4000)
await page.evaluate(() => {
  const btns = document.querySelectorAll('.dsh-mermaid-zoom')
  btns[btns.length - 1].click()
})
await page.waitForTimeout(400)
await page.evaluate(() => {
  const overlay = document.querySelector('.dsh-mermaid-overlay')
  for (let i = 0; i < 8; i++) {
    overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
  }
})
const tallBox = await page.locator('.dsh-mermaid-stage').boundingBox()
const gaps = () => page.evaluate(() => {
  const stage = document.querySelector('.dsh-mermaid-stage')
  const svg = stage.querySelector('svg')
  const sr = stage.getBoundingClientRect()
  const vr = svg.getBoundingClientRect()
  return { topGap: Math.round(vr.top - sr.top), bottomGap: Math.round(sr.bottom - vr.bottom) }
})
// Drag to the top limit (drag down), then the bottom limit (drag up).
await page.mouse.move(tallBox.x + tallBox.width / 2, tallBox.y + tallBox.height / 2)
await page.mouse.down({ button: 'left' })
await page.mouse.move(tallBox.x + tallBox.width / 2, tallBox.y + tallBox.height / 2 + 2000, { steps: 10 })
await page.mouse.up({ button: 'left' })
const topLimit = await gaps()
await page.mouse.move(tallBox.x + tallBox.width / 2, tallBox.y + tallBox.height / 2)
await page.mouse.down({ button: 'left' })
await page.mouse.move(tallBox.x + tallBox.width / 2, tallBox.y + tallBox.height / 2 - 2000, { steps: 10 })
await page.mouse.up({ button: 'left' })
const bottomLimit = await gaps()
// Both edges must be reachable: at the top drag limit the TOP is flush with
// the stage top; at the bottom drag limit the BOTTOM is flush with the stage
// bottom (the opposite edge then legitimately overflows).
const symmetricPan = topLimit.topGap <= 2 && bottomLimit.bottomGap <= 2
console.log('TALL PAN:', JSON.stringify({ topLimit, bottomLimit, symmetricPan }))

console.log('--- errors ---')
console.log(errors.slice(-5).join('\n') || '(none)')
await browser.close()

if (pre.zoomBtn !== true || !opened.overlayOpen || !opened.stageHasSvg || zoomed === null || !panned || !leftPanned || !symmetricPan || afterEsc !== false || afterBackdrop !== false) {
  process.exit(1)
}
