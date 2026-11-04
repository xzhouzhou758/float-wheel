// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Float Wheel (悬浮窗轮盘) — Luker extension.
// One draggable orb; tap it to fan out a ring around it. Every collected
// floating button is shown in the ring *as itself*: while the ring is open
// the original element is moved onto a slot (inline left/top !important,
// original size, nothing else touched), so its look, animation and badges
// stay exactly as the owner draws them, and tapping it is tapping it.
// When the ring closes it goes back to whatever position its owner last
// wrote and is hidden again (visibility only, never removed).
//   - discovery: position:fixed elements that are rendered, on screen and not
//     part of Luker's own UI (plus children of click-through layers)
//   - large panels are show / hide toggles, drawn with the panel's own first
//     img / svg when it has one
//   - known sources: names, detached companions (e.g. the desk pet's notice
//     bubble) and an open action for sources with no floating button
// Settings live in extensionSettings.float_wheel.

const SETTINGS_KEY = 'float_wheel';
const LAYER_CLASS = 'fwheel';
const STYLE_ID = 'fwheel-hide-rules';
const LIFT_ATTR = 'data-fwheel-lifted';
const HIDE_ATTR = 'data-fwheel-hide';
const OPEN_ATTR = 'data-fwheel-open';

// A button that grows into its own panel after a tap (same element) must stay visible while open.
const baseSize = new WeakMap();
const sizeWatch = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    for (const { target } of entries) syncOpen(target);
}) : null;

function syncOpen(node) {
    const base = baseSize.get(node);
    if (!base || !node.isConnected) return;
    const big = r => r.width > base.w * 1.4 + 8 || r.height > base.h * 1.4 + 8;
    let grown = big(node.getBoundingClientRect());
    // A panel the button opens *inside itself* (positioned child) inherits our visibility rule too.
    if (!grown && node.childElementCount) {
        let n = 0;
        for (const d of node.querySelectorAll('*')) {
            if (++n > 240) break;
            const r = d.getBoundingClientRect();
            if (r.width * r.height > 0 && big(r)) { grown = true; break; }
        }
    }
    node.toggleAttribute(OPEN_ATTR, grown);
}

function watchSize(node, rect) {
    if (baseSize.has(node)) return;
    baseSize.set(node, { w: rect.width, h: rect.height });
    sizeWatch?.observe(node);
}
const SCAN_MS = 1800;
const NOTICE_ATTR = 'data-fwheel-notice';
const AWAY_ATTR = 'data-fwheel-away';
// An element that first shows up this soon after a click / key press is a popup, not a resident button.
const SPAWN_MS = 4000;
let lastInput = 0;
const POPUP_ROLES = '[role="menu"],[role="listbox"],[role="tooltip"],[role="dialog"],[role="alertdialog"],[role="alert"],[role="status"],[aria-live]';
const PIN_PROPS = ['left', 'top', 'right', 'bottom'];
const KEEP_PROPS = [...PIN_PROPS, 'transition'];

// ---------------------------------------------------------------------------
// Luker's own fixed UI (checked against public/index.html, style.css, css/*)
// ---------------------------------------------------------------------------
const NATIVE = [
    '.fwheel', '.fwheel-mark',
    '#preloader', '#bg1', '#bg_custom', '#character_context_menu', '#immersiveExitButton',
    '#top-bar', '#top-settings-holder', '#sheld', '#form_sheld', '#left-nav-panel', '#right-nav-panel',
    '#options', '#extensionsMenu', '#secrets_datalists', '#toast-container', '#nav-toggle', '#bg_menu',
    '#floatingPrompt', '#cfgConfig', '#logprobsViewer', '#debug-recording-indicator',
    '#card-app-menu-btn', '#expression-wrapper', '#visual-novel-wrapper', '.zoomed_avatar',
    '.drawer-content', 'dialog', '.popup', '[aria-modal="true"]', '.activity-pill-host', '.streaming-display',
    '.model_metadata_tap_hint', '.world_bulk_field_menu', '.ctx-blocker', '.ctx-menu', '.list-group',
    '.select2-container', '.select2-dropdown', '.ui-widget-overlay', '.ui-autocomplete', '.ui-front',
    '.autoComplete-wrap', '.autoComplete', '.tooltip', '.fillRight',
    '.luker_iter_diff_zoom_overlay', '.cea_line_diff_zoom_overlay',
].join(',');

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'VIDEO', 'AUDIO', 'CANVAS', 'svg', 'SVG', 'BR']);
// Classes many extensions borrow from Luker / Font Awesome: never a key on their own.
const SHARED_CLASS = /^(fa|fa-.*|fas|far|fab|menu_button.*|interactable|list-group-item|flex-container|flex1|flexGap\d*|wide100p|margin0|drag-grabber|draggable|ui-.*|mes_.*|inline-drawer.*|displayNone|hoverglow|opacity\d+p?)$/;
const STATE_CLASS = /^(is-|has-)|^(active|visible|show|shown|open|opened|hidden|hide|closed|dragging|drag|hover|focus|selected|collapsed|expanded|mini|mobile|desktop|touch|ready|loading|loaded|animating|enter|leave)$/i;

// ---------------------------------------------------------------------------
// Icons (only for things that have no floating element of their own)
// ---------------------------------------------------------------------------
const ICONS = {
    orb: '<rect x="5" y="5" width="5.5" height="5.5" rx="1.6"/><rect x="13.5" y="5" width="5.5" height="5.5" rx="1.6"/><rect x="5" y="13.5" width="5.5" height="5.5" rx="1.6"/><circle cx="16.25" cy="16.25" r="2.9"/>',
    close: '<path d="M7 7l10 10M17 7L7 17"/>',
    gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    dot: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2"/>',
    panel: '<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M4 9.5h16"/>',
    db: '<ellipse cx="12" cy="6.5" rx="6.5" ry="2.5"/><path d="M5.5 6.5v11c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-11"/><path d="M5.5 12c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5"/>',
    moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/><path d="M16.5 4v3M15 5.5h3"/>',
    shirt: '<path d="M9 4l-5 3 2 4 2-1v10h8V10l2 1 2-4-5-3c-.4 1.4-1.6 2.3-3 2.3S9.4 5.4 9 4z"/>',
    phone: '<rect x="7" y="3.5" width="10" height="17" rx="2.5"/><path d="M11 17.5h2"/>',
    graph: '<circle cx="6.5" cy="7" r="2.2"/><circle cx="17.5" cy="6" r="2.2"/><circle cx="12" cy="17.5" r="2.2"/><path d="M8.6 7.6l6.8-1.1M7.6 9l3.4 6.5M16.6 8l-3.6 7.6"/>',
    orch: '<path d="M4 18c3-8 5-11 8-11s5 3 8 11"/><path d="M12 7V3.5"/><circle cx="12" cy="3.5" r=".6"/>',
    list: '<path d="M9 7h11M9 12h11M9 17h11"/><path d="M4.5 7l1 1 1.8-2M4.5 12l1 1 1.8-2"/><circle cx="5.6" cy="17" r=".8"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>',
    brush: '<path d="M14.5 4.5l5 5-7.5 7.5-5-5z"/><path d="M7 12l-2.2 2.2c-1 1-1 2.6 0 3.6l-.8 2.2 2.2-.8c1 1 2.6 1 3.6 0L12 17"/>',
};

