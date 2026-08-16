/**
 * DOM processing for dsh-mermaid: pure-ish helpers that decide whether a code
 * block is a mermaid fence, extract its source, and render it in place. All
 * side-effecting capabilities (loading mermaid, resolving config, the lazy
 * viewport observer) arrive as injected dependencies or are created lazily so
 * the logic is unit-testable in jsdom without a real mermaid bundle.
 *
 * Rendering is asynchronous and viewport-driven:
 *
 *   1. `scan()` registers every settled mermaid fence with one shared
 *      IntersectionObserver instead of rendering it immediately, so diagrams
 *      below the fold never pay the mermaid cost (lazy loading).
 *   2. When a block enters the viewport (with a small preload margin) its
 *      render is enqueued; the queue drains one diagram at a time, yielding
 *      to the event loop between renders so many diagrams never block the
 *      page.
 *   3. While a first render is in flight the block shows a loading
 *      placeholder. If the block scrolls away before its render finishes the
 *      work is discarded and the placeholder stays until it re-enters.
 */
/** Stable literal class CodeBlock applies to every fence wrapper. */
export const CODE_BLOCK_SELECTOR = '.md-code-block';
/** The banner element's readable class segment (css-module keeps it). */
export const INFOSTRING_SEGMENT = 'infostring';
/** Attribute marking a block this plugin already processed. */
export const RENDERED_ATTR = 'data-dsh-mermaid';
/** Attribute marking a block whose render failed (no retry loop). */
export const ERROR_ATTR = 'data-dsh-mermaid-error';
/** Class of the host div holding the rendered SVG. */
export const HOST_CLASS = 'dsh-mermaid';
/** Class of the loading placeholder shown while a first render is in flight. */
export const LOADING_CLASS = 'dsh-mermaid-loading';
/** Class of the zoom button injected left of the copy button. */
export const ZOOM_BUTTON_CLASS = 'dsh-mermaid-zoom';
/** Class of the error summary bar shown below a failed render. */
export const ERROR_BAR_CLASS = 'dsh-mermaid-error';
/** Class of the full-screen zoom overlay. */
export const OVERLAY_CLASS = 'dsh-mermaid-overlay';
/** Class of the overlay's zoomable stage (the SVG lives inside it). */
export const STAGE_CLASS = 'dsh-mermaid-stage';
/** Class toggled on the stage while a middle-button pan drag is active. */
export const STAGE_DRAGGING_CLASS = 'dsh-mermaid-dragging';
/** Whether `block` is a mermaid fence (infostring text is exactly `mermaid`). */
export function isMermaidBlock(block) {
    const info = block.querySelector(`[class*="${INFOSTRING_SEGMENT}"]`);
    return info?.textContent?.trim() === 'mermaid';
}
/** The fence source: the `<pre>` text minus the trailing newline CodeBlock trims on display. */
export function fenceSource(block) {
    return block.querySelector('pre')?.textContent?.replace(/\n$/, '') ?? '';
}
/** Resolve the mermaid theme from config + the GUI's dark-mode attribute. */
export function resolveTheme(config, dark) {
    if (config.theme !== 'auto')
        return config.theme;
    return dark ? 'dark' : 'default';
}
/** Apply the effective theme to the mermaid singleton before rendering. */
export function applyTheme(mermaid, config, dark) {
    mermaid.initialize({
        startOnLoad: false,
        securityLevel: config.securityLevel,
        theme: resolveTheme(config, dark),
        maxTextSize: config.maxTextSize,
        maxEdges: config.maxEdges,
        fontFamily: 'inherit',
    });
}
let renderCounter = 0;
/** Rendered block → its source, kept so a theme flip can re-render without a `<pre>`. */
const renderedSources = new WeakMap();
/** Block waiting on a first render → its fence source (the `<pre>` may already be a placeholder). */
const pendingSources = new WeakMap();
/** Block whose placeholder replaced the `<pre>` → the original `<pre>` (restored on failure). */
const pendingPre = new WeakMap();
/** Rendered blocks whose theme is stale after a flip; refreshed lazily on re-entry. */
const needsRefresh = new WeakSet();
/** Blocks handed to the lazy observer (scan idempotence, also detach cleanup). */
const trackedBlocks = new WeakSet();
/** Blocks currently intersecting the viewport (maintained by the observer). */
const visibleBlocks = new WeakSet();
/** The render environment for queued work; set by `scan`/`reRenderAll`. */
let activeEnv;
/** Cap one mermaid.render call; a hostile or pathological diagram must never hang the queue. */
const RENDER_TIMEOUT_MS = 15000;
/** How far outside the viewport a block still counts as "wanted" (preload margin). */
const OBSERVER_MARGIN = '300px';
function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(`dsh-mermaid: render timed out after ${ms}ms`)), ms);
        promise.then(value => { window.clearTimeout(timer); resolve(value); }, error => { window.clearTimeout(timer); reject(error); });
    });
}
/** Let the browser paint (loading placeholders) and stay responsive between renders. */
function yieldToMainThread() {
    return new Promise(resolve => window.setTimeout(resolve, 0));
}
// --- lazy viewport rendering ------------------------------------------------
/**
 * One shared IntersectionObserver for every tracked fence. Blocks enter the
 * render queue only when (near) the viewport; a block that scrolls away while
 * queued or mid-render is skipped/discarded and re-enqueued on re-entry.
 * Without `IntersectionObserver` (jsdom) the plugin degrades to immediate
 * rendering of every block — the tests and headless fixtures rely on this.
 */
