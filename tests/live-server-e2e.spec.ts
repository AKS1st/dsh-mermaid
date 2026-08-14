// @vitest-environment jsdom
// Verifies against a LIVE dsh web instance (default http://127.0.0.1:3080):
// fetch the exact client.js + mermaid.min.js bytes the browser receives and
// run the full render pipeline in jsdom, exactly like the real page does.
// Skips when no server is reachable, so the default test run stays green.
import { JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it } from 'vitest'

const BASE = process.env.DSH_WEB_BASE ?? 'http://127.0.0.1:3080'

async function serverUp(): Promise<boolean> {
  try {
    const response = await fetch(BASE, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

describe('live dsh web instance', () => {
  it('serves the plugin endpoints', async () => {
    if (!await serverUp()) return
    const config = await fetch(`${BASE}/mermaid-dist/config.json`).then(r => r.json())
    expect(config.theme).toBe('auto')
    expect(config.securityLevel).toBe('strict')

    const bundle = await fetch(`${BASE}/plugins/@dsh-external/dsh-mermaid/client.js`)
    expect(bundle.status).toBe(200)
    expect(await bundle.text()).toContain('window.__ModuleLoader__.load')

    const umd = await fetch(`${BASE}/mermaid-dist/mermaid.min.js`)
    expect(umd.status).toBe(200)
    expect(umd.headers.get('content-type')).toContain('text/javascript')
    expect((await umd.arrayBuffer()).byteLength).toBeGreaterThan(1_000_000)
  })

  it('renders a settled mermaid fence with the live-served bytes', async () => {
    if (!await serverUp()) return
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      pretendToBeVisual: true,
      runScripts: 'dangerously',
      url: `${BASE}/`,
    })
    const { window } = dom
    const { Element, SVGElement } = window
    for (const proto of [Element.prototype, SVGElement.prototype]) {
      if (!proto.getBBox) proto.getBBox = function () { return { x: 0, y: 0, width: 120, height: 40 } }
      if (!proto.getComputedTextLength) proto.getComputedTextLength = function () { return 40 }
      if (!proto.getBoundingClientRect) {
        proto.getBoundingClientRect = function () { return { x: 0, y: 0, width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40 } }
      }
    }

    // The real mermaid UMD, exactly as the browser fetches it.
    const umdSource = await fetch(`${BASE}/mermaid-dist/mermaid.min.js`).then(r => r.text())
    const mermaidScript = window.document.createElement('script')
    mermaidScript.textContent = umdSource
    window.document.head.append(mermaidScript)

    // The host config endpoint.
    const fetchStub: typeof fetch = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/mermaid-dist/config.json')) {
        return new Response(JSON.stringify({ theme: 'auto', maxTextSize: 50000, maxEdges: 2000, securityLevel: 'strict' }),
          { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('', { status: 404 })
    }
    Object.defineProperty(window, 'fetch', { value: fetchStub, configurable: true })

    // A settled mermaid fence as ui-primitives renders it.
    const block = window.document.createElement('div')
    block.className = '_block_abc md-code-block'
    block.innerHTML = '<div class="_bannerWrap_abc"><div class="_banner_abc"><div class="_infostring_abc">mermaid</div><div class="_action_abc"><button>复制</button></div></div></div><pre class="_plain_abc"><code>graph TD\n  A[Start] --> B{Decision}\n  B -->|yes| C[Go]\n  B -->|no| D[Stop]</code></pre>'
    window.document.body.append(block)

    // The real client bundle, exactly as the browser fetches it.
    let apply: ((ctx: { effect(cb: () => () => void): void }) => void) | undefined
    const loader = { load({ id, factory }: { id: string; factory: (r: unknown) => Record<string, unknown> }) {
      expect(id).toBe('@dsh-external/dsh-mermaid')
      apply = factory(() => { throw new Error('no require needed') })['apply'] as typeof apply
    } }
    Object.defineProperty(window, '__ModuleLoader__', { value: loader })
    const bundleSource = await fetch(`${BASE}/plugins/@dsh-external/dsh-mermaid/client.js`).then(r => r.text())
    const bundleScript = window.document.createElement('script')
    bundleScript.textContent = bundleSource
    window.document.head.append(bundleScript)
    expect(apply).toBeTypeOf('function')

    const disposers: Array<() => void> = []
    apply!({ effect(cb) { disposers.push(cb()); return () => {} } })
    await new Promise(resolve => window.setTimeout(resolve, 800))

    expect(block.querySelector('pre')).toBeNull()
    const host = block.querySelector('.dsh-mermaid')
    expect(host).not.toBeNull()
    expect(host!.innerHTML).toContain('<svg')
    expect(block.querySelector('[class*="infostring"]')?.textContent?.trim()).toBe('mermaid')
    for (const dispose of disposers) dispose()
  })
})
