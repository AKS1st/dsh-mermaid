/**
 * DOM processing for dsh-mermaid: pure-ish helpers that decide whether a code
 * block is a mermaid fence, extract its source, and render it in place. All
 * side-effecting capabilities (loading mermaid, resolving config) arrive as
 * injected dependencies so the logic is unit-testable in jsdom without a real
 * mermaid bundle.
 */

import type { MermaidConfig } from '../protocol.ts'

/** Mermaid's global instance shape (UMD build default export). */
export interface MermaidApi {
  initialize(config: Record<string, unknown>): void
  render(id: string, source: string): Promise<{ svg: string }>
}

/** Everything the renderer needs from the outside world. */
export interface MermaidRenderEnv {
  /** Load (once) the mermaid API; resolves after the bundle script runs. */
  loadMermaid(): Promise<MermaidApi>
  /** The effective client config. */
  config: MermaidConfig
}

/** Stable literal class CodeBlock applies to every fence wrapper. */
export const CODE_BLOCK_SELECTOR = '.md-code-block'
/** The banner element's readable class segment (css-module keeps it). */
export const INFOSTRING_SEGMENT = 'infostring'
/** Attribute marking a block this plugin already processed. */
export const RENDERED_ATTR = 'data-dsh-mermaid'
/** Attribute marking a block whose render failed (no retry loop). */
export const ERROR_ATTR = 'data-dsh-mermaid-error'
/** Class of the host div holding the rendered SVG. */
export const HOST_CLASS = 'dsh-mermaid'

/** Whether `block` is a mermaid fence (infostring text is exactly `mermaid`). */
export function isMermaidBlock(block: HTMLElement): boolean {
  const info = block.querySelector<HTMLElement>(`[class*="${INFOSTRING_SEGMENT}"]`)
  return info?.textContent?.trim() === 'mermaid'
}

/** The fence source: the `<pre>` text minus the trailing newline CodeBlock trims on display. */
export function fenceSource(block: HTMLElement): string {
  return block.querySelector('pre')?.textContent?.replace(/\n$/, '') ?? ''
}

/** Resolve the mermaid theme from config + the GUI's dark-mode attribute. */
export function resolveTheme(config: MermaidConfig, dark: boolean): string {
  if (config.theme !== 'auto') return config.theme
  return dark ? 'dark' : 'default'
}

/** Apply the effective theme to the mermaid singleton before rendering. */
export function applyTheme(mermaid: MermaidApi, config: MermaidConfig, dark: boolean): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: config.securityLevel,
    theme: resolveTheme(config, dark),
    maxTextSize: config.maxTextSize,
    maxEdges: config.maxEdges,
    fontFamily: 'inherit',
  })
}

let renderCounter = 0

/** Rendered block → its source, kept so a theme flip can re-render without a `<pre>`. */
const renderedSources = new WeakMap<HTMLElement, string>()

/** Cap one mermaid.render call; a hostile or pathological diagram must never hang the observer. */
const RENDER_TIMEOUT_MS = 15000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`dsh-mermaid: render timed out after ${ms}ms`)), ms)
    promise.then(
      value => { window.clearTimeout(timer); resolve(value) },
      error => { window.clearTimeout(timer); reject(error) },
    )
  })
}

/**
 * Render one mermaid block in place: replace the `<pre>` (or a previous SVG
 * host, on re-render) with the SVG produced by mermaid.render. The banner
 * (infostring + copy) is untouched, so copy still copies the source. On
 * failure the block keeps its plain text and is marked so the observer does
 * not retry it forever.
 * @param block - the `.md-code-block` element.
 * @param source - the fence source to render.
 * @param env - the render environment (mermaid loader + config).
 * @returns a promise resolving when the block settled (rendered or failed).
 */
export async function renderBlock(block: HTMLElement, source: string, env: MermaidRenderEnv): Promise<void> {
  if (block.hasAttribute(ERROR_ATTR)) return
  try {
    const mermaid = await env.loadMermaid()
    applyTheme(mermaid, env.config, document.body.hasAttribute('data-ds-dark-theme'))
    const { svg } = await withTimeout(mermaid.render(`dsh-mermaid-${++renderCounter}`, source), RENDER_TIMEOUT_MS)
    const host = document.createElement('div')
    host.className = HOST_CLASS
    host.innerHTML = svg
    // Replace the existing SVG host on re-render, otherwise the `<pre>`.
    const oldHost = block.querySelector(`.${HOST_CLASS}`)
    const pre = block.querySelector('pre')
    if (oldHost !== null) oldHost.replaceWith(host)
    else if (pre !== null) pre.replaceWith(host)
    renderedSources.set(block, source)
    block.setAttribute(RENDERED_ATTR, '1')
  } catch (error) {
    block.setAttribute(ERROR_ATTR, '1')
    // Keep the plain code block as the fallback; the error is visible in the
    // console only (untrusted content must not render error HTML).
    console.error('dsh-mermaid: render failed', error)
  }
}

/**
 * Re-render every already-rendered block (theme flip, config change).
 * @param env - the render environment.
 */
export function reRenderAll(env: MermaidRenderEnv): void {
  for (const block of document.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR)) {
    const source = renderedSources.get(block)
    if (source !== undefined) void renderBlock(block, source, env)
  }
}

/**
 * Process every currently-settled mermaid fence in the document. Settled-only
 * by construction: while a message streams, CodeBlock renders fences with an
 * empty infostring (lang is suppressed mid-stream), so the infostring test
 * never matches until the settle pass — the same policy the product applies
 * to KaTeX.
 * @param env - the render environment.
 */
export function scan(env: MermaidRenderEnv): void {
  for (const block of document.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR)) {
    if (isMermaidBlock(block) && !block.hasAttribute(RENDERED_ATTR)) {
      const source = fenceSource(block)
      if (source !== '') void renderBlock(block, source, env)
    }
  }
}
