/**
 * Client half of dsh-mermaid.
 *
 * The harness renders ```mermaid fences as plain code blocks (its mdast
 * renderer has no mermaid branch and its shiki allowlist has no mermaid
 * grammar), so this plugin post-processes the settled message DOM:
 *
 *   1. A MutationObserver watches the conversation for `.md-code-block`
 *      elements whose infostring is `mermaid`.
 *   2. The mermaid UMD build is loaded lazily (once) from the host route.
 *      Rendering itself is viewport-driven: a fence only renders when it
 *      scrolls into view (with a small preload margin), diagrams render one
 *      at a time so many fences never block the page, and while a first
 *      render is in flight a loading placeholder replaces the fence body.
 *      `mermaid.render()` produces an SVG that replaces the fence's `<pre>`
 *      body. The banner (language + copy button) stays.
 *   3. securityLevel is always strict: labels are DOMPurify-sanitized by
 *      mermaid itself and click handlers are never bound, matching the
 *      harness's untrusted-output policy for assistant text.
 *   4. Theme follows the GUI: 'auto' reads body[data-ds-dark-theme] and
 *      re-renders diagrams when the attribute flips.
 *
 * Rendering logic lives in `dom.ts` (injected deps, unit-testable); this
 * module only wires the real environment and the observers.
 */

import { CONFIG_ROUTE, DIST_PREFIX, MERMAID_BUNDLE, DEFAULT_CONFIG, validateConfig, type MermaidConfig } from '../protocol.ts'
import { scan, reRenderAll, applyTheme, dispose, removeStrayErrorElements, type MermaidApi, type MermaidRenderEnv } from './dom.ts'
import { mountStyles } from './styles.ts'

/** The `window.mermaid` global the UMD build installs. */
declare global {
  interface Window {
    mermaid?: MermaidApi
  }
}

interface ClientContext {
  effect(callback: () => (() => void), label?: string): void
}

let mermaidPromise: Promise<MermaidApi> | undefined
let configPromise: Promise<MermaidConfig> | undefined

/**
 * Load the mermaid UMD build once, from the host-served route. The bundle is
 * a self-contained classic script (no ESM chunks), so a <script> injection is
 * the most robust load path inside the CJS-wrapped client bundle.
 * @returns the mermaid API (window.mermaid after script load).
 */
function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= new Promise<MermaidApi>((resolveLoad, rejectLoad) => {
    const existing = window.mermaid
    if (existing !== undefined) {
      resolveLoad(existing)
      return
    }
    const script = document.createElement('script')
    script.src = `${DIST_PREFIX}/${MERMAID_BUNDLE}`
    script.async = true
    script.onload = () => {
      const api = window.mermaid
      if (api === undefined) rejectLoad(new Error('dsh-mermaid: mermaid loaded but window.mermaid is missing'))
      else resolveLoad(api)
    }
    script.onerror = () => rejectLoad(new Error('dsh-mermaid: failed to load mermaid bundle'))
    document.head.append(script)
  })
  return mermaidPromise
}

/**
 * Fetch the effective client config from the host endpoint once; falls back
 * to defaults when the host route is absent (e.g. plugin loaded without its
 * host half).
 * @returns the validated config.
 */
function loadConfig(): Promise<MermaidConfig> {
  if (configPromise === undefined) {
    configPromise = fetch(CONFIG_ROUTE, { cache: 'no-store' })
      .then(response => response.ok ? response.json() as Promise<Record<string, unknown>> : Promise.reject(new Error(`dsh-mermaid: config route ${response.status}`)))
      .then(raw => validateConfig(raw))
      .catch(() => DEFAULT_CONFIG)
  }
  return configPromise
}

/**
 * Plugin entry: observe the conversation DOM and render mermaid fences.
 * @param ctx - client plugin context (effect lifecycle).
 */
export function apply(ctx: ClientContext): void {
  // Zoom button / overlay / loading-state styles, removed on unload.
  ctx.effect(() => mountStyles(), 'dsh-mermaid: styles')

  void loadConfig().then((config) => {
    const env: MermaidRenderEnv = { loadMermaid, config }

    // Initial pass covers already-settled messages (session replay, history).
    scan(env)
    // Clear any mermaid error-render artifacts older versions left stuck in
    // the page body (the bottom-left "Syntax error in text" popup).
    removeStrayErrorElements()

    // Settled messages mount new DOM (or swap streaming → settled nodes), so
    // watch the whole document for added nodes and re-scan.
    const observer = new MutationObserver(() => scan(env))
    observer.observe(document.body, { childList: true, subtree: true })

    // Theme: re-render existing diagrams when light/dark flips.
    const themeObserver = new MutationObserver(() => {
      void loadMermaid().then((mermaid) => {
        applyTheme(mermaid, config, document.body.hasAttribute('data-ds-dark-theme'))
        reRenderAll(env)
      })
    })
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })

    ctx.effect(() => () => {
      observer.disconnect()
      themeObserver.disconnect()
      // Full module teardown: any open overlay, the lazy viewport observer,
      // and the pending render queue.
      dispose()
    }, 'dsh-mermaid: fence observer + theme observer + dispose')
  })
}
