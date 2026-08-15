// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CODE_BLOCK_SELECTOR, ERROR_ATTR, HOST_CLASS, INFOSTRING_SEGMENT, OVERLAY_CLASS, RENDERED_ATTR, STAGE_CLASS, ZOOM_BUTTON_CLASS,
  ensureZoomButton, fenceSource, isMermaidBlock, openOverlay, reRenderAll, renderBlock, scan,
  type MermaidApi, type MermaidRenderEnv,
} from '../src/client/dom.ts'
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

beforeEach(() => {
  document.body.innerHTML = ''
  fakeMermaid.lastInit = undefined
  fakeMermaid.lastId = ''
  fakeMermaid.lastSource = ''
})

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

describe('scan', () => {
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
})

describe('reRenderAll', () => {
  it('re-renders every previously rendered block on a theme flip', async () => {
    const block = mermaidBlock('graph TD; A-->B')
    await renderBlock(block, 'graph TD; A-->B', env())
    document.body.setAttribute('data-ds-dark-theme', '')
    reRenderAll(env({ config: { ...DEFAULT_CONFIG, theme: 'dark' } }))
    await vi.waitFor(() => {
      expect(fakeMermaid.lastInit?.['theme']).toBe('dark')
    })
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

  it('wheel zooms the stage within bounds', () => {
    const block = mermaidBlock('graph TD; A-->B')
    block.innerHTML += `<div class="${HOST_CLASS}"><svg><g/></svg></div>`
    openOverlay(block)
    const stage = document.querySelector<HTMLElement>(`.${STAGE_CLASS}`)!
    const overlay = document.querySelector<HTMLElement>(`.${OVERLAY_CLASS}`)!
    const zoomIn = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
    overlay.dispatchEvent(zoomIn)
    expect(stage.style.transform).toBe('scale(1.15)')
    // A long streak of zoom-out hits the floor.
    for (let i = 0; i < 40; i++) {
      overlay.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
    }
    expect(stage.style.transform).toBe('scale(0.2)')
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
