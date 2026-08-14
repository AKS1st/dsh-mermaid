// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CODE_BLOCK_SELECTOR, ERROR_ATTR, HOST_CLASS, INFOSTRING_SEGMENT, RENDERED_ATTR,
  fenceSource, isMermaidBlock, reRenderAll, renderBlock, scan,
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
