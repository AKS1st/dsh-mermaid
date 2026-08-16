// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CODE_BLOCK_SELECTOR, ERROR_ATTR, ERROR_BAR_CLASS, HOST_CLASS, INFOSTRING_SEGMENT, LOADING_CLASS, OVERLAY_CLASS, RENDERED_ATTR, STAGE_CLASS, STAGE_DRAGGING_CLASS, ZOOM_BUTTON_CLASS,
  __resetForTests, buildErrorReport, ensureZoomButton, fenceSource, isMermaidBlock, openOverlay, reRenderAll, removeStrayErrorElements, renderBlock, scan, sendToAI, showErrorBar,
  type MermaidApi, type MermaidRenderEnv,
} from '../src/client/dom.ts'
import { STYLE_ID, mountStyles } from '../src/client/styles.ts'
import { DEFAULT_CONFIG } from '../src/protocol.ts'

/** Build a settled mermaid fence exactly as CodeBlock renders it (plain fallback). */
function mermaidBlock(source: string): HTMLElement {
  const block = document.createElement('div')
  block.className = `_block_abc ${CODE_BLOCK_SELECTOR.slice(1)}`
  const bannerWrap = document.createElement('div')
  const banner = document.createElement('div')
  const info = document.createElement('div')
  info.className = `_infostring_abc`
  info.textContent = 'mermaid'
  const action = document.createElement('div')
  action.className = '_action_abc'
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
  document.body.append(block)
  return block
}

/** A plain (non-mermaid) fence: infostring says `ts`. */
function tsBlock(source: string): HTMLElement {
  const block = document.createElement('div')
  block.className = `_block_abc ${CODE_BLOCK_SELECTOR.slice(1)}`
  const bannerWrap = document.createElement('div')
  const banner = document.createElement('div')
  const info = document.createElement('div')
  info.className = `_infostring_abc`
  info.textContent = 'ts'
  banner.append(info)
  bannerWrap.append(banner)
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = source
  pre.append(code)
  block.append(bannerWrap, pre)
  document.body.append(block)
  return block
}

const fakeMermaid: MermaidApi = {
  initialize(config: Record<string, unknown>): void {
    this.lastInit = config
  },
  lastInit: undefined as Record<string, unknown> | undefined,
  async render(id: string, source: string): Promise<{ svg: string }> {
    this.lastId = id
    this.lastSource = source
    return { svg: `<svg id="${id}" data-source="${source}"></svg>` }
  },
  lastId: '',
  lastSource: '',
}

function env(overrides: Partial<MermaidRenderEnv> = {}): MermaidRenderEnv {
  return {
    loadMermaid: async () => fakeMermaid,
    config: DEFAULT_CONFIG,
    ...overrides,
  }
}

/**
 * Controllable IntersectionObserver stand-in. `autoVisible` (default true)
 * makes every observed target immediately visible, mimicking a viewport that
 * contains everything — the old behavior. Set it false and drive `fire()`
 * manually to exercise the lazy/cancel paths.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  static autoVisible = true
  readonly targets = new Set<Element>()
  readonly rootMargin: string
  private readonly callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.rootMargin = options?.rootMargin ?? '0px'
    FakeIntersectionObserver.instances.push(this)
  }

  observe(target: Element): void {
    this.targets.add(target)
    if (FakeIntersectionObserver.autoVisible) {
      queueMicrotask(() => {
        this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      })
    }
  }

  unobserve(target: Element): void {
    this.targets.delete(target)
  }

  disconnect(): void {
    this.targets.clear()
  }

  fire(entries: Array<{ target: Element; isIntersecting: boolean }>): void {
    this.callback(
      entries.map(entry => ({ target: entry.target, isIntersecting: entry.isIntersecting } as IntersectionObserverEntry)),
      this as unknown as IntersectionObserver,
    )
  }

  takeRecords(): IntersectionObserverEntry[] { return [] }
  get root(): Element | null { return null }
  get thresholds(): ReadonlyArray<number> { return [] }
}

/**
 * jsdom has no PointerEvent / pointer capture; the overlay pan uses pointer
 * events with setPointerCapture, so tests get a minimal stand-in.
 */
class FakePointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, init: { pointerId?: number; button?: number; bubbles?: boolean; cancelable?: boolean; clientX?: number; clientY?: number } = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.body.removeAttribute('data-ds-dark-theme')
  fakeMermaid.lastInit = undefined
  fakeMermaid.lastId = ''
  fakeMermaid.lastSource = ''
  __resetForTests()
  FakeIntersectionObserver.instances = []
  FakeIntersectionObserver.autoVisible = true
  globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver
  globalThis.PointerEvent = FakePointerEvent as unknown as typeof PointerEvent
  Element.prototype.setPointerCapture = function (): void {}
  Element.prototype.hasPointerCapture = function (): boolean { return false }
  Element.prototype.releasePointerCapture = function (): void {}
})

