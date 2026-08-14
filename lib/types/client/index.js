/**
 * Client half of dsh-mermaid.
 *
 * The harness renders ```mermaid fences as plain code blocks (its mdast
 * renderer has no mermaid branch and its shiki allowlist has no mermaid
 * grammar), so this plugin post-processes the settled message DOM:
 *
 *   1. A MutationObserver watches the conversation for `.md-code-block`
 *      elements whose infostring is `mermaid`.
 *   2. The mermaid UMD build is loaded lazily (once) from the host route,
 *      then `mermaid.render()` produces an SVG that replaces the fence's
 *      `<pre>` body. The banner (language + copy button) stays.
 *   3. securityLevel is always strict: labels are DOMPurify-sanitized by
 *      mermaid itself and click handlers are never bound, matching the
 *      harness's untrusted-output policy for assistant text.
 *   4. Theme follows the GUI: 'auto' reads body[data-ds-dark-theme] and
 *      re-renders diagrams when the attribute flips.
 *
 * Rendering logic lives in `dom.ts` (injected deps, unit-testable); this
 * module only wires the real environment and the observers.
 */
import { CONFIG_ROUTE, DIST_PREFIX, MERMAID_BUNDLE, DEFAULT_CONFIG, validateConfig } from "../protocol.js";
import { scan, reRenderAll, applyTheme } from "./dom.js";
let mermaidPromise;
let configPromise;
/**
 * Load the mermaid UMD build once, from the host-served route. The bundle is
 * a self-contained classic script (no ESM chunks), so a <script> injection is
 * the most robust load path inside the CJS-wrapped client bundle.
 * @returns the mermaid API (window.mermaid after script load).
 */
function loadMermaid() {
    mermaidPromise ??= new Promise((resolveLoad, rejectLoad) => {
        const existing = window.mermaid;
        if (existing !== undefined) {
            resolveLoad(existing);
            return;
        }
        const script = document.createElement('script');
        script.src = `${DIST_PREFIX}/${MERMAID_BUNDLE}`;
        script.async = true;
        script.onload = () => {
            const api = window.mermaid;
            if (api === undefined)
                rejectLoad(new Error('dsh-mermaid: mermaid loaded but window.mermaid is missing'));
            else
                resolveLoad(api);
        };
        script.onerror = () => rejectLoad(new Error('dsh-mermaid: failed to load mermaid bundle'));
        document.head.append(script);
    });
    return mermaidPromise;
}
/**
 * Fetch the effective client config from the host endpoint once; falls back
 * to defaults when the host route is absent (e.g. plugin loaded without its
 * host half).
 * @returns the validated config.
 */
function loadConfig() {
    if (configPromise === undefined) {
        configPromise = fetch(CONFIG_ROUTE, { cache: 'no-store' })
            .then(response => response.ok ? response.json() : Promise.reject(new Error(`dsh-mermaid: config route ${response.status}`)))
            .then(raw => validateConfig(raw))
            .catch(() => DEFAULT_CONFIG);
    }
    return configPromise;
}
/**
 * Plugin entry: observe the conversation DOM and render mermaid fences.
 * @param ctx - client plugin context (effect lifecycle).
 */
export function apply(ctx) {
    void loadConfig().then((config) => {
        const env = { loadMermaid, config };
        // Initial pass covers already-settled messages (session replay, history).
        scan(env);
        // Settled messages mount new DOM (or swap streaming → settled nodes), so
        // watch the whole document for added nodes and re-scan.
        const observer = new MutationObserver(() => scan(env));
        observer.observe(document.body, { childList: true, subtree: true });
        // Theme: re-render existing diagrams when light/dark flips.
        const themeObserver = new MutationObserver(() => {
            void loadMermaid().then((mermaid) => {
                applyTheme(mermaid, config, document.body.hasAttribute('data-ds-dark-theme'));
                reRenderAll(env);
            });
        });
        themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
        ctx.effect(() => () => {
            observer.disconnect();
            themeObserver.disconnect();
        }, 'dsh-mermaid: fence observer + theme observer');
    });
}
