/**
 * Shared contract between the host half (validates + serves) and the client
 * half (fetches + applies). The client boot manifest carries no config, so
 * the host exposes the effective client config at a fixed HTTP endpoint and
 * the client fetches it once at apply time.
 */
/** Host route prefix serving the mermaid UMD build. */
export const DIST_PREFIX = '/mermaid-dist';
/** Fixed endpoint returning the effective client config as JSON. */
export const CONFIG_ROUTE = `${DIST_PREFIX}/config.json`;
/** The mermaid browser bundle file served under {@link DIST_PREFIX}. */
export const MERMAID_BUNDLE = 'mermaid.min.js';
/** Full package path of the UMD build, for `require.resolve` inside the installed mermaid dependency. */
export const MERMAID_DIST_FILE = 'mermaid/dist/mermaid.min.js';
export const DEFAULT_CONFIG = {
    theme: 'auto',
    maxTextSize: 50000,
    maxEdges: 2000,
    securityLevel: 'strict',
};
const THEMES = new Set(['auto', 'default', 'dark', 'neutral', 'forest', 'base']);
/**
 * Validate one raw config object at load, so a typo fails loud instead of
 * silently rendering wrong diagrams (or none).
 * @param raw - the patch-row config object (may be partial/undefined).
 * @returns the merged, validated config.
 * @throws when a provided key has an invalid value.
 */
export function validateConfig(raw) {
    const input = raw ?? {};
    let theme;
    if (input['theme'] === undefined) {
        theme = DEFAULT_CONFIG.theme;
    }
    else if (typeof input['theme'] === 'string' && THEMES.has(input['theme'])) {
        theme = input['theme'];
    }
    else {
        throw new Error(`dsh-mermaid: invalid theme "${String(input['theme'])}" (expected one of ${[...THEMES].join(', ')})`);
    }
    const maxTextSize = input['maxTextSize'] === undefined ? DEFAULT_CONFIG.maxTextSize : Number(input['maxTextSize']);
    if (!Number.isFinite(maxTextSize) || maxTextSize <= 0) {
        throw new Error(`dsh-mermaid: invalid maxTextSize "${String(input['maxTextSize'])}" (expected a positive number)`);
    }
    const maxEdges = input['maxEdges'] === undefined ? DEFAULT_CONFIG.maxEdges : Number(input['maxEdges']);
    if (!Number.isFinite(maxEdges) || maxEdges <= 0) {
        throw new Error(`dsh-mermaid: invalid maxEdges "${String(input['maxEdges'])}" (expected a positive number)`);
    }
    if (input['securityLevel'] !== undefined && input['securityLevel'] !== 'strict') {
        throw new Error(`dsh-mermaid: securityLevel "${String(input['securityLevel'])}" is not allowed (only "strict")`);
    }
    return { theme, maxTextSize, maxEdges, securityLevel: 'strict' };
}
