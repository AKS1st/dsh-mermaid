/**
 * Stylesheet for the dsh-mermaid client half: the zoom button, the full-screen
 * zoom overlay, and the lazy-render loading state. Injected once by the client
 * `apply()` (see {@link mountStyles}) and removed on unload.
 *
 * The product exposes semantic alias tokens on `body` (light/dark aware), so
 * every color here prefers those tokens and falls back to a neutral literal so
 * the plugin still renders acceptably when the GUI theme sheet is absent.
 */
/** `<style>` element id used to keep the injection idempotent. */
export const STYLE_ID = 'dsh-mermaid-styles';
/** Live mount count: the `<style>` element is removed only on the last dispose. */
let styleRefCount = 0;
/**
 * Inject the plugin stylesheet once and return a disposer that removes it.
 * Reference-counted: overlapping lifetimes (e.g. a re-run before the previous
 * unload) share one `<style>` element, and each disposer only drops its own
 * reference — the element is removed when the last one disposes.
 * @returns a cleanup function releasing this lifetime's reference.
 */
export function mountStyles() {
    if (styleRefCount === 0) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLES;
        document.head.append(style);
    }
    styleRefCount += 1;
    let disposed = false;
    return () => {
        if (disposed)
            return;
        disposed = true;
        styleRefCount -= 1;
        if (styleRefCount === 0)
            document.getElementById(STYLE_ID)?.remove();
    };
}
/**
 * Shared look for the banner action buttons: the product's own copy button is
 * a borderless, backgroundless, color-inheriting button, so the zoom button
 * must not bring back default browser button chrome (the old bordered look).
 * A compact ghost icon button with a soft hover keeps it discoverable while
 * staying visually consistent with the banner.
 */
const ZOOM_BUTTON_CSS = `
.dsh-mermaid-zoom {
  appearance: none;
  -webkit-appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, rgba(0, 0, 0, 0.55));
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.dsh-mermaid-zoom:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-mermaid-zoom:active {
  background: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, 0.1));
}
.dsh-mermaid-zoom:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4176e6);
  outline-offset: 1px;
}
`;
/**
 * Overlay + stage: previously inline `style.cssText`, now theme-aware classes
 * so the white stage no longer clashes with dark mode. The stage fills the
 * viewport (94vw × 94vh) with the diagram fitted inside and acts as a clipped
 * viewport: `margin: auto` centers the SVG, and the pan translate (see
 * dom.ts openOverlay) moves the diagram within it at any zoom.
 */
const OVERLAY_CSS = `
.dsh-mermaid-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.6);
  cursor: zoom-out;
}
.dsh-mermaid-stage {
  width: 94vw;
  height: 94vh;
  display: flex;
  /* Pan rides the SVG transform (translate), so the stage is a clipped
     viewport: no scrollbars, the diagram moves inside it and is cut at the
     edges when zoomed beyond it. */
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #000000);
  border-radius: 8px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
  cursor: grab;
}
.dsh-mermaid-stage:active {
  cursor: grabbing;
}
.dsh-mermaid-stage.dsh-mermaid-dragging {
  cursor: grabbing;
  user-select: none;
}
.dsh-mermaid-stage svg {
  /* The JS overlay pin sets an explicit px width/height inline (mermaid emits
     width="100%", which would otherwise stretch the diagram to the full stage
     before the fit transform applies); these rules center the box and keep
     the transform-origin at its center. */
  display: block;
  width: auto;
  height: auto;
  max-width: none;
  max-height: none;
  margin: auto;
  transform-origin: center center;
}
`;
/**
 * Loading placeholder: a quiet skeleton block with a spinner, styled to sit
 * where the diagram's `<pre>` was (inside the same code-block wrapper), so a
 * slow first render never leaves the layout looking broken.
 */
const LOADING_CSS = `
.dsh-mermaid-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 96px;
  padding: 24px 16px;
  color: var(--dsw-alias-label-secondary, rgba(0, 0, 0, 0.55));
  font-size: 13px;
  line-height: 1;
  background: var(--dsw-alias-markdown-code-block, rgba(0, 0, 0, 0.03));
  border-bottom-left-radius: var(--dsl-code-block-border-radius, 12px);
  border-bottom-right-radius: var(--dsl-code-block-border-radius, 12px);
}
.dsh-mermaid-loading-spinner {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-top-color: transparent;
  animation: dsh-mermaid-spin 0.8s linear infinite;
}
@keyframes dsh-mermaid-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-mermaid-loading-spinner { animation-duration: 2s; }
}
`;
/** Complete stylesheet injected by the client half. */
export const STYLES = `${ZOOM_BUTTON_CSS}\n${OVERLAY_CSS}\n${LOADING_CSS}`;
