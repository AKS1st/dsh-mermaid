/**
 * DOM processing for dsh-mermaid: pure-ish helpers that decide whether a code
 * block is a mermaid fence, extract its source, and render it in place. All
 * side-effecting capabilities (loading mermaid, resolving config) arrive as
 * injected dependencies so the logic is unit-testable in jsdom without a real
 * mermaid bundle.
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
 * host, on re-render) with the SVG produced by mermaid.render. The banner
 * (infostring + copy) is untouched, so copy still copies the source. On
 * failure the block keeps its plain text and is marked so the observer does
 * not retry it forever.
 * @param block - the `.md-code-block` element.
 * @param source - the fence source to render.
 * @param env - the render environment (mermaid loader + config).
 * @returns a promise resolving when the block settled (rendered or failed).
 */
export declare function renderBlock(block: HTMLElement, source: string, env: MermaidRenderEnv): Promise<void>;
/**
 * Re-render every already-rendered block (theme flip, config change).
 * @param env - the render environment.
 */
export declare function reRenderAll(env: MermaidRenderEnv): void;
/**
 * Process every currently-settled mermaid fence in the document. Settled-only
 * by construction: while a message streams, CodeBlock renders fences with an
 * empty infostring (lang is suppressed mid-stream), so the infostring test
 * never matches until the settle pass — the same policy the product applies
 * to KaTeX.
 * @param env - the render environment.
 */
export declare function scan(env: MermaidRenderEnv): void;