function svg(name, size = 18) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.dot}</svg>`;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
const q = (sel, root = document) => { try { return root.querySelector(sel); } catch { return null; } };
const qa = (sel, root = document) => { try { return [...root.querySelectorAll(sel)]; } catch { return []; } };
const matches = (node, sel) => { try { return node.matches(sel); } catch { return false; } };
const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

function el(tag, cls, attrs = {}) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v === true ? '' : String(v));
    }
    return node;
}

function shown(target) {
    const node = typeof target === 'string' ? q(target) : target;
    if (!node || !node.isConnected || node.hidden) return false;
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
}

/** Can this element be put into the ring? Rendered and laid out; our own visibility hiding is fine. */
function liftable(node) {
    if (!(node instanceof Element) || !node.isConnected || node.hidden) return false;
    if (node.style.visibility === 'hidden' || node.style.display === 'none') return false;
    if (getComputedStyle(node).display === 'none') return false;
    const r = node.getBoundingClientRect();
    return r.width >= 8 && r.height >= 8;
}

function clickButtonByText(root, text) {
    if (!root) return false;
    const btn = [...root.querySelectorAll('button, [role="button"]')].find(b => (b.textContent || '').trim() === text);
    if (btn) { btn.click(); return true; }
    return false;
}

/** A small copy of an element's own first image / svg / font icon, for panel toggles and the manager. */
function glyphOf(node, size = 20) {
    if (!(node instanceof Element)) return null;
    const src = matches(node, 'img, svg') ? node : q('img, svg, i[class*="fa-"]', node);
    if (!src) return null;
    if (src.tagName === 'IMG') {
        const url = src.currentSrc || src.src;
        if (!url) return null;
        const img = el('img', 'fwheel-glyph', { src: url, alt: '', draggable: 'false' });
        img.width = img.height = size;
        return img;
    }
    if (src.tagName.toLowerCase() === 'svg') {
        const copy = src.cloneNode(true);
        copy.setAttribute('width', String(size));
        copy.setAttribute('height', String(size));
        if (!copy.getAttribute('viewBox')) {
            const w = parseFloat(src.getAttribute('width')) || src.getBoundingClientRect().width || 24;
            const h = parseFloat(src.getAttribute('height')) || src.getBoundingClientRect().height || 24;
            copy.setAttribute('viewBox', `0 0 ${w} ${h}`);
        }
        copy.removeAttribute('style');
        copy.classList.add('fwheel-glyph');
        copy.setAttribute('aria-hidden', 'true');
        return copy;
    }
    const i = el('i', `${[...src.classList].filter(c => /^fa/.test(c)).join(' ')} fwheel-glyph`, { 'aria-hidden': 'true' });
    i.style.fontSize = `${Math.round(size * 0.8)}px`;
    return i;
}

// ---------------------------------------------------------------------------
// Known sources
// ---------------------------------------------------------------------------
/**
 * key / name / icon; find() → truthy when installed; float() → its floating
 * button (moved into the ring as itself); companions: separately positioned
 * elements that belong to the button (moved along); hide: hidden while
 * collected; ignore: never listed on their own; active() → its window is
 * open; run() is used only when there is no floating button to show.
 */
const SPECS = [
    {
        key: 'acu-desk-pet', name: '数据库', icon: 'db',
        hide: ['.acu-desk-pet'],
        companions: [],
        notices: ['.acu-notice-bubble'],
        signal: () => (qa('.acu-notice-bubble').some(liftable) ? { n: null } : null),
        showWhileActive: true,
        ignore: ['.acu-notice-bubble', '.acu-desk-pet-menu', '.acu-desk-pet-layer', '.acu-v2-app__shell', '.acu-v2-drawer-layer', '.acu-dialog-layer', '.acu-v2-app__mobile-nav-layer'],
        find: () => q('.acu-desk-pet'),
        float: () => q('.acu-desk-pet'),
        active: () => shown('.acu-desk-pet-menu'),
        run() {},
    },
    {
        key: 'story-oracle', name: '故事神谕', icon: 'moon',
        hide: [], companions: [],
        ignore: ['#so-window'],
        find: () => q('#so-window'),
        float: () => null,
        active: () => shown('#so-window'),
        run() {
            if (shown('#so-window')) { q('#so-close-btn')?.click(); return; }
            (q('#so-chatbar-button') || q('#so-wand-button'))?.click();
        },
    },
    {
        key: 'ocw', name: '情趣服装', icon: 'shirt',
        hide: ['#ocw-root.ocw-mini'], companions: [],
        ignore: ['#ocw-root', '#ocw-mask'],
        find: () => q('#ocw-root'),
        float: () => q('#ocw-root.ocw-mini'),
        active: () => { const r = q('#ocw-root'); return !!r && !r.classList.contains('ocw-mini'); },
        run() { clickButtonByText(q('#ocw-root'), '收起'); },
    },
    {
        key: 'yuzi-phone', name: '玉子手机', icon: 'phone',
        hide: ['#yuzi-phone-toggle'], companions: [],
        ignore: ['#yuzi-phone-root', '#yuzi-phone-standalone', '.yuzi-phone-standalone', '.phone-toast', '.phone-modal-overlay-fixed'],
        find: () => q('#yuzi-phone-toggle') || q('#yuzi-phone-standalone'),
        float: () => q('#yuzi-phone-toggle'),
        active: () => !!q('#yuzi-phone-standalone')?.classList.contains('visible'),
        run() { q('#yuzi-phone-standalone')?.classList.toggle('visible'); },
    },
    {
        key: 'st-chatu8', name: '智绘姬', icon: 'brush',
        hide: ['#st-chatu8-fab'], companions: [],
        ignore: ['.st-chatu8-popup-bubble', '.st-chatu8-click-trigger-bubble', '.st-chatu8-ai-dialog'],
        find: () => q('#st-chatu8-fab'),
        float: () => q('#st-chatu8-fab'),
        active: () => false,
        run() { globalThis.showChatuSettingsPanel?.(); },
    },
    {
        key: 'memory-lens', name: '记忆透镜', icon: 'graph',
        hide: [], companions: [],
        ignore: ['.mlens'],
        find: () => globalThis.MemoryLens,
        float: () => null,
        active: () => shown('.mlens'),
        run() { shown('.mlens') ? globalThis.MemoryLens?.close?.() : globalThis.MemoryLens?.open?.(); },
    },
    {
        key: 'orchestra-lens', name: '编排透镜', icon: 'orch',
        hide: [], companions: [],
        ignore: ['.olens.ol-lens', '.olens .ol-menu'],
        find: () => globalThis.OrchestraLens,
        float: () => null,
        active: () => shown('.olens.ol-lens'),
        run() { shown('.olens.ol-lens') ? globalThis.OrchestraLens?.close?.() : globalThis.OrchestraLens?.open?.(); },
    },
    {
        key: 'orchestra-dock', name: '运行面板', icon: 'list',
        hide: ['.olens.ol-dock-pill'], companions: [],
        ignore: ['.olens.ol-dock', '.olens.ol-dock-scrim'],
        find: () => globalThis.OrchestraLens?.toggleDock && q('.olens.ol-dock'),
        float: () => q('.olens.ol-dock-pill'),
        active: () => q('.olens.ol-dock')?.dataset?.state === 'open',
        run() { globalThis.OrchestraLens?.toggleDock?.(); },
    },
    {
        key: 'workbench', name: '工作台', icon: 'grid',
        hide: ['.wbench .wb-pill'], companions: [],
        ignore: ['.wbench .wb-win', '.wbench .wb-scrim', '.wbench .wb-toast'],
        find: () => globalThis.LukerWorkbench,
        float: () => q('.wbench .wb-pill'),
        signal() {
            const pill = q('.wbench .wb-pill');
            if (!pill || pill.hidden) return null;
            const m = (q('.wb-pill-todo', pill)?.textContent || '').match(/\d+/);
            if (m && Number(m[0]) > 0) return { n: Number(m[0]) };
            return /待处理/.test(pill.textContent || '') ? { n: null } : null;
        },
        active: () => { const w = q('.wbench .wb-win'); return !!w && !w.hidden; },
        run() { globalThis.LukerWorkbench?.toggle?.(); },
    },
];

/** Names for floats we know but treat generically. */
const ALIASES = [
    { sel: '#so-plan-float', name: '神谕·计划' },
    { sel: '#so-live', name: '神谕·实时' },
];

const SPEC_HIDE = SPECS.flatMap(s => s.hide).join(',');
const SPEC_IGNORE = SPECS.flatMap(s => s.ignore).join(',');

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function ctx() {
    try { return globalThis.Luker?.getContext?.() || globalThis.SillyTavern?.getContext?.() || null; } catch { return null; }
}

let fallbackStore = null;
function settings() {
    const c = ctx();
    const bag = c?.extensionSettings;
    if (bag) {
        if (!bag[SETTINGS_KEY] || typeof bag[SETTINGS_KEY] !== 'object') bag[SETTINGS_KEY] = {};
        const s = bag[SETTINGS_KEY];
        if (!s.items || typeof s.items !== 'object') s.items = {};
        if (!s.orb || typeof s.orb !== 'object') s.orb = {};
        return s;
    }
    if (!fallbackStore) {
        try { fallbackStore = JSON.parse(localStorage.getItem('floatWheel.v1') || '{}'); } catch { fallbackStore = {}; }
        fallbackStore.items ||= {};
        fallbackStore.orb ||= {};
    }
    return fallbackStore;
}

function save() {
    const c = ctx();
    if (c?.extensionSettings) (c.saveSettingsDebounced || c.saveSettings)?.();
    else try { localStorage.setItem('floatWheel.v1', JSON.stringify(fallbackStore || {})); } catch { /* optional */ }
}

const itemPref = key => settings().items[key] || null;

function setItemPref(key, patch) {
    const items = settings().items;
    items[key] = { ...(items[key] || {}), ...patch };
    save();
}

function isOn(key, kind) {
    const p = itemPref(key);
    if (p && typeof p.on === 'boolean') return p.on;
    if (kind === 'panel') return false;
    return !p?.spawned;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
function cssKey(node) {
    if (node.id && node.id.length < 64 && !/\d{5,}/.test(node.id)) return `#${CSS.escape(node.id)}`;
    const classes = [...node.classList]
        .filter(c => c && c.length < 40 && !STATE_CLASS.test(c) && !SHARED_CLASS.test(c) && !/\d{4,}/.test(c) && !c.startsWith('fwheel') && !/^(data-v-|v-|svelte-|css-|sc-)/.test(c))
        .slice(0, 2);
    if (!classes.length) return '';
    return `${node.tagName.toLowerCase()}${classes.map(c => `.${CSS.escape(c)}`).join('')}`;
}

