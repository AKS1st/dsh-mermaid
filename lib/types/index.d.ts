/**
 * Host half of dsh-mermaid.
 *
 * The client bundle stays tiny (a MutationObserver + fetcher) and pulls the
 * ~700KB mermaid UMD build lazily, only when a ```mermaid fence actually
 * renders. This host half serves that build over a fixed prefix route plus a
 * small config endpoint, because the client boot manifest carries no config.
 *
 * The mermaid package is a regular dependency of this plugin, so once the
 * plugin is installed into a profile (`dsh plugin --profile web add .`) its
 * UMD build resolves from the profile's node_modules — no CDN, no extra
 * bundle in the client boot graph.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/**
 * Serve a file from the mermaid dist root with a traversal guard (the SPA
 * fallback would otherwise answer every miss with index.html).
 * @param distRoot - absolute directory containing mermaid.min.js.
 * @param pathname - decoded request pathname.
 * @param res - the node:http response.
 */
export declare function serveDistFile(distRoot: string, pathname: string, res: ServerResponse): Promise<void>;
/**
 * Resolve the effective config and register the two routes.
 * @param ctx - plugin context carrying the webServer service.
 * @param rawConfig - patch-row config (validated at apply).
 */
interface MermaidHostContext {
    webServer: {
        register(route: {
            kind: 'exact' | 'prefix';
            path: string;
            handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
        }): () => void;
    };
    effect(callback: () => (() => void), label?: string): void;
}
export declare function apply(ctx: MermaidHostContext, rawConfig: Record<string, unknown> | undefined): void;
export {};