/** Let the render queue drain (macrotask yields + microtask renders). */
async function settle(): Promise<void> {
  await new Promise(resolve => window.setTimeout(resolve, 30))
}

/** Parse the scale() value out of the overlay SVG's transform string. */
function scaleOf(transform: string): number {
  return parseFloat(transform.match(/scale\(([\d.]+)\)/)?.[1] ?? '1')
}

/** Parse the translate() px offsets out of the overlay SVG's transform string. */
function translateOf(transform: string): [number, number] {
  const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)
  return match ? [parseFloat(match[1]), parseFloat(match[2])] : [0, 0]
}

/** Run a callback with a fixed stage getBoundingClientRect (jsdom has no layout). */
function withStageRect<T>(width: number, height: number, fn: () => T): T {
  const orig = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (): DOMRect {
    return { x: 0, y: 0, width, height, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}) } as DOMRect
  }
  try {
    return fn()
  } finally {
    Element.prototype.getBoundingClientRect = orig
  }
}

describe('isMermaidBlock', () => {
  it('matches a fence whose infostring is exactly mermaid', () => {
    expect(isMermaidBlock(mermaidBlock('graph TD; A-->B'))).toBe(true)
  })

  it('rejects a non-mermaid fence', () => {
    expect(isMermaidBlock(tsBlock('const x = 1'))).toBe(false)
  })

  it('rejects a streaming fence (empty infostring)', () => {
    const block = mermaidBlock('graph TD')
    const info = block.querySelector<HTMLElement>(`[class*="${INFOSTRING_SEGMENT}"]`)
    info!.textContent = ''
    expect(isMermaidBlock(block)).toBe(false)
  })
})

describe('fenceSource', () => {
  it('extracts the pre text minus the display-trimmed trailing newline', () => {
    const block = mermaidBlock('graph TD\n  A-->B\n')
    expect(fenceSource(block)).toBe('graph TD\n  A-->B')
  })
})

describe('renderBlock', () => {
  it('replaces the pre with the SVG host and marks the block rendered', async () => {
    const block = mermaidBlock('graph TD; A-->B')
    await renderBlock(block, 'graph TD; A-->B', env())
    expect(block.querySelector('pre')).toBeNull()
    const host = block.querySelector(`.${HOST_CLASS}`)
    expect(host).not.toBeNull()
    expect(host!.innerHTML).toContain('<svg')
    expect(block.hasAttribute(RENDERED_ATTR)).toBe(true)
    expect(fakeMermaid.lastInit?.['securityLevel']).toBe('strict')
    // mermaid must never render its built-in error diagram into the page.
    expect(fakeMermaid.lastInit?.['suppressErrorRendering']).toBe(true)
  })

  it('keeps the plain text and marks an error when mermaid throws', async () => {
    const block = mermaidBlock('this is not a diagram')
    const throwing: MermaidApi = {
      ...fakeMermaid,
      async render(): Promise<{ svg: string }> { throw new Error('parse failed') },
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await renderBlock(block, 'this is not a diagram', env({ loadMermaid: async () => throwing }))
      expect(block.querySelector('pre')).not.toBeNull()
      expect(block.hasAttribute(ERROR_ATTR)).toBe(true)
      expect(block.hasAttribute(RENDERED_ATTR)).toBe(false)
      // An error summary bar appears below the block with the message + actions.
      const bar = block.querySelector<HTMLElement>(`.${ERROR_BAR_CLASS}`)
      expect(bar).not.toBeNull()
      expect(bar!.textContent).toContain('parse failed')
      expect(bar!.querySelector('button')?.textContent).toBe('复制报错')
      expect([...(bar!.querySelectorAll('button') ?? [])].map(b => b.textContent)).toContain('发送给 AI 修复')
    } finally {
      spy.mockRestore()
    }
  })

  it('marks an error when mermaid.render never settles (timeout guard)', async () => {
    const block = mermaidBlock('graph TD; A-->B')
    const hanging: MermaidApi = {
      ...fakeMermaid,
      render(): Promise<{ svg: string }> { return new Promise(() => { /* never settles */ }) },
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await renderBlock(block, 'graph TD; A-->B', env({ loadMermaid: async () => hanging }))
      expect(block.hasAttribute(ERROR_ATTR)).toBe(true)
      expect(block.querySelector('pre')).not.toBeNull()
    } finally {
      spy.mockRestore()
    }
  }, 20000)

  it('replaces the previous host on re-render (theme flip path)', async () => {
    const block = mermaidBlock('graph TD; A-->B')
    await renderBlock(block, 'graph TD; A-->B', env())
    await renderBlock(block, 'graph TD; A-->B', env())
    expect(block.querySelectorAll(`.${HOST_CLASS}`)).toHaveLength(1)
  })
})

