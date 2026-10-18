/* ==========================================================================
   Tangerine Design System — Behaviors
   Dependency-free. Classic script: <script src="js/tangerine.js" defer></script>
   Exposes window.Tangerine and auto-initialises [data-tg-*] elements on load.

   API
     Tangerine.wheel(container, options)       → radial wheel (preview or popup)
     Tangerine.petalPath(index, count)          → SVG path "d" for one petal
     Tangerine.wheelHit(dx, dy, count)          → petal index under offset, or null
     Tangerine.tabs(tablist, { onChange })      → roving-tabindex segmented tabs
     Tangerine.keycaps(root)                    → real key presses light up [data-tg-key]
     Tangerine.playground(scene, options)       → drag a file, tap a key, pick a petal
     Tangerine.tick()                           → subtle UI click (Web Audio, synthesized)
     Tangerine.announce(message)                → polite screen-reader announcement
     Tangerine.icons                            → built-in 24px stroke icon paths
   ========================================================================== */
(function (global) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const reducedMotion = () => global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------------
     Geometry — petals of a 272×272 wheel centred at (0,0)
     Measurements from the reference implementation.
     ------------------------------------------------------------------------ */
  const WHEEL = {
    size: 272,
    inner: 48 * 0.8 * 1.1 + 8 * 0.8, // 48.64 — hollow centre radius
    outer: 166 * 0.8 * 0.9,          // 119.52 — petal outer radius
    gap: 5 * 0.8,                    // 4 — gap between petals (px)
    corner: 28 * 0.8 * 0.9,          // 20.16 — outer corner rounding
    labelInner: 50 * 0.8,            // 40
  };

  /** Angle (radians, math orientation) of petal centre. First petal at 12 o'clock;
   *  for 3 items the first sits at 9 o'clock so the trio reads left→right. */
  function angleFor(i, n) {
    return (n === 3 ? Math.PI : Math.PI / 2) - (Math.PI * 2 * i) / n;
  }
  function polar(r, a) {
    return [Math.cos(a) * r, -Math.sin(a) * r];
  }

  function petalPath(i, n, g = WHEEL) {
    const mid = angleFor(i, n);
    const step = (Math.PI * 2) / n;
    const a0 = mid - step / 2;
    const a1 = mid + step / 2;
    // angular inset so the straight gap between petals is constant in px
    const inset = (r) => Math.asin(Math.min(0.95, g.gap / 2 / Math.max(r, g.gap / 2 + 0.01)));
    const oa0 = a0 + inset(g.outer);
    const oa1 = a1 - inset(g.outer);
    const ia0 = a0 + inset(g.inner);
    const ia1 = a1 - inset(g.inner);
    const oc = Math.min(0.15, (oa1 - oa0) * 0.24); // outer corner angle
    const ic = Math.min(0.18, (ia1 - ia0) * 0.18); // inner corner angle
    const iq = g.inner / Math.max(0.01, Math.cos(ic));
    const is = iq + g.inner * Math.tan(ic);
    const os = g.outer - g.corner;
    const p = (r, a) => polar(r, a).map((v) => v.toFixed(3)).join(" ");
    const largeO = oa1 - oc - (oa0 + oc) > Math.PI ? 1 : 0;
    const largeI = ia1 - ic - (ia0 + ic) > Math.PI ? 1 : 0;
    return [
      `M ${p(is, a0 + inset(is))}`,
      `L ${p(os, a0 + inset(os))}`,
      `Q ${p(g.outer, oa0)} ${p(g.outer, oa0 + oc)}`,
      `A ${g.outer} ${g.outer} 0 ${largeO} 0 ${p(g.outer, oa1 - oc)}`,
      `Q ${p(g.outer, oa1)} ${p(os, a1 - inset(os))}`,
      `L ${p(is, a1 - inset(is))}`,
      `Q ${p(iq, a1 - inset(iq))} ${p(g.inner, ia1 - ic)}`,
      `A ${g.inner} ${g.inner} 0 ${largeI} 1 ${p(g.inner, ia0 + ic)}`,
      `Q ${p(iq, a0 + inset(iq))} ${p(is, a0 + inset(is))}`,
      "Z",
    ].join(" ");
  }

  /** Which petal is under an offset (dx, dy) from the wheel centre? */
  function wheelHit(dx, dy, n, g = WHEEL) {
    const r = Math.hypot(dx, dy);
    if (!n || r < g.inner || r > g.outer) return null;
    const a = Math.atan2(-dy, dx);
    const step = (Math.PI * 2) / n;
    const rel = (((angleFor(0, n) - a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const i = Math.round(rel / step) % n;
    const off = Math.abs(Math.atan2(Math.sin(a - angleFor(i, n)), Math.cos(a - angleFor(i, n))));
    return off > step / 2 - Math.asin(g.gap / 2 / r) ? null : i;
  }

  /* ------------------------------------------------------------------------
     Icons — 24×24, stroke 1.75, round caps (the system's icon grammar)
     ------------------------------------------------------------------------ */
  const icons = {
    compress: "m3 3 6 6M4 9h5V4m12 17-6-6m5 0h-5v5",
    crop: "M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2",
    edit: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
    annotate: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
    metadata: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01",
    redact: "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10 10 0 0 1 12 4c7 0 10 8 10 8a17 17 0 0 1-3 4M6.6 6.6A17 17 0 0 0 2 12s3 8 10 8a10 10 0 0 0 5.4-1.6",
    trim: "M6 3v18M18 3v18M6 12h12M3 7h3M3 17h3M18 7h3M18 17h3",
    merge: "M8 6h4a4 4 0 0 1 4 4v8M16 18l-3-3M16 18l3-3M8 18V6",
    split: "M16 3h5v5M8 3H3v5M21 3l-7 7M3 3l7 7M12 22v-8",
    airdrop: "M8.5 10a5 5 0 1 1 7 0M6 12.5a8.5 8.5 0 1 1 12 0M12 12l5 8H7z",
    copy: "M9 9h11v11H9zM5 15H4V4h11v1",
    move: "M3 7h6l2 2h10v11H3zM12 13h5M15 11l2 2-2 2",
    path: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
    terminal: "M4 17l6-5-6-5M12 19h8",
    float: "M12 17v5M9 10.8V4h6v6.8l3 3.2v3H6v-3z",
    image: "M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M3 17l5-5 4 4 4-6 5 7",
    video: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM10 9l5 3-5 3z",
    audio: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    document: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5",
    archive: "M3 4h18v4H3zM5 8v12h14V8M10 12h4",
    upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
    home: "M3 11l9-8 9 8M5 9.5V20h14V9.5M10 20v-6h4v6",
    lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
    bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
    check: "M5 12l5 5 9-10",
    arrowUpRight: "M7 17 17 7M8 7h9v9",
  };

  function iconSVG(name, { size = 24, stroke = 1.75, className = "" } = {}) {
    const d = icons[name] || name;
    return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  }

  /* ------------------------------------------------------------------------
     Sound — a soft synthesized "tick" for highlight changes.
     Audio context is only created after a trusted user gesture.
     Disable with <html data-tg-sound="off">.
     ------------------------------------------------------------------------ */
  let audioCtx = null;
  function primeAudio(e) {
    if (!e.isTrusted || audioCtx) return;
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return;
    try { audioCtx = new Ctx({ latencyHint: "interactive" }); } catch (_) { /* ignore */ }
  }
  ["pointerdown", "keydown"].forEach((t) => global.addEventListener(t, primeAudio, { capture: true }));
  function tick() {
    if (!audioCtx || document.documentElement.dataset.tgSound === "off") return;
    if (audioCtx.state !== "running") audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1900, t);
    osc.frequency.exponentialRampToValueAtTime(1100, t + 0.03);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  /* ------------------------------------------------------------------------
     Announcer
     ------------------------------------------------------------------------ */
  let liveRegion = null;
  function announce(message) {
    if (!liveRegion) {
      liveRegion = document.createElement("div");
      liveRegion.className = "tg-sr-only";
      liveRegion.setAttribute("role", "status");
      liveRegion.setAttribute("aria-live", "polite");
      document.body.append(liveRegion);
    }
    liveRegion.textContent = "";
    requestAnimationFrame(() => { liveRegion.textContent = message; });
  }

  /* ------------------------------------------------------------------------
     Wheel
     options:
       items:        [{ id, label, icon? }]   (icon = key of Tangerine.icons or a path "d")
       variant:      "format" | "tool"         tool = icon + small caps label
       popup:        boolean                   fixed-position bloom (for drag menus)
       interactive:  boolean                   hover/click/arrow keys select (preview wheels)
       initial:      index | null              highlighted on render (default 0 for previews)
       sound:        boolean                   tick on highlight (default true)
       onHighlight(item, index), onSelect(item, index)
     ------------------------------------------------------------------------ */
  let wheelSeq = 0;
  function wheel(container, options = {}) {
    const opts = Object.assign({ items: [], variant: "format", popup: false, interactive: !options.popup, sound: true }, options);
    const items = opts.items.map((it) => (typeof it === "string" ? { id: it, label: it } : it));
    const n = items.length;
    const el = container;
    el.classList.add("tg-wheel");
    if (opts.popup) el.classList.add("tg-wheel--popup");
    el.replaceChildren();

    const id = `tg-wheel-${++wheelSeq}`;
    el.style.setProperty("--tg-wheel-fill", `url(#${id}-glass)`);

    const glass = document.createElement("div");
    glass.className = "tg-wheel__glass";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "-136 -136 272 272");
    svg.setAttribute("width", "272");
    svg.setAttribute("height", "272");
    svg.setAttribute("role", opts.popup ? "menu" : "group");
    if (opts.ariaLabel) svg.setAttribute("aria-label", opts.ariaLabel);
    svg.innerHTML = `<defs><radialGradient id="${id}-glass"><stop offset="0" stop-color="#fff" stop-opacity=".8"/><stop offset=".68" stop-color="#f3f6f7" stop-opacity=".58"/><stop offset="1" stop-color="#f4f6f6" stop-opacity=".75"/></radialGradient></defs>`;

    const labelR = WHEEL.labelInner + (WHEEL.outer - WHEEL.labelInner) * 0.56;
    const groups = items.map((item, i) => {
      const g = document.createElementNS(SVG_NS, "g");
      g.classList.add("tg-wheel__item");
      g.setAttribute("role", opts.popup ? "menuitem" : "button");
      g.setAttribute("tabindex", "-1");
      g.setAttribute("aria-label", item.ariaLabel || item.label);
      const path = document.createElementNS(SVG_NS, "path");
      path.classList.add("tg-wheel__petal");
      path.setAttribute("d", petalPath(i, n));
      g.append(path);

      const [x, y] = polar(labelR, angleFor(i, n));
      const isTool = opts.variant === "tool";
      if (isTool && item.icon) {
        const ig = document.createElementNS(SVG_NS, "g");
        ig.classList.add("tg-wheel__icon");
        ig.setAttribute("transform", `translate(${x - 9} ${y - 16.5}) scale(0.75)`);
        ig.innerHTML = `<path d="${icons[item.icon] || item.icon}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
        g.append(ig);
      }
      const text = document.createElementNS(SVG_NS, "text");
      text.classList.add("tg-wheel__label");
      if (isTool) text.classList.add("tg-wheel__label--tool");
      text.setAttribute("x", x.toFixed(2));
      text.setAttribute("y", (isTool && item.icon ? y + 10.5 : y).toFixed(2));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.textContent = item.short || item.label;
      g.append(text);
      svg.append(g);
      return g;
    });

    const center = document.createElement("span");
    center.className = "tg-wheel__center" + (opts.variant === "tool" ? " is-tool" : "");
    center.setAttribute("aria-hidden", "true");
    center.hidden = true;
    el.append(glass, svg, center);

    let selected = null;
    function highlight(i, { silent = false } = {}) {
      if (i === selected) return;
      selected = i;
      groups.forEach((g, k) => {
        g.classList.toggle("is-highlighted", k === i);
        g.setAttribute("tabindex", k === i || (i === null && k === 0) ? "0" : "-1");
      });
      if (i === null) {
        center.hidden = true;
      } else {
        center.textContent = items[i].label;
        center.hidden = false;
        if (!silent && opts.sound) tick();
      }
      opts.onHighlight && opts.onHighlight(i === null ? null : items[i], i);
    }

    if (opts.interactive) {
      groups.forEach((g, i) => {
        g.addEventListener("pointerenter", () => highlight(i));
        g.addEventListener("click", () => { highlight(i); opts.onSelect && opts.onSelect(items[i], i); });
        g.addEventListener("keydown", (e) => {
          const fwd = ["ArrowRight", "ArrowDown"].includes(e.key);
          const back = ["ArrowLeft", "ArrowUp"].includes(e.key);
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            opts.onSelect && opts.onSelect(items[i], i);
          } else if (fwd || back || e.key === "Home" || e.key === "End") {
            e.preventDefault();
            let k = (i + (fwd ? 1 : -1) + n) % n;
            if (e.key === "Home") k = 0;
            if (e.key === "End") k = n - 1;
            highlight(k);
            groups[k].focus({ preventScroll: true });
          }
        });
      });
    }

    const initial = opts.initial !== undefined ? opts.initial : opts.popup ? null : 0;
    if (initial !== null && n) highlight(initial, { silent: true });
    else groups[0] && groups[0].setAttribute("tabindex", "0");

    return {
      el,
      items,
      get selected() { return selected; },
      highlight,
      step(delta) { highlight(((selected === null ? (delta > 0 ? -1 : 0) : selected) + delta + n) % n); },
      hit(dx, dy) {
        const i = wheelHit(dx, dy, n);
        if (i === null) return null;
        const p = groups[i].firstChild;
        if (typeof p.isPointInFill === "function" && global.DOMPoint && !p.isPointInFill(new DOMPoint(dx, dy))) return null;
        return i;
      },
      focus() { (groups[selected ?? 0] || groups[0]).focus({ preventScroll: true }); },
      destroy() { el.replaceChildren(); el.classList.remove("tg-wheel", "tg-wheel--popup"); },
    };
  }

  /* ------------------------------------------------------------------------
     Tabs — role=tablist with roving tabindex (WAI-ARIA Tabs pattern)
     <div class="tg-tabs" role="tablist" data-tg-tabs> <button role="tab" ...>
     ------------------------------------------------------------------------ */
  function tabs(list, { onChange } = {}) {
    const tabsEls = Array.from(list.querySelectorAll('[role="tab"]'));
    function select(tab, focus) {
      tabsEls.forEach((t) => {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        const panelId = t.getAttribute("aria-controls");
        const panel = panelId && document.getElementById(panelId);
        if (panel && list.dataset.tgTabs !== "shared") panel.hidden = !on;
      });
      if (focus) tab.focus();
      onChange && onChange(tab, tabsEls.indexOf(tab));
      list.dispatchEvent(new CustomEvent("tg:tabchange", { detail: { tab, index: tabsEls.indexOf(tab) }, bubbles: true }));
    }
    tabsEls.forEach((t, i) => {
      t.addEventListener("click", () => select(t, false));
      t.addEventListener("keydown", (e) => {
        let k = null;
        if (e.key === "ArrowRight") k = (i + 1) % tabsEls.length;
        if (e.key === "ArrowLeft") k = (i - 1 + tabsEls.length) % tabsEls.length;
        if (e.key === "Home") k = 0;
        if (e.key === "End") k = tabsEls.length - 1;
        if (k !== null) { e.preventDefault(); select(tabsEls[k], true); }
      });
    });
    const current = tabsEls.find((t) => t.getAttribute("aria-selected") === "true") || tabsEls[0];
    if (current) select(current, false);
    return { select: (i) => select(tabsEls[i], false) };
  }

  /* ------------------------------------------------------------------------
     Keycaps — <span class="tg-key" data-tg-key="Shift"> lights up while held
     ------------------------------------------------------------------------ */
  function keycaps(root = document) {
    const set = (key, on) => root.querySelectorAll(`[data-tg-key="${key}"]`).forEach((k) => k.classList.toggle("is-held", on));
    global.addEventListener("keydown", (e) => set(e.key, true));
    global.addEventListener("keyup", (e) => set(e.key, false));
    global.addEventListener("blur", () => root.querySelectorAll(".tg-key.is-held").forEach((k) => k.classList.remove("is-held")));
  }

  /* ------------------------------------------------------------------------
     Playground — files on a scene; drag one, tap a key, choose a petal, drop.
     options:
       files:  [{ name, ext, kind, x, y, mx?, my?, img? }]  x/y in % of stage
       modes:  { Shift: { label, glyph, variant, items(file)→[{id,label,icon?}], apply(file,item)→{name,ext,kind,img?} },
                 Meta: {...}, Control: {...} }
       hint:   element to fade after first drag (optional)
       onApply(file, item, result)
     ------------------------------------------------------------------------ */
  const KEY_GLYPH = { Shift: "⇧", Meta: "⌘", Control: "⌃", Alt: "⌥" };
  const KEY_NAME = { Shift: "shift", Meta: "command", Control: "control", Alt: "option" };

  function fileArt(f) {
    if (f.img) return `<img src="${f.img}" alt="" draggable="false">`;
    return `<span class="tg-doc" data-ext="${(f.ext || "").toUpperCase()}" data-kind="${f.kind || ""}"></span>`;
  }

  function playground(scene, options = {}) {
    const stage = scene.querySelector(".tg-scene__stage") || scene;
    const modes = options.modes || {};
    const modeKeys = Object.keys(modes);
    const files = (options.files || []).map((f, i) => Object.assign({ id: `f${i}` }, f));
    const isMobile = () => global.matchMedia("(max-width: 700px)").matches;
    let seq = files.length;
    let drag = null;
    let longPress = null;
    let instructionsId = scene.id ? `${scene.id}-help` : `tg-pg-help-${Math.random().toString(36).slice(2, 7)}`;

    const help = document.createElement("p");
    help.className = "tg-sr-only";
    help.id = instructionsId;
    help.textContent = `Drag a file, then tap ${modeKeys.join(", ")} to open a menu. Or press Enter on a file, use arrow keys to choose, Enter to apply, Escape to cancel.`;
    scene.append(help);

    // Shared overlay elements
    const ghost = document.createElement("div");
    ghost.className = "tg-drag-ghost tg-file";
    ghost.hidden = true;
    const prompt = document.createElement("div");
    prompt.className = "tg-key-prompt";
    prompt.hidden = true;
    const first = modeKeys[0];
    if (first) prompt.innerHTML = `<p>Tap ${KEY_NAME[first] ? KEY_NAME[first][0].toUpperCase() + KEY_NAME[first].slice(1) : first} on your keyboard</p><span class="tg-key"><span class="tg-key__glyph">${KEY_GLYPH[first] || ""}</span>${KEY_NAME[first] || first}</span>`;
    const keybar = document.createElement("div");
    keybar.className = "tg-keybar tg-keybar--floating";
    keybar.hidden = true;
    keybar.innerHTML = modeKeys.map((k) => `<span><kbd>${KEY_GLYPH[k] || k}</kbd> ${modes[k].label}</span>`).join("");
    const menu = document.createElement("div");
    menu.hidden = true;
    document.body.append(ghost, prompt, keybar, menu);
    let wheelApi = null;

    function render(f) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tg-file";
      b.dataset.id = f.id;
      b.setAttribute("aria-describedby", instructionsId);
      b.setAttribute("aria-haspopup", "menu");
      b.setAttribute("aria-label", f.name);
      b.innerHTML = `<span class="tg-file__art">${fileArt(f)}</span><span class="tg-file__name">${f.name}</span>`;
      place(b, f);
      b.addEventListener("pointerdown", (e) => onPointerDown(e, f, b));
      b.addEventListener("keydown", (e) => onFileKey(e, f, b));
      b.addEventListener("focus", () => selectFile(b));
      stage.append(b);
      f.el = b;
      return b;
    }
    function place(b, f) {
      const m = isMobile();
      b.style.setProperty("--x", `${m && f.mx != null ? f.mx : f.x}%`);
      b.style.setProperty("--y", `${m && f.my != null ? f.my : f.y}%`);
    }
    function selectFile(b) {
      stage.querySelectorAll(".tg-file.is-selected").forEach((x) => x !== b && x.classList.remove("is-selected"));
      b && b.classList.add("is-selected");
    }
    files.forEach(render);
    global.addEventListener("resize", () => files.forEach((f) => f.el && place(f.el, f)));
    stage.addEventListener("pointerdown", (e) => { if (e.target === stage) selectFile(null); });

    /* ----- wheel menu ----- */
    function openWheel(key, x, y, keyboard) {
      const mode = modes[key];
      if (!mode || !drag) return;
      drag.modeKey = key;
      drag.anchor = drag.anchor || { x, y };
      const items = mode.items(drag.file) || [];
      drag.items = items;
      menu.className = "";
      menu.style.left = `${drag.anchor.x}px`;
      menu.style.top = `${drag.anchor.y}px`;
      if (!items.length) {
        menu.className = "tg-wheel--popup";
        menu.style.width = "245px";
        menu.innerHTML = `<p class="tg-wheel-empty">${mode.empty || `Nothing to show for this file. Try ${modeKeys.filter((k) => k !== key).map((k) => KEY_NAME[k] || k).join(" or ")}.`}</p>`;
        wheelApi = null;
      } else {
        menu.style.width = "";
        wheelApi = wheel(menu, {
          items,
          variant: mode.variant || "format",
          popup: true,
          interactive: keyboard,
          initial: keyboard ? 0 : null,
          ariaLabel: mode.label,
          onSelect: () => apply(),
        });
        menu.classList.toggle("is-keyboard", !!keyboard);
      }
      menu.hidden = false;
      prompt.classList.add("is-pressed");
      setTimeout(() => { prompt.hidden = true; prompt.classList.remove("is-pressed"); }, 360);
      keybar.style.left = `${drag.anchor.x}px`;
      keybar.style.top = `${drag.anchor.y - 136 - 52}px`;
      keybar.hidden = false;
      drag.file.el.setAttribute("aria-expanded", "true");
      if (keyboard && wheelApi) wheelApi.focus();
      announce(`${mode.label} menu open. ${items.length} options.`);
    }
    function closeWheel() {
      menu.hidden = true;
      menu.replaceChildren();
      menu.className = "";
      keybar.hidden = true;
      wheelApi = null;
      if (drag) drag.file.el.setAttribute("aria-expanded", "false");
    }

    /* ----- pointer drag ----- */
    function onPointerDown(e, f, b) {
      if (e.button !== 0 || drag) return;
      e.preventDefault();
      b.focus({ preventScroll: true });
      selectFile(b);
      const r = b.getBoundingClientRect();
      drag = { file: f, mode: "pointer", pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, offsetX: e.clientX - r.left, offsetY: e.clientY - r.top, w: r.width, h: r.height, active: false, anchor: null, modeKey: null };
      try { b.setPointerCapture(e.pointerId); } catch (_) { /* synthetic or stale pointer */ }
      if (e.pointerType === "touch" && first) {
        longPress = setTimeout(() => { if (drag && !drag.active) { activate(); openWheel(first, drag.x, drag.y, false); } }, 450);
      }
    }
    function activate() {
      drag.active = true;
      const b = drag.file.el;
      b.classList.add("is-source");
      ghost.replaceChildren(...Array.from(b.children, (c) => c.cloneNode(true)));
      ghost.style.width = `${drag.w}px`;
      ghost.hidden = false;
      document.body.classList.add("tg-is-dragging");
      if (options.hint) options.hint.classList.add("is-done");
      if (first && !drag.modeKey) prompt.hidden = false;
      move();
    }
    function move() {
      ghost.style.transform = `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px)`;
      prompt.style.left = `${drag.x}px`;
      prompt.style.top = `${drag.y + 56}px`;
      if (wheelApi && drag.anchor) {
        wheelApi.highlight(wheelApi.hit(drag.x - drag.anchor.x, drag.y - drag.anchor.y));
      }
    }
    global.addEventListener("pointermove", (e) => {
      if (!drag || drag.mode !== "pointer" || e.pointerId !== drag.pointerId) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 4) {
        clearTimeout(longPress);
        activate();
      }
      if (drag.active) move();
    });
    global.addEventListener("pointerup", (e) => {
      if (!drag || drag.mode !== "pointer" || e.pointerId !== drag.pointerId) return;
      clearTimeout(longPress);
      if (!drag.active) { end(); return; }
      if (wheelApi && wheelApi.selected !== null) apply();
      else if (drag.modeKey) end(); // wheel open but dropped outside petals: cancel
      else drop();
    });
    global.addEventListener("pointercancel", () => drag && end());

    function drop() {
      const r = stage.getBoundingClientRect();
      const cx = drag.x - drag.offsetX + drag.w / 2;
      const cy = drag.y - drag.offsetY + drag.h / 2;
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) { end(); return; }
      const f = drag.file;
      f.x = f.mx = Math.max(5, Math.min(95, ((cx - r.left) / r.width) * 100));
      f.y = f.my = Math.max(8, Math.min(92, ((cy - r.top) / r.height) * 100));
      place(f.el, f);
      announce(`${f.name} moved.`);
      end();
    }

    /* ----- keyboard ----- */
    function onFileKey(e, f, b) {
      if ((e.key === "Enter" || e.key === " ") && !drag && first) {
        e.preventDefault();
        const r = b.getBoundingClientRect();
        drag = { file: f, mode: "keyboard", x: r.left + r.width / 2, y: r.top + r.height / 2, active: true, anchor: null, modeKey: null };
        openWheel(first, drag.x, drag.y, true);
      }
    }
    global.addEventListener("keydown", (e) => {
      if (!drag || !drag.active) return;
      if (e.key === "Escape") { e.preventDefault(); end(true); return; }
      if (modes[e.key] && e.key !== drag.modeKey) {
        e.preventDefault();
        closeWheel();
        openWheel(e.key, drag.x, drag.y, drag.mode === "keyboard");
        return;
      }
      if (drag.mode === "keyboard" && wheelApi && ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key) && !e.target.closest?.(".tg-wheel__item")) {
        e.preventDefault();
        wheelApi.step(["ArrowRight", "ArrowDown"].includes(e.key) ? 1 : -1);
      }
    }, true);

    /* ----- apply & lifecycle ----- */
    function apply() {
      if (!drag || !wheelApi || wheelApi.selected === null) return;
      const mode = modes[drag.modeKey];
      const item = drag.items[wheelApi.selected];
      const src = drag.file;
      const at = drag.anchor;
      const keyboard = drag.mode === "keyboard";
      end();
      const out = mode.apply ? mode.apply(src, item) : null;
      if (!out) { options.onApply && options.onApply(src, item, null); return; }
      const r = stage.getBoundingClientRect();
      const nf = Object.assign({ id: `f${seq++}` }, out);
      // land beside the drop point, nudged so it does not overlap the source
      nf.x = nf.mx = Math.max(6, Math.min(94, ((at.x - r.left + 70) / r.width) * 100));
      nf.y = nf.my = Math.max(10, Math.min(90, ((at.y - r.top + 40) / r.height) * 100));
      files.push(nf);
      const b = render(nf);
      b.classList.add("is-processing", "is-new");
      b.setAttribute("aria-busy", "true");
      announce(`Making ${nf.name}…`);
      if (keyboard) b.focus({ preventScroll: true });
      setTimeout(() => {
        b.classList.remove("is-processing", "is-new");
        b.setAttribute("aria-busy", "false");
        announce(`${nf.name} — just like that.`);
      }, reducedMotion() ? 100 : 680);
      options.onApply && options.onApply(src, item, nf);
    }
    function end(cancelled) {
      if (!drag) return;
      const b = drag.file.el;
      b.classList.remove("is-source");
      if (drag.pointerId != null && b.hasPointerCapture && b.hasPointerCapture(drag.pointerId)) b.releasePointerCapture(drag.pointerId);
      closeWheel();
      ghost.hidden = true;
      prompt.hidden = true;
      document.body.classList.remove("tg-is-dragging");
      if (cancelled && drag.mode === "keyboard") b.focus({ preventScroll: true });
      drag = null;
    }

    return { files, destroy() { [ghost, prompt, keybar, menu, help].forEach((n) => n.remove()); stage.querySelectorAll(".tg-file").forEach((n) => n.remove()); } };
  }

  /* ------------------------------------------------------------------------
     Auto-init
       [data-tg-tabs]                          → tabs()
       [data-tg-wheel='{"items":[...]}']       → wheel() preview; caption via data-tg-caption="#id"
       [data-tg-keycaps]                       → keycaps(element)
       [data-tg-icon="name"]                   → injects icon SVG
     ------------------------------------------------------------------------ */
  function init(root = document) {
    root.querySelectorAll("[data-tg-icon]").forEach((el) => {
      if (el.querySelector("svg")) return;
      el.insertAdjacentHTML("afterbegin", iconSVG(el.dataset.tgIcon, { size: el.dataset.tgSize || 24 }));
    });
    root.querySelectorAll("[data-tg-tabs]").forEach((el) => tabs(el));
    root.querySelectorAll("[data-tg-wheel]").forEach((el) => {
      let cfg = {};
      try { cfg = JSON.parse(el.dataset.tgWheel || "{}"); } catch (_) { /* ignore */ }
      const caption = el.dataset.tgCaption && document.querySelector(el.dataset.tgCaption);
      const prefix = el.dataset.tgCaptionPrefix || "";
      wheel(el, Object.assign(cfg, {
        onHighlight: (item) => { if (caption && item) caption.textContent = prefix + item.label; },
      }));
    });
    root.querySelectorAll("[data-tg-keycaps]").forEach((el) => keycaps(el));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => init());
  else init();

  global.Tangerine = { WHEEL, angleFor, petalPath, wheelHit, wheel, tabs, keycaps, playground, tick, announce, icons, iconSVG, init };
})(window);
