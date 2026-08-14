/**
 * Shared contract between the host half (validates + serves) and the client
 * half (fetches + applies). The client boot manifest carries no config, so
 * the host exposes the effective client config at a fixed HTTP endpoint and
 * the client fetches it once at apply time.
 */
/** Host route prefix serving the mermaid UMD build. */
export declare const DIST_PREFIX = "/mermaid-dist";
/** Fixed endpoint returning the effective client config as JSON. */
export declare const CONFIG_ROUTE = "/mermaid-dist/config.json";
/** The mermaid browser bundle file served under {@link DIST_PREFIX}. */
export declare const MERMAID_BUNDLE = "mermaid.min.js";
/** Full package path of the UMD build, for `require.resolve` inside the installed mermaid dependency. */
export declare const MERMAID_DIST_FILE = "mermaid/dist/mermaid.min.js";
/** Diagram themes mermaid ships; 'auto' follows the GUI light/dark. */
export type MermaidTheme = 'auto' | 'default' | 'dark' | 'neutral' | 'forest' | 'base';
/** Security level is pinned to strict — untrusted assistant output. */
export type MermaidSecurityLevel = 'strict';
/** Validated plugin config shared by both halves. */
export interface MermaidConfig {
    /** Diagram theme; 'auto' tracks body[data-ds-dark-theme]. */
    theme: MermaidTheme;
    /** Mermaid's maxTextSize render guard (default 50000). */
    maxTextSize: number;
    /** Mermaid's maxEdges render guard (default 2000). */
    maxEdges: number;
    /** Always 'strict': DOMPurify-sanitized labels, inert click handlers. */
    securityLevel: MermaidSecurityLevel;
}
export declare const DEFAULT_CONFIG: MermaidConfig;
/**
 * Validate one raw config object at load, so a typo fails loud instead of
 * silently rendering wrong diagrams (or none).
 * @param raw - the patch-row config object (may be partial/undefined).
 * @returns the merged, validated config.
 * @throws when a provided key has an invalid value.
 */
export declare function validateConfig(raw: Record<string, unknown> | undefined): MermaidConfig;
