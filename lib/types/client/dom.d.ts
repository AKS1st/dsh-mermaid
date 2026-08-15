/**
 * DOM processing for dsh-mermaid: pure-ish helpers that decide whether a code
 * block is a mermaid fence, extract its source, and render it in place. All
 * side-effecting capabilities (loading mermaid, resolving config, the lazy
 * viewport observer) arrive as injected dependencies or are created lazily so
 * the logic is unit-testable in jsdom without a real mermaid bundle.
 *
 * Rendering is asynchronous and viewport-driven:
 *
 *   1. `scan()` registers every settled mermaid fence with one shared
 *      IntersectionObserver instead of rendering it immediately, so diagrams
 *      below the fold never pay the mermaid cost (lazy loading).
 *   2. When a block enters the viewport (with a small preload margin) its
 *      render is enqueued; the queue drains one diagram at a time, yielding
 *      to the event loop between renders so many diagrams never block the
 *      page.
 *   3. While a first render is in flight the block shows a loading
 *      placeholder. If the block scrolls away before its render finishes the
 *      work is discarded and the placeholder stays until it re-enters.
 */
import type { MermaidConfig } from '../protocol.ts';
/** Mermaid's global instance shape (UMD build default export). */
export interface MermaidApi {
    initialize(config: Record<string, unknown>): void;
    render(id: string, source: string): Promise<{
        svg: string;
    }>;
}
/** Everything the renderer needs from the outside world. */
export interface MermaidRenderEnv {
    /** Load (once) the mermaid API; resolves after the bundle script runs. */
    loadMermaid(): Promise<MermaidApi>;
    /** The effective client config. */
    config: MermaidConfig;
}
/** Stable literal class CodeBlock applies to every fence wrapper. */
export declare const CODE_BLOCK_SELECTOR = ".md-code-block";
/** The banner element's readable class segment (css-module keeps it). */
export declare const INFOSTRING_SEGMENT = "infostring";
/** Attribute marking a block this plugin already processed. */
export declare const RENDERED_ATTR = "data-dsh-mermaid";
/** Attribute marking a block whose render failed (no retry loop). */
export declare const ERROR_ATTR = "data-dsh-mermaid-error";
/** Class of the host div holding the rendered SVG. */
export declare const HOST_CLASS = "dsh-mermaid";
/** Class of the loading placeholder shown while a first render is in flight. */
export declare const LOADING_CLASS = "dsh-mermaid-loading";
/** Class of the zoom button injected left of the copy button. */
export declare const ZOOM_BUTTON_CLASS = "dsh-mermaid-zoom";
/** Class of the full-screen zoom overlay. */
export declare const OVERLAY_CLASS = "dsh-mermaid-overlay";
/** Class of the overlay's zoomable stage (the SVG lives inside it). */
export declare const STAGE_CLASS = "dsh-mermaid-stage";
/** Class toggled on the stage while a middle-button pan drag is active. */
export declare const STAGE_DRAGGING_CLASS = "dsh-mermaid-dragging";
/** Whether `block` is a mermaid fence (infostring text is exactly `mermaid`). */
export declare function isMermaidBlock(block: HTMLElement): boolean;
/** The fence source: the `<pre>` text minus the trailing newline CodeBlock trims on display. */
export declare function fenceSource(block: HTMLElement): string;
/** Resolve the mermaid theme from config + the GUI's dark-mode attribute. */
export declare function resolveTheme(config: MermaidConfig, dark: boolean): string;
/** Apply the effective theme to the mermaid singleton before rendering. */
export declare function applyTheme(mermaid: MermaidApi, config: MermaidConfig, dark: boolean): void;
/**
 * Render one mermaid block in place: replace the `<pre>` (or a previous SVG
 * host / loading placeholder) with the SVG produced by mermaid.render. The
 * banner (infostring + copy) is untouched, so copy still copies the source.
 *
 * With `loading` (first render) the `<pre>` is replaced by a loading
 * placeholder up front; if the block leaves the viewport before the SVG is
 * ready the result is discarded and the placeholder stays until re-entry.
 * On a failed first render the block gets its plain text back and is marked
 * so the observer does not retry it forever. A failed refresh keeps the
 * previous SVG and stays marked for a later retry.
 * @param block - the `.md-code-block` element.
 * @param source - the fence source to render.
 * @param env - the render environment (mermaid loader + config).
 * @param options - `loading` selects the first-render placeholder path.
 * @returns whether the block settled with a rendered SVG (false = failure or viewport-discarded).
 */
export declare function renderBlock(block: HTMLElement, source: string, env: MermaidRenderEnv, options?: {
    loading?: boolean;
}): Promise<boolean>;
/**
 * Re-render already-rendered blocks after a theme flip. Rendered blocks are
 * marked stale and refreshed lazily: those currently in (or near) the viewport
 * render now, the rest when they next enter it.
 * @param env - the render environment.
 */
export declare function reRenderAll(env: MermaidRenderEnv): void;
/**
 * Inject the zoom button left of the copy button in the block's banner, once.
 * The button opens the rendered SVG in a full-screen overlay (see
 * {@link openOverlay}). Idempotent: re-renders (theme flip) keep one button.
 * Styling lives in `styles.ts` (`.dsh-mermaid-zoom`), so the button carries no
 * inline styles and matches the banner's other actions.
 * @param block - the `.md-code-block` element.
 */
export declare function ensureZoomButton(block: HTMLElement): void;
/**
 * Open the full-screen zoom overlay for a rendered mermaid block. The overlay
 * clones the block's SVG into a stage and fits it to the viewport on open —
 * a small diagram is scaled up to near full-screen (with a small margin) so
 * it reads as a popup instead of a tiny image in the middle of the screen.
 * The mouse wheel zooms relative to that fitted size (bounded); holding the
 * middle button and dragging pans the (zoomed) diagram; the overlay closes on
 * background click or Escape. Only one overlay is open at a time (opening a
 * new one closes the previous). Every listener is removed when the overlay
 * closes, and the open overlay is tracked so plugin unload can tear it down.
 * Layout + theme come from `styles.ts` classes; only the scale transform is
 * inline (on the cloned SVG, so zooming beyond the stage stays pannable
 * through `overflow: auto`).
 * @param block - the `.md-code-block` element.
 */
export declare function openOverlay(block: HTMLElement): void;
/**
 * Process every currently-settled mermaid fence in the document: register it
 * with the lazy viewport observer (or enqueue it directly when the observer is
 * unavailable) rather than rendering immediately. Settled-only by
 * construction: while a message streams, CodeBlock renders fences with an
 * empty infostring (lang is suppressed mid-stream), so the infostring test
 * never matches until the settle pass — the same policy the product applies
 * to KaTeX.
 * @param env - the render environment.
 */
export declare function scan(env: MermaidRenderEnv): void;
/**
 * Tear down everything this module owns: any open overlay, the shared lazy
 * observer, and the render queue. Called on plugin unload (see the client
 * `apply()` disposer) so a stopped/updated plugin stops observing the whole
 * document and leaks no window listeners or held blocks.
 */
export declare function dispose(): void;
/**
 * Test-support reset: same teardown as {@link dispose} so unit tests start
 * clean (module singletons are otherwise shared across tests in one file).
 */
export declare function __resetForTests(): void;