function humanName(node, key) {
    const alias = ALIASES.find(a => matches(node, a.sel));
    if (alias) return alias.name;
    const label = (node.getAttribute('aria-label') || node.getAttribute('title') || '').trim();
    if (label && label.length <= 16) return label;
    return key.replace(/^#/, '').replace(/^[a-z]+\./, '').replace(/\\/g, '').replace(/\./g, ' ');
}

let hideList = [];
function hiddenByUs(node) {
    return node.hasAttribute(HIDE_ATTR) || hideList.some(s => matches(node, s));
}

/** @returns {{ kind: 'skip'|'layer'|'float', rect?: DOMRect }} */
function hasLiveChild(node) {
    for (const c of node.querySelectorAll('*')) {
        if (getComputedStyle(c).pointerEvents !== 'none') return true;
    }
    return false;
}

function classify(node, cs, fixed) {
    const r = node.getBoundingClientRect();
    const vwArea = innerWidth * innerHeight;
    const area = r.width * r.height;
    const ours = hiddenByUs(node) || node.hasAttribute(LIFT_ATTR);
    const passThrough = cs.pointerEvents === 'none' && !ours;
    if (fixed && ((passThrough && area >= vwArea * 0.5) || area < 4)) return { kind: 'layer' };
    if (area >= vwArea * 0.85) return { kind: 'skip' };
    if (r.width < 12 || r.height < 12) return { kind: 'skip' };
    if (!node.hasAttribute(LIFT_ATTR) && (r.right < 4 || r.bottom < 4 || r.left > innerWidth - 4 || r.top > innerHeight - 4)) return { kind: 'skip' };
    if (cs.visibility === 'hidden' && !ours) return { kind: 'skip' };
    if (Number(cs.opacity) < 0.05) return { kind: 'skip' };
    if (passThrough) return hasLiveChild(node) ? { kind: 'float', rect: r } : { kind: 'skip' };
    return { kind: 'float', rect: r };
}

const excluded = node => matches(node, NATIVE) || (SPEC_IGNORE && matches(node, SPEC_IGNORE));

/** Fixed, rendered, not-native elements (and children of click-through layers). */
function discover() {
    const out = [];
    const visit = (node, depth, inLayer) => {
        for (const child of node.children) {
            if (SKIP_TAGS.has(child.tagName) || excluded(child)) continue;
            const cs = getComputedStyle(child);
            if (cs.display === 'none') continue;
            const fixed = cs.position === 'fixed';
            if (fixed || (inLayer && (cs.position === 'absolute' || cs.position === 'sticky'))) {
                const c = classify(child, cs, fixed);
                if (c.kind === 'layer') { if (depth < 6) visit(child, depth + 1, true); continue; }
                if (c.kind === 'float') out.push({ node: child, rect: c.rect });
                continue;
            }
            if (depth < 4 && child.childElementCount && child.childElementCount < 120) visit(child, depth + 1, inLayer);
        }
    };
    visit(document.body, 0, false);
    for (const child of document.documentElement.children) {
        if (child === document.body || child === document.head) continue;
        visit({ children: [child] }, 1, false);
    }
    return out;
}

let model = { specs: [], generic: [] };
const seen = new Map(); // generic key → { gone }

function rescan() {
    const specs = [];
    for (const spec of SPECS) {
        let found = null;
        try { found = spec.find(); } catch { /* ignore */ }
        if (found) specs.push({ spec });
    }
    const generic = [];
    const keys = new Set();
    for (const { node, rect } of discover()) {
        if (SPEC_HIDE && matches(node, SPEC_HIDE)) continue;
        if (matches(node, POPUP_ROLES)) continue;
        const key = cssKey(node);
        if (!key || keys.has(key)) continue;
        keys.add(key);
        const lift = lifted.get(node);
        const w = lift ? lift.size.w : rect.width;
        const h = lift ? lift.size.h : rect.height;
        const small = Math.max(w, h) <= 96 && w * h <= 96 * 96;
        const exact = qa(key).length === 1;
        generic.push({ key, node, exact, kind: small ? 'button' : 'panel', name: humanName(node, key) });
        if (!itemPref(key)?.kind) setItemPref(key, { kind: small ? 'button' : 'panel', spawned: Date.now() - lastInput < SPAWN_MS });
        if (small) watchSize(node, lift ? { width: lift.size.w, height: lift.size.h } : rect);
    }
    // A panel that was hidden through the ring and then reopened by its owner comes back un-hidden.
    for (const [key, rec] of seen) if (!keys.has(key)) rec.gone = true;
    for (const g of generic) {
        const rec = seen.get(g.key);
        if (rec?.gone && g.kind === 'panel' && itemPref(g.key)?.hidden) setItemPref(g.key, { hidden: false });
        seen.set(g.key, { gone: false });
    }
    model = { specs, generic };
    for (const { spec } of specs) {
        let f = null;
        try { f = spec.float(); } catch { /* ignore */ }
        if (f && !baseSize.has(f) && liftable(f)) watchSize(f, f.getBoundingClientRect());
        if (f && !lifted.has(f)) syncOpen(f);
    }
    for (const g of generic) if (g.kind === 'button' && !lifted.has(g.node)) syncOpen(g.node);
    applyHideRules();
    dockNotices();
    paintDot();
    if (wheelOpen) {
        if (wheelSig() !== paintedSig) paintWheel(false);
        else refreshActive();
    }
    if (managerOpen && managerSig() !== paintedManager) paintManager();
}

// ---------------------------------------------------------------------------
// Hide stylesheet (visibility only; an element in the ring is exempt)
// ---------------------------------------------------------------------------
let marked = new Set();
function applyHideRules() {
    const sels = [];
    for (const { spec } of model.specs) {
        if (!isOn(spec.key, 'spec')) continue;
        if (spec.showWhileActive) { try { if (spec.active()) continue; } catch { /* ignore */ } }
        sels.push(...spec.hide);
    }
    if (!model.specs.length) for (const spec of SPECS) if (isOn(spec.key, 'spec')) sels.push(...spec.hide);
    const live = new Set();
    const toMark = new Set();
    for (const g of model.generic) {
        live.add(g.key);
        if (!isOn(g.key, g.kind)) continue;
        if (!(g.kind === 'button' || itemPref(g.key)?.hidden)) continue;
        // A key matching more than this one element is not safe as a page-wide rule.
        if (g.exact) sels.push(g.key);
        else toMark.add(g.node);
    }
    for (const [key, p] of Object.entries(settings().items)) {
        if (!key || live.has(key) || !key.startsWith('#') || SPECS.some(s => s.key === key) || p?.on === false) continue;
        if ((p?.kind === 'button' && (p?.on === true || !p?.spawned)) || (p?.on && p?.hidden)) sels.push(key);
    }
    for (const node of marked) if (!toMark.has(node)) node.removeAttribute(HIDE_ATTR);
    for (const node of toMark) node.setAttribute(HIDE_ATTR, '');
    marked = toMark;
    hideList = sels.filter(s => { try { document.querySelector(s); return true; } catch { return false; } });
    writeHideCss(hideList);
}

function writeHideCss(list) {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
        style = el('style', '', { id: STYLE_ID });
        (document.head || document.documentElement).appendChild(style);
    }
    const not = `:not([${LIFT_ATTR}]):not([${OPEN_ATTR}])`;
    const css = [`[${HIDE_ATTR}]`, ...list]
        .map(s => `${s}${not}, ${s}${not} * { visibility: hidden !important; pointer-events: none !important; }`)
        .join('\n')
        + `\n[${AWAY_ATTR}], [${AWAY_ATTR}] * { visibility: hidden !important; pointer-events: none !important; }`;
    if (style.textContent !== css) style.textContent = css;
}