describe('scan (lazy viewport rendering)', () => {
  it('renders settled mermaid fences and leaves other fences alone', async () => {
    const mermaid = mermaidBlock('graph TD; A-->B')
    const ts = tsBlock('const x = 1')
    scan(env())
    await vi.waitFor(() => {
      expect(mermaid.querySelector(`.${HOST_CLASS}`)).not.toBeNull()
    })
    expect(ts.querySelector('pre')).not.toBeNull()
    expect(ts.hasAttribute(RENDERED_ATTR)).toBe(false)
  })

  it('skips already-rendered blocks', async () => {
    const block = mermaidBlock('graph TD; A-->B')
    await renderBlock(block, 'graph TD; A-->B', env())
    const host = block.querySelector(`.${HOST_CLASS}`)
    scan(env())
    await vi.waitFor(() => {
      expect(block.querySelector(`.${HOST_CLASS}`)).toBe(host)
    })
  })

  it('does not render a fence that never enters the viewport', async () => {
    FakeIntersectionObserver.autoVisible = false
    const block = mermaidBlock('graph TD; A-->B')
    scan(env())
    await settle()
    expect(block.querySelector('pre')).not.toBeNull()
    expect(block.querySelector(`.${HOST_CLASS}`)).toBeNull()
    expect(block.hasAttribute(RENDERED_ATTR)).toBe(false)
  })

  it('renders a fence once it enters the viewport', async () => {
    FakeIntersectionObserver.autoVisible = false
    const block = mermaidBlock('graph TD; A-->B')
    scan(env())
    const io = FakeIntersectionObserver.instances[0]
    io.fire([{ target: block, isIntersecting: true }])
    await vi.waitFor(() => expect(block.querySelector(`.${HOST_CLASS}`)).not.toBeNull())
    expect(block.hasAttribute(RENDERED_ATTR)).toBe(true)
  })

  it('skips a queued render for a block that left the viewport, then renders on re-entry', async () => {
    FakeIntersectionObserver.autoVisible = false
    const block = mermaidBlock('graph TD; A-->B')
    scan(env())
    const io = FakeIntersectionObserver.instances[0]
    io.fire([{ target: block, isIntersecting: true }])  // enters → enqueued
    io.fire([{ target: block, isIntersecting: false }]) // leaves before the queue drains
    await settle()
    expect(block.querySelector('pre')).not.toBeNull()
    expect(block.hasAttribute(RENDERED_ATTR)).toBe(false)
    io.fire([{ target: block, isIntersecting: true }])  // re-enters
    await vi.waitFor(() => expect(block.querySelector(`.${HOST_CLASS}`)).not.toBeNull())
  })

  it('discards an in-flight render whose block left the viewport, keeping the placeholder', async () => {
    FakeIntersectionObserver.autoVisible = false
    const block = mermaidBlock('graph TD; A-->B')
    let resolveLoad!: (api: MermaidApi) => void
    const slowLoad = new Promise<MermaidApi>(resolve => { resolveLoad = resolve })
    scan(env({ loadMermaid: () => slowLoad }))
    const io = FakeIntersectionObserver.instances[0]
    io.fire([{ target: block, isIntersecting: true }])
    await vi.waitFor(() => expect(block.querySelector(`.${HOST_CLASS}.${LOADING_CLASS}`)).not.toBeNull())
    // Scrolls away while mermaid is still loading; the finished render is discarded.
    io.fire([{ target: block, isIntersecting: false }])
    resolveLoad(fakeMermaid)
    await settle()
    expect(block.querySelector(`.${HOST_CLASS}.${LOADING_CLASS}`)).not.toBeNull()
    expect(block.hasAttribute(RENDERED_ATTR)).toBe(false)
    // Re-entering renders it.
    io.fire([{ target: block, isIntersecting: true }])
    await vi.waitFor(() => expect(block.querySelector(`.${HOST_CLASS}:not(.${LOADING_CLASS})`)).not.toBeNull())
  })

  it('unobserves a detached block so the observer does not hold it', async () => {
    FakeIntersectionObserver.autoVisible = false
    const block = mermaidBlock('graph TD; A-->B')
    scan(env())
    const io = FakeIntersectionObserver.instances[0]
    expect(io.targets.has(block)).toBe(true)
    block.remove()
    io.fire([{ target: block, isIntersecting: false }])
    expect(io.targets.has(block)).toBe(false)
  })

  it('dedupes duplicate enter entries into one render', async () => {
    FakeIntersectionObserver.autoVisible = false
    const block = mermaidBlock('graph TD; A-->B')
    const renderSpy = vi.spyOn(fakeMermaid, 'render')
    scan(env())
    const io = FakeIntersectionObserver.instances[0]
    io.fire([{ target: block, isIntersecting: true }])
    io.fire([{ target: block, isIntersecting: true }])
    await vi.waitFor(() => expect(block.hasAttribute(RENDERED_ATTR)).toBe(true))
    expect(renderSpy).toHaveBeenCalledTimes(1)
    renderSpy.mockRestore()
  })

  it('does not retry a failed block on re-entry', async () => {
    FakeIntersectionObserver.autoVisible = false
    const throwing: MermaidApi = {
      ...fakeMermaid,
      async render(): Promise<{ svg: string }> { throw new Error('parse failed') },
    }
    const renderSpy = vi.spyOn(throwing, 'render')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const block = mermaidBlock('graph TD; A-->B')
      scan(env({ loadMermaid: async () => throwing }))
      const io = FakeIntersectionObserver.instances[0]
      io.fire([{ target: block, isIntersecting: true }])
      await vi.waitFor(() => expect(block.hasAttribute(ERROR_ATTR)).toBe(true))
      const calls = renderSpy.mock.calls.length
      io.fire([{ target: block, isIntersecting: true }]) // re-entry after failure
      await settle()
      expect(renderSpy).toHaveBeenCalledTimes(calls)
    } finally {
      renderSpy.mockRestore()
      spy.mockRestore()
    }
  })

  it('falls back to eager rendering when IntersectionObserver is unavailable', async () => {
    globalThis.IntersectionObserver = undefined
    const block = mermaidBlock('graph TD; A-->B')
    scan(env())
    await vi.waitFor(() => expect(block.querySelector(`.${HOST_CLASS}`)).not.toBeNull())
    expect(block.hasAttribute(RENDERED_ATTR)).toBe(true)
  })
})

