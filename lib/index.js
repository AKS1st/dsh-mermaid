import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
//#region lib/types/protocol.js
/**
* Shared contract between the host half (validates + serves) and the client
* half (fetches + applies). The client boot manifest carries no config, so
* the host exposes the effective client config at a fixed HTTP endpoint and
* the client fetches it once at apply time.
*/
/** Host route prefix serving the mermaid UMD build. */
const DIST_PREFIX = "/mermaid-dist";
/** Fixed endpoint returning the effective client config as JSON. */
const CONFIG_ROUTE = `${DIST_PREFIX}/config.json`;
/** Full package path of the UMD build, for `require.resolve` inside the installed mermaid dependency. */
const MERMAID_DIST_FILE = "mermaid/dist/mermaid.min.js";
const DEFAULT_CONFIG = {
	theme: "auto",
	maxTextSize: 5e4,
	maxEdges: 2e3,
	securityLevel: "strict"
};
const THEMES = /* @__PURE__ */ new Set([
	"auto",
	"default",
	"dark",
	"neutral",
	"forest",
	"base"
]);
/**
* Validate one raw config object at load, so a typo fails loud instead of
* silently rendering wrong diagrams (or none).
* @param raw - the patch-row config object (may be partial/undefined).
* @returns the merged, validated config.
* @throws when a provided key has an invalid value.
*/
function validateConfig(raw) {
	const input = raw ?? {};
	let theme;
	if (input["theme"] === void 0) theme = DEFAULT_CONFIG.theme;
	else if (typeof input["theme"] === "string" && THEMES.has(input["theme"])) theme = input["theme"];
	else throw new Error(`dsh-mermaid: invalid theme "${String(input["theme"])}" (expected one of ${[...THEMES].join(", ")})`);
	const maxTextSize = input["maxTextSize"] === void 0 ? DEFAULT_CONFIG.maxTextSize : Number(input["maxTextSize"]);
	if (!Number.isFinite(maxTextSize) || maxTextSize <= 0) throw new Error(`dsh-mermaid: invalid maxTextSize "${String(input["maxTextSize"])}" (expected a positive number)`);
	const maxEdges = input["maxEdges"] === void 0 ? DEFAULT_CONFIG.maxEdges : Number(input["maxEdges"]);
	if (!Number.isFinite(maxEdges) || maxEdges <= 0) throw new Error(`dsh-mermaid: invalid maxEdges "${String(input["maxEdges"])}" (expected a positive number)`);
	if (input["securityLevel"] !== void 0 && input["securityLevel"] !== "strict") throw new Error(`dsh-mermaid: securityLevel "${String(input["securityLevel"])}" is not allowed (only "strict")`);
	return {
		theme,
		maxTextSize,
		maxEdges,
		securityLevel: "strict"
	};
}
//#endregion
//#region lib/types/index.js
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
const require = createRequire(import.meta.url);
/** MIME types for the files the prefix route serves (the UMD build + its map). */
const MIME = {
	".js": "text/javascript; charset=utf-8",
	".map": "application/json; charset=utf-8"
};
/**
* Serve a file from the mermaid dist root with a traversal guard (the SPA
* fallback would otherwise answer every miss with index.html).
* @param distRoot - absolute directory containing mermaid.min.js.
* @param pathname - decoded request pathname.
* @param res - the node:http response.
*/
async function serveDistFile(distRoot, pathname, res) {
	const target = resolve(normalize(join(distRoot, pathname)));
	if (target !== distRoot && !target.startsWith(distRoot + sep)) {
		res.writeHead(403);
		res.end();
		return;
	}
	if (pathname !== `/mermaid.min.js` && pathname !== `/mermaid.min.js.map`) {
		res.writeHead(404);
		res.end();
		return;
	}
	try {
		const body = await readFile(target);
		res.writeHead(200, {
			"content-type": MIME[extname(target)] ?? "application/octet-stream",
			"cache-control": "no-cache"
		});
		res.end(body);
	} catch {
		res.writeHead(404);
		res.end();
	}
}
/** Resolve the mermaid dist directory from this plugin's own dependency tree. */
function resolveMermaidDist() {
	return dirname(require.resolve(MERMAID_DIST_FILE));
}
function apply(ctx, rawConfig) {
	const config = validateConfig(rawConfig);
	const distRoot = resolveMermaidDist();
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: DIST_PREFIX,
		handler: (req, res) => {
			const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
			const rel = pathname.startsWith("/mermaid-dist") ? pathname.slice(13) : pathname;
			return serveDistFile(distRoot, rel, res);
		}
	}), "dsh-mermaid: dist route");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: CONFIG_ROUTE,
		handler: (_req, res) => {
			res.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-cache"
			});
			res.end(JSON.stringify(config));
		}
	}), "dsh-mermaid: config route");
}
//#endregion
export { apply, serveDistFile };