let lazyObserver;
function ensureObserver() {
    if (lazyObserver !== undefined)
        return lazyObserver;
    if (typeof IntersectionObserver === 'undefined')
        return undefined;
    lazyObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            const block = entry.target;
            if (!entry.isIntersecting) {
                visibleBlocks.delete(block);
                if (!document.contains(block)) {
                    // Detached (streaming → settled node swap, or the product removed
                    // it): drop all tracking — the observer holds strong references.
                    lazyObserver?.unobserve(block);
                    trackedBlocks.delete(block);
                    pendingSources.delete(block);
                    pendingPre.delete(block);
                }
                continue;
            }
            visibleBlocks.add(block);
            if (pendingSources.has(block))
                enqueueRender(block, 'initial');
            else if (needsRefresh.has(block))
                enqueueRender(block, 'refresh');
        }
    }, { rootMargin: OBSERVER_MARGIN });
    return lazyObserver;
}
/** Viewport gate: without an observer every block counts as visible. */
function isVisible(block) {
    return lazyObserver === undefined || visibleBlocks.has(block);
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
    if (block.hasAttribute(ERROR_ATTR))
        return;
    if (kind === 'initial' && (block.hasAttribute(RENDERED_ATTR) || !pendingSources.has(block)))
        return;
    if (kind === 'refresh' && !renderedSources.has(block))
        return;
    if (renderQueue.some(item => item.block === block && item.kind === kind))
        return;
    renderQueue.push({ block, kind });
    void drainQueue();
}
/**
 * Drain the queue one item at a time. Items whose block left the viewport
 * since enqueue are skipped (left for the observer to re-enqueue on re-entry).
 */