// ---------------------------------------------------------------------------
// Lifting: put an original element onto a ring slot, and back
// ---------------------------------------------------------------------------
/** node → { latest, ours, tf, target, size, owner, companions, obs, cleanup } */
const lifted = new Map();

const readInline = (node, p) => ({ v: node.style.getPropertyValue(p), p: node.style.getPropertyPriority(p) });
function writeInline(node, p, val) {
    if (val && val.v) node.style.setProperty(p, val.v, val.p || '');
    else node.style.removeProperty(p);
}

/**
 * Move `node` so its centre sits on rec.target (client px). The owner's own
 * values are put back first so the measurement is of where *it* wants the
 * element; then left/top are set relative to that, right/bottom released.
 */
function pin(node, rec) {
    if (!node.isConnected) return;
    // Our fly-out animation would skew the measurement: jump it to its end first.
    try { node.getAnimations?.().forEach(a => { if (a.id === 'fwheel') a.finish(); }); } catch { /* optional */ }
    for (const p of PIN_PROPS) writeInline(node, p, rec.latest[p]);
    node.style.setProperty('transition', 'none', 'important');
    const base = node.getBoundingClientRect();
    const cs = getComputedStyle(node);
    let left = parseFloat(cs.left);
    let top = parseFloat(cs.top);
    if (!Number.isFinite(left)) left = base.left;
    if (!Number.isFinite(top)) top = base.top;
    let target = rec.target;
    if (rec.owner) {
        const o = rec.owner;
        target = { x: base.left + base.width / 2 + (o.target.x - o.baseCenter.x), y: base.top + base.height / 2 + (o.target.y - o.baseCenter.y) };
    } else {
        rec.baseCenter = { x: base.left + base.width / 2, y: base.top + base.height / 2 };
    }
    let x = left + (target.x - (base.left + base.width / 2));
    let y = top + (target.y - (base.top + base.height / 2));
    node.style.setProperty('right', 'auto', 'important');
    node.style.setProperty('bottom', 'auto', 'important');
    for (let pass = 0; pass < 3; pass++) {
        node.style.setProperty('left', `${Math.round(x * 10) / 10}px`, 'important');
        node.style.setProperty('top', `${Math.round(y * 10) / 10}px`, 'important');
        const r = node.getBoundingClientRect();
        const ex = target.x - (r.left + r.width / 2);
        const ey = target.y - (r.top + r.height / 2);
        if (Math.abs(ex) < 1 && Math.abs(ey) < 1) break;
        x += ex;
        y += ey;
    }
    writeInline(node, 'transition', rec.latest.transition);
    rec.ours = Object.fromEntries(KEEP_PROPS.map(p => [p, readInline(node, p)]));
    rec.tf = node.style.transform;
}

function sameInline(a, b) { return a.v === b.v && a.p === b.p; }

