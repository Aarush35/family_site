/* Trail duel: steer a line of light around the arena and outlast the others.
   Exposes window.TrailDuel = { mount, onOpen, onClose, handleKey }. */
(function () {
  "use strict";

  const { Settings, Sound, Colors, PALETTE, clamp, rgba, hexToRgb } = window.FX;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // right, down, left, up
  const BEST_KEY = "family-site:duel-best:v1";
  /* Opponent colors per circuit, so no opponent ever matches the player's color. */
  const FOES = {
    ion: ["#ff8b2b", "#ff5fd2", "#ffd84d"],
    ember: ["#4de8ff", "#b78aff", "#a6ff4d"],
    ultra: ["#ffd84d", "#4de8ff", "#ff5a4a"],
    volt: ["#ff5fd2", "#4de8ff", "#ffd84d"],
    halo: ["#ff5a4a", "#4de8ff", "#ffd84d"]
  };

  const el = {};
  let ctx = null;
  let COLS = 56, ROWS = 34, cell = 10, ox = 0, oy = 0, W = 0, H = 0, dpr = 1;
  let grid = new Uint8Array(COLS * ROWS), seen = new Uint16Array(COLS * ROWS), stamp = 0, queue = new Int32Array(COLS * ROWS);
  let riders = [], sparks = [];
  let mode = "menu"; // menu | count | play | over
  let round = 1, streak = 0, best = 0;
  let tickMs = 72, acc = 0, last = 0, raf = 0, countAt = 0, countShown = 0, open = false, endTimer = 0;

  function loadBest() {
    try { best = Math.max(0, parseInt(localStorage.getItem(BEST_KEY), 10) || 0); } catch (e) { best = 0; }
  }
  function saveBest() {
    try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* storage is optional */ }
  }
  function hud() {
    el.round.textContent = round;
    el.streak.textContent = streak;
    el.best.textContent = best;
  }
  function message(big, sub, button) {
    el.msg.hidden = false;
    el.msg.dataset.mode = "menu";
    el.big.textContent = big;
    el.sub.textContent = sub;
    el.go.querySelector(".btn-face").textContent = button;
  }

  function fit() {
    const r = el.stage.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.canvas.width = Math.round(W * dpr); el.canvas.height = Math.round(H * dpr);
    cell = Math.max(3, Math.min(W / COLS, H / ROWS));
    ox = (W - cell * COLS) / 2; oy = (H - cell * ROWS) / 2;
  }
  function shape() {
    /* A tall arena on narrow screens, a wide one everywhere else. */
    const tall = window.innerWidth < 620;
    COLS = tall ? 30 : 56; ROWS = tall ? 38 : 34;
    el.stage.style.aspectRatio = COLS + " / " + ROWS;
    el.game.style.setProperty("--ar", (COLS / ROWS).toFixed(3));
    grid = new Uint8Array(COLS * ROWS); seen = new Uint16Array(COLS * ROWS); queue = new Int32Array(COLS * ROWS); stamp = 0;
    fit();
    return tall;
  }

  function addRider(human, x, y, dir, rgb) {
    const r = { id: riders.length, human, x, y, px: x, py: y, dir, alive: true, rgb, turns: [], path: [[x, y]], deadAt: 0, hit: false, tx: x, ty: y };
    grid[y * COLS + x] = r.id + 1;
    riders.push(r);
  }
  function setup() {
    const tall = shape();
    riders = []; sparks = [];
    const midX = Math.floor(COLS / 2), midY = Math.floor(ROWS / 2);
    const foes = Math.min(3, 1 + Math.floor((round - 1) / 2));
    const foeColors = FOES[Settings.get("circuit")] || FOES.ion;
    addRider(true, tall ? midX : 7, tall ? ROWS - 6 : midY, tall ? 3 : 0, hexToRgb(PALETTE[Settings.get("circuit")][0]));
    const spots = tall
      ? [[midX, 5, 1], [6, 8, 1], [COLS - 7, 8, 1]]
      : [[COLS - 8, midY, 2], [COLS - 8, 7, 2], [COLS - 8, ROWS - 8, 2]];
    const pick = foes === 1 ? [0] : foes === 2 ? [1, 2] : [0, 1, 2];
    pick.forEach((s, i) => addRider(false, spots[s][0], spots[s][1], spots[s][2], hexToRgb(foeColors[i])));
    tickMs = Math.max(44, 76 - (round - 1) * 4);
    acc = 0;
    hud();
  }

  const free = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && grid[y * COLS + x] === 0;
  function flood(x, y, limit) {
    if (++stamp > 65000) { seen.fill(0); stamp = 1; }
    let head = 0, tail = 0, count = 0;
    queue[tail++] = y * COLS + x; seen[y * COLS + x] = stamp;
    while (head < tail && count < limit) {
      const idx = queue[head++], cx = idx % COLS, cy = (idx - cx) / COLS;
      count++;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (!free(nx, ny)) continue;
        const ni = ny * COLS + nx;
        if (seen[ni] === stamp) continue;
        seen[ni] = stamp; queue[tail++] = ni;
      }
    }
    return count;
  }
  function think(r) {
    const me = riders[0];
    const options = [r.dir, (r.dir + 1) % 4, (r.dir + 3) % 4];
    const careless = Math.random() < 0.05;
    const aimX = me.x + DIRS[me.dir][0] * 5, aimY = me.y + DIRS[me.dir][1] * 5;
    const here = Math.abs(aimX - r.x) + Math.abs(aimY - r.y);
    let bestDir = r.dir, bestScore = -1;
    for (const d of options) {
      const nx = r.x + DIRS[d][0], ny = r.y + DIRS[d][1];
      if (!free(nx, ny)) continue;
      let score = careless ? 40 : flood(nx, ny, 240);
      if (d === r.dir) score += 4;
      if (me.alive && round > 1) score += (here - (Math.abs(aimX - nx) + Math.abs(aimY - ny))) * 2.2; // close in on the player
      score += Math.random() * 3.5;
      if (score > bestScore) { bestScore = score; bestDir = d; }
    }
    return bestDir;
  }
  function turn(r, d) {
    r.path.push([r.x, r.y]);
    r.dir = d;
  }
  function crash(r, now) {
    r.alive = false; r.deadAt = now;
    const tag = r.id + 1;
    for (let i = 0; i < grid.length; i++) if (grid[i] === tag) grid[i] = 0;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 220;
      sparks.push({ x: ox + (r.x + 0.5) * cell, y: oy + (r.y + 0.5) * cell, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: now, rgb: r.rgb, s: 2 + Math.random() * 4 });
    }
    Sound.play("crash");
  }
  function tick(now) {
    const live = riders.filter((r) => r.alive);
    for (const r of live) {
      if (r.human) {
        while (r.turns.length) {
          const d = r.turns.shift();
          if (d !== r.dir && d !== (r.dir + 2) % 4) { turn(r, d); Sound.play("turn"); break; }
        }
      } else {
        const d = think(r);
        if (d !== r.dir) turn(r, d);
      }
      r.tx = r.x + DIRS[r.dir][0]; r.ty = r.y + DIRS[r.dir][1];
      r.hit = !free(r.tx, r.ty);
    }
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      if (live[i].tx === live[j].tx && live[i].ty === live[j].ty) live[i].hit = live[j].hit = true;
    }
    for (const r of live) {
      r.px = r.x; r.py = r.y;
      if (r.hit) { crash(r, now); continue; }
      r.x = r.tx; r.y = r.ty;
      grid[r.y * COLS + r.x] = r.id + 1;
    }
    const me = riders[0];
    if (!me.alive) finish(false);
    else if (!riders.some((r) => !r.human && r.alive)) finish(true);
  }
  function finish(won) {
    mode = "over";
    const cleared = round;
    if (won) {
      streak += 1; round += 1;
      if (streak > best) { best = streak; saveBest(); }
    } else {
      streak = 0; round = 1;
    }
    clearTimeout(endTimer);
    endTimer = setTimeout(() => {
      if (!open || mode !== "over") return;
      hud();
      Sound.play(won ? "win" : "lose");
      if (won) {
        const next = cleared === 2 || cleared === 4 ? "The next round is faster and adds an opponent." : cleared < 9 ? "The next round is faster." : "You're at top speed. Keep the streak alive.";
        message("Round " + cleared + " won", "Streak " + streak + ". " + next, "Start round " + round);
      }
      else message("You crashed", cleared > 1 ? "You made it to round " + cleared + ". Back to round 1." : "Hit a wall or a trail and the round is over.", "Try again");
      el.go.focus({ preventScroll: true });
    }, 650);
  }

  function draw(now) {
    const glow = Settings.get("glow") / 100;
    Colors.step(0.016);
    const A = Colors.accent;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#020812";
    ctx.fillRect(0, 0, W, H);
    const aw = COLS * cell, ah = ROWS * cell;
    ctx.beginPath();
    for (let c = 2; c < COLS; c += 2) { const x = Math.round(ox + c * cell) + 0.5; ctx.moveTo(x, oy); ctx.lineTo(x, oy + ah); }
    for (let r = 2; r < ROWS; r += 2) { const y = Math.round(oy + r * cell) + 0.5; ctx.moveTo(ox, y); ctx.lineTo(ox + aw, y); }
    ctx.strokeStyle = rgba(A, 0.1); ctx.lineWidth = 1; ctx.stroke();
    ctx.shadowColor = rgba(A, 1); ctx.shadowBlur = 12 * glow;
    ctx.strokeStyle = rgba(A, 0.95); ctx.lineWidth = 2;
    ctx.strokeRect(ox + 1, oy + 1, aw - 2, ah - 2);

    const k = mode === "play" ? clamp(acc / tickMs, 0, 1) : 1;
    const cx = (x) => ox + (x + 0.5) * cell, cy = (y) => oy + (y + 0.5) * cell;
    ctx.lineJoin = "miter"; ctx.lineCap = "square";
    for (const r of riders) {
      const fade = r.alive ? 1 : 1 - (now - r.deadAt) / 500;
      if (fade <= 0) continue;
      const hx = r.alive ? r.px + (r.x - r.px) * k : r.x, hy = r.alive ? r.py + (r.y - r.py) * k : r.y;
      ctx.beginPath();
      ctx.moveTo(cx(r.path[0][0]), cy(r.path[0][1]));
      for (let i = 1; i < r.path.length; i++) ctx.lineTo(cx(r.path[i][0]), cy(r.path[i][1]));
      ctx.lineTo(cx(hx), cy(hy));
      ctx.strokeStyle = rgba(r.rgb, fade);
      ctx.lineWidth = Math.max(2, cell * 0.36);
      ctx.shadowColor = rgba(r.rgb, 1); ctx.shadowBlur = 10 * glow;
      ctx.stroke();
      if (r.alive) {
        const s = Math.max(4, cell * 0.64);
        ctx.fillStyle = "#fff";
        ctx.fillRect(cx(hx) - s / 2, cy(hy) - s / 2, s, s);
      }
    }
    ctx.shadowBlur = 0;
    sparks = sparks.filter((s) => now - s.t < 700);
    for (const s of sparks) {
      const age = (now - s.t) / 1000;
      ctx.fillStyle = rgba(s.rgb, 1 - age / 0.7);
      ctx.fillRect(s.x + s.vx * age - s.s / 2, s.y + s.vy * age - s.s / 2, s.s, s.s);
    }
  }
  function loop(now) {
    raf = 0;
    if (!open) return;
    const dt = last ? Math.min(100, now - last) : 16;
    last = now;
    if (mode === "count") {
      const left = 3 - Math.floor((now - countAt) / 620);
      if (left !== countShown) {
        countShown = left;
        if (left > 0) { el.big.textContent = String(left); Sound.play("count"); }
        else { el.msg.hidden = true; mode = "play"; acc = 0; Sound.play("go"); }
      }
    } else if (mode === "play") {
      acc += dt;
      let guard = 0;
      while (acc >= tickMs && mode === "play" && guard++ < 4) { acc -= tickMs; tick(now); }
      if (guard >= 4) acc = 0;
    }
    draw(now);
    raf = requestAnimationFrame(loop);
  }

  function begin() {
    if (mode === "play" || mode === "count") return;
    clearTimeout(endTimer);
    setup();
    mode = "count"; countAt = performance.now(); countShown = 0;
    el.msg.hidden = false; el.msg.dataset.mode = "count"; el.big.textContent = "3";
    el.canvas.focus({ preventScroll: true });
  }
  function steer(d) {
    if (mode !== "play" && mode !== "count") return;
    const me = riders[0];
    if (me && me.turns.length < 3) me.turns.push(d);
  }
  function steerSide(side) {
    const me = riders[0];
    if (!me) return;
    const from = me.turns.length ? me.turns[me.turns.length - 1] : me.dir;
    steer((from + (side > 0 ? 1 : 3)) % 4);
  }

  const KEYS = { ArrowRight: 0, d: 0, ArrowDown: 1, s: 1, ArrowLeft: 2, a: 2, ArrowUp: 3, w: 3 };
  function handleKey(e) {
    if (!open) return false;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key in KEYS) { steer(KEYS[key]); return true; }
    if (key === " " || key === "Enter") {
      if (mode === "menu" || mode === "over") { if (!el.msg.hidden) begin(); return true; }
      return key === " ";
    }
    return false;
  }

  function mount() {
    el.game = document.querySelector("#game .game");
    el.stage = document.getElementById("game-stage");
    el.canvas = document.getElementById("game-canvas");
    el.msg = document.getElementById("game-msg");
    el.big = document.getElementById("game-big");
    el.sub = document.getElementById("game-sub");
    el.go = document.getElementById("game-go");
    el.round = document.getElementById("g-round");
    el.streak = document.getElementById("g-streak");
    el.best = document.getElementById("g-best");
    if (!el.canvas || !el.canvas.getContext) return false;
    ctx = el.canvas.getContext("2d");
    el.canvas.tabIndex = -1;
    el.canvas.setAttribute("role", "img");
    el.canvas.setAttribute("aria-label", "Trail duel arena");
    loadBest();
    el.go.addEventListener("click", begin);
    document.getElementById("g-left").addEventListener("click", () => steerSide(-1));
    document.getElementById("g-right").addEventListener("click", () => steerSide(1));
    el.canvas.addEventListener("pointerdown", (e) => {
      if (mode !== "play") return;
      const r = el.canvas.getBoundingClientRect();
      steerSide(e.clientX - r.left < r.width / 2 ? -1 : 1);
    });
    window.addEventListener("resize", () => { if (open) fit(); });
    return true;
  }
  function onOpen() {
    open = true;
    round = 1; streak = 0; mode = "menu";
    setup();
    message("Trail duel", "Steer your line of light. Hit a wall or any trail and you're out. Last one moving wins the round.", "Start the round");
    last = 0;
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function onClose() {
    open = false;
    mode = "menu";
    clearTimeout(endTimer);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  window.TrailDuel = { mount, onOpen, onClose, handleKey, steerSide, begin };
})();