async function drainQueue() {
    if (queueRunning)
        return;
    queueRunning = true;
    try {
        while (renderQueue.length > 0) {
            const item = renderQueue.shift();
            if (item === undefined)
                break;
            const { block, kind } = item;
            // Let the browser paint (loading placeholders) and give the observer a
            // chance to deliver scroll-away entries before starting this render.
            await yieldToMainThread();
            if (!document.contains(block))
                continue;
            if (block.hasAttribute(ERROR_ATTR))
                continue;
            if (!isVisible(block))
                continue;
            const source = kind === 'initial' ? pendingSources.get(block) : renderedSources.get(block);
            if (source === undefined || source === '')
                continue;
            if (kind === 'initial' && block.hasAttribute(RENDERED_ATTR))
                continue;
            if (activeEnv === undefined)
                continue;
            const ok = await renderBlock(block, source, activeEnv, { loading: kind === 'initial' });
            if (ok && kind === 'refresh')
                needsRefresh.delete(block);
        }
    }
    finally {
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
    if (block.querySelector(`.${HOST_CLASS}`) !== null)
        return;
    const pre = block.querySelector('pre');
    if (pre === null)
        return;
    const host = document.createElement('div');
    host.className = `${HOST_CLASS} ${LOADING_CLASS}`;
    host.setAttribute('role', 'status');
    host.setAttribute('aria-label', 'mermaid 渲染中');
    const spinner = document.createElement('span');
    spinner.className = `${LOADING_CLASS}-spinner`;
    const label = document.createElement('span');
    label.textContent = '渲染中…';
    host.append(spinner, label);
    pre.replaceWith(host);
    pendingPre.set(block, pre);
}
/** Put the remembered `<pre>` back over a loading placeholder (failed first render). */
function restorePre(block) {
    const placeholder = block.querySelector(`.${HOST_CLASS}.${LOADING_CLASS}`);
    const pre = pendingPre.get(block);
    if (placeholder === null || pre === undefined)
        return;
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
export async function renderBlock(block, source, env, options = {}) {
    if (block.hasAttribute(ERROR_ATTR))
        return false;
    if (options.loading === true)
        showLoading(block);
    try {
        const mermaid = await env.loadMermaid();
        applyTheme(mermaid, env.config, document.body.hasAttribute('data-ds-dark-theme'));
        const { svg } = await withTimeout(mermaid.render(`dsh-mermaid-${++renderCounter}`, source), RENDER_TIMEOUT_MS);
        // The block scrolled out of the preload margin while this render was in
        // flight: drop the result and let the observer re-enqueue on re-entry.
        if (options.loading === true && !isVisible(block))
            return false;
        const host = document.createElement('div');
        host.className = HOST_CLASS;
        host.innerHTML = svg;
        // Replace, in order: the loading placeholder, an existing SVG host
        // (re-render), otherwise the `<pre>`.
        const placeholder = block.querySelector(`.${HOST_CLASS}.${LOADING_CLASS}`);
        const oldHost = block.querySelector(`.${HOST_CLASS}:not(.${LOADING_CLASS})`);
        const pre = block.querySelector('pre');
        if (placeholder !== null)
            placeholder.replaceWith(host);
        else if (oldHost !== null)
            oldHost.replaceWith(host);
        else if (pre !== null)
            pre.replaceWith(host);
        renderedSources.set(block, source);
        pendingSources.delete(block);
        pendingPre.delete(block);
        block.setAttribute(RENDERED_ATTR, '1');
        ensureZoomButton(block);
        return true;
    }
    catch (error) {
        const hadSvg = block.querySelector(`.${HOST_CLASS} svg`) !== null;
        if (!hadSvg) {
            // First render failed: restore the plain code block as the fallback
            // (untrusted content must not render error HTML) and stop retrying,
            // then surface an error summary below the block with copy / send-to-AI.
            restorePre(block);
            block.setAttribute(ERROR_ATTR, '1');
            forgetBlock(block);
            showErrorBar(block, source, error);
        }
        console.error('dsh-mermaid: render failed', error);
        return false;
    }
}
/**
 * Re-render already-rendered blocks after a theme flip. Rendered blocks are
 * marked stale and refreshed lazily: those currently in (or near) the viewport
 * render now, the rest when they next enter it.
 * @param env - the render environment.
 */
export function reRenderAll(env) {
    activeEnv = env;
    const observer = ensureObserver();
    for (const block of document.querySelectorAll(CODE_BLOCK_SELECTOR)) {
        if (!renderedSources.has(block))
            continue;
        needsRefresh.add(block);
        if (!trackedBlocks.has(block)) {
            trackedBlocks.add(block);
            if (observer !== undefined) {
                // The observer delivers the current intersection asynchronously; its
                // enter handler enqueues the refresh for visible blocks.
                observer.observe(block);
                continue;
            }
        }
        if (observer === undefined || visibleBlocks.has(block))
            enqueueRender(block, 'refresh');
    }
}
// --- error summary + copy / send-to-AI ---------------------------------------
/** Cap the error text shown inline (the full message rides the report/title). */
const ERROR_SUMMARY_MAX = 180;
/** The plain error message, whatever was thrown. */
function errorMessage(error) {
    if (error instanceof Error && error.message !== '')
        return error.message;
    return String(error);
}
/**
 * The report copied or sent to the AI: the error plus the failing source, so
 * the recipient has everything needed to fix the diagram.
 * @param source - the fence source that failed to render.
 * @param message - the renderer's error message.
 */
export function buildErrorReport(source, message) {
    return [
        'mermaid 渲染失败，请帮我修复。',
        '',
        '错误信息：',
        message,
        '',
        '图表源码：',
        '```mermaid',
        source,
        '```',
    ].join('\n');
}
/** Copy text to the clipboard (navigator API with an execCommand fallback). */
async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return;
    }
    catch {
        // Fallback path (non-secure context / missing Clipboard API).
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    try {
        document.execCommand('copy');
    }
    catch { /* ignore */ }
    ta.remove();
}
/** Briefly swap a button's label to give feedback. */
function flash(button, label) {
    const original = button.textContent;
    button.textContent = label;
    window.setTimeout(() => { button.textContent = original; }, 1200);
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
export async function sendToAI(report) {
    const textarea = document.querySelector('textarea[data-phase]');
    if (textarea === null || textarea.disabled || textarea.readOnly) {
        await copyText(report);
        return false;
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter !== undefined)
        setter.call(textarea, report);
    else
        textarea.value = report;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    // Let React/onChange flush the draft; if the machine rejected it (locked or
    // busy), the controlled value snaps back empty — hand the user a copy.
    await new Promise(resolve => window.setTimeout(resolve, 30));
    if (textarea.value === '') {
        await copyText(report);
        return false;
    }
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    return true;
}
/**
 * Show the error summary bar below a failed fence: a truncated error summary
 * plus "copy the report" and "send to the AI" actions. Idempotent per block.
 * @param block - the `.md-code-block` element.
 * @param source - the fence source that failed.
 * @param error - the thrown render error.
 */
export function showErrorBar(block, source, error) {
    if (block.querySelector(`.${ERROR_BAR_CLASS}`) !== null)
        return;
    const message = errorMessage(error);
    const report = buildErrorReport(source, message);
    const summary = message.length > ERROR_SUMMARY_MAX ? `${message.slice(0, ERROR_SUMMARY_MAX)}…` : message;
    const bar = document.createElement('div');
    bar.className = ERROR_BAR_CLASS;
    const text = document.createElement('div');
    text.className = `${ERROR_BAR_CLASS}-message`;
    text.title = message;
    text.textContent = `渲染失败：${summary}`;
    const actions = document.createElement('div');
    actions.className = `${ERROR_BAR_CLASS}-actions`;
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = '复制报错';
    copyButton.addEventListener('click', () => {
        void copyText(report).then(() => flash(copyButton, '已复制'));
    });
    const sendButton = document.createElement('button');
    sendButton.type = 'button';
    sendButton.textContent = '发送给 AI 修复';
    sendButton.addEventListener('click', () => {
        void sendToAI(report).then(sent => flash(sendButton, sent ? '已发送' : '已复制'));
    });
    actions.append(copyButton, sendButton);
    bar.append(text, actions);
    block.append(bar);
}
// --- zoom button + overlay --------------------------------------------------
/** The banner's action cell (copy button seat); matched by its readable class segment. */
const ACTION_SEGMENT = 'action';
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
export function ensureZoomButton(block) {
    if (block.querySelector(`.${ZOOM_BUTTON_CLASS}`) !== null)
        return;
    const action = block.querySelector(`[class*="${ACTION_SEGMENT}"]`);
    if (action === null)
        return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = ZOOM_BUTTON_CLASS;
    button.title = '放大';
    button.setAttribute('aria-label', '放大 mermaid 图');
    button.textContent = '⛶';
    button.addEventListener('click', () => openOverlay(block));
    // Prepend: the copy button stays last in the action cell.
    action.prepend(button);
}
/** Wheel-zoom multiplier bounds (relative to the fitted size on open). */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
/** Wheel-zoom step per notch. */
const ZOOM_STEP = 1.15;
/** Inner margin (px) between the fitted diagram and the stage edge. */
const STAGE_PADDING = 24;
/**
 * The diagram's intrinsic size in SVG user units, from `viewBox` (preferred)
 * or the `width`/`height` attributes. Returns 0,0 when neither is usable.
 * @param svg - the (cloned) diagram SVG.
 */
function svgNaturalSize(svg) {
    const viewBox = svg.getAttribute('viewBox');
    if (viewBox !== null) {
        const parts = viewBox.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0)
            return { w: parts[2], h: parts[3] };
    }
    const w = parseFloat(svg.getAttribute('width') ?? '');
    const h = parseFloat(svg.getAttribute('height') ?? '');
    if (w > 0 && h > 0)
        return { w, h };
    return { w: 0, h: 0 };
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
export function openOverlay(block) {
    const svg = block.querySelector(`.${HOST_CLASS} svg`);
    if (svg === null)
        return;
    // One overlay at a time: close whatever is currently open (its own window
    // listeners are removed by its close(), so Esc no longer closes two).
    currentOverlay?.();
    const overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    const stage = document.createElement('div');
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
        // Pin the layout box to the diagram's natural size in px: mermaid often
        // emits width="100%", which would otherwise stretch the diagram to the
        // full stage width before the fit transform applies (a plain CSS
        // width:auto does not reliably recover the viewBox-derived size). Inline
        // px width/height are deterministic. Pan rides the transform as a
        // translate in front of the scale, so dragging works at ANY zoom (the
        // stage is overflow:hidden, i.e. a viewport — no scroll range needed).
        const pinned = natural.w > 0 && natural.h > 0 ? `width:${natural.w}px;height:${natural.h}px;` : '';
        clone.setAttribute('style', `${pinned}transform: translate(${panX}px, ${panY}px) scale(${fitScale * zoom})`);
    };
    const stageSize = () => {
        const rect = stage.getBoundingClientRect();
        return { w: rect.width, h: rect.height };
    };
    /** The diagram's current visual size (layout box × total scale). */
    const visualSize = () => {
        const scale = fitScale * zoom;
        const baseW = natural.w > 0 ? natural.w : (clone.clientWidth || 1);
        const baseH = natural.h > 0 ? natural.h : (clone.clientHeight || 1);
        return { w: baseW * scale, h: baseH * scale };
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
        const availW = Math.max(s.w - STAGE_PADDING * 2, 1);
        const availH = Math.max(s.h - STAGE_PADDING * 2, 1);
        fitScale = natural.w > 0 && natural.h > 0
            ? Math.min(availW / natural.w, availH / natural.h)
            : 1;
        panX = 0;
        panY = 0;
        applyTransform();
    };
    measure();
    // Middle- or left-button drag on the stage pans the diagram via the
    // transform translate (works at any zoom — the fit position is just the
    // centered pan 0,0). Listeners sit on `window` in the CAPTURE phase so no
    // page-level handler can swallow the events before they reach us; pointer
    // capture keeps the drag alive outside the window (no stuck "panning"
    // state) and filters events to the dragged pointer. preventDefault stops
    // Chrome's middle-click autoscroll and text selection.
    let panning = false;
    let panPointerId = -1;
    let panStartX = 0;
    let panStartY = 0;
    let panLastX = 0;
    let panLastY = 0;
    let justPanned = false;
    const onWheel = (event) => {
        event.preventDefault();
        if (panning)
            return; // don't zoom mid-pan
        const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
        clampPan();
        applyTransform();
    };
    const onPointerDown = (event) => {
        justPanned = false;
        if (event.button !== 1 && event.button !== 0)
            return;
        if (!(event.target instanceof Element) || !stage.contains(event.target))
            return;
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
        }
        catch {
            // The page may already hold the capture; the window listeners still pan.
        }
    };
    const onPointerMove = (event) => {
        if (!panning || event.pointerId !== panPointerId)
            return;
        panX += event.clientX - panLastX;
        panY += event.clientY - panLastY;
        panLastX = event.clientX;
        panLastY = event.clientY;
        clampPan();
        applyTransform();
    };
    const endPan = (event) => {
        if (!panning || event.pointerId !== panPointerId)
            return;
        justPanned = Math.abs(event.clientX - panStartX) + Math.abs(event.clientY - panStartY) > 4;
        panning = false;
        panPointerId = -1;
        stage.classList.remove(STAGE_DRAGGING_CLASS);
        if (stage.hasPointerCapture(event.pointerId)) {
            try {
                stage.releasePointerCapture(event.pointerId);
            }
            catch { /* ignore */ }
        }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', endPan, true);
    window.addEventListener('pointercancel', endPan, true);
    const close = () => {
        if (currentOverlay === close)
            currentOverlay = null;
        overlay.remove();
        window.removeEventListener('keydown', onKeydown);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('pointerdown', onPointerDown, true);
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', endPan, true);
        window.removeEventListener('pointercancel', endPan, true);
        overlay.removeEventListener('wheel', onWheel);
    };
    const onKeydown = (event) => {
        if (event.key === 'Escape')
            close();
    };
    const onResize = () => measure();
    overlay.addEventListener('click', (event) => {
        // Only a click on the backdrop closes; clicking the diagram itself does
        // not, and neither does a left-drag pan whose release click lands on the
        // overlay (its click target is the common ancestor).
        if (event.target === overlay && !justPanned)
            close();
        justPanned = false;
    });
    overlay.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', onResize);
    currentOverlay = close;
}
// --- scan -------------------------------------------------------------------
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
export function scan(env) {
    activeEnv = env;
    const observer = ensureObserver();
    for (const block of document.querySelectorAll(CODE_BLOCK_SELECTOR)) {
        if (!isMermaidBlock(block))
            continue;
        if (block.hasAttribute(ERROR_ATTR))
            continue;
        if (trackedBlocks.has(block))
            continue;
        trackedBlocks.add(block);
        if (block.hasAttribute(RENDERED_ATTR)) {
            // Already rendered: observed so a theme flip can refresh it on re-entry.
            if (observer !== undefined)
                observer.observe(block);
            continue;
        }
        const source = fenceSource(block);
        if (source === '')
            continue;
        pendingSources.set(block, source);
        if (observer !== undefined)
            observer.observe(block);
        else
            enqueueRender(block, 'initial');
    }
}
/**
 * Tear down everything this module owns: any open overlay, the shared lazy
 * observer, and the render queue. Called on plugin unload (see the client
 * `apply()` disposer) so a stopped/updated plugin stops observing the whole
 * document and leaks no window listeners or held blocks.
 */
export function dispose() {
    currentOverlay?.();
    currentOverlay = null;
    lazyObserver?.disconnect();
    lazyObserver = undefined;
    renderQueue.length = 0;
    queueRunning = false;
    activeEnv = undefined;
}
/**
 * Test-support reset: same teardown as {@link dispose} so unit tests start
 * clean (module singletons are otherwise shared across tests in one file).
 */
export function __resetForTests() {
    dispose();
}
