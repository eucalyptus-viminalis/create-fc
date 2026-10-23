// A clipboard on the right edge of the window that holds whatever you last copied.
// Copying sends a paper copy of the document into it with a genie effect, with
// paper and scissor sounds synthesized in the browser. Usage:
//   dock.copy({ text, title: 'Service order', from: element, paper: '#e8e6db', onLift })
// `paper` colours the flying copy; `onLift` runs as it leaves, so the page can reveal the sheet underneath.
// `from` is the element the copy flies out of. Click the clipboard to see what's on it
// and copy it again. "m" turns sound on and off (shared with fameboy: cc-sound).
(() => {
  // ---------------------------------------------------------------- sound
  // Sound is synthesized with the Web Audio API (see sfx below). tone() is fameboy's square-wave blip, kept for reference.
  let ac = null;
  const unlock = () => { if (!ac) try { ac = new AudioContext(); } catch { return; } if (ac.state === 'suspended') ac.resume(); };
  addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
  const soundOn = () => { try { return localStorage.getItem('cc-sound') !== 'off'; } catch { return true; } };
  const setSound = on => { try { localStorage.setItem('cc-sound', on ? 'on' : 'off'); } catch {} };
  function tone(f, at, dur, opt = 0.035) {
    const { vol = 0.035, to } = typeof opt === 'number' ? { vol: opt } : opt;
    if (!ac || !soundOn() || ac.state !== 'running') return;
    const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  // Paper and metal, made from filtered noise: no recordings, nothing to download.
  let noiseBuf = null;
  const noise = () => {
    if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const n = ac.createBufferSource(); n.buffer = noiseBuf; return n;
  };
  const audible = () => ac && soundOn() && ac.state === "running";
  // burst(start, length, filter type, frequency, Q, volume, envelope points [[time 0..1, gain 0..1], ...])
  function burst(at, dur, type, f, q, vol, env = [[0, 1], [1, 0]], f2) {
    if (!audible()) return;
    const t = ac.currentTime + at, n = noise(), flt = ac.createBiquadFilter(), g = ac.createGain();
    flt.type = type; flt.frequency.setValueAtTime(f, t); flt.Q.value = q;
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    env.forEach(([k, v]) => g.gain.linearRampToValueAtTime(Math.max(v * vol, 0.0001), t + k * dur));
    n.connect(flt).connect(g).connect(ac.destination);
    n.start(t, Math.random() * 1.5); n.stop(t + dur + 0.02);
  }
  // A ringing metal ping: a sine that dies fast. Gives scissors and the clip their edge.
  function ping(at, f, dur, vol) {
    if (!audible()) return;
    const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const sfx = {
    // scissors: two blades closing, snip-snip, each a sharp click with a little ring
    snip: (at = 0) => [0, 0.13].forEach(d => { burst(at + d, 0.035, 'highpass', 4200, 0.8, 0.5, [[0, 1], [0.15, .6], [1, 0]]); ping(at + d + 0.004, 6200 + Math.random() * 600, 0.05, 0.03); burst(at + d + 0.012, 0.02, 'bandpass', 2400, 3, 0.25); }),
    // paper tearing along the perforation: a crackle of many tiny rips, rising then trailing off
    tear: (at = 0) => {
      const n = 26, len = 0.42;
      for (let i = 0; i < n; i++) {
        const k = i / n, when = at + k * len + Math.random() * 0.012, loud = Math.sin(Math.PI * Math.min(1, k * 1.25)) * (0.5 + Math.random() * 0.5);
        burst(when, 0.012 + Math.random() * 0.02, 'bandpass', 1800 + Math.random() * 2600, 1.2, 0.55 * loud);
      }
      burst(at, len, 'bandpass', 3000, 0.6, 0.12, [[0, 0], [0.2, 1], [0.8, .7], [1, 0]]);   // the fibre hiss under it
    },
    // a sheet moving through the air
    fly: (at = 0) => burst(at, 0.5, 'bandpass', 600, 0.9, 0.22, [[0, 0], [0.35, 1], [1, 0]], 2400),
    // the clip snapping onto the board: a dull knock and a spring
    // the clip's lever pulled back against its spring
    unclip: () => { burst(0, 0.02, 'highpass', 2600, 0.7, 0.35); ping(0.01, 1900, 0.12, 0.012); burst(0.03, 0.06, 'bandpass', 1200, 4, 0.08, [[0, 0], [0.5, 1], [1, 0]]); },
    clip: () => { burst(0, 0.06, 'lowpass', 380, 0.7, 0.9, [[0, 1], [1, 0]]); burst(0.003, 0.015, 'highpass', 3000, 0.7, 0.4); ping(0.006, 2900, 0.09, 0.025); },
    // paper settling on paper
    got: () => burst(0.05, 0.14, 'bandpass', 1400, 0.7, 0.18, [[0, 0], [0.2, 1], [1, 0]], 700),
    // flicking the clipboard open: a light page riffle
    open: () => burst(0, 0.09, 'bandpass', 2200, 0.8, 0.16, [[0, 0], [0.3, 1], [1, 0]]),
    // scissors working round a coupon: four snips, each a little different
    cut: () => [0, .15, .29, .45].forEach((d, i) => { burst(d, 0.03, 'highpass', 3800 + i * 300, 0.8, 0.45, [[0, 1], [0.15, .6], [1, 0]]); ping(d + 0.004, 5800 + Math.random() * 900, 0.045, 0.025); }),
    // a used coupon screwed up and tossed: crackle, then a soft whoosh
    crumple: (at = 0) => { for (let i = 0; i < 22; i++) burst(at + Math.random() * 0.32, 0.015 + Math.random() * 0.03, 'bandpass', 900 + Math.random() * 3000, 1, 0.35 + Math.random() * 0.3); burst(at + 0.3, 0.3, 'bandpass', 900, 0.8, 0.16, [[0, 0], [0.3, 1], [1, 0]], 300); },
    // a counter service bell: a struck metal dome, a few inharmonic partials ringing out
    bell: () => { burst(0, 0.012, 'highpass', 5000, 0.7, 0.5); [[2093, .05, 1.6], [2093 * 2.76, .02, .7], [2093 * 5.4, .008, .35], [2093 * 1.5, .012, 1.1]].forEach(([f, v, d]) => ping(0.002, f, d, v)); },
    // the sound switch: a small mechanical click
    toggle: () => { burst(0, 0.02, 'highpass', 2500, 0.7, 0.4); burst(0.05, 0.015, 'highpass', 3500, 0.7, 0.25); },
  };


  // ---------------------------------------------------------------- the clipboard
  const css = `
  .cbd { position: fixed; z-index: 50; right: -18px; top: 50%; transform: translateY(-50%) rotate(3deg); width: 128px; transition: right .25s, transform .25s; font: 500 11px/1.2 "Oswald", "Arial Narrow", sans-serif; }
  .cbd:hover, .cbd.open, .cbd:focus-within { right: -4px; transform: translateY(-50%) rotate(1deg); }
  .cbd .board { all: unset; box-sizing: border-box; display: block; width: 128px; height: 168px; cursor: pointer; border-radius: 7px; position: relative;
    background: radial-gradient(120% 80% at 30% 20%, #a07a52, #6f4f30); box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / .12), inset 0 -3px 0 rgb(0 0 0 / .18), -6px 8px 16px rgb(0 0 0 / .28); }
  .cbd .board::before { content: ""; position: absolute; inset: 0; border-radius: inherit; opacity: .35; mix-blend-mode: multiply;
    background: repeating-linear-gradient(97deg, transparent 0 5px, rgb(60 35 15 / .25) 5px 6px, transparent 6px 13px); }
  .cbd .board:focus-visible { outline: 2px solid #8a63d2; outline-offset: 3px; }
  .cbd .clip { position: absolute; left: 50%; top: -9px; width: 62px; height: 26px; transform: translateX(-50%); z-index: 3; border-radius: 6px 6px 3px 3px;
    background: linear-gradient(180deg, #e9e9e4, #a9a9a2 55%, #d6d6cf); box-shadow: 0 2px 2px rgb(0 0 0 / .3), inset 0 1px 0 #fff; transform-origin: 50% 100%; transition: transform .12s; }
  .cbd .clip::after { content: ""; position: absolute; left: 50%; top: 5px; width: 22px; height: 7px; transform: translateX(-50%); border-radius: 4px; background: #6f4f30; box-shadow: inset 0 1px 2px rgb(0 0 0 / .5); }
  .cbd.snap .clip { transform: translateX(-50%) scaleY(.82); }
  /* catching: the clipboard squares up and comes out, and the clip's jaw lifts open */
  .cbd .clip { transition: transform .16s cubic-bezier(.3, 1.6, .6, 1), box-shadow .16s; }
  .cbd.jaw .clip { transform: translateX(-50%) translateY(-11px) scale(1.1, .88); box-shadow: 0 9px 8px rgb(0 0 0 / .32), inset 0 1px 0 #fff; }
  .cbd.snap .clip { transition-duration: .06s; }
  .cbd .slot { position: absolute; left: 12px; right: 12px; top: 14px; bottom: 14px; }
  .cbd .page { position: absolute; inset: 0; background: #e8e6db; box-shadow: 0 1px 2px rgb(0 0 0 / .25); padding: 16px 7px 6px; color: #1c1c1a; overflow: hidden; }
  .cbd .page.fade { animation: cbd-fade .45s ease-out; }
  @keyframes cbd-fade { from { opacity: 0; } }
  .cbd .page b { display: block; font: 700 11px/1 "Oswald", "Arial Narrow", sans-serif; letter-spacing: .06em; text-transform: uppercase; border-bottom: 1.5px solid #1c1c1a; padding-bottom: 3px; margin-bottom: 4px; }
  .cbd .page i { display: block; height: 2px; background: #23253a; opacity: .45; margin: 4px 0; }
  .cbd .empty { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; color: rgb(255 255 255 / .55); letter-spacing: .14em; text-transform: uppercase; padding: 0 10px; }
  .cbd .tag { display: block; margin: 7px 18px 0 6px; color: #3a3a35; text-align: center; letter-spacing: .1em; text-transform: uppercase; font-size: 10px; }
  .cbd .snd { all: unset; cursor: pointer; position: absolute; left: -26px; bottom: 8px; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; background: #1c1c1a; color: #e8e6db; font: 12px/1 sans-serif; }
  .cbd .snd:focus-visible { outline: 2px solid #8a63d2; outline-offset: 2px; }
  .cbd .peek { position: absolute; right: 136px; top: 50%; transform: translateY(-50%); width: min(340px, 70vw); background: #e8e6db; color: #1c1c1a; padding: 12px 14px; box-shadow: -6px 8px 18px rgb(0 0 0 / .25); display: none; }
  .cbd.open .peek { display: block; }
  .cbd .peek h3 { margin: 0 0 6px; font: 600 12px/1 "Oswald", sans-serif; letter-spacing: .12em; text-transform: uppercase; }
  .cbd .peek p { margin: 0 0 10px; font: 400 13px/1.45 "Courier Prime", monospace; color: #23253a; overflow-wrap: anywhere; max-height: 40vh; overflow: auto; }
  .cbd .peek button { all: unset; cursor: pointer; border: 2px solid #1c1c1a; padding: 6px 10px; font: 600 11px/1 "Oswald", sans-serif; letter-spacing: .1em; text-transform: uppercase; }
  .cbd .peek button:focus-visible { outline: 2px solid #8a63d2; outline-offset: 2px; }
  .cbd .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .cbd-ghost { position: absolute; z-index: 2; width: 100vw; height: 100vh; pointer-events: none; }   /* over the board, under the clip */
  .cbd-ghost div { position: absolute; background-repeat: no-repeat; will-change: transform; }
  @media (max-width: 700px) {
    .cbd { top: auto; bottom: 12px; transform: rotate(3deg) scale(.62); transform-origin: 100% 100%; }
    .cbd:hover, .cbd.open, .cbd:focus-within { transform: rotate(1deg) scale(.62); }
    .cbd.catch { transform: none !important; }
    .cbd .peek { top: auto; bottom: 0; transform: scale(1.6); transform-origin: 100% 100%; right: 150px; width: 60vw; }
  }`;
  document.head.insertAdjacentHTML('beforeend', `<style>${css}
  .cbd.catch { right: -4px; transform: translateY(-50%); }
  @media (max-width: 700px) { .cbd.catch { transform: none; } }</style>`);
  const el = document.createElement('aside');
  el.className = 'cbd'; el.setAttribute('aria-label', 'Clipboard');
  el.innerHTML = `
    <button class="board" type="button" aria-expanded="false" aria-label="Clipboard: nothing copied yet">
      <span class="clip"></span><span class="slot"><span class="empty">Nothing on the clipboard</span></span>
    </button>
    <span class="tag">Clipboard</span>
    <button class="snd" type="button"></button>
    <div class="peek" role="dialog" aria-label="On the clipboard"><h3></h3><p></p><button type="button" class="again">Copy again</button></div>
    <span class="sr" aria-live="polite"></span>`;
  document.body.append(el);
  const board = el.querySelector('.board'), slot = el.querySelector('.slot'), peek = el.querySelector('.peek'), live = el.querySelector('.sr'), snd = el.querySelector('.snd'), tag = el.querySelector('.tag');
  const paintSnd = () => { snd.textContent = soundOn() ? '♪' : '×'; snd.setAttribute('aria-label', soundOn() ? 'Sound on. Press to mute (m)' : 'Sound off. Press to turn on (m)'); };
  const toggleSound = () => { setSound(!soundOn()); paintSnd(); sfx.toggle(); };
  snd.addEventListener('click', toggleSound);
  addEventListener('keydown', e => { if (e.key === 'm' && !e.metaKey && !e.ctrlKey && !/input|textarea/i.test(e.target.tagName) && !e.target.isContentEditable) toggleSound(); });
  paintSnd();

  let held = null;
  board.addEventListener('click', () => { if (!held) return; const open = !el.classList.contains('open'); el.classList.toggle('open', open); board.setAttribute('aria-expanded', open); sfx.open(); });
  el.querySelector('.again').addEventListener('click', () => held && copy(held));
  addEventListener('keydown', e => { if (e.key === 'Escape') { el.classList.remove('open'); board.setAttribute('aria-expanded', 'false'); } });

  // A paper copy of the document, drawn as an image so the genie strips are cheap to move.
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function paperImage(title, w, h, paper = '#e8e6db', kind) {
    if (kind === 'coupon') {   // a clipped coupon: dashed edge, heading, the black command bar, a tick box
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <rect width="${w}" height="${h}" fill="${paper}"/><rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="none" stroke="#1c1c1a" stroke-width="2" stroke-dasharray="7 5"/>
        <text x="20" y="34" font-family="Oswald, Impact, Arial Narrow, sans-serif" font-weight="500" font-size="16" letter-spacing="1" fill="#1c1c1a">CLIP &amp; PASTE IN YOUR TERMINAL TODAY</text>
        <rect x="20" y="48" width="${w - 40}" height="${h * .36}" fill="#1c1c1a"/>
        ${[0, 1, 2].map(i => `<rect x="32" y="${60 + i * 18}" width="${(w - 64) * (i === 2 ? .45 : 1)}" height="4" fill="#e2e0d4" opacity=".8"/>`).join('')}
        <rect x="20" y="${h - 58}" width="16" height="16" fill="none" stroke="#1c1c1a" stroke-width="2"/><rect x="46" y="${h - 52}" width="${w * .6}" height="4" fill="#1c1c1a" opacity=".6"/>
        <rect x="20" y="${h - 26}" width="${w * .5}" height="4" fill="#1c1c1a" opacity=".45"/></svg>`;
      return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
    }
    const m = w * .06, iw = w - 2 * m; let y = 74, rows = '';
    while (y < h - 40) {
      const tall = (y / 24) % 3 < 1 ? 66 : 44;
      rows += `<rect x="${m}" y="${y}" width="${iw}" height="${tall}" fill="none" stroke="#1c1c1a" stroke-width="1.4"/>` +
        `<rect x="${m + 8}" y="${y + 7}" width="${iw * .14}" height="3" fill="#1c1c1a" opacity=".8"/>` +
        Array.from({ length: Math.floor((tall - 20) / 14) }, (_, k) => `<rect x="${m + 8}" y="${y + 20 + k * 14}" width="${iw * (k % 2 ? .52 : .84)}" height="3" fill="#23253a" opacity=".45"/>`).join('');
      y += tall + 6;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect width="${w}" height="${h}" fill="${paper}"/><rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" fill="none" stroke="#1c1c1a" stroke-opacity=".2"/>
      <text x="${w / 2}" y="50" text-anchor="middle" font-family="Oswald, Impact, Arial Narrow, sans-serif" font-weight="700" font-size="${Math.min(42, w / 12)}" letter-spacing="3" fill="#1c1c1a">${esc(title.toUpperCase())}</text>
      <rect x="${w - m - 54}" y="26" width="54" height="16" fill="#8a63d2" opacity=".85"/>
      <rect x="${m}" y="62" width="${iw}" height="3.5" fill="#1c1c1a"/>${rows}</svg>`;
    return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  }

  // ---------------------------------------------------------------- genie
  // The paper is cut into vertical strips. Strips nearer the clipboard leave first, and each
  // strip squeezes to the clipboard's height before it travels, so the sheet bends into a funnel.
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const clamp = t => Math.max(0, Math.min(1, t));
  function genie(src, dst, title, paper, kind, done) {
    const N = 36, ghost = document.createElement('div'); ghost.className = 'cbd-ghost';
    const r = el.getBoundingClientRect(); ghost.style.left = -r.left + 'px'; ghost.style.top = -r.top + 'px';   // viewport coordinates inside the dock
    const img = paperImage(title, Math.round(src.width), Math.round(src.height), paper, kind), sw = src.width / N, strips = [];
    for (let i = 0; i < N; i++) {
      const s = document.createElement('div');
      s.style.cssText = `left:0;top:0;width:${sw + .6}px;height:${src.height}px;background-image:${img};background-size:${src.width}px ${src.height}px;background-position:${-i * sw}px 0;transform-origin:0 0`;
      ghost.append(s); strips.push(s);
    }
    el.append(ghost);
    const T = 620 * (window.__genieSlow || 1), t0 = performance.now();   // __genieSlow: slow it down to inspect
    const frame = () => {
      const t = clamp((performance.now() - t0) / T);
      // the sheet stays one ribbon: its right edge leads, and each strip sits against the next
      let right = src.left + src.width + (dst.left + dst.width - src.left - src.width) * ease(clamp(t / .62));
      for (let i = N - 1; i >= 0; i--) {
        const u = i / (N - 1), lag = (1 - u) * .42;               // right-hand strips go first
        const squeeze = ease(clamp((t - lag * .55) / .5));         // pinch to the clipboard's height
        const travel = ease(clamp((t - lag) / .58));               // and narrow to its width
        const w = sw + (dst.width / N - sw) * travel, x = right - w;
        const top = src.top + (dst.top - src.top) * squeeze, h = src.height + (dst.height - src.height) * squeeze;
        strips[i].style.transform = `translate(${x}px, ${top}px) scale(${(w + .6) / (sw + .6)}, ${h / src.height})`;
        right = x;
      }
      t < 1 ? requestAnimationFrame(frame) : (ghost.remove(), done());
    };
    frame();   // place the strips before the first paint, so nothing flashes
  }

  // ---------------------------------------------------------------- copy
  function land(item, fade) {
    slot.innerHTML = `<span class="page${fade ? ' fade' : ''}"${item.paper ? ` style="background:${item.paper}"` : ''}><b>${esc(item.title)}</b>${'<i></i>'.repeat(9)}</span>`;
    peek.querySelector('h3').textContent = item.title; peek.querySelector('p').textContent = item.text;
    board.setAttribute('aria-label', `Clipboard: ${item.title}. Press to see it`);
    tag.textContent = 'On the clipboard · paste it';
    el.classList.remove('jaw'); el.classList.add('snap'); setTimeout(() => el.classList.remove('snap'), 140);
    setTimeout(() => el.classList.remove('catch'), 420);
    sfx.clip(); sfx.got();
  }
  async function copy(item) {
    unlock();
    try { await navigator.clipboard.writeText(item.text); }
    catch { live.textContent = 'Could not copy. Select the text and copy it yourself.'; return; }
    held = item; live.textContent = `${item.title} copied to the clipboard.`;
    el.classList.remove('open'); board.setAttribute('aria-expanded', 'false');
    const from = item.from?.getBoundingClientRect();
    // the clipboard squares up and the clip opens, ready to take it
    el.classList.add('catch', 'jaw'); sfx.unclip();
    // Reduce motion: no flight, the copy fades onto the clipboard instead. ?motion=full forces the flight.
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches && new URLSearchParams(location.search).get('motion') !== 'full';
    if (!from || still || from.width < 40) { (item.sound === 'cut' ? sfx.cut() : item.sound === 'snip' ? sfx.snip() : (sfx.snip(), sfx.tear(0.22))); item.onLift?.(); setTimeout(() => land(item, true), item.sound === 'snip' ? 260 : 620); return; }
    // fly a copy no taller than the window, so the funnel stays on screen
    const src = { left: from.left, top: Math.max(from.top, 8), width: from.width, height: Math.min(from.height, innerHeight - 16 - Math.max(from.top, 8)) };
    const s = item.sound || 'tear';
    if (s === 'tear') { sfx.snip(); sfx.tear(0.22); sfx.fly(0.5); } else if (s === 'cut') { sfx.cut(); sfx.fly(0.5); } else { sfx.snip(); sfx.fly(0.24); }
    await new Promise(r => setTimeout(r, 260));                  // let the clipboard square up before aiming at it
    const to = slot.getBoundingClientRect();
    item.onLift?.();   // only now does the page show what was under it, as the copy takes off
    genie(src, to, item.title, item.paper, item.kind, () => land(item));
  }
  // Throw away what's on the clipboard: the page spins off the board and into the bin.
  function toss() {
    const page = slot.querySelector('.page'); if (!page) return;
    held = null; el.classList.remove('open'); board.setAttribute('aria-expanded', 'false');
    sfx.crumple();
    page.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate(-40px, -30px) rotate(-12deg) scale(.8)', opacity: 1, offset: .25 },
      { transform: 'translate(60px, 260px) rotate(160deg) scale(.25)', opacity: 0 }], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 650, easing: 'cubic-bezier(.4, 0, .7, .2)' })
      .finished.then(() => {
        slot.innerHTML = '<span class="empty">Nothing on the clipboard</span>';
        board.setAttribute('aria-label', 'Clipboard: nothing copied yet'); tag.textContent = 'Clipboard';
      });
  }
  window.dock = { copy, toss, play: name => { unlock(); sfx[name]?.(); } };
})();