describe('loading placeholder', () => {
  it('shows a loading placeholder while the first render is in flight, then swaps in the SVG', async () => {
    let resolveLoad!: (api: MermaidApi) => void
    const slowLoad = new Promise<MermaidApi>(resolve => { resolveLoad = resolve })
    const block = mermaidBlock('graph TD; A-->B')
    scan(env({ loadMermaid: () => slowLoad }))
    await vi.waitFor(() => expect(block.querySelector(`.${HOST_CLASS}.${LOADING_CLASS}`)).not.toBeNull())
    resolveLoad(fakeMermaid)
    await vi.waitFor(() => expect(block.querySelector(`.${HOST_CLASS}:not(.${LOADING_CLASS})`)).not.toBeNull())
    expect(block.querySelector('pre')).toBeNull()
    expect(block.hasAttribute(RENDERED_ATTR)).toBe(true)
  })

  it('restores the plain code block when a first render fails', async () => {
    const throwing: MermaidApi = {
      ...fakeMermaid,
      async render(): Promise<{ svg: string }> { throw new Error('parse failed') },
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const block = mermaidBlock('graph TD; A-->B')
      scan(env({ loadMermaid: async () => throwing }))
      await vi.waitFor(() => {
        expect(block.querySelector('pre')).not.toBeNull()
        expect(block.hasAttribute(ERROR_ATTR)).toBe(true)
      })
      expect(block.querySelector(`.${HOST_CLASS}`)).toBeNull()
      expect(block.querySelector(`.${ERROR_BAR_CLASS}`)).not.toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('error summary bar', () => {
  it('buildErrorReport includes the error and the failing source', () => {
    const report = buildErrorReport('graph TD\n  A --> B', 'parse error on line 2')
    expect(report).toContain('parse error on line 2')
    expect(report).toContain('```mermaid')
    expect(report).toContain('graph TD\n  A --> B')
  })

  it('shows a truncated summary with copy and send actions', () => {
    const longMessage = 'Parse error on line 33: ' + 'x'.repeat(300)
    const block = mermaidBlock('graph TD; A-->B')
    showErrorBar(block, 'graph TD; A-->B', new Error(longMessage))
    const bar = block.querySelector<HTMLElement>(`.${ERROR_BAR_CLASS}`)!
    const message = bar.querySelector(`.${ERROR_BAR_CLASS}-message`)!
    // Displayed summary is truncated; the full message rides the title.
    expect(message.textContent!.length).toBeLessThan(longMessage.length)
    expect(message.textContent).toContain('…')
    expect(message.title).toBe(longMessage)
    const labels = [...bar.querySelectorAll('button')].map(b => b.textContent)
    expect(labels).toEqual(['复制报错', '发送给 AI 修复'])
  })

  it('copy button copies the full report to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const block = mermaidBlock('graph TD; A-->B')
    showErrorBar(block, 'graph TD; A-->B', new Error('boom'))
    const copyButton = [...block.querySelectorAll<HTMLButtonElement>(`.${ERROR_BAR_CLASS} button`)].find(b => b.textContent === '复制报错')!
    copyButton.click()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled())
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).toContain('boom')
    expect(copied).toContain('graph TD; A-->B')
    expect(copied).toContain('```mermaid')
  })

  it('send button fills the conversation input and presses Enter', async () => {
    const textarea = document.createElement('textarea')
    textarea.setAttribute('data-phase', 'ready')
    document.body.append(textarea)
    const dispatchSpy = vi.spyOn(textarea, 'dispatchEvent')
    const block = mermaidBlock('graph TD; A-->B')
    showErrorBar(block, 'graph TD; A-->B', new Error('boom'))
    const sendButton = [...block.querySelectorAll<HTMLButtonElement>(`.${ERROR_BAR_CLASS} button`)].find(b => b.textContent === '发送给 AI 修复')!
    sendButton.click()
    expect(textarea.value).toContain('mermaid 渲染失败')
    expect(textarea.value).toContain('boom')
    expect(textarea.value).toContain('```mermaid')
    await vi.waitFor(() => {
      expect(dispatchSpy.mock.calls.some(([event]) => event instanceof KeyboardEvent && event.key === 'Enter')).toBe(true)
    })
  })

  it('send falls back to copying when no conversation input is present', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const block = mermaidBlock('graph TD; A-->B')
    showErrorBar(block, 'graph TD; A-->B', new Error('boom'))
    const sendButton = [...block.querySelectorAll<HTMLButtonElement>(`.${ERROR_BAR_CLASS} button`)].find(b => b.textContent === '发送给 AI 修复')!
    sendButton.click()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls[0][0]).toContain('boom')
  })

  it('removeStrayErrorElements clears mermaid error artifacts but keeps normal nodes', () => {
    const strayDiv = document.createElement('div')
    strayDiv.id = 'ddsh-mermaid-3'
    const strayIframe = document.createElement('iframe')
    strayIframe.id = 'idsh-mermaid-4'
    const normal = document.createElement('div')
    normal.id = 'dsh-mermaid-5'
    document.body.append(strayDiv, strayIframe, normal)
    removeStrayErrorElements()
    expect(document.getElementById('ddsh-mermaid-3')).toBeNull()
    expect(document.getElementById('idsh-mermaid-4')).toBeNull()
    expect(document.getElementById('dsh-mermaid-5')).not.toBeNull()
  })
})