/** The owner wrote to the element's style while it is in the ring: remember its values, re-pin. */
function onStyleWrite(node) {
    const rec = lifted.get(node);
    if (!rec || !rec.ours) return;
    let changed = false;
    for (const p of KEEP_PROPS) {
        const cur = readInline(node, p);
        if (!sameInline(cur, rec.ours[p])) { rec.latest[p] = cur; changed = true; }
    }
    if (node.style.transform !== rec.tf) { rec.tf = node.style.transform; changed = true; }
    if (!changed) return;
    // Observer callbacks run before the next paint, so re-pinning here never shows the plugin's own position.
    pin(node, rec);
    for (const c of rec.companions || []) { const cr = lifted.get(c); if (cr) pin(c, cr); }
}

function lift(node, target, owner = null) {
    let rec = lifted.get(node);
    if (!rec) {
        const r = node.getBoundingClientRect();
        rec = {
            latest: Object.fromEntries(['transform', 'visibility', ...KEEP_PROPS].map(p => [p, readInline(node, p)])),
            ours: null, tf: node.style.transform, target, owner, companions: [],
            size: { w: r.width, h: r.height },
        };
        watchSize(node, r);
        lifted.set(node, rec);
        node.setAttribute(LIFT_ATTR, '');
        rec.obs = new MutationObserver(() => onStyleWrite(node));
        rec.obs.observe(node, { attributes: true, attributeFilter: ['style'] });
    }
    rec.target = target;
    pin(node, rec);
    return rec;
}

function drop(node) {
    const rec = lifted.get(node);
    if (!rec) return;
    lifted.delete(node);
    rec.obs?.disconnect();
    rec.cleanup?.();
    try { node.getAnimations?.().forEach(a => { if (a.id === 'fwheel') a.cancel(); }); } catch { /* optional */ }
    node.removeAttribute(LIFT_ATTR);
    if (!node.isConnected) return;
    syncOpen(node);
    node.style.setProperty('transition', 'none', 'important');
    for (const p of PIN_PROPS) writeInline(node, p, rec.latest[p]);
    void node.offsetWidth;
    writeInline(node, 'transition', rec.latest.transition);
}

function dropAll() {
    for (const [node, rec] of [...lifted]) if (!rec.notice) drop(node);
}

