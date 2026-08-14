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

import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CONFIG_ROUTE, DIST_PREFIX, MERMAID_DIST_FILE, MERMAID_BUNDLE, validateConfig, type MermaidConfig } from './protocol.ts'

const require = createRequire(import.meta.url)

/** Stable Cordis plugin name. */
export const name = 'mermaid'

/** Service required before the routes can be registered. */
export const inject = ['webServer']

/** MIME types for the files the prefix route serves (the UMD build + its map). */
const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/**
 * Serve a file from the mermaid dist root with a traversal guard (the SPA
 * fallback would otherwise answer every miss with index.html).
 * @param distRoot - absolute directory containing mermaid.min.js.
 * @param pathname - decoded request pathname.
 * @param res - the node:http response.
 */
export async function serveDistFile(distRoot: string, pathname: string, res: ServerResponse): Promise<void> {
  const target = resolve(normalize(join(distRoot, pathname)))
  // Traversal rejection: the target must stay under distRoot (sep, not '/':
  // resolve() emits backslash paths on Windows).
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  if (pathname !== `/${MERMAID_BUNDLE}` && pathname !== `/${MERMAID_BUNDLE}.map`) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    const body = await readFile(target)
    res.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
}

/** Resolve the mermaid dist directory from this plugin's own dependency tree. */
function resolveMermaidDist(): string {
  return dirname(require.resolve(MERMAID_DIST_FILE))
}

/**
 * Resolve the effective config and register the two routes.
 * @param ctx - plugin context carrying the webServer service.
 * @param rawConfig - patch-row config (validated at apply).
 */
interface MermaidHostContext {
  webServer: {
    register(route: { kind: 'exact' | 'prefix'; path: string; handler(req: IncomingMessage, res: ServerResponse): void | Promise<void> }): () => void
  }
  effect(callback: () => (() => void), label?: string): void
}

export function apply(ctx: MermaidHostContext, rawConfig: Record<string, unknown> | undefined): void {
  const config: MermaidConfig = validateConfig(rawConfig)
  const distRoot = resolveMermaidDist()
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: DIST_PREFIX,
    handler: (req, res) => {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
      // The prefix route matches DIST_PREFIX and DIST_PREFIX/<anything>; serve
      // the bare file name (strip the prefix, keep the leading slash).
      const rel = pathname.startsWith(DIST_PREFIX) ? pathname.slice(DIST_PREFIX.length) : pathname
      return serveDistFile(distRoot, rel, res)
    },
  }), 'dsh-mermaid: dist route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CONFIG_ROUTE,
    handler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
      res.end(JSON.stringify(config))
    },
  }), 'dsh-mermaid: config route')
}
