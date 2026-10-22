// @vitest-environment jsdom
// End-to-end smoke of the BUILT client bundle (lib/client.js) exactly as the
// browser loads it: the ModuleLoader handoff, real config fetch, and the real
// mermaid UMD render replacing a settled ```mermaid fence.
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

/** Load the real mermaid UMD into the jsdom window (as a browser script would). */
function installMermaid(window: Window): unknown {
  const { Element, SVGElement } = window
  for (const proto of [Element.prototype, SVGElement.prototype]) {
    if (!proto.getBBox) proto.getBBox = function () { return { x: 0, y: 0, width: 120, height: 40 } }
    if (!proto.getComputedTextLength) proto.getComputedTextLength = function () { return 40 }
    if (!proto.getBoundingClientRect) {
      proto.getBoundingClientRect = function () { return { x: 0, y: 0, width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40 } }
    }
  }
  const script = window.document.createElement('script')
  script.textContent = readFileSync(resolve(import.meta.dirname ?? process.cwd(), '../node_modules/mermaid/dist/mermaid.min.js'), 'utf8')
  window.document.head.append(script)
  return (window as Window & { mermaid: unknown }).mermaid
}

/** Build the settled fence DOM exactly as ui-primitives' CodeBlock renders it. */
function settledMermaidFence(window: Window, source: string): HTMLElement {
  const { document } = window
  const block = document.createElement('div')
  block.className = '_block_abc md-code-block'
  const bannerWrap = document.createElement('div')
  const banner = document.createElement('div')
  const info = document.createElement('div')
  info.className = '_infostring_abc'
  info.textContent = 'mermaid'
  const action = document.createElement('div')
  const copy = document.createElement('button')
  copy.textContent = '复制'
  action.append(copy)
  banner.append(info, action)
  bannerWrap.append(banner)
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = source
  pre.append(code)
  block.append(bannerWrap, pre)
  return block
}

/**
 * Build a settled fence as the code-card CodeBlock renders it: the toolbar
 * labels mermaid "Code block", and the language lives on the component's
 * React fiber (`lang` prop).
 */
function settledCodeCardFence(window: Window, source: string): HTMLElement {
  const block = window.document.createElement('div')
  block.className = '_block_abc md-code-block _card_abc'
  block.innerHTML = '<div class="_bannerWrap_abc"><div class="_header_abc" data-code-block-banner>'
    + '<div class="_heading_abc"><span class="_language_abc">Code block</span></div>'
    + '<div class="_actions_abc"><button class="_action_abc" aria-label="Copy"></button></div></div></div>'
    + '<div class="_content_abc" data-code-block-content><pre class="_plain_abc"><code></code></pre></div>'
  block.querySelector('code')!.textContent = source
  const codeBlockFiber = { memoizedProps: { code: `${source}\n`, lang: 'mermaid', streaming: false }, return: null, alternate: null }
  Object.assign(block, { '__reactFiber$e2e': { memoizedProps: {}, return: codeBlockFiber, alternate: null } })
  return block
}

/**
 * Load the BUILT bundle into a fresh jsdom page holding one fence, apply it,
 * and wait for the async render.
 * @returns the fence element and the plugin's disposers.
 */
async function renderWithBuiltBundle(buildFence: (window: Window) => HTMLElement): Promise<{ block: HTMLElement; disposers: Array<() => void> }> {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    url: 'http://localhost/',
  })
  const { window } = dom
  // @ts-expect-error jsdom window is a real Window in the test realm
  globalThis.window = window
  // @ts-expect-error jsdom window is a real Window in the test realm
  globalThis.document = window.document
  // @ts-expect-error jsdom window is a real Window in the test realm
  globalThis.MutationObserver = window.MutationObserver
  // @ts-expect-error jsdom window is a real Window in the test realm
  globalThis.fetch = window.fetch
  // @ts-expect-error jsdom window is a real Window in the test realm
  globalThis.console = window.console

  // Pre-install the real mermaid so the client's loadMermaid short-circuits
  // (it checks window.mermaid first) — no network script fetch in jsdom.
  installMermaid(window)

  // The host config endpoint, served as it is on the real server. jsdom does
  // not implement fetch, so provide it on the window the bundle runs in.
  const fetchStub: typeof fetch = async () => new Response(JSON.stringify({
    theme: 'auto', maxTextSize: 50000, maxEdges: 2000, securityLevel: 'strict',
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  Object.defineProperty(window, 'fetch', { value: fetchStub, configurable: true })

  window.document.body.append(buildFence(window))

  // Load the BUILT client bundle the way the browser does: a classic script
  // element; jsdom (runScripts: 'dangerously') executes it, which runs the
  // top-level `window.__ModuleLoader__.load(...)` handoff.
  let apply: ((ctx: { effect(cb: () => () => void): void }) => void) | undefined
  const loader = { load({ id, factory }: { id: string; factory: (r: unknown) => Record<string, unknown> }) {
    expect(id).toBe('dsh-mermaid')
    const exports_ = factory(() => { throw new Error('no require needed') })
    apply = exports_['apply'] as typeof apply
  } }
  Object.defineProperty(window, '__ModuleLoader__', { value: loader })
  const bundleScript = window.document.createElement('script')
  bundleScript.textContent = readFileSync(resolve(import.meta.dirname ?? process.cwd(), '../lib/client.js'), 'utf8')
  window.document.head.append(bundleScript)
  expect(apply).toBeTypeOf('function')

  // Run the plugin with a capture-only ctx; observers are wired via effect.
  const disposers: Array<() => void> = []
  apply!({ effect(cb) { disposers.push(cb()); return () => {} } })

  await new Promise(resolve => window.setTimeout(resolve, 500))
  return { block: window.document.querySelector('.md-code-block') as HTMLElement, disposers }
}

const SOURCE = 'graph TD\n  A[Start] --> B{Decision}\n  B -->|yes| C[Go]\n  B -->|no| D[Stop]'

describe('built client bundle end-to-end', () => {
  it('loads via ModuleLoader, fetches config, and renders a settled mermaid fence as SVG', async () => {
    const { block, disposers } = await renderWithBuiltBundle(window => settledMermaidFence(window, SOURCE))
    expect(block.querySelector('pre')).toBeNull()
    const host = block.querySelector('.dsh-mermaid')
    expect(host).not.toBeNull()
    expect(host!.innerHTML).toContain('<svg')
    // The banner (infostring + copy) must be untouched.
    expect(block.querySelector('[class*="infostring"]')?.textContent?.trim()).toBe('mermaid')
    for (const dispose of disposers) dispose()
  })

  it('renders a settled code-card fence whose toolbar shows the generic label', async () => {
    const { block, disposers } = await renderWithBuiltBundle(window => settledCodeCardFence(window, SOURCE))
    expect(block.querySelector('pre')).toBeNull()
    expect(block.querySelector('.dsh-mermaid')?.innerHTML).toContain('<svg')
    expect(block.querySelector('[class*="language"]')?.textContent).toBe('Code block')
    expect(block.querySelector('[class*="actions"]')?.firstElementChild?.classList.contains('dsh-mermaid-zoom')).toBe(true)
    for (const dispose of disposers) dispose()
  })
})