/** Fly out from the orb: a temporary `translate` animation (composes with the element's own transform). */
function flyFrom(node, from, to, delay) {
    if (reducedMotion() || typeof node.animate !== 'function') return;
    try {
        const a = node.animate([
            { translate: `${Math.round(from.x - to.x)}px ${Math.round(from.y - to.y)}px`, opacity: 0, offset: 0 },
            { opacity: 1, offset: 0.6 },
            { translate: '0px 0px', offset: 1 },
        ], { duration: 240, delay, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' });
        a.id = 'fwheel';
    } catch { /* old browser: no animation */ }
}

// ---------------------------------------------------------------------------
// Notices: a collected source's own notice element, docked beside the orb
// ---------------------------------------------------------------------------
const NOTICE_SEL = SPECS.flatMap(s => s.notices || []).join(',');

function noticeNodes() {
    const out = [];
    for (const spec of SPECS) {
        if (!spec.notices?.length || !isOn(spec.key, 'spec')) continue;
        for (const sel of spec.notices) for (const n of qa(sel)) if (liftable(n) && !out.includes(n)) out.push(n);
    }
    return out;
}

/** Stack the notices next to the orb, toward the inside of the screen; hidden while the ring / list is open. */
function dockNotices() {
    if (!layer) return;
    const want = noticeNodes();
    for (const [n, rec] of [...lifted]) {
        if (rec.notice && !want.includes(n)) { n.removeAttribute(NOTICE_ATTR); n.removeAttribute(AWAY_ATTR); drop(n); }
    }
    if (!want.length) return;
    const away = wheelOpen || managerOpen;
    const c = orbCenter();
    const half = orbSize() / 2;
    const gap = 10;
    const m = 8;
    const vw = innerWidth;
    const vh = innerHeight;
    const boxes = want.map((n) => {
        const rec = lifted.get(n);
        const r = n.getBoundingClientRect();
        return { n, w: rec?.notice ? r.width : r.width, h: r.height };
    });
    const right = c.x > vw / 2;
    const room = right ? c.x - half - gap - m : vw - c.x - half - gap - m;
    const side = Math.max(...boxes.map(b => b.w)) <= room;
    const total = boxes.reduce((a, b) => a + b.h, 0) + gap * (boxes.length - 1);
    const below = c.y < vh / 2;
    let y = side
        ? Math.min(Math.max(m, c.y - total / 2), vh - m - total)
        : below ? c.y + half + gap : c.y - half - gap - total;
    y = Math.min(Math.max(m, y), Math.max(m, vh - m - total));
    for (const b of boxes) {
        let x = side ? (right ? c.x - half - gap - b.w / 2 : c.x + half + gap + b.w / 2) : (right ? c.x + half - b.w / 2 : c.x - half + b.w / 2);
        x = Math.min(Math.max(m + b.w / 2, x), vw - m - b.w / 2);
        const rec = lift(b.n, { x, y: y + b.h / 2 });
        rec.notice = true;
        b.n.setAttribute(NOTICE_ATTR, '');
        b.n.toggleAttribute(AWAY_ATTR, away);
        y += b.h + gap;
    }
}

// ---------------------------------------------------------------------------
// Orb dot: something collected wants attention (badge number, pending, notice)
// ---------------------------------------------------------------------------
let dot = null;
let seenSig = '';
let currentSig = '';

/** A small numeric / dot badge inside a button (its own child, read only). */
function badgeIn(node) {
    if (!(node instanceof Element)) return null;
    const cands = qa('[class*="badge" i], [class*="unread" i], [class*="notif" i], [class*="count" i], [id*="badge" i]', node);
    for (const c of cands) {
        const cs = getComputedStyle(c);
        if (cs.display === 'none' || Number(cs.opacity) === 0) continue;
        const r = c.getBoundingClientRect();
        if (r.width < 3 || r.height < 3 || r.width > 44 || r.height > 32) continue;
        const t = (c.textContent || '').trim();
        if (/^\d{1,4}\+?$/.test(t)) { const n = parseInt(t, 10); if (n > 0) return { n }; continue; }
        if (!t && /badge|unread|notif|dot/i.test(c.getAttribute('class') || '')) return { n: null };
    }
    return null;
}

function signals() {
    const list = [];
    for (const { spec } of model.specs) {
        if (!isOn(spec.key, 'spec')) continue;
        let s = null;
        try {
            s = spec.signal?.() || null;
            if (!s) { const f = spec.float(); if (f && !f.hasAttribute(OPEN_ATTR)) s = badgeIn(f); }
        } catch { /* ignore */ }
        if (s) list.push({ key: spec.key, n: s.n });
    }
    for (const g of model.generic) {
        if (g.kind !== 'button' || !isOn(g.key, g.kind)) continue;
        const s = badgeIn(g.node);
        if (s) list.push({ key: g.key, n: s.n });
    }
    return list;
}

function paintDot() {
    if (!dot) return;
    const list = signals();
    currentSig = list.map(s => `${s.key}:${s.n ?? '*'}`).join('|');
    if (!list.length) seenSig = '';
    if (wheelOpen) seenSig = currentSig;
    const show = !!list.length && currentSig !== seenSig;
    const total = list.reduce((a, s) => a + (s.n || 0), 0);
    dot.hidden = !show;
    dot.textContent = show && total > 0 ? (total > 99 ? '99+' : String(total)) : '';
    dot.classList.toggle('is-num', show && total > 0);
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
let layer, orb, ring, caption, manager, mark;
let wheelOpen = false;
let managerOpen = false;
let paintedSig = '';
let paintedManager = '';
let slots = []; // [{ entry, x, y (client), node }]

const coarse = () => innerWidth < 768 || !!globalThis.matchMedia?.('(pointer: coarse)')?.matches;
const itemSize = () => (coarse() ? 44 : 40);
const orbSize = () => (coarse() ? 46 : 42);
const orbSlot = () => (innerWidth < 768 ? 'mobile' : 'desktop');

let orbAt = { x: 0, y: 0 };
function defaultOrb() {
    const saved = settings().orb[orbSlot()];
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return clampOrb(saved.x * innerWidth, saved.y * innerHeight);
    return clampOrb(innerWidth - orbSize() - 14, Math.round(innerHeight * 0.62));
}

function clampOrb(x, y) {
    const s = orbSize();
    const m = 6;
    return { x: Math.min(Math.max(m, x), innerWidth - s - m), y: Math.min(Math.max(m, y), innerHeight - s - m) };
}

function placeOrb(p = defaultOrb()) {
    orbAt = p;
    orb.style.left = `${Math.round(p.x)}px`;
    orb.style.top = `${Math.round(p.y)}px`;
}

/** The orb's centre right now, in client px (measured, so it follows drags and zoom). */
function orbCenter() {
    const r = orb.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Client px → px inside our layer (equal unless an ancestor is zoomed / transformed). */
function toLayer(p) {
    const r = layer.getBoundingClientRect();
    const kx = layer.offsetWidth ? r.width / layer.offsetWidth : 1;
    const ky = layer.offsetHeight ? r.height / layer.offsetHeight : 1;
    return { x: (p.x - r.left) / (kx || 1), y: (p.y - r.top) / (ky || 1) };
}

/** What the ring holds, in order: original floating elements, then our toggles, then 管理. */
function wheelEntries() {
    const lifts = [];
    const icons = [];
    for (const { spec } of model.specs) {
        if (!isOn(spec.key, 'spec')) continue;
        let node = null;
        try { node = spec.float(); } catch { /* ignore */ }
        if (node && lifted.get(node)?.notice) node = null;
        if (node && liftable(node)) {
            lifts.push({ key: spec.key, name: spec.name, node, companions: spec.companions });
            continue;
        }
        let active = false;
        try { active = !!spec.active(); } catch { /* ignore */ }
        icons.push({ key: spec.key, name: spec.name, icon: svg(spec.icon, coarse() ? 20 : 18), active, toggle: true, run: () => spec.run() });
    }
    for (const g of model.generic) {
        if (!isOn(g.key, g.kind)) continue;
        if (g.kind === 'button') {
            if (liftable(g.node)) lifts.push({ key: g.key, name: g.name, node: g.node, companions: [] });
            continue;
        }
        const hidden = !!itemPref(g.key)?.hidden;
        icons.push({
            key: g.key, name: g.name, node: g.node, active: !hidden, toggle: true,
            run: () => { setItemPref(g.key, { hidden: !hidden }); applyHideRules(); },
        });
    }
    return [...lifts, ...icons, { key: '__manage', name: '管理', icon: svg('gear', coarse() ? 20 : 18), manage: true, run: () => openManager() }];
}

const sigOf = entries => entries.map(e => `${e.key}:${e.toggle || e.manage ? 'i' : 'l'}`).join('|');
const wheelSig = () => sigOf(wheelEntries());

function entrySize(e) {
    if (e.toggle || e.manage) return itemSize();
    const rec = lifted.get(e.node);
    const r = rec ? rec.size : e.node.getBoundingClientRect();
    return Math.max(r.width ?? r.w, r.height ?? r.h);
}

/**
 * Fan the items around the orb centre `c` (client px), facing the middle of
 * the screen, widening the radius until every item (own size) fits on screen.
 */
function layoutRing(sizes, c) {
    const n = sizes.length;
    const gap = 10;
    const m = 8;
    const vw = innerWidth;
    const vh = innerHeight;
    const fits = (p, s) => p.x - s / 2 >= m && p.x + s / 2 <= vw - m && p.y - s / 2 >= m && p.y + s / 2 <= vh - m;
    const dir = Math.atan2(vh / 2 - c.y, vw / 2 - c.x);
    const maxS = Math.max(...sizes);
    const rMin = orbSize() / 2 + maxS / 2 + 12;
    const rMax = Math.max(rMin, Math.hypot(vw, vh));
    const angleFor = (d, r) => 2 * Math.asin(Math.min(1, d / (2 * r)));
    for (let r = rMin; r <= rMax; r += 6) {
        const steps = [];
        for (let i = 0; i < n - 1; i++) steps.push(angleFor((sizes[i] + sizes[i + 1]) / 2 + gap, r));
        const span = steps.reduce((a, b) => a + b, 0);
        const closing = n > 1 ? angleFor((sizes[n - 1] + sizes[0]) / 2 + gap, r) : 0;
        if (span + closing > Math.PI * 2 + 1e-6) continue;
        const offsets = [0, 0.2, -0.2, 0.4, -0.4, 0.65, -0.65, 0.9, -0.9, 1.2, -1.2, 1.6, -1.6, 2.1, -2.1, Math.PI];
        for (const off of offsets) {
            let a = dir + off - span / 2;
            const pts = [];
            for (let i = 0; i < n; i++) {
                pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
                a += steps[i] || 0;
            }
            if (pts.every((p, i) => fits(p, sizes[i]))) return pts;
        }
    }
    // Nothing fits (a very large element on a small screen): best effort, clamped.
    const r = rMin + 20;
    let a = dir - Math.PI / 2;
    return sizes.map((s) => {
        const p = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
        a += angleFor(s + gap, r);
        return { x: Math.min(Math.max(m + s / 2, p.x), vw - m - s / 2), y: Math.min(Math.max(m + s / 2, p.y), vh - m - s / 2) };
    });
}

function ourButton(e) {
    const btn = el('button', `fwheel-item${e.active ? ' is-active' : ''}${e.manage ? ' is-manage' : ''}`, {
        type: 'button', 'aria-label': e.name, 'aria-pressed': e.toggle ? String(!!e.active) : null,
    });
    btn.dataset.key = e.key;
    const glyph = e.icon ? null : glyphOf(e.node, coarse() ? 22 : 20);
    if (glyph) btn.appendChild(glyph);
    else btn.innerHTML = e.icon || svg('panel', coarse() ? 20 : 18);
    btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        hideCaption();
        if (e.manage) { closeWheel(); e.run(); return; }
        try { e.run(); } catch (err) { console.warn('[float-wheel] toggle failed', e.key, err); }
        closeWheel();
        setTimeout(rescan, 400);
    });
    return btn;
}

function paintWheel(animate) {
    const entries = wheelEntries();
    paintedSig = sigOf(entries);
    const keep = new Set(entries.filter(e => !e.toggle && !e.manage).map(e => e.node));
    for (const node of [...lifted.keys()]) {
        const rec = lifted.get(node);
        if (rec.notice) continue;
        if (rec.owner ? !keep.has(rec.ownerNode) : !keep.has(node)) drop(node);
    }
    ring.replaceChildren();
    const c = orbCenter();
    const sizes = entries.map(entrySize);
    const pts = layoutRing(sizes, c);
    slots = [];
    entries.forEach((e, i) => {
        const p = pts[i];
        const delay = i * 16;
        if (e.toggle || e.manage) {
            const btn = ourButton(e);
            const lp = toLayer(p);
            btn.style.left = `${Math.round(lp.x)}px`;
            btn.style.top = `${Math.round(lp.y)}px`;
            ring.appendChild(btn);
            hoverName(btn, e.name, () => slotOf(btn));
            if (animate) flyFrom(btn, c, p, delay);
            slots.push({ entry: e, x: p.x, y: p.y, node: btn, ours: true });
            return;
        }
        const rec = lift(e.node, p);
        rec.cleanup ||= hoverName(e.node, e.name, () => slotOf(e.node));
        if (animate) flyFrom(e.node, c, p, delay);
        const comps = [];
        for (const sel of e.companions || []) {
            for (const cn of qa(sel)) {
                if (cn === e.node || !liftable(cn)) continue;
                const cr = lift(cn, p, rec);
                cr.ownerNode = e.node;
                comps.push(cn);
                if (animate) flyFrom(cn, c, p, delay);
            }
        }
        rec.companions = comps;
        slots.push({ entry: e, x: p.x, y: p.y, node: e.node });
    });
}

/** Re-lay the ring around the orb's current position, no animation (orb dragged / resize). */
function relayout() {
    if (!wheelOpen || !slots.length) return;
    const c = orbCenter();
    const sizes = slots.map(s => entrySize(s.entry));
    const pts = layoutRing(sizes, c);
    slots.forEach((s, i) => {
        s.x = pts[i].x;
        s.y = pts[i].y;
        if (s.ours) {
            const lp = toLayer(pts[i]);
            s.node.style.left = `${Math.round(lp.x)}px`;
            s.node.style.top = `${Math.round(lp.y)}px`;
            return;
        }
        const rec = lifted.get(s.node);
        if (!rec) return;
        rec.target = pts[i];
        pin(s.node, rec);
        for (const cn of rec.companions) { const cr = lifted.get(cn); if (cr) pin(cn, cr); }
    });
    hideCaption();
}

function refreshActive() {
    const now = wheelEntries();
    for (const s of slots) {
        if (!s.ours || !s.entry.toggle) continue;
        const e = now.find(x => x.key === s.entry.key);
        if (!e) continue;
        s.node.classList.toggle('is-active', !!e.active);
        s.node.setAttribute('aria-pressed', String(!!e.active));
    }
}

function slotOf(node) {
    return slots.find(s => s.node === node) || null;
}

/** Name tip on hover only. Returns a cleanup for listeners put on foreign elements. */
function hoverName(node, name, where) {
    const enter = (ev) => { if (ev.pointerType !== 'touch' && wheelOpen) { const s = where(); if (s) showCaption(name, s); } };
    const leave = () => hideCaption();
    node.addEventListener('pointerenter', enter);
    node.addEventListener('pointerleave', leave);
    return () => { node.removeEventListener('pointerenter', enter); node.removeEventListener('pointerleave', leave); };
}

function showCaption(text, slot) {
    caption.textContent = text;
    caption.hidden = false;
    const w = caption.offsetWidth;
    const h = caption.offsetHeight;
    const c = orbCenter();
    const size = entrySize(slot.entry);
    const dx = slot.x - c.x;
    const dy = slot.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    let x;
    let y;
    if (Math.abs(dy / len) > 0.5) { x = slot.x; y = slot.y + Math.sign(dy) * (size / 2 + 6 + h / 2); }
    else { x = slot.x + Math.sign(dx) * (size / 2 + 6 + w / 2); y = slot.y; }
    x = Math.min(Math.max(6 + w / 2, x), innerWidth - 6 - w / 2);
    y = Math.min(Math.max(6 + h / 2, y), innerHeight - 6 - h / 2);
    const lp = toLayer({ x: x - w / 2, y: y - h / 2 });
    caption.style.left = `${Math.round(lp.x)}px`;
    caption.style.top = `${Math.round(lp.y)}px`;
}

function hideCaption() { if (caption) caption.hidden = true; }

function openWheel() {
    rescan();
    wheelOpen = true;
    layer.classList.add('is-wheel');
    orb.setAttribute('aria-expanded', 'true');
    dockNotices();
    paintWheel(true);
    seenSig = currentSig;
    paintDot();
}

function closeWheel() {
    if (!wheelOpen) return;
    wheelOpen = false;
    hideCaption();
    dropAll();
    slots = [];
    paintedSig = '';
    layer.classList.remove('is-wheel');
    orb.setAttribute('aria-expanded', 'false');
    ring.replaceChildren();
    applyHideRules();
    dockNotices();
}

// ----- Manager: one switch per float -----
function manageRows() {
    const rows = [];
    for (const { spec } of model.specs) {
        let node = null;
        try { node = spec.float(); } catch { /* ignore */ }
        rows.push({ key: spec.key, name: spec.name, icon: spec.icon, kind: 'spec', node });
    }
    for (const g of model.generic) rows.push({ key: g.key, name: g.name, icon: g.kind === 'panel' ? 'panel' : 'dot', kind: g.kind, node: g.node });
    return rows;
}

const managerSig = () => manageRows().map(r => `${r.key}:${isOn(r.key, r.kind) ? 1 : 0}:${r.name}`).join('|');

function paintManager() {
    const list = manager.querySelector('.fwheel-list');
    const rows = manageRows();
    paintedManager = managerSig();
    list.replaceChildren();
    for (const r of rows) {
        const on = isOn(r.key, r.kind);
        const sw = el('button', 'fwheel-switch', { type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': r.name });
        sw.addEventListener('click', () => {
            const next = !isOn(r.key, r.kind);
            setItemPref(r.key, { on: next, ...(r.kind === 'panel' && !next ? { hidden: false } : {}) });
            applyHideRules();
            paintManager();
        });
        const icon = el('span', 'fwheel-row-icon');
        const glyph = glyphOf(r.node, 16);
        if (glyph) icon.appendChild(glyph);
        else icon.innerHTML = svg(r.icon, 16);
        const row = el('li', 'fwheel-row');
        row.append(icon, el('span', 'fwheel-row-name', { text: r.name, title: r.key }), sw);
        const lit = () => markTarget(r.node);
        row.addEventListener('pointerenter', lit);
        row.addEventListener('focusin', lit);
        row.addEventListener('pointerleave', unmark);
        row.addEventListener('focusout', unmark);
        list.appendChild(row);
    }
}

function openManager() {
    rescan();
    managerOpen = true;
    manager.hidden = false;
    paintManager();
    placeManager();
    dockNotices();
}

function closeManager() {
    managerOpen = false;
    manager.hidden = true;
    unmark();
    dockNotices();
}

function placeManager() {
    if (innerWidth < 600) {
        manager.classList.add('is-sheet');
        manager.style.left = manager.style.top = '';
        return;
    }
    manager.classList.remove('is-sheet');
    const c = toLayer(orbCenter());
    const w = manager.offsetWidth || 280;
    const h = manager.offsetHeight || 320;
    const gap = orbSize() / 2 + 12;
    let x = c.x > layer.offsetWidth / 2 ? c.x - gap - w : c.x + gap;
    let y = c.y - h / 2;
    x = Math.min(Math.max(8, x), layer.offsetWidth - w - 8);
    y = Math.min(Math.max(8, y), layer.offsetHeight - h - 8);
    manager.style.left = `${Math.round(x)}px`;
    manager.style.top = `${Math.round(y)}px`;
}

function markTarget(node) {
    if (!(node instanceof Element) || !node.isConnected) { unmark(); return; }
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) { unmark(); return; }
    Object.assign(mark.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    mark.hidden = false;
}

function unmark() { if (mark) mark.hidden = true; }

// ----- Orb: tap toggles the ring, drag moves it (the open ring follows) -----
function wireOrb() {
    let start = null;
    let moved = false;
    let frame = 0;
    orb.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        start = { x: ev.clientX, y: ev.clientY, left: orbAt.x, top: orbAt.y, id: ev.pointerId };
        moved = false;
        try { orb.setPointerCapture(ev.pointerId); } catch { /* optional */ }
    });
    orb.addEventListener('pointermove', (ev) => {
        if (!start || ev.pointerId !== start.id) return;
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 6) return;
        if (!moved) {
            moved = true;
            orb.classList.add('is-dragging');
            if (managerOpen) closeManager();
        }
        placeOrb(clampOrb(start.left + dx, start.top + dy));
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; wheelOpen ? relayout() : dockNotices(); });
        ev.preventDefault();
    });
    const end = (ev) => {
        if (!start || ev.pointerId !== start.id) return;
        try { orb.releasePointerCapture(ev.pointerId); } catch { /* optional */ }
        start = null;
        if (moved) {
            orb.classList.remove('is-dragging');
            settings().orb[orbSlot()] = { x: orbAt.x / innerWidth, y: orbAt.y / innerHeight };
            save();
            relayout();
            dockNotices();
        }
    };
    orb.addEventListener('pointerup', end);
    orb.addEventListener('pointercancel', end);
    orb.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (moved) { moved = false; return; }
        if (managerOpen) { closeManager(); return; }
        wheelOpen ? closeWheel() : openWheel();
    });
}