describe('reRenderAll (lazy theme refresh)', () => {
  it('re-renders visible rendered blocks with the new theme', async () => {
    const block = mermaidBlock('graph TD; A-->B')
    await renderBlock(block, 'graph TD; A-->B', env())
    document.body.setAttribute('data-ds-dark-theme', '')
    reRenderAll(env({ config: { ...DEFAULT_CONFIG, theme: 'dark' } }))
    await vi.waitFor(() => {
      expect(fakeMermaid.lastInit?.['theme']).toBe('dark')
    })
    expect(block.querySelector(`.${HOST_CLASS}`)).not.toBeNull()
  })

  it('defers refreshing an offscreen rendered block until it re-enters', async () => {
    FakeIntersectionObserver.autoVisible = false
    const block = mermaidBlock('graph TD; A-->B')
    await renderBlock(block, 'graph TD; A-->B', env())
    const before = block.querySelector(`.${HOST_CLASS}`)
    reRenderAll(env({ config: { ...DEFAULT_CONFIG, theme: 'dark' } }))
    await settle()
    // Never entered the viewport: old SVG stays, no re-render happened yet.
    expect(block.querySelector(`.${HOST_CLASS}`)).toBe(before)
    expect(fakeMermaid.lastInit?.['theme']).not.toBe('dark')
    const io = FakeIntersectionObserver.instances[0]
    io.fire([{ target: block, isIntersecting: true }])
    await vi.waitFor(() => expect(fakeMermaid.lastInit?.['theme']).toBe('dark'))
  })

  it('keeps the previous SVG and no error mark when a refresh fails', async () => {
    const block = mermaidBlock('graph TD; A-->B')
    await renderBlock(block, 'graph TD; A-->B', env())
    const svgHost = block.querySelector(`.${HOST_CLASS}`)
    const throwing: MermaidApi = {
      ...fakeMermaid,
      async render(): Promise<{ svg: string }> { throw new Error('boom') },
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      reRenderAll(env({ loadMermaid: async () => throwing }))
      await settle()
      expect(block.querySelector(`.${HOST_CLASS} svg`)).not.toBeNull()
      expect(block.querySelector(`.${HOST_CLASS}`)).toBe(svgHost)
      expect(block.hasAttribute(ERROR_ATTR)).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('re-renders eagerly (no IntersectionObserver) on a theme flip', async () => {
    globalThis.IntersectionObserver = undefined
    const block = mermaidBlock('graph TD; A-->B')
    await renderBlock(block, 'graph TD; A-->B', env())
    reRenderAll(env({ config: { ...DEFAULT_CONFIG, theme: 'dark' } }))
    await vi.waitFor(() => expect(fakeMermaid.lastInit?.['theme']).toBe('dark'))
    expect(block.querySelector(`.${HOST_CLASS}`)).not.toBeNull()
  })
})

describe('zoom overlay', () => {
  it('rendering a block injects a zoom button left of the copy button', async () => {
    const block = mermaidBlock('graph TD; A-->B')
    await renderBlock(block, 'graph TD; A-->B', env())
    const zoom = block.querySelector<HTMLButtonElement>(`.${ZOOM_BUTTON_CLASS}`)
    expect(zoom).not.toBeNull()
    // The zoom button sits before the copy button inside the action cell.
    const action = block.querySelector('[class*="action"]')
    const children = [...(action?.children ?? [])]
    expect(children[0]).toBe(zoom)
    expect(zoom!.textContent).toBe('⛶')
  })

  it('ensureZoomButton is idempotent', async () => {
    const block = mermaidBlock('graph TD; A-->B')
    ensureZoomButton(block)
    ensureZoomButton(block)
    expect(block.querySelectorAll(`.${ZOOM_BUTTON_CLASS}`)).toHaveLength(1)
  })

  it('openOverlay clones the SVG into a full-screen stage', () => {
    const block = mermaidBlock('graph TD; A-->B')
    block.innerHTML += `<div class="${HOST_CLASS}"><svg><g/></svg></div>`
    openOverlay(block)
    const overlay = document.querySelector(`.${OVERLAY_CLASS}`)
    expect(overlay).not.toBeNull()
    const stage = overlay!.querySelector(`.${STAGE_CLASS}`)
    expect(stage).not.toBeNull()
    expect(stage!.querySelector('svg')).not.toBeNull()
    document.body.innerHTML = ''
  })

  it('fits the diagram to the stage on open instead of showing it at natural size', () => {
    withStageRect(1000, 800, () => {
      const block = mermaidBlock('graph TD; A-->B')
      block.innerHTML += `<div class="${HOST_CLASS}"><svg viewBox="0 0 400 300"><g/></svg></div>`
      openOverlay(block)
      const stage = document.querySelector<HTMLElement>(`.${STAGE_CLASS}`)!
      const svg = stage.querySelector('svg') as HTMLElement
      // 400x300 diagram inside a 1000x800 stage minus 2*24 padding: upscaled
      // to fit 952x752 — near full-screen, not natural size, centered (pan 0).
      expect(translateOf(svg.style.transform)).toEqual([0, 0])
      const initial = scaleOf(svg.style.transform)
      expect(initial).toBeCloseTo(Math.min(952 / 400, 752 / 300), 5)
      expect(initial).toBeGreaterThan(1)
      // Wheel zoom is relative to the fitted size.
      stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
      const after = scaleOf(svg.style.transform)
      expect(after).toBeCloseTo(initial * 1.15, 5)
      document.body.innerHTML = ''
    })
  })

  it('wheel zooms the fitted SVG within bounds', () => {
    const block = mermaidBlock('graph TD; A-->B')
    block.innerHTML += `<div class="${HOST_CLASS}"><svg><g/></svg></div>`
    openOverlay(block)
    const stage = document.querySelector<HTMLElement>(`.${STAGE_CLASS}`)!
    const overlay = document.querySelector<HTMLElement>(`.${OVERLAY_CLASS}`)!
    const svg = stage.querySelector('svg') as HTMLElement
    const zoomIn = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
    overlay.dispatchEvent(zoomIn)
    expect(scaleOf(svg.style.transform)).toBe(1.15)
    // A long streak of zoom-out hits the floor.
    for (let i = 0; i < 40; i++) {
      overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
    }
    expect(scaleOf(svg.style.transform)).toBe(0.2)
    document.body.innerHTML = ''
  })

  it('middle-button drag pans via translate (works without zooming)', () => {
    withStageRect(1000, 800, () => {
      const block = mermaidBlock('graph TD; A-->B')
      block.innerHTML += `<div class="${HOST_CLASS}"><svg viewBox="0 0 400 300"><g/></svg></div>`
      openOverlay(block)
      const stage = document.querySelector<HTMLElement>(`.${STAGE_CLASS}`)!
      const svg = stage.querySelector('svg') as HTMLElement
      stage.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 7, button: 1, bubbles: true, cancelable: true, clientX: 200, clientY: 150 }))
      stage.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: 7, button: -1, bubbles: true, clientX: 210, clientY: 160 }))
      // Content follows the cursor: translate accumulates the drag deltas.
      expect(translateOf(svg.style.transform)).toEqual([10, 10])
      expect(stage.classList.contains(STAGE_DRAGGING_CLASS)).toBe(true)
      // Another pointer's moves are ignored (only the captured pointer pans).
      stage.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: 99, button: -1, bubbles: true, clientX: 999, clientY: 999 }))
      expect(translateOf(svg.style.transform)).toEqual([10, 10])
      // An excessive drag is clamped so the diagram stays reachable
      // (visual 952x714 in a 1000x800 stage → ±24 / ±43).
      stage.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: 7, button: -1, bubbles: true, clientX: 999, clientY: 999 }))
      expect(translateOf(svg.style.transform)).toEqual([24, 43])
      // Releasing the middle pointer ends the pan; further moves do nothing.
      stage.dispatchEvent(new FakePointerEvent('pointerup', { pointerId: 7, button: 1, bubbles: true, clientX: 999, clientY: 999 }))
      expect(stage.classList.contains(STAGE_DRAGGING_CLASS)).toBe(false)
      stage.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: 7, button: -1, bubbles: true, clientX: 999, clientY: 999 }))
      expect(translateOf(svg.style.transform)).toEqual([24, 43])
      document.body.innerHTML = ''
    })
  })

  it('left-button drag also pans (trackpad-friendly)', () => {
    withStageRect(1000, 800, () => {
      const block = mermaidBlock('graph TD; A-->B')
      block.innerHTML += `<div class="${HOST_CLASS}"><svg viewBox="0 0 400 300"><g/></svg></div>`
      openOverlay(block)
      const stage = document.querySelector<HTMLElement>(`.${STAGE_CLASS}`)!
      const svg = stage.querySelector('svg') as HTMLElement
      stage.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 2, button: 0, bubbles: true, cancelable: true, clientX: 200, clientY: 150 }))
      stage.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: 2, button: 0, bubbles: true, clientX: 215, clientY: 165 }))
      expect(translateOf(svg.style.transform)).toEqual([15, 15])
      stage.dispatchEvent(new FakePointerEvent('pointerup', { pointerId: 2, button: 0, bubbles: true, clientX: 215, clientY: 165 }))
      document.body.innerHTML = ''
    })
  })

  it('right-button and off-stage presses do not pan', () => {
    withStageRect(1000, 800, () => {
      const block = mermaidBlock('graph TD; A-->B')
      block.innerHTML += `<div class="${HOST_CLASS}"><svg viewBox="0 0 400 300"><g/></svg></div>`
      openOverlay(block)
      const stage = document.querySelector<HTMLElement>(`.${STAGE_CLASS}`)!
      const overlay = document.querySelector<HTMLElement>(`.${OVERLAY_CLASS}`)!
      const svg = stage.querySelector('svg') as HTMLElement
      // Right button on the stage: no pan.
      stage.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 1, button: 2, bubbles: true, cancelable: true, clientX: 200, clientY: 150 }))
      stage.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: 1, button: 2, bubbles: true, clientX: 260, clientY: 180 }))
      expect(translateOf(svg.style.transform)).toEqual([0, 0])
      expect(stage.classList.contains(STAGE_DRAGGING_CLASS)).toBe(false)
      // Middle button on the backdrop (outside the stage): no pan.
      overlay.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 3, button: 1, bubbles: true, cancelable: true, clientX: 20, clientY: 20 }))
      overlay.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: 3, button: 1, bubbles: true, clientX: 80, clientY: 80 }))
      expect(translateOf(svg.style.transform)).toEqual([0, 0])
      expect(stage.classList.contains(STAGE_DRAGGING_CLASS)).toBe(false)
      document.body.innerHTML = ''
    })
  })

  it('a left-drag pan ending over the backdrop does not close the overlay', () => {
    const block = mermaidBlock('graph TD; A-->B')
    block.innerHTML += `<div class="${HOST_CLASS}"><svg><g/></svg></div>`
    openOverlay(block)
    const stage = document.querySelector<HTMLElement>(`.${STAGE_CLASS}`)!
    const overlay = document.querySelector<HTMLElement>(`.${OVERLAY_CLASS}`)!
    // Drag from the stage, release: the release click lands on the overlay
    // (common ancestor) — the overlay must stay open.
    stage.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 4, button: 0, bubbles: true, cancelable: true, clientX: 200, clientY: 150 }))
    stage.dispatchEvent(new FakePointerEvent('pointermove', { pointerId: 4, button: 0, bubbles: true, clientX: 300, clientY: 250 }))
    stage.dispatchEvent(new FakePointerEvent('pointerup', { pointerId: 4, button: 0, bubbles: true, clientX: 300, clientY: 250 }))
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.querySelector(`.${OVERLAY_CLASS}`)).not.toBeNull()
    // A plain backdrop click (no drag) still closes.
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.querySelector(`.${OVERLAY_CLASS}`)).toBeNull()
    document.body.innerHTML = ''
  })

  it('pointercancel also ends a middle-drag pan', () => {
    const block = mermaidBlock('graph TD; A-->B')
    block.innerHTML += `<div class="${HOST_CLASS}"><svg><g/></svg></div>`
    openOverlay(block)
    const stage = document.querySelector<HTMLElement>(`.${STAGE_CLASS}`)!
    stage.dispatchEvent(new FakePointerEvent('pointerdown', { pointerId: 3, button: 1, bubbles: true, cancelable: true, clientX: 200, clientY: 150 }))
    expect(stage.classList.contains(STAGE_DRAGGING_CLASS)).toBe(true)
    stage.dispatchEvent(new FakePointerEvent('pointercancel', { pointerId: 3, button: -1, bubbles: true }))
    expect(stage.classList.contains(STAGE_DRAGGING_CLASS)).toBe(false)
    document.body.innerHTML = ''
  })

  it('closes a previously open overlay when a new one opens', () => {
    const block = mermaidBlock('graph TD; A-->B')
    block.innerHTML += `<div class="${HOST_CLASS}"><svg><g/></svg></div>`
    openOverlay(block)
    expect(document.querySelectorAll(`.${OVERLAY_CLASS}`)).toHaveLength(1)
    openOverlay(block)
    expect(document.querySelectorAll(`.${OVERLAY_CLASS}`)).toHaveLength(1)
    document.body.innerHTML = ''
  })

  it('closes on Escape and on backdrop click, not on diagram click', () => {
    const block = mermaidBlock('graph TD; A-->B')
    block.innerHTML += `<div class="${HOST_CLASS}"><svg><g/></svg></div>`
    openOverlay(block)
    const overlay = document.querySelector<HTMLElement>(`.${OVERLAY_CLASS}`)!
    const stage = overlay.querySelector(`.${STAGE_CLASS}`)!

    // Clicking the diagram keeps the overlay open.
    stage.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.querySelector(`.${OVERLAY_CLASS}`)).not.toBeNull()

    // Escape closes it.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.querySelector(`.${OVERLAY_CLASS}`)).toBeNull()

    // Backdrop click closes it.
    openOverlay(block)
    const overlay2 = document.querySelector<HTMLElement>(`.${OVERLAY_CLASS}`)!
    overlay2.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.querySelector(`.${OVERLAY_CLASS}`)).toBeNull()
  })
})

describe('styles', () => {
  it('mountStyles shares one stylesheet across lifetimes and removes it on the last dispose', () => {
    const dispose1 = mountStyles()
    const dispose2 = mountStyles()
    const style = document.getElementById(STYLE_ID)
    expect(style).not.toBeNull()
    expect(style!.textContent).toContain('.dsh-mermaid-zoom')
    expect(style!.textContent).toContain('.dsh-mermaid-overlay')
    expect(style!.textContent).toContain('.dsh-mermaid-loading')
    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1)
    dispose1()
    // The second lifetime still holds a reference: the element stays.
    expect(document.getElementById(STYLE_ID)).not.toBeNull()
    dispose2()
    expect(document.getElementById(STYLE_ID)).toBeNull()
    // Idempotent: disposing twice is a no-op.
    dispose2()
    expect(document.getElementById(STYLE_ID)).toBeNull()
  })
})
