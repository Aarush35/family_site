/* Family Site effects: the deck settings, sound, the arena grid and the cursor trail.
   Everything here is exposed on window.FX for js/game.js and js/app.js. */
(function () {
  "use strict";

  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const params = new URLSearchParams(location.search);
  if (navigator.maxTouchPoints > 0 || matchMedia("(any-pointer: coarse)").matches) root.classList.add("touch");
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a, 0, 1).toFixed(3)})`;
  const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  /* Circuit colors as [accent, rival]. Keep in step with the [data-circuit] rules in css/site.css. */
  const PALETTE = {
    ion: ["#4de8ff", "#ff8b2b"],
    ember: ["#ff8b2b", "#4de8ff"],
    ultra: ["#b78aff", "#ffd84d"],
    volt: ["#a6ff4d", "#ff5fd2"],
    halo: ["#eef7ff", "#ff5a4a"]
  };
  const CIRCUITS = Object.keys(PALETTE);

  /* ---------- deck settings ---------- */
  const KEY = "family-site:deck:v1";
  const DEFAULTS = {
    circuit: "ion",
    motion: !reduced,
    waves: false,
    runners: true,
    ceiling: true,
    trail: finePointer && !reduced,
    scan: false,
    sound: false,
    glow: 100,
    speed: 100
  };
  const state = Object.assign({}, DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && typeof saved === "object") {
      for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === typeof DEFAULTS[k]) state[k] = saved[k];
    }
  } catch (e) { /* storage is optional */ }
  if (!CIRCUITS.includes(state.circuit)) state.circuit = DEFAULTS.circuit;
  state.glow = clamp(state.glow, 0, 150);
  state.speed = clamp(state.speed, 25, 300);
  state.sound = false; // browsers only allow audio after a click, so sound always starts off
  if (reduced) state.motion = false;

  const listeners = [];
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage is optional */ }
  }
  function applyToPage(k) {
    if (k === "circuit") root.setAttribute("data-circuit", state.circuit);
    if (k === "scan") root.setAttribute("data-scan", state.scan ? "on" : "off");
    if (k === "glow") root.style.setProperty("--glow", (state.glow / 100).toFixed(2));
  }
  const Settings = {
    CIRCUITS,
    DEFAULTS,
    get: (k) => state[k],
    all: () => Object.assign({}, state),
    set(k, v) {
      if (!(k in DEFAULTS)) return false;
      if (k === "glow") v = clamp(Math.round(Number(v)), 0, 150);
      if (k === "speed") v = clamp(Math.round(Number(v)), 25, 300);
      if (typeof v !== typeof DEFAULTS[k] || (typeof v === "number" && isNaN(v))) return false;
      if (k === "circuit" && !CIRCUITS.includes(v)) return false;
      if (state[k] === v) return true;
      state[k] = v;
      save();
      applyToPage(k);
      listeners.forEach((fn) => fn(k, v));
      return true;
    },
    toggle(k) { this.set(k, !state[k]); return state[k]; },
    reset() { for (const k of Object.keys(DEFAULTS)) this.set(k, DEFAULTS[k]); },
    on(fn) { listeners.push(fn); }
  };
  ["circuit", "scan", "glow"].forEach(applyToPage);

  /* ---------- canvas colors, eased so a circuit change fades ---------- */
  const Colors = {
    accent: hexToRgb(PALETTE[state.circuit][0]),
    rival: hexToRgb(PALETTE[state.circuit][1]),
    step(dt) {
      const ta = hexToRgb(PALETTE[state.circuit][0]), tr = hexToRgb(PALETTE[state.circuit][1]);
      const k = Math.min(1, dt * 7);
      let moving = false;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(ta[i] - this.accent[i]) > 0.6) { this.accent[i] += (ta[i] - this.accent[i]) * k; moving = true; } else this.accent[i] = ta[i];
        if (Math.abs(tr[i] - this.rival[i]) > 0.6) { this.rival[i] += (tr[i] - this.rival[i]) * k; moving = true; } else this.rival[i] = tr[i];
      }
      return moving;
    }
  };

  /* ---------- sound: short synth blips, no audio files ---------- */
  const Sound = (() => {
    let ac = null, master = null, on = false, noiseBuf = null;
    function ensure() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        try { ac = new AC(); } catch (e) { return false; }
        master = ac.createGain();
        master.gain.value = 0.22;
        master.connect(ac.destination);
      }
      if (ac.state === "suspended") ac.resume().catch(() => {});
      return true;
    }
    function tone(freq, dur, type, vol, slide, delay) {
      const t0 = ac.currentTime + (delay || 0);
      const osc = ac.createOscillator(), gain = ac.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol || 0.4, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain); gain.connect(master);
      osc.start(t0); osc.stop(t0 + dur + 0.03);
    }
    function noise(dur, vol, cutoff) {
      if (!noiseBuf) {
        noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.6), ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const t0 = ac.currentTime;
      const src = ac.createBufferSource(), gain = ac.createGain(), filter = ac.createBiquadFilter();
      src.buffer = noiseBuf;
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(cutoff, t0);
      filter.frequency.exponentialRampToValueAtTime(120, t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter); filter.connect(gain); gain.connect(master);
      src.start(t0); src.stop(t0 + dur);
    }
    const bank = {
      hover() { tone(1480, 0.03, "sine", 0.1); },
      click() { tone(620, 0.05, "square", 0.14); tone(930, 0.07, "sine", 0.2, null, 0.03); },
      on() { tone(520, 0.07, "triangle", 0.4); tone(780, 0.11, "triangle", 0.4, null, 0.07); },
      off() { tone(780, 0.07, "triangle", 0.4); tone(520, 0.11, "triangle", 0.4, null, 0.07); },
      open() { tone(300, 0.16, "sawtooth", 0.12, 900); },
      close() { tone(900, 0.14, "sawtooth", 0.1, 300); },
      pulse() { tone(140, 0.7, "sawtooth", 0.2, 880); tone(70, 0.5, "sine", 0.5, 40); },
      key() { tone(1100 + Math.random() * 200, 0.018, "square", 0.05); },
      error() { tone(160, 0.16, "square", 0.18); },
      turn() { tone(880, 0.025, "square", 0.07); },
      count() { tone(440, 0.09, "triangle", 0.35); },
      go() { tone(880, 0.22, "triangle", 0.4); },
      crash() { noise(0.45, 0.7, 2600); tone(220, 0.4, "sawtooth", 0.22, 40); },
      win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, "triangle", 0.35, null, i * 0.09)); },
      lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.16, "triangle", 0.3, null, i * 0.1)); }
    };
    return {
      setEnabled(v) { on = !!v; if (on) ensure(); },
      play(name) {
        if (!on || !bank[name] || !ensure()) return;
        try { bank[name](); } catch (e) { /* a failed blip is not worth surfacing */ }
      }
    };
  })();

  /* ---------- the arena: a perspective floor of light under the family name ---------- */
  const Arena = (() => {
    const hero = document.getElementById("arena");
    const canvas = document.getElementById("grid");
    const bloom = document.getElementById("bloom");
    const none = { pulse() {}, relayout() {}, setPaused() {}, kick() {} };
    if (!hero || !canvas || !canvas.getContext) return none;
    const ctx = canvas.getContext("2d");
    const bctx = bloom && bloom.getContext ? bloom.getContext("2d") : null;
    if (!ctx) return none;

    /* World units are grid cells. The camera looks down the +z axis from height camH. */
    const D0 = 2.6;      // depth of the floor at the bottom edge of the hero
    const FAR = 38;      // how far the floor is drawn
    const XR = 24;       // half-width of the floor in cells
    const TRAIL = 8;     // runner trail length in cells
    const DIR = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // away, right, toward, left
    const cam = { x: 0, tx: 0, z: 0 };
    const P = [0, 0];
    const ripples = [];
    const runners = [];
    let W = 1, H = 1, dpr = 1, hz = 1, f = 1, camH = 1;
    let t = 0, last = 0, raf = 0, onScreen = true, paused = false;
    let wavesAmt = state.waves ? 1 : 0, ceilAmt = state.ceiling ? 1 : 0, runAmt = state.runners ? 1 : 0;
    let quality = params.get("fx") === "max" ? -1 : 0; // -1 pins full quality
    let slowFrames = 0;

    function floorY(x, z) {
      let y = 0;
      if (wavesAmt > 0.002) {
        const side = smooth(1.2, 9, Math.abs(x));
        y += wavesAmt * camH * (0.05 + 0.42 * side) *
          (Math.sin(x * 0.55 + t * 0.8) * Math.cos(z * 0.42 - t * 0.6) + 0.5 * Math.sin(z * 0.23 + x * 0.31 + t * 0.4));
      }
      for (let i = 0; i < ripples.length; i++) {
        const rp = ripples[i];
        const k = Math.hypot(x - rp.x, z - rp.z) - rp.r;
        if (k > -1.5 && k < 1.5) y += rp.amp * Math.exp(-k * k * 3.4) * clamp((z - cam.z) / 9, 0.18, 1); // gentler close to the camera
      }
      return y;
    }
    function proj(x, z) {
      const k = f / (z - cam.z);
      P[0] = W / 2 + (x - cam.x) * k;
      P[1] = hz + (camH - floorY(x, z)) * k;
      return P;
    }

    function relayout() {
      const r = hero.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      dpr = Math.min(window.devicePixelRatio || 1, quality >= 2 ? 1 : quality === 1 ? 1.25 : 2);
      const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      if (bloom) {
        const bw = Math.max(1, Math.round(W / 2)), bh = Math.max(1, Math.round(H / 2));
        if (bloom.width !== bw || bloom.height !== bh) { bloom.width = bw; bloom.height = bh; }
      }
      /* The horizon sits on the baseline of the family name, wherever the type lands. */
      const sign = hero.querySelector("h1.sign"), mark = sign && sign.querySelector(".bl");
      let y = H * 0.54;
      if (mark) {
        const m = mark.getBoundingClientRect(), s = sign.getBoundingClientRect();
        if (s.height > 0) {
          y = m.bottom - r.top;
          hero.style.setProperty("--sign-d", Math.max(0, s.bottom - m.bottom).toFixed(1) + "px");
        }
      }
      hz = Math.round(clamp(y, H * 0.2, H * 0.8)) + 2;
      f = W * 0.6;
      camH = D0 * (H - hz) / f;
      while (runners.length < (W < 700 ? 3 : 6)) { const rn = {}; spawn(rn, true); rn.rival = runners.length % 3 === 2; runners.push(rn); }
      kick();
    }

    function spawn(rn, first) {
      const dz = first ? 6 + Math.random() * 20 : 10 + Math.random() * 18;
      rn.nx = Math.round(cam.x + (Math.random() * 2 - 1) * Math.min(9, dz * 0.45));
      rn.nz = Math.round(cam.z + dz);
      rn.dir = Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? 1 : 3);
      rn.prog = 0;
      rn.speed = 3 + Math.random() * 2.4;
      rn.alpha = 0;
      rn.dying = false;
      rn.pts = [[rn.nx, rn.nz]];
      rn.hx = rn.nx; rn.hz = rn.nz;
    }
    function stepRunner(rn, dt, spd) {
      rn.alpha = clamp(rn.alpha + (rn.dying ? -dt * 2.5 : dt * 2), 0, 1);
      if (rn.dying && rn.alpha <= 0) { spawn(rn, false); return; }
      rn.prog += dt * rn.speed * (0.5 + 0.5 * spd);
      while (rn.prog >= 1) {
        rn.prog -= 1;
        rn.nx += DIR[rn.dir][0]; rn.nz += DIR[rn.dir][1];
        const roll = Math.random();
        let nd = rn.dir;
        if (roll < 0.16) nd = (rn.dir + 1) % 4; else if (roll < 0.32) nd = (rn.dir + 3) % 4;
        if (nd === 2 && Math.random() < 0.75) nd = rn.dir === 2 ? 1 : rn.dir; // seldom straight at the camera
        if (nd !== rn.dir) { rn.pts.push([rn.nx, rn.nz]); rn.dir = nd; }
      }
      rn.hx = rn.nx + DIR[rn.dir][0] * rn.prog;
      rn.hz = rn.nz + DIR[rn.dir][1] * rn.prog;
      /* Trim the tail so the trail stays TRAIL cells long. */
      let len = 0, px = rn.hx, pz = rn.hz;
      for (let i = rn.pts.length - 1; i >= 0; i--) {
        const c = rn.pts[i], seg = Math.abs(c[0] - px) + Math.abs(c[1] - pz);
        if (len + seg >= TRAIL) {
          const keep = (TRAIL - len) / (seg || 1);
          c[0] = px + (c[0] - px) * keep; c[1] = pz + (c[1] - pz) * keep;
          if (i > 0) rn.pts.splice(0, i);
          break;
        }
        len += seg; px = c[0]; pz = c[1];
      }
      const dz = rn.hz - cam.z;
      if (!rn.dying && (dz < D0 * 0.95 || dz > FAR * 0.8 || Math.abs(rn.hx - cam.x) > (W / 2) / f * dz + 4)) rn.dying = true;
    }
    function drawRunner(rn, col) {
      const near = D0 * 0.72;
      let px = rn.hx, pz = rn.hz, dist = 0;
      ctx.lineCap = "round";
      for (let i = rn.pts.length - 1; i >= 0; i--) {
        const c = rn.pts[i], seg = Math.abs(c[0] - px) + Math.abs(c[1] - pz);
        const n = Math.max(1, Math.ceil(seg / 0.5));
        for (let j = 0; j < n; j++) {
          const a0 = j / n, a1 = (j + 1) / n;
          const x0 = px + (c[0] - px) * a0, z0 = pz + (c[1] - pz) * a0;
          const x1 = px + (c[0] - px) * a1, z1 = pz + (c[1] - pz) * a1;
          const dzm = (z0 + z1) / 2 - cam.z;
          if (z0 - cam.z < near || z1 - cam.z < near) continue;
          const fade = 1 - (dist + seg * (a0 + a1) / 2) / TRAIL;
          const depth = clamp(1.25 - dzm / (FAR * 0.8), 0.12, 1);
          proj(x0, z0);
          const sx = P[0], sy = P[1];
          proj(x1, z1);
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(P[0], P[1]);
          ctx.strokeStyle = rgba(col, fade * rn.alpha * runAmt * depth);
          ctx.lineWidth = clamp(0.02 * f / dzm, 1, 5);
          ctx.stroke();
        }
        dist += seg; px = c[0]; pz = c[1];
      }
      const dz = rn.hz - cam.z;
      if (dz > near) {
        proj(rn.hx, rn.hz);
        const r = clamp(0.085 * f / dz, 2.5, 22), a = rn.alpha * runAmt;
        const g = ctx.createRadialGradient(P[0], P[1], 0, P[0], P[1], r);
        g.addColorStop(0, `rgba(255,255,255,${(0.95 * a).toFixed(3)})`);
        g.addColorStop(0.25, rgba(col, 0.8 * a));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(P[0], P[1], r, 0, Math.PI * 2); ctx.fill();
      }
    }

    function draw() {
      const glow = state.glow / 100;
      const A = Colors.accent, R = Colors.rival;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";

      /* haze along the horizon */
      ctx.save();
      ctx.translate(W / 2, hz); ctx.scale(1, 0.2);
      const hazeR = Math.max(W * 0.62, 420);
      const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, hazeR);
      haze.addColorStop(0, rgba(A, 0.2 + 0.16 * Math.min(glow, 1.5)));
      haze.addColorStop(0.45, rgba(A, 0.07));
      haze.addColorStop(1, rgba(A, 0));
      ctx.fillStyle = haze;
      ctx.fillRect(-hazeR, -hazeR, hazeR * 2, hazeR * 2);
      ctx.restore();

      /* floor lines, built once and stroked for the floor and again, mirrored, for the ceiling */
      const bent = wavesAmt > 0.002 || ripples.length > 0;
      const near = D0 * 0.78;
      const path = new Path2D();
      const k0 = Math.ceil(cam.z + near), k1 = Math.floor(cam.z + FAR);
      for (let k = k0; k <= k1; k++) {
        const dz = k - cam.z, hw = Math.min(XR, (W / 2) / f * dz + 1.5);
        const xa = cam.x - hw, xb = cam.x + hw;
        if (bent) {
          const step = dz < 14 ? 0.5 : 1;
          let first = true;
          for (let x = xa; x <= xb + 0.001; x += step) {
            proj(x, k);
            if (first) { path.moveTo(P[0], P[1]); first = false; } else path.lineTo(P[0], P[1]);
          }
        } else {
          proj(xa, k); path.moveTo(P[0], P[1]);
          proj(xb, k); path.lineTo(P[0], P[1]);
        }
      }
      const x0 = Math.ceil(cam.x - XR), x1 = Math.floor(cam.x + XR), zs = bent ? 26 : 1;
      for (let x = x0; x <= x1; x++) {
        for (let i = 0; i <= zs; i++) {
          proj(x, cam.z + near * Math.pow(FAR / near, i / zs));
          if (i === 0) path.moveTo(P[0], P[1]); else path.lineTo(P[0], P[1]);
        }
      }
      const lg = ctx.createLinearGradient(0, hz, 0, H);
      lg.addColorStop(0, rgba(A, 0));
      lg.addColorStop(0.03, rgba(A, 0.2));
      lg.addColorStop(0.3, rgba(A, 0.5));
      lg.addColorStop(1, rgba(A, 0.92));
      ctx.lineWidth = 1.15;
      ctx.lineJoin = "round";
      ctx.strokeStyle = lg;
      ctx.stroke(path);
      if (ceilAmt > 0.01) {
        ctx.save();
        ctx.translate(0, hz); ctx.scale(1, -(hz / Math.max(1, H - hz))); ctx.translate(0, -hz);
        ctx.globalAlpha = 0.22 * ceilAmt;
        ctx.stroke(path);
        ctx.restore();
      }

      /* the horizon itself */
      const hg = ctx.createLinearGradient(0, 0, W, 0);
      hg.addColorStop(0, rgba(A, 0));
      hg.addColorStop(0.18, rgba(A, 0.75));
      hg.addColorStop(0.5, "rgba(255,255,255,0.95)");
      hg.addColorStop(0.82, rgba(A, 0.75));
      hg.addColorStop(1, rgba(A, 0));
      ctx.fillStyle = hg;
      ctx.fillRect(0, hz - 1, W, 2);

      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < ripples.length; i++) {
        const rp = ripples[i];
        ctx.beginPath();
        let open = false;
        for (let s = 0; s <= 72; s++) {
          const a = s / 72 * Math.PI * 2, x = rp.x + Math.cos(a) * rp.r, z = rp.z + Math.sin(a) * rp.r, dz = z - cam.z;
          if (dz < near || dz > FAR) { open = false; continue; }
          proj(x, z);
          if (!open) { ctx.moveTo(P[0], P[1]); open = true; } else ctx.lineTo(P[0], P[1]);
        }
        ctx.strokeStyle = rgba(A, 0.9 * rp.life);
        ctx.lineWidth = 1 + 2.2 * rp.life;
        ctx.stroke();
      }
      if (runAmt > 0.01) for (let i = 0; i < runners.length; i++) drawRunner(runners[i], runners[i].rival ? R : A);
      ctx.globalCompositeOperation = "source-over";

      if (bctx && quality < 2) {
        bctx.clearRect(0, 0, bloom.width, bloom.height);
        if (glow > 0.02) bctx.drawImage(canvas, 0, 0, bloom.width, bloom.height);
      }
    }

    function active() { return onScreen && !paused && !document.hidden; }
    function kick() { if (!raf && active()) { last = 0; raf = requestAnimationFrame(frame); } }
    function ease(cur, target, dt, rate) { return Math.abs(target - cur) > 0.002 ? cur + (target - cur) * Math.min(1, dt * rate) : target; }
    function frame(now) {
      raf = 0;
      if (!active()) return;
      const raw = last ? (now - last) / 1000 : 0.016;
      last = now;
      const dt = Math.min(0.05, raw);
      const moving = state.motion, spd = state.speed / 100;
      let busy = moving;
      if (moving) { t += dt * (0.6 + 0.4 * spd); cam.z += dt * 2 * spd; }
      if (Math.abs(cam.tx - cam.x) > 0.0015) { cam.x += (cam.tx - cam.x) * Math.min(1, dt * 4.5); busy = true; }
      const w = ease(wavesAmt, state.waves ? 1 : 0, dt, 3.2), c = ease(ceilAmt, state.ceiling ? 1 : 0, dt, 5), rn = ease(runAmt, state.runners ? 1 : 0, dt, 5);
      if (w !== wavesAmt || c !== ceilAmt || rn !== runAmt) busy = true;
      wavesAmt = w; ceilAmt = c; runAmt = rn;
      if (Colors.step(dt)) busy = true;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        if (rp.wait > 0) { rp.wait -= dt; busy = true; continue; }
        rp.r += dt * 7.5;
        rp.life -= dt / 2.4;
        rp.amp = rp.amp0 * Math.pow(Math.max(0, rp.life), 1.4);
        if (rp.life <= 0) ripples.splice(i, 1); else busy = true;
      }
      if (moving && runAmt > 0.01) for (let i = 0; i < runners.length; i++) stepRunner(runners[i], dt, spd);
      draw();
      /* If the device cannot keep up, step the quality down: lower pixel density first, then no bloom. */
      if (quality >= 0 && quality < 2 && moving) {
        slowFrames = raw > 0.04 ? slowFrames + 1 : Math.max(0, slowFrames - 0.5);
        if (slowFrames > 80) {
          quality += 1; slowFrames = 0;
          if (quality >= 2) root.setAttribute("data-fx", "lite");
          relayout();
        }
      }
      if (busy) raf = requestAnimationFrame(frame);
    }

    function addRipple(x, z, amp, wait) {
      if (ripples.length >= 6) ripples.shift();
      ripples.push({ x, z, r: 0, life: 1, amp0: amp * camH, amp: amp * camH, wait: wait || 0 });
      kick();
    }
    function rippleAt(sx, sy) {
      let dz = sy > hz + 6 ? camH * f / (sy - hz) : 26;
      dz = clamp(dz, D0, 30);
      addRipple(cam.x + (sx - W / 2) * dz / f, cam.z + dz, 0.3);
    }

    hero.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const r = hero.getBoundingClientRect();
      cam.tx = ((e.clientX - r.left) / r.width - 0.5) * 1.5;
      kick();
    });
    hero.addEventListener("pointerleave", () => { cam.tx = 0; kick(); });
    hero.addEventListener("click", (e) => {
      if (e.target.closest("a, button, input, label")) return;
      const r = hero.getBoundingClientRect();
      rippleAt(e.clientX - r.left, e.clientY - r.top);
      Sound.play("pulse");
    });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => { onScreen = entries[0].isIntersecting; if (onScreen) kick(); }).observe(hero);
    }
    if ("ResizeObserver" in window) new ResizeObserver(() => relayout()).observe(hero);
    else window.addEventListener("resize", relayout);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); });
    Settings.on(() => kick());

    return {
      relayout,
      kick,
      setPaused(v) { paused = !!v; if (!paused) kick(); },
      pulse() {
        addRipple(cam.x, cam.z + 7, 0.42);
        addRipple(cam.x, cam.z + 7, 0.26, 0.22);
      }
    };
  })();

  /* ---------- cursor trail: the pointer leaves a right-angled trace that fades ---------- */
  const Trail = (() => {
    const canvas = document.getElementById("trail");
    if (!canvas || !canvas.getContext) return { block() {} };
    const ctx = canvas.getContext("2d");
    const STEP = 14, LIFE = 650, SPARK = 460;
    let W = 0, H = 0, dpr = 1, raf = 0, blocked = false, cell = null;
    let pts = [], sparks = [];

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }
    function frame(now) {
      raf = 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (blocked || !state.trail) { pts = []; sparks = []; return; }
      const A = Colors.accent, glow = state.glow / 100;
      Colors.step(0.016);
      while (pts.length > 1 && now - pts[1].t > LIFE) pts.shift();
      if (pts.length === 1 && now - pts[0].t > LIFE) pts = [];
      ctx.lineCap = "square";
      ctx.lineWidth = 2;
      ctx.shadowColor = rgba(A, 0.9);
      ctx.shadowBlur = 10 * glow;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i], q = pts[i - 1];
        if (p.gap) continue;
        const a = 1 - (now - p.t) / LIFE;
        if (a <= 0) continue;
        ctx.strokeStyle = rgba(A, a * 0.9);
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      if (pts.length) {
        const h = pts[pts.length - 1], a = 1 - (now - h.t) / LIFE;
        if (a > 0) { ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`; ctx.fillRect(h.x - 2.5, h.y - 2.5, 5, 5); }
      }
      sparks = sparks.filter((s) => now - s.t < SPARK);
      ctx.lineWidth = 1.5;
      for (const s of sparks) {
        const k = (now - s.t) / SPARK, r = 5 + 26 * (1 - (1 - k) * (1 - k));
        ctx.strokeStyle = rgba(A, 1 - k);
        ctx.strokeRect(s.x - r, s.y - r, r * 2, r * 2);
        ctx.beginPath();
        for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.moveTo(s.x + d[0] * (r + 4), s.y + d[1] * (r + 4));
          ctx.lineTo(s.x + d[0] * (r + 12), s.y + d[1] * (r + 12));
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      if (pts.length || sparks.length) raf = requestAnimationFrame(frame);
    }
    function onMove(e) {
      if (blocked || !state.trail || e.pointerType === "touch") return;
      const now = performance.now();
      const gx = Math.round(e.clientX / STEP) * STEP, gy = Math.round(e.clientY / STEP) * STEP;
      if (cell && pts.length && gx === cell.x && gy === cell.y) return;
      const fresh = !cell || !pts.length || Math.abs(gx - cell.x) + Math.abs(gy - cell.y) > STEP * 14;
      if (fresh) pts.push({ x: gx, y: gy, t: now, gap: true });
      else {
        const dx = gx - cell.x, dy = gy - cell.y;
        if (dx && dy) pts.push(Math.abs(dx) >= Math.abs(dy) ? { x: gx, y: cell.y, t: now } : { x: cell.x, y: gy, t: now });
        pts.push({ x: gx, y: gy, t: now });
      }
      cell = { x: gx, y: gy };
      if (pts.length > 400) pts.splice(0, pts.length - 400);
      kick();
    }
    function onDown(e) {
      if (blocked || !state.trail || e.pointerType === "touch") return;
      sparks.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      kick();
    }
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    Settings.on((k) => { if (k === "trail") kick(); });
    return { block(v) { blocked = !!v; kick(); } };
  })();

  window.FX = { Settings, Sound, Arena, Trail, Colors, PALETTE, reduced, finePointer, clamp, rgba, hexToRgb };
})();
