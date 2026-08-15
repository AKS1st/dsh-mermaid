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
import { type MermaidApi } from './dom.ts';
/** The `window.mermaid` global the UMD build installs. */
declare global {
    interface Window {
        mermaid?: MermaidApi;
    }
}
interface ClientContext {
    effect(callback: () => (() => void), label?: string): void;
}
/**
 * Plugin entry: observe the conversation DOM and render mermaid fences.
 * @param ctx - client plugin context (effect lifecycle).
 */
export declare function apply(ctx: ClientContext): void;
export {};
