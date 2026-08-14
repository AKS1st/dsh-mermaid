window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-mermaid",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/protocol.ts
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
		/** The mermaid browser bundle file served under {@link DIST_PREFIX}. */
		const MERMAID_BUNDLE = "mermaid.min.js";
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
		//#region src/client/dom.ts
		/** Stable literal class CodeBlock applies to every fence wrapper. */
		const CODE_BLOCK_SELECTOR = ".md-code-block";
		/** The banner element's readable class segment (css-module keeps it). */
		const INFOSTRING_SEGMENT = "infostring";
		/** Attribute marking a block this plugin already processed. */
		const RENDERED_ATTR = "data-dsh-mermaid";
		/** Attribute marking a block whose render failed (no retry loop). */
		const ERROR_ATTR = "data-dsh-mermaid-error";
		/** Class of the host div holding the rendered SVG. */
		const HOST_CLASS = "dsh-mermaid";
		/** Whether `block` is a mermaid fence (infostring text is exactly `mermaid`). */
		function isMermaidBlock(block) {
			return block.querySelector(`[class*="${INFOSTRING_SEGMENT}"]`)?.textContent?.trim() === "mermaid";
		}
		/** The fence source: the `<pre>` text minus the trailing newline CodeBlock trims on display. */
		function fenceSource(block) {
			return block.querySelector("pre")?.textContent?.replace(/\n$/, "") ?? "";
		}
		/** Resolve the mermaid theme from config + the GUI's dark-mode attribute. */
		function resolveTheme(config, dark) {
			if (config.theme !== "auto") return config.theme;
			return dark ? "dark" : "default";
		}
		/** Apply the effective theme to the mermaid singleton before rendering. */
		function applyTheme(mermaid, config, dark) {
			mermaid.initialize({
				startOnLoad: false,
				securityLevel: config.securityLevel,
				theme: resolveTheme(config, dark),
				maxTextSize: config.maxTextSize,
				maxEdges: config.maxEdges,
				fontFamily: "inherit"
			});
		}
		let renderCounter = 0;
		/** Rendered block → its source, kept so a theme flip can re-render without a `<pre>`. */
		const renderedSources = /* @__PURE__ */ new WeakMap();
		/** Cap one mermaid.render call; a hostile or pathological diagram must never hang the observer. */
		const RENDER_TIMEOUT_MS = 15e3;
		function withTimeout(promise, ms) {
			return new Promise((resolve, reject) => {
				const timer = window.setTimeout(() => reject(/* @__PURE__ */ new Error(`dsh-mermaid: render timed out after ${ms}ms`)), ms);
				promise.then((value) => {
					window.clearTimeout(timer);
					resolve(value);
				}, (error) => {
					window.clearTimeout(timer);
					reject(error);
				});
			});
		}
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
		async function renderBlock(block, source, env) {
			if (block.hasAttribute("data-dsh-mermaid-error")) return;
			try {
				const mermaid = await env.loadMermaid();
				applyTheme(mermaid, env.config, document.body.hasAttribute("data-ds-dark-theme"));
				const { svg } = await withTimeout(mermaid.render(`dsh-mermaid-${++renderCounter}`, source), RENDER_TIMEOUT_MS);
				const host = document.createElement("div");
				host.className = HOST_CLASS;
				host.innerHTML = svg;
				const oldHost = block.querySelector(`.${HOST_CLASS}`);
				const pre = block.querySelector("pre");
				if (oldHost !== null) oldHost.replaceWith(host);
				else if (pre !== null) pre.replaceWith(host);
				renderedSources.set(block, source);
				block.setAttribute(RENDERED_ATTR, "1");
			} catch (error) {
				block.setAttribute(ERROR_ATTR, "1");
				console.error("dsh-mermaid: render failed", error);
			}
		}
		/**
		* Re-render every already-rendered block (theme flip, config change).
		* @param env - the render environment.
		*/
		function reRenderAll(env) {
			for (const block of document.querySelectorAll(CODE_BLOCK_SELECTOR)) {
				const source = renderedSources.get(block);
				if (source !== void 0) renderBlock(block, source, env);
			}
		}
		/**
		* Process every currently-settled mermaid fence in the document. Settled-only
		* by construction: while a message streams, CodeBlock renders fences with an
		* empty infostring (lang is suppressed mid-stream), so the infostring test
		* never matches until the settle pass — the same policy the product applies
		* to KaTeX.
		* @param env - the render environment.
		*/
		function scan(env) {
			for (const block of document.querySelectorAll(CODE_BLOCK_SELECTOR)) if (isMermaidBlock(block) && !block.hasAttribute("data-dsh-mermaid")) {
				const source = fenceSource(block);
				if (source !== "") renderBlock(block, source, env);
			}
		}
		//#endregion
		//#region src/client/index.ts
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
				if (existing !== void 0) {
					resolveLoad(existing);
					return;
				}
				const script = document.createElement("script");
				script.src = `${DIST_PREFIX}/${MERMAID_BUNDLE}`;
				script.async = true;
				script.onload = () => {
					const api = window.mermaid;
					if (api === void 0) rejectLoad(/* @__PURE__ */ new Error("dsh-mermaid: mermaid loaded but window.mermaid is missing"));
					else resolveLoad(api);
				};
				script.onerror = () => rejectLoad(/* @__PURE__ */ new Error("dsh-mermaid: failed to load mermaid bundle"));
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
			if (configPromise === void 0) configPromise = fetch(CONFIG_ROUTE, { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(/* @__PURE__ */ new Error(`dsh-mermaid: config route ${response.status}`))).then((raw) => validateConfig(raw)).catch(() => DEFAULT_CONFIG);
			return configPromise;
		}
		/**
		* Plugin entry: observe the conversation DOM and render mermaid fences.
		* @param ctx - client plugin context (effect lifecycle).
		*/
		function apply(ctx) {
			loadConfig().then((config) => {
				const env = {
					loadMermaid,
					config
				};
				scan(env);
				const observer = new MutationObserver(() => scan(env));
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
				const themeObserver = new MutationObserver(() => {
					loadMermaid().then((mermaid) => {
						applyTheme(mermaid, config, document.body.hasAttribute("data-ds-dark-theme"));
						reRenderAll(env);
					});
				});
				themeObserver.observe(document.body, {
					attributes: true,
					attributeFilter: ["data-ds-dark-theme"]
				});
				ctx.effect(() => () => {
					observer.disconnect();
					themeObserver.disconnect();
				}, "dsh-mermaid: fence observer + theme observer");
			});
		}
		//#endregion
		exports.apply = apply;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map