const inLifted = target => target instanceof Node && [...lifted.keys()].some(n => n.contains(target));

function build() {
    layer = el('div', LAYER_CLASS);
    ring = el('div', 'fwheel-ring', { role: 'menu', 'aria-label': '悬浮窗' });
    caption = el('div', 'fwheel-caption', { hidden: true, 'aria-hidden': 'true' });
    orb = el('button', 'fwheel-orb', { type: 'button', 'aria-label': '悬浮窗', title: '悬浮窗', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
    orb.innerHTML = `<span class="fwheel-orb-i is-a">${svg('orb', 20)}</span><span class="fwheel-orb-i is-b">${svg('close', 18)}</span>`;
    dot = el('span', 'fwheel-dot', { hidden: true, 'aria-hidden': 'true' });
    orb.appendChild(dot);
    manager = el('section', 'fwheel-manager', { hidden: true, role: 'dialog', 'aria-label': '悬浮窗' });
    const head = el('header', 'fwheel-head');
    const x = el('button', 'fwheel-x', { type: 'button', 'aria-label': '关闭', title: '关闭', html: svg('close', 15) });
    x.addEventListener('click', (ev) => { ev.stopPropagation(); closeManager(); });
    head.append(el('span', 'fwheel-title', { text: '悬浮窗' }), x);
    manager.append(head, el('ul', 'fwheel-list'));
    manager.addEventListener('click', ev => ev.stopPropagation());
    mark = el('div', 'fwheel-mark', { hidden: true, 'aria-hidden': 'true' });
    layer.append(ring, caption, manager, orb);
    document.body.append(layer, mark);
    placeOrb();
    wireOrb();

    // Taps on an element in the ring go to the element itself; afterwards the ring folds.
    let press = null;
    document.addEventListener('pointerdown', (ev) => {
        if (inLifted(ev.target)) { press = { x: ev.clientX, y: ev.clientY, id: ev.pointerId }; return; }
        press = null;
        if (layer.contains(ev.target)) return;
        if (wheelOpen) closeWheel();
        if (managerOpen) closeManager();
    }, true);
    document.addEventListener('pointerup', (ev) => {
        if (!press || ev.pointerId !== press.id) return;
        const tapped = Math.hypot(ev.clientX - press.x, ev.clientY - press.y) < 8;
        press = null;
        if (!tapped) return;
        setTimeout(() => { closeWheel(); setTimeout(rescan, 60); setTimeout(rescan, 450); setTimeout(rescan, 1100); }, 180);
    }, true);
    document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        if (managerOpen) { closeManager(); orb.focus(); }
        else if (wheelOpen) { closeWheel(); orb.focus(); }
    });
    let resizeTimer = 0;
    addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            placeOrb(clampOrb(orbAt.x, orbAt.y));
            relayout();
            if (managerOpen) placeManager();
            rescan();
        }, 120);
    });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
