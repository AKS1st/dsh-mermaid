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
/** Class of the zoom button injected left of the copy button. */
export const ZOOM_BUTTON_CLASS = 'dsh-mermaid-zoom'
/** Class of the full-screen zoom overlay. */
export const OVERLAY_CLASS = 'dsh-mermaid-overlay'
/** Class of the overlay's zoomable stage (the SVG lives inside it). */
export const STAGE_CLASS = 'dsh-mermaid-stage'

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
    ensureZoomButton(block)
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

/** The banner's action cell (copy button seat); matched by its readable class segment. */
const ACTION_SEGMENT = 'action'

/**
 * Inject the zoom button left of the copy button in the block's banner, once.
 * The button opens the rendered SVG in a full-screen overlay (see
 * {@link openOverlay}). Idempotent: re-renders (theme flip) keep one button.
 * @param block - the `.md-code-block` element.
 */
export function ensureZoomButton(block: HTMLElement): void {
  if (block.querySelector(`.${ZOOM_BUTTON_CLASS}`) !== null) return
  const action = block.querySelector<HTMLElement>(`[class*="${ACTION_SEGMENT}"]`)
  if (action === null) return
  const button = document.createElement('button')
  button.type = 'button'
  button.className = ZOOM_BUTTON_CLASS
  button.title = '放大'
  button.setAttribute('aria-label', '放大 mermaid 图')
  button.textContent = '⛶'
  button.addEventListener('click', () => openOverlay(block))
  // Prepend: the copy button stays last in the action cell.
  action.prepend(button)
}

/** Wheel-zoom scale bounds. */
const MIN_SCALE = 0.2
const MAX_SCALE = 8
/** Wheel-zoom step per notch. */
const ZOOM_STEP = 1.15

/**
 * Open the full-screen zoom overlay for a rendered mermaid block. The overlay
 * clones the block's SVG into a centered stage, zooms with the mouse wheel
 * (bounded), and closes on background click or Escape. Every listener is
 * removed when the overlay closes.
 * @param block - the `.md-code-block` element.
 */
export function openOverlay(block: HTMLElement): void {
  const svg = block.querySelector(`.${HOST_CLASS} svg`)
  if (svg === null) return
  const overlay = document.createElement('div')
  overlay.className = OVERLAY_CLASS
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:rgba(0,0,0,.6);cursor:zoom-out;'
  const stage = document.createElement('div')
  stage.className = STAGE_CLASS
  stage.style.cssText = 'max-width:94vw;max-height:94vh;overflow:auto;background:#fff;border-radius:8px;box-shadow:0 24px 64px rgba(0,0,0,.45);transform-origin:center center;cursor:grab;'
  stage.append(svg.cloneNode(true))
  overlay.append(stage)
  document.body.append(overlay)

  let scale = 1
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor))
    stage.style.transform = `scale(${scale})`
  }
  const close = (): void => {
    overlay.remove()
    window.removeEventListener('keydown', onKeydown)
    overlay.removeEventListener('wheel', onWheel)
  }
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close()
  }
  overlay.addEventListener('click', (event) => {
    // Only a click on the backdrop closes; clicking the diagram itself does not.
    if (event.target === overlay) close()
  })
  overlay.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', onKeydown)
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
