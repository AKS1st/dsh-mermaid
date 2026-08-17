window.__ModuleLoader__.load({
	id: "dsh-mermaid",
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
		/** Class of the loading placeholder shown while a first render is in flight. */
		const LOADING_CLASS = "dsh-mermaid-loading";
		/** Class of the zoom button injected left of the copy button. */
		const ZOOM_BUTTON_CLASS = "dsh-mermaid-zoom";
		/** Class of the error summary bar shown below a failed render. */
		const ERROR_BAR_CLASS = "dsh-mermaid-error";
		/** Class of the full-screen zoom overlay. */
		const OVERLAY_CLASS = "dsh-mermaid-overlay";
		/** Class of the overlay's zoomable stage (the SVG lives inside it). */
		const STAGE_CLASS = "dsh-mermaid-stage";
		/** Class toggled on the stage while a middle-button pan drag is active. */
		const STAGE_DRAGGING_CLASS = "dsh-mermaid-dragging";
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
				fontFamily: "inherit",
				suppressErrorRendering: true
			});
		}
		let renderCounter = 0;
		/** Rendered block → its source, kept so a theme flip can re-render without a `<pre>`. */
		const renderedSources = /* @__PURE__ */ new WeakMap();
		/** Block waiting on a first render → its fence source (the `<pre>` may already be a placeholder). */
		const pendingSources = /* @__PURE__ */ new WeakMap();
		/** Block whose placeholder replaced the `<pre>` → the original `<pre>` (restored on failure). */
		const pendingPre = /* @__PURE__ */ new WeakMap();
		/** Rendered blocks whose theme is stale after a flip; refreshed lazily on re-entry. */
		const needsRefresh = /* @__PURE__ */ new WeakSet();
		/** Blocks handed to the lazy observer (scan idempotence, also detach cleanup). */
		const trackedBlocks = /* @__PURE__ */ new WeakSet();
		/** Blocks currently intersecting the viewport (maintained by the observer). */
		const visibleBlocks = /* @__PURE__ */ new WeakSet();
		/** The render environment for queued work; set by `scan`/`reRenderAll`. */
		let activeEnv;
		/** Cap one mermaid.render call; a hostile or pathological diagram must never hang the queue. */
		const RENDER_TIMEOUT_MS = 15e3;
		/** How far outside the viewport a block still counts as "wanted" (preload margin). */
		const OBSERVER_MARGIN = "300px";
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
		/** Let the browser paint (loading placeholders) and stay responsive between renders. */
		function yieldToMainThread() {
			return new Promise((resolve) => window.setTimeout(resolve, 0));
		}
		/**
		* One shared IntersectionObserver for every tracked fence. Blocks enter the
		* render queue only when (near) the viewport; a block that scrolls away while
		* queued or mid-render is skipped/discarded and re-enqueued on re-entry.
		* Without `IntersectionObserver` (jsdom) the plugin degrades to immediate
		* rendering of every block — the tests and headless fixtures rely on this.
		*/
		let lazyObserver;
		function ensureObserver() {
			if (lazyObserver !== void 0) return lazyObserver;
			if (typeof IntersectionObserver === "undefined") return void 0;
			lazyObserver = new IntersectionObserver((entries) => {
				for (const entry of entries) {
					const block = entry.target;
					if (!entry.isIntersecting) {
						visibleBlocks.delete(block);
						if (!document.contains(block)) {
							lazyObserver?.unobserve(block);
							trackedBlocks.delete(block);
							pendingSources.delete(block);
							pendingPre.delete(block);
						}
						continue;
					}
					visibleBlocks.add(block);
					if (pendingSources.has(block)) enqueueRender(block, "initial");
					else if (needsRefresh.has(block)) enqueueRender(block, "refresh");
				}
			}, { rootMargin: OBSERVER_MARGIN });
			return lazyObserver;
		}
		/** Viewport gate: without an observer every block counts as visible. */
		function isVisible(block) {
			return lazyObserver === void 0 || visibleBlocks.has(block);
		}
		const renderQueue = [];
		let queueRunning = false;
		/**
		* Push a render onto the single-threaded queue and start draining. The queue
		* serializes mermaid.render (which is synchronous CPU work on the main thread)
		* and yields between items, so many diagrams load without freezing the page.
		* @param block - the `.md-code-block` element.
		* @param kind - `initial` for a first render, `refresh` for a theme flip.
		*/
		function enqueueRender(block, kind) {
			if (block.hasAttribute("data-dsh-mermaid-error")) return;
			if (kind === "initial" && (block.hasAttribute("data-dsh-mermaid") || !pendingSources.has(block))) return;
			if (kind === "refresh" && !renderedSources.has(block)) return;
			if (renderQueue.some((item) => item.block === block && item.kind === kind)) return;
			renderQueue.push({
				block,
				kind
			});
			drainQueue();
		}
		/**
		* Drain the queue one item at a time. Items whose block left the viewport
		* since enqueue are skipped (left for the observer to re-enqueue on re-entry).
		*/
		async function drainQueue() {
			if (queueRunning) return;
			queueRunning = true;
			try {
				while (renderQueue.length > 0) {
					const item = renderQueue.shift();
					if (item === void 0) break;
					const { block, kind } = item;
					await yieldToMainThread();
					if (!document.contains(block)) continue;
					if (block.hasAttribute("data-dsh-mermaid-error")) continue;
					if (!isVisible(block)) continue;
					const source = kind === "initial" ? pendingSources.get(block) : renderedSources.get(block);
					if (source === void 0 || source === "") continue;
					if (kind === "initial" && block.hasAttribute("data-dsh-mermaid")) continue;
					if (activeEnv === void 0) continue;
					if (await renderBlock(block, source, activeEnv, { loading: kind === "initial" }) && kind === "refresh") needsRefresh.delete(block);
				}
			} finally {
				queueRunning = false;
			}
		}
		/**
		* Show the loading placeholder in place of the fence's `<pre>`. The banner
		* (infostring + copy) stays, and the original `<pre>` is remembered so a
		* failed first render can restore the plain source text.
		* @param block - the `.md-code-block` element.
		*/
		function showLoading(block) {
			if (block.querySelector(`.dsh-mermaid`) !== null) return;
			const pre = block.querySelector("pre");
			if (pre === null) return;
			const host = document.createElement("div");
			host.className = `${HOST_CLASS} ${LOADING_CLASS}`;
			host.setAttribute("role", "status");
			host.setAttribute("aria-label", "mermaid 渲染中");
			const spinner = document.createElement("span");
			spinner.className = `${LOADING_CLASS}-spinner`;
			const label = document.createElement("span");
			label.textContent = "渲染中…";
			host.append(spinner, label);
			pre.replaceWith(host);
			pendingPre.set(block, pre);
		}
		/** Put the remembered `<pre>` back over a loading placeholder (failed first render). */
		function restorePre(block) {
			const placeholder = block.querySelector(`.${HOST_CLASS}.${LOADING_CLASS}`);
			const pre = pendingPre.get(block);
			if (placeholder === null || pre === void 0) return;
			placeholder.replaceWith(pre);
			pendingPre.delete(block);
		}
		/** Stop observing + tracking a block after a permanent failure. */
		function forgetBlock(block) {
			lazyObserver?.unobserve(block);
			trackedBlocks.delete(block);
			pendingSources.delete(block);
			pendingPre.delete(block);
		}
		/**
		* Render one mermaid block in place: replace the `<pre>` (or a previous SVG
		* host / loading placeholder) with the SVG produced by mermaid.render. The
		* banner (infostring + copy) is untouched, so copy still copies the source.
		*
		* With `loading` (first render) the `<pre>` is replaced by a loading
		* placeholder up front; if the block leaves the viewport before the SVG is
		* ready the result is discarded and the placeholder stays until re-entry.
		* On a failed first render the block gets its plain text back and is marked
		* so the observer does not retry it forever. A failed refresh keeps the
		* previous SVG and stays marked for a later retry.
		* @param block - the `.md-code-block` element.
		* @param source - the fence source to render.
		* @param env - the render environment (mermaid loader + config).
		* @param options - `loading` selects the first-render placeholder path.
		* @returns whether the block settled with a rendered SVG (false = failure or viewport-discarded).
		*/
		async function renderBlock(block, source, env, options = {}) {
			if (block.hasAttribute("data-dsh-mermaid-error")) return false;
			if (options.loading === true) showLoading(block);
			try {
				const mermaid = await env.loadMermaid();
				applyTheme(mermaid, env.config, document.body.hasAttribute("data-ds-dark-theme"));
				const { svg } = await withTimeout(mermaid.render(`dsh-mermaid-${++renderCounter}`, source), RENDER_TIMEOUT_MS);
				if (options.loading === true && !isVisible(block)) return false;
				const host = document.createElement("div");
				host.className = HOST_CLASS;
				host.innerHTML = svg;
				const placeholder = block.querySelector(`.${HOST_CLASS}.${LOADING_CLASS}`);
				const oldHost = block.querySelector(`.${HOST_CLASS}:not(.${LOADING_CLASS})`);
				const pre = block.querySelector("pre");
				if (placeholder !== null) placeholder.replaceWith(host);
				else if (oldHost !== null) oldHost.replaceWith(host);
				else if (pre !== null) pre.replaceWith(host);
				renderedSources.set(block, source);
				pendingSources.delete(block);
				pendingPre.delete(block);
				block.setAttribute(RENDERED_ATTR, "1");
				ensureZoomButton(block);
				return true;
			} catch (error) {
				if (!(block.querySelector(`.dsh-mermaid svg`) !== null)) {
					restorePre(block);
					block.setAttribute(ERROR_ATTR, "1");
					forgetBlock(block);
					showErrorBar(block, source, error);
				}
				console.error("dsh-mermaid: render failed", error);
				return false;
			}
		}
		/**
		* Re-render already-rendered blocks after a theme flip. Rendered blocks are
		* marked stale and refreshed lazily: those currently in (or near) the viewport
		* render now, the rest when they next enter it.
		* @param env - the render environment.
		*/
		function reRenderAll(env) {
			activeEnv = env;
			const observer = ensureObserver();
			for (const block of document.querySelectorAll(CODE_BLOCK_SELECTOR)) {
				if (!renderedSources.has(block)) continue;
				needsRefresh.add(block);
				if (!trackedBlocks.has(block)) {
					trackedBlocks.add(block);
					if (observer !== void 0) {
						observer.observe(block);
						continue;
					}
				}
				if (observer === void 0 || visibleBlocks.has(block)) enqueueRender(block, "refresh");
			}
		}
		/** Cap the error text shown inline (the full message rides the report/title). */
		const ERROR_SUMMARY_MAX = 180;
		/** The plain error message, whatever was thrown. */
		function errorMessage(error) {
			if (error instanceof Error && error.message !== "") return error.message;
			return String(error);
		}
		/**
		* The report copied or sent to the AI: the error plus the failing source, so
		* the recipient has everything needed to fix the diagram.
		* @param source - the fence source that failed to render.
		* @param message - the renderer's error message.
		*/
		function buildErrorReport(source, message) {
			return [
				"mermaid 渲染失败，请帮我修复。",
				"",
				"错误信息：",
				message,
				"",
				"图表源码：",
				"```mermaid",
				source,
				"```"
			].join("\n");
		}
		/** Copy text to the clipboard (navigator API with an execCommand fallback). */
		async function copyText(text) {
			try {
				await navigator.clipboard.writeText(text);
				return;
			} catch {}
			const ta = document.createElement("textarea");
			ta.value = text;
			ta.style.position = "fixed";
			ta.style.opacity = "0";
			document.body.append(ta);
			ta.select();
			try {
				document.execCommand("copy");
			} catch {}
			ta.remove();
		}
		/** Briefly swap a button's label to give feedback. */
		function flash(button, label) {
			const original = button.textContent;
			button.textContent = label;
			window.setTimeout(() => {
				button.textContent = original;
			}, 1200);
		}
		/**
		* Simulate the user sending the report to the AI: fill the conversation
		* input's textarea (through React's native value setter so the draft machine
		* picks it up) and press Enter, exactly as if the user typed it. If the input
		* is missing, locked, or the machine rejects the draft (e.g. mid-turn), falls
		* back to copying the report instead.
		* @param report - the text to send.
		* @returns whether the report was actually placed in the input and Enter sent
		* (false = the report was copied instead).
		*/
		async function sendToAI(report) {
			const textarea = document.querySelector("textarea[data-phase]");
			if (textarea === null || textarea.disabled || textarea.readOnly) {
				await copyText(report);
				return false;
			}
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
			if (setter !== void 0) setter.call(textarea, report);
			else textarea.value = report;
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			await new Promise((resolve) => window.setTimeout(resolve, 30));
			if (textarea.value === "") {
				await copyText(report);
				return false;
			}
			textarea.dispatchEvent(new KeyboardEvent("keydown", {
				key: "Enter",
				code: "Enter",
				bubbles: true,
				cancelable: true
			}));
			return true;
		}
		/**
		* Show the error summary bar below a failed fence: a truncated error summary
		* plus "copy the report" and "send to the AI" actions. Idempotent per block.
		* @param block - the `.md-code-block` element.
		* @param source - the fence source that failed.
		* @param error - the thrown render error.
		*/
		function showErrorBar(block, source, error) {
			if (block.querySelector(`.dsh-mermaid-error`) !== null) return;
			const message = errorMessage(error);
			const report = buildErrorReport(source, message);
			const summary = message.length > ERROR_SUMMARY_MAX ? `${message.slice(0, ERROR_SUMMARY_MAX)}…` : message;
			const bar = document.createElement("div");
			bar.className = ERROR_BAR_CLASS;
			const text = document.createElement("div");
			text.className = `${ERROR_BAR_CLASS}-message`;
			text.title = message;
			text.textContent = `渲染失败：${summary}`;
			const actions = document.createElement("div");
			actions.className = `${ERROR_BAR_CLASS}-actions`;
			const copyButton = document.createElement("button");
			copyButton.type = "button";
			copyButton.textContent = "复制报错";
			copyButton.addEventListener("click", () => {
				copyText(report).then(() => flash(copyButton, "已复制"));
			});
			const sendButton = document.createElement("button");
			sendButton.type = "button";
			sendButton.textContent = "发送给 AI 修复";
			sendButton.addEventListener("click", () => {
				sendToAI(report).then((sent) => flash(sendButton, sent ? "已发送" : "已复制"));
			});
			actions.append(copyButton, sendButton);
			bar.append(text, actions);
			block.append(bar);
		}
		/**
		* Remove stray mermaid error-render artifacts left in the page body by older
		* runs (before `suppressErrorRendering`, mermaid appended its built-in
		* "Syntax error in text" diagram to `body` — the undismissable bottom-left
		* popup). Strict mode wraps it in a `i`-prefixed sandbox iframe, loose mode
		* in a `d`-prefixed div; the prefixes are ours (render ids are
		* `dsh-mermaid-<n>`). Called once at apply time so a previously stuck popup
		* clears on plugin reload.
		*/
		function removeStrayErrorElements() {
			for (const el of document.querySelectorAll("[id^=\"ddsh-mermaid-\"], [id^=\"idsh-mermaid-\"], [id^=\"cdsh-mermaid-\"]")) el.remove();
		}
		/** The banner's action cell (copy button seat); matched by its readable class segment. */
		const ACTION_SEGMENT = "action";
		/** Close function of the currently open overlay (if any), for single-overlay + unload teardown. */
		let currentOverlay = null;
		/**
		* Inject the zoom button left of the copy button in the block's banner, once.
		* The button opens the rendered SVG in a full-screen overlay (see
		* {@link openOverlay}). Idempotent: re-renders (theme flip) keep one button.
		* Styling lives in `styles.ts` (`.dsh-mermaid-zoom`), so the button carries no
		* inline styles and matches the banner's other actions.
		* @param block - the `.md-code-block` element.
		*/
		function ensureZoomButton(block) {
			if (block.querySelector(`.dsh-mermaid-zoom`) !== null) return;
			const action = block.querySelector(`[class*="${ACTION_SEGMENT}"]`);
			if (action === null) return;
			const button = document.createElement("button");
			button.type = "button";
			button.className = ZOOM_BUTTON_CLASS;
			button.title = "放大";
			button.setAttribute("aria-label", "放大 mermaid 图");
			button.textContent = "⛶";
			button.addEventListener("click", () => openOverlay(block));
			action.prepend(button);
		}
		/** Wheel-zoom multiplier bounds (relative to the fitted size on open). */
		const MIN_ZOOM = .2;
		const MAX_ZOOM = 8;
		/** Wheel-zoom step per notch. */
		const ZOOM_STEP = 1.15;
		/**
		* The diagram's intrinsic size in SVG user units, from `viewBox` (preferred)
		* or the `width`/`height` attributes. Returns 0,0 when neither is usable.
		* @param svg - the (cloned) diagram SVG.
		*/
		function svgNaturalSize(svg) {
			const viewBox = svg.getAttribute("viewBox");
			if (viewBox !== null) {
				const parts = viewBox.trim().split(/[\s,]+/).map(Number);
				if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) return {
					w: parts[2],
					h: parts[3]
				};
			}
			const w = parseFloat(svg.getAttribute("width") ?? "");
			const h = parseFloat(svg.getAttribute("height") ?? "");
			if (w > 0 && h > 0) return {
				w,
				h
			};
			return {
				w: 0,
				h: 0
			};
		}
		/**
		* Open the full-screen zoom overlay for a rendered mermaid block. The overlay
		* clones the block's SVG into a stage and fits it to the viewport on open —
		* a small diagram is scaled up to near full-screen (with a small margin) so
		* it reads as a popup instead of a tiny image in the middle of the screen.
		* The mouse wheel zooms relative to that fitted size (bounded); holding the
		* middle button and dragging pans the (zoomed) diagram; the overlay closes on
		* background click or Escape. Only one overlay is open at a time (opening a
		* new one closes the previous). Every listener is removed when the overlay
		* closes, and the open overlay is tracked so plugin unload can tear it down.
		* Layout + theme come from `styles.ts` classes; only the scale transform is
		* inline (on the cloned SVG, so zooming beyond the stage stays pannable
		* through `overflow: auto`).
		* @param block - the `.md-code-block` element.
		*/
		function openOverlay(block) {
			const svg = block.querySelector(`.${HOST_CLASS} svg`);
			if (svg === null) return;
			currentOverlay?.();
			const overlay = document.createElement("div");
			overlay.className = OVERLAY_CLASS;
			const stage = document.createElement("div");
			stage.className = STAGE_CLASS;
			const clone = svg.cloneNode(true);
			stage.append(clone);
			overlay.append(stage);
			document.body.append(overlay);
			const natural = svgNaturalSize(clone);
			let zoom = 1;
			let fitScale = 1;
			let panX = 0;
			let panY = 0;
			const applyTransform = () => {
				const pinned = natural.w > 0 && natural.h > 0 ? `width:${natural.w}px;height:${natural.h}px;` : "";
				clone.setAttribute("style", `${pinned}transform: translate(${panX}px, ${panY}px) scale(${fitScale * zoom})`);
			};
			const stageSize = () => {
				const rect = stage.getBoundingClientRect();
				return {
					w: rect.width,
					h: rect.height
				};
			};
			/** The diagram's current visual size (layout box × total scale). */
			const visualSize = () => {
				const scale = fitScale * zoom;
				const baseW = natural.w > 0 ? natural.w : clone.clientWidth || 1;
				const baseH = natural.h > 0 ? natural.h : clone.clientHeight || 1;
				return {
					w: baseW * scale,
					h: baseH * scale
				};
			};
			/**
			* Keep the diagram overlapping the stage: when smaller than the stage it
			* slides within it, when larger each edge stays reachable.
			*/
			const clampPan = () => {
				const s = stageSize();
				const v = visualSize();
				const hx = Math.abs(s.w - v.w) / 2;
				const hy = Math.abs(s.h - v.h) / 2;
				panX = Math.min(hx, Math.max(-hx, panX));
				panY = Math.min(hy, Math.max(-hy, panY));
			};
			const measure = () => {
				const s = stageSize();
				const availW = Math.max(s.w - 48, 1);
				const availH = Math.max(s.h - 48, 1);
				fitScale = natural.w > 0 && natural.h > 0 ? Math.min(availW / natural.w, availH / natural.h) : 1;
				panX = 0;
				panY = 0;
				applyTransform();
			};
			measure();
			let panning = false;
			let panPointerId = -1;
			let panStartX = 0;
			let panStartY = 0;
			let panLastX = 0;
			let panLastY = 0;
			let justPanned = false;
			const onWheel = (event) => {
				event.preventDefault();
				if (panning) return;
				const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
				zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
				clampPan();
				applyTransform();
			};
			const onPointerDown = (event) => {
				justPanned = false;
				if (event.button !== 1 && event.button !== 0) return;
				if (!(event.target instanceof Element) || !stage.contains(event.target)) return;
				event.preventDefault();
				panning = true;
				panPointerId = event.pointerId;
				panStartX = event.clientX;
				panStartY = event.clientY;
				panLastX = event.clientX;
				panLastY = event.clientY;
				stage.classList.add(STAGE_DRAGGING_CLASS);
				try {
					stage.setPointerCapture(event.pointerId);
				} catch {}
			};
			const onPointerMove = (event) => {
				if (!panning || event.pointerId !== panPointerId) return;
				panX += event.clientX - panLastX;
				panY += event.clientY - panLastY;
				panLastX = event.clientX;
				panLastY = event.clientY;
				clampPan();
				applyTransform();
			};
			const endPan = (event) => {
				if (!panning || event.pointerId !== panPointerId) return;
				justPanned = Math.abs(event.clientX - panStartX) + Math.abs(event.clientY - panStartY) > 4;
				panning = false;
				panPointerId = -1;
				stage.classList.remove(STAGE_DRAGGING_CLASS);
				if (stage.hasPointerCapture(event.pointerId)) try {
					stage.releasePointerCapture(event.pointerId);
				} catch {}
			};
			window.addEventListener("pointerdown", onPointerDown, true);
			window.addEventListener("pointermove", onPointerMove, true);
			window.addEventListener("pointerup", endPan, true);
			window.addEventListener("pointercancel", endPan, true);
			const close = () => {
				if (currentOverlay === close) currentOverlay = null;
				overlay.remove();
				window.removeEventListener("keydown", onKeydown);
				window.removeEventListener("resize", onResize);
				window.removeEventListener("pointerdown", onPointerDown, true);
				window.removeEventListener("pointermove", onPointerMove, true);
				window.removeEventListener("pointerup", endPan, true);
				window.removeEventListener("pointercancel", endPan, true);
				overlay.removeEventListener("wheel", onWheel);
			};
			const onKeydown = (event) => {
				if (event.key === "Escape") close();
			};
			const onResize = () => measure();
			overlay.addEventListener("click", (event) => {
				if (event.target === overlay && !justPanned) close();
				justPanned = false;
			});
			overlay.addEventListener("wheel", onWheel, { passive: false });
			window.addEventListener("keydown", onKeydown);
			window.addEventListener("resize", onResize);
			currentOverlay = close;
		}
		/**
		* Process every currently-settled mermaid fence in the document: register it
		* with the lazy viewport observer (or enqueue it directly when the observer is
		* unavailable) rather than rendering immediately. Settled-only by
		* construction: while a message streams, CodeBlock renders fences with an
		* empty infostring (lang is suppressed mid-stream), so the infostring test
		* never matches until the settle pass — the same policy the product applies
		* to KaTeX.
		* @param env - the render environment.
		*/
		function scan(env) {
			activeEnv = env;
			const observer = ensureObserver();
			for (const block of document.querySelectorAll(CODE_BLOCK_SELECTOR)) {
				if (!isMermaidBlock(block)) continue;
				if (block.hasAttribute("data-dsh-mermaid-error")) continue;
				if (trackedBlocks.has(block)) continue;
				trackedBlocks.add(block);
				if (block.hasAttribute("data-dsh-mermaid")) {
					if (observer !== void 0) observer.observe(block);
					continue;
				}
				const source = fenceSource(block);
				if (source === "") continue;
				pendingSources.set(block, source);
				if (observer !== void 0) observer.observe(block);
				else enqueueRender(block, "initial");
			}
		}
		/**
		* Tear down everything this module owns: any open overlay, the shared lazy
		* observer, and the render queue. Called on plugin unload (see the client
		* `apply()` disposer) so a stopped/updated plugin stops observing the whole
		* document and leaks no window listeners or held blocks.
		*/
		function dispose() {
			currentOverlay?.();
			currentOverlay = null;
			lazyObserver?.disconnect();
			lazyObserver = void 0;
			renderQueue.length = 0;
			queueRunning = false;
			activeEnv = void 0;
		}
		//#endregion
		//#region src/client/styles.ts
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
		const STYLE_ID = "dsh-mermaid-styles";
		/** Live mount count: the `<style>` element is removed only on the last dispose. */
		let styleRefCount = 0;
		/**
		* Inject the plugin stylesheet once and return a disposer that removes it.
		* Reference-counted: overlapping lifetimes (e.g. a re-run before the previous
		* unload) share one `<style>` element, and each disposer only drops its own
		* reference — the element is removed when the last one disposes.
		* @returns a cleanup function releasing this lifetime's reference.
		*/
		function mountStyles() {
			if (styleRefCount === 0) {
				const style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = STYLES;
				document.head.append(style);
			}
			styleRefCount += 1;
			let disposed = false;
			return () => {
				if (disposed) return;
				disposed = true;
				styleRefCount -= 1;
				if (styleRefCount === 0) document.getElementById(STYLE_ID)?.remove();
			};
		}
		/** Complete stylesheet injected by the client half. */
		const STYLES = `
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
\n
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
  /* Center the diagram's LAYOUT box even when it is taller/wider than the
     stage: flex centering overflows equally on both sides, so the SVG's
     transform-origin (its layout center) stays at the stage center and the
     pan/zoom is symmetric. margin: auto would collapse to 0 once the box
     overflows and anchor it at the top, shifting the origin and making one
     pan edge unreachable. */
  align-items: center;
  justify-content: center;
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
     before the fit transform applies); centering comes from the stage's flex
     alignment so the transform-origin stays centered even on overflow. */
  display: block;
  width: auto;
  height: auto;
  max-width: none;
  max-height: none;
  transform-origin: center center;
}
\n
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
\n
.dsh-mermaid-error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  padding: 6px 14px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-state-error-primary, #c8102e);
  background: rgba(236, 19, 19, 0.06);
  border-top: 1px solid var(--dsw-alias-state-error-secondary, rgba(236, 19, 19, 0.35));
  border-bottom-left-radius: var(--dsl-code-block-border-radius, 12px);
  border-bottom-right-radius: var(--dsl-code-block-border-radius, 12px);
}
.dsh-mermaid-error-message {
  flex: 1 1 220px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-mermaid-error-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.dsh-mermaid-error button {
  appearance: none;
  -webkit-appearance: none;
  border: none;
  border-radius: 6px;
  background: transparent;
  padding: 3px 8px;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.dsh-mermaid-error button:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
}
.dsh-mermaid-error button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4176e6);
  outline-offset: 1px;
}
`;
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
			ctx.effect(() => mountStyles(), "dsh-mermaid: styles");
			loadConfig().then((config) => {
				const env = {
					loadMermaid,
					config
				};
				scan(env);
				removeStrayErrorElements();
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
					dispose();
				}, "dsh-mermaid: fence observer + theme observer + dispose");
			});
		}
		//#endregion
		exports.apply = apply;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map