/** 0.3: forget auto-collected generic entries, so popups collected by earlier versions are re-judged. */
function migrate() {
    const s = settings();
    if (s.ver >= 3) return;
    for (const [key, p] of Object.entries(s.items)) {
        if (SPECS.some(x => x.key === key)) continue;
        if (typeof p?.on !== 'boolean') delete s.items[key];
    }
    s.ver = 3;
    save();
}

let booted = false;
function boot() {
    if (booted || !document.body) return;
    booted = true;
    migrate();
    build();
    const touch = () => { lastInput = Date.now(); };
    document.addEventListener('pointerdown', touch, true);
    document.addEventListener('keydown', touch, true);
    rescan();
    // A notice that appears is docked by the orb before it is ever painted at its owner's spot.
    if (NOTICE_SEL) {
        new MutationObserver((muts) => {
            for (const m of muts) for (const n of m.addedNodes) {
                if (n.nodeType === 1 && (matches(n, NOTICE_SEL) || q(NOTICE_SEL, n))) { dockNotices(); return; }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }
    let pending = 0;
    const soon = () => { clearTimeout(pending); pending = setTimeout(rescan, 250); };
    new MutationObserver(soon).observe(document.body, { childList: true });
    setInterval(() => { if (!document.hidden) rescan(); }, SCAN_MS);
}

try {
    const c = ctx();
    const ready = c?.eventTypes?.APP_READY;
    if (ready && c.eventSource?.on) c.eventSource.on(ready, boot);
    setTimeout(boot, 4000);
} catch {
    setTimeout(boot, 3000);
}

// Hide known sources' buttons as early as possible, so they never flash.
try {
    const early = [];
    for (const spec of SPECS) if (isOn(spec.key, 'spec')) early.push(...spec.hide);
    hideList = early;
    writeHideCss(early);
} catch { /* settings not ready yet */ }

globalThis.FloatWheel = Object.freeze({
    open: () => { boot(); openWheel(); },
    close: () => closeWheel(),
    manage: () => { boot(); openManager(); },
    rescan: () => rescan(),
});
