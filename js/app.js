/* Family Site: draws the page from window.SITE and wires up the control deck,
   the console, the photo viewer, trail duel and the keyboard shortcuts. */
(function () {
  "use strict";

  const SITE = window.SITE;
  const { Settings, Sound, Arena, Trail, reduced, finePointer, clamp } = window.FX;
  const Duel = window.TrailDuel;
  const root = document.documentElement;

  /* ---------- helpers ---------- */
  const $ = (sel, scope) => (scope || document).querySelector(sel);
  const $$ = (sel, scope) => Array.from((scope || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad2 = (n) => String(n).padStart(2, "0");
  const plural = (n, word) => (n === 1 ? word : word + "s");
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function fmtDate(s, long) {
    if (!s) return "";
    const [y, m, d] = String(s).split("-").map(Number);
    const name = MONTHS[(m || 1) - 1] || "";
    return `${long ? name : name.slice(0, 3)} ${d || 1}, ${y}`;
  }
  function initials(name) { return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase(); }
  function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const crew = SITE.crew || [], photos = SITE.photos || [], missions = SITE.missions || [];
  const members = crew.filter((m) => !m.open);
  const points = (list) => list.reduce((n, m) => n + (m.points || 0), 0);
  const earned = points(missions.filter((m) => m.status === "complete"));
  const inPlay = points(missions) - earned;
  const STATUS = { started: "In progress", submitted: "Proof submitted", complete: "Complete" };
  const LABEL = { motion: "Grid motion", waves: "Floor waves", runners: "Light runners", ceiling: "Ceiling grid", trail: "Cursor trail", scan: "Scanlines", sound: "Sound" };
  const CIRCUIT_NAME = { ion: "Ion", ember: "Ember", ultra: "Ultra", volt: "Volt", halo: "Halo" };

  /* ---------- sigils: a mirrored circuit glyph grown from a name ---------- */
  const OCTAGON = "M29 3H71L97 29V71L71 97H29L3 71V29Z";
  function sigil(seed) {
    const rand = mulberry32(hashStr(seed));
    const N = 7, PAD = 23, STEP = (100 - PAD * 2) / (N - 1), HALF = 3;
    const at = (i) => +(PAD + i * STEP).toFixed(2);
    const paths = [], nodes = [];
    /* Four traces, each starting in its own band of rows so the glyph fills the frame. */
    const rows = [0, 2, 4, 5].map((row) => row + Math.floor(rand() * 2));
    for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
    rows.forEach((row, tr) => {
      let x = Math.floor(rand() * (HALF + 1)), y = clamp(row, 0, N - 1);
      let d = `M${at(x)} ${at(y)}`;
      nodes.push([x, y]);
      let horiz = rand() < 0.5;
      const steps = 3 + Math.floor(rand() * 3);
      for (let s = 0; s < steps; s++) {
        const len = 1 + Math.floor(rand() * 3), dir = rand() < 0.5 ? -1 : 1;
        if (horiz) { let nx = clamp(x + dir * len, 0, HALF); if (nx === x) nx = x < HALF ? x + 1 : x - 1; x = nx; }
        else { let ny = clamp(y + dir * len, 0, N - 1); if (ny === y) ny = y < N - 1 ? y + 1 : y - 1; y = ny; }
        d += `L${at(x)} ${at(y)}`;
        horiz = !horiz;
      }
      if (tr === 0 && x !== HALF) { x = HALF; d += `L${at(x)} ${at(y)}`; } // one trace always reaches the middle, so the two halves join
      nodes.push([x, y]);
      paths.push(d);
    });
    const half = paths.map((d) => `<path class="sig-trace" pathLength="1" d="${d}"/>`).join("") +
      nodes.map(([x, y]) => `<rect x="${(at(x) - 2.8).toFixed(2)}" y="${(at(y) - 2.8).toFixed(2)}" width="5.6" height="5.6" fill="currentColor" stroke="none"/>`).join("");
    return `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="square" aria-hidden="true" focusable="false"><path d="${OCTAGON}" stroke-width="2"/><g>${half}</g><g transform="matrix(-1 0 0 1 100 0)">${half}</g></svg>`;
  }
  const FRAME_SVG = `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" aria-hidden="true" focusable="false"><path d="${OCTAGON}" stroke-width="2"/></svg>`;
  const OPEN_SVG = `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-linecap="square" aria-hidden="true" focusable="false"><path d="${OCTAGON}" stroke-width="2" stroke-dasharray="5 7"/><path d="M50 37V63M37 50H63" stroke-width="3"/></svg>`;

  /* ---------- toast ---------- */
  let toastTimer = 0;
  function toast(text) {
    const node = $("#toast");
    node.textContent = text;
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 1700);
  }

  /* ---------- hero ---------- */
  function renderHero() {
    const sign = $("#sign"), mirror = $("#sign-mirror");
    let i = 0;
    const html = String(SITE.family).trim().split(/\s+/).map((word) =>
      `<span class="word">${Array.from(word).map((ch) => `<span class="ch" style="--i:${i++}">${esc(ch)}</span>`).join("")}</span>`).join(" ");
    sign.setAttribute("aria-label", SITE.family);
    sign.innerHTML = `<span aria-hidden="true">${html}</span><span class="bl"></span>`;
    mirror.innerHTML = html;
    $$("[data-family]").forEach((node) => { node.textContent = SITE.family; });
    document.title = SITE.family;
    $("#tagline").textContent = SITE.tagline || "";
    $("#floor-hint").textContent = finePointer ? "Click the floor to send a pulse." : "";
    $("#brand-sigil").innerHTML = sigil(SITE.family);
    $("#foot-sigil").innerHTML = sigil(SITE.family);
    $("#updated").textContent = SITE.updated ? `Last updated ${fmtDate(SITE.updated, true)}.` : "";

    $("#readouts").innerHTML =
      `<div class="readout"><dd data-n="${members.length}">00</dd><dt>${plural(members.length, "member")}</dt></div>` +
      `<div class="readout"><dd data-n="${missions.length}">00</dd><dt>${plural(missions.length, "mission")}</dt></div>` +
      `<div class="readout"><dd data-n="${earned}">00</dd><dt>points earned${inPlay ? ` <small>+${inPlay} in play</small>` : ""}</dt></div>`;
    const delay = root.classList.contains("no-intro") ? 250 : 1250;
    $$("#readouts dd").forEach((node, n) => countUp(node, Number(node.dataset.n), delay + n * 120));
  }
  function countUp(node, to, delay) {
    const show = (v) => { node.textContent = pad2(v); };
    if (reduced || to <= 0) { show(to); return; }
    show(0);
    const dur = 900, t0 = performance.now() + (delay || 0);
    const step = (now) => {
      const k = clamp((now - t0) / dur, 0, 1);
      show(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function armIntro() {
    /* Take the intro curtain out of the page once it has played. */
    const intro = $("#intro");
    if (intro) intro.addEventListener("animationend", (e) => { if (e.animationName === "introFade") intro.remove(); });
  }
  function setIntroSplit() {
    const mark = $("#sign .bl"), intro = $("#intro");
    if (!mark || !intro) return;
    const y = mark.getBoundingClientRect().bottom;
    if (y > 80 && y < window.innerHeight) intro.style.setProperty("--split", Math.round(y + 2) + "px");
  }

  /* ---------- roster ---------- */
  function renderRoster() {
    const open = crew.length - members.length;
    $("#roster-note").textContent = `${members.length} ${plural(members.length, "member")}${open ? `, ${open} open ${plural(open, "slot")}` : ""}`;
    $("#roster-list").innerHTML = crew.map((m) => {
      if (m.open) {
        return `<li class="card is-open"><div class="plate"><div class="plate-in"><div class="avatar">${OPEN_SVG}</div><h3 class="card-name">Open slot</h3><p class="card-about">Saved for the next member.</p></div></div></li>`;
      }
      const avatar = m.photo
        ? `<img src="${esc(m.photo)}" alt="Portrait of ${esc(m.name)}" loading="lazy" decoding="async">${FRAME_SVG}`
        : sigil(m.name);
      const links = (m.links || []).filter((l) => l && l.url).map((l) => `<li><a href="${esc(l.url)}" rel="noopener">${esc(l.label || l.url)}</a></li>`).join("");
      return `<li class="card"><div class="plate tilt"><div class="plate-in">` +
        `<span class="glare" aria-hidden="true"></span><span class="card-mono" aria-hidden="true">${esc(initials(m.name))}</span>` +
        `<div class="avatar">${avatar}</div><h3 class="card-name">${esc(m.name)}</h3>` +
        (m.role ? `<p class="card-role">${esc(m.role)}</p>` : "") +
        (m.about ? `<p class="card-about">${esc(m.about)}</p>` : "") +
        (links ? `<ul class="card-links">${links}</ul>` : "") +
        `</div></div></li>`;
    }).join("");
    if (finePointer && !reduced) $$("#roster-list .tilt").forEach(initTilt);
  }
  function initTilt(node) {
    let frame = 0;
    node.addEventListener("pointermove", (e) => {
      const r = node.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        node.classList.add("live");
        node.style.setProperty("--rx", ((0.5 - py) * 9).toFixed(2) + "deg");
        node.style.setProperty("--ry", ((px - 0.5) * 11).toFixed(2) + "deg");
        node.style.setProperty("--gx", (px * 100).toFixed(1) + "%");
        node.style.setProperty("--gy", (py * 100).toFixed(1) + "%");
      });
    });
    node.addEventListener("pointerleave", () => {
      cancelAnimationFrame(frame);
      node.classList.remove("live");
      node.style.setProperty("--rx", "0deg");
      node.style.setProperty("--ry", "0deg");
    });
  }

  /* ---------- photos ---------- */
  function renderPhotos() {
    const list = $("#shots");
    if (!photos.length) {
      $("#photos-note").textContent = "Photos from our missions land here.";
      list.innerHTML = Array.from({ length: 5 }, (_, i) =>
        `<li class="shot is-empty${i === 0 ? " wide" : ""}"><div class="plate"><div class="plate-in"><span class="slot-no" aria-hidden="true">${pad2(i + 1)}</span><span class="slot-text">Photo slot ${i + 1}</span></div></div></li>`).join("");
    } else {
      $("#photos-note").textContent = `${photos.length} ${plural(photos.length, "photo")}. Select one to see it full size.`;
      list.innerHTML = photos.map((p, i) =>
        `<li class="shot${i % 7 === 0 ? " wide" : ""}"><div class="plate"><div class="plate-in">` +
        `<button class="shot-btn" type="button" data-shots="gallery" data-i="${i}" aria-label="Open photo ${i + 1}${p.caption ? ": " + esc(p.caption) : ""}">` +
        `<img src="${esc(p.thumb || p.src)}" alt="${esc(p.caption || "")}" loading="lazy" decoding="async">` +
        (p.caption ? `<span class="shot-cap">${esc(p.caption)}</span>` : "") +
        `</button></div></div></li>`).join("");
    }
    $$(".seg [data-layout]").forEach((btn) => btn.addEventListener("click", () => {
      list.dataset.layout = btn.dataset.layout;
      $$(".seg [data-layout]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      list.scrollLeft = 0;
      Sound.play("on");
    }));
    /* Drag the reel sideways with a mouse. */
    let down = false, dragged = false, startX = 0, startLeft = 0;
    list.addEventListener("pointerdown", (e) => {
      if (list.dataset.layout !== "reel" || e.pointerType !== "mouse" || e.button !== 0) return;
      down = true; dragged = false; startX = e.clientX; startLeft = list.scrollLeft;
    });
    window.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 5) dragged = true;
      if (dragged) list.scrollLeft = startLeft - dx;
    });
    window.addEventListener("pointerup", () => { down = false; });
    list.addEventListener("click", (e) => { if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; } }, true);
  }

  /* ---------- mission log ---------- */
  let filter = "all";
  function renderMissions() {
    const by = (s) => missions.filter((m) => m.status === s);
    $("#missions-note").textContent = missions.length > 1 ? "Newest first" : "";
    $("#tally").innerHTML =
      `<div><dd>${pad2(missions.length)}</dd><dt>${plural(missions.length, "mission")} logged</dt></div>` +
      `<div><dd>${pad2(earned)}</dd><dt>points earned</dt></div>` +
      `<div><dd>${pad2(inPlay)}</dd><dt>points in play</dt></div>`;
    const ordered = ["complete", "submitted", "started"].flatMap(by);
    const meter = $("#meter");
    meter.innerHTML = ordered.map((m) => `<span class="${esc(m.status)}" style="--w:${Math.max(1, m.points || 1)}" title="#${esc(m.no)} ${esc(m.title)}, ${m.points || 0} pts, ${esc(STATUS[m.status] || m.status)}"></span>`).join("");
    meter.setAttribute("role", "img");
    meter.setAttribute("aria-label", `${earned} points earned and ${inPlay} points in play across ${missions.length} ${plural(missions.length, "mission")}`);
    $("#meter-key").textContent = missions.length ? "One block per mission, sized by its points. Solid is complete, striped is proof submitted, pulsing is in progress." : "";
    const counts = { all: missions.length, started: by("started").length, submitted: by("submitted").length, complete: by("complete").length };
    $("#filters").innerHTML = [["all", "All"], ["started", "In progress"], ["submitted", "Proof submitted"], ["complete", "Complete"]].map(([key, label]) =>
      `<button class="chip" type="button" data-filter="${key}" aria-pressed="${key === filter}">${label}<b>${counts[key]}</b></button>`).join("");
    const sorted = missions.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (b.no || 0) - (a.no || 0));
    $("#log").innerHTML = sorted.map((m) => {
      const lvl = clamp(m.level || 1, 1, 3);
      const dias = `<span class="dias" role="img" aria-label="Difficulty ${lvl} of 3">${[1, 2, 3].map((n) => `<i${n <= lvl ? ' class="on"' : ""}></i>`).join("")}</span>`;
      const shots = (m.photos || []).length
        ? `<div class="entry-shots">${m.photos.map((p, i) => `<button type="button" data-shots="m${esc(m.no)}" data-i="${i}" aria-label="Open photo ${i + 1}${p.caption ? ": " + esc(p.caption) : ""}"><img src="${esc(p.thumb || p.src)}" alt="${esc(p.caption || "")}" loading="lazy" decoding="async"></button>`).join("")}</div>`
        : "";
      return `<li class="entry" data-status="${esc(m.status)}" id="mission-${esc(m.no)}"><span class="entry-node" aria-hidden="true"></span>` +
        `<article class="plate"><div class="plate-in">` +
        `<header class="entry-top"><span class="entry-no" aria-hidden="true">#${esc(m.no)}</span><h3 class="entry-title"><span class="sr">Mission ${esc(m.no)}: </span>${esc(m.title)}</h3><span class="entry-pts">${m.points || 0}<small>pts</small></span></header>` +
        `<div class="entry-meta">${m.tier ? `<span class="tier">${esc(m.tier)} ${dias}</span>` : dias}<span class="status">${esc(STATUS[m.status] || m.status)}</span>${m.date ? `<time datetime="${esc(m.date)}">${fmtDate(m.date)}</time>` : ""}</div>` +
        (m.story ? `<p class="entry-story">${esc(m.story)}</p>` : "") + shots +
        `</div></article></li>`;
    }).join("");
    $("#filters").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-filter]");
      if (!chip) return;
      filter = chip.dataset.filter;
      applyFilter();
      Sound.play("on");
    });
    applyFilter();
  }
  function applyFilter() {
    let shown = 0;
    $$("#log .entry").forEach((entry) => {
      const show = filter === "all" || entry.dataset.status === filter;
      entry.hidden = !show;
      if (show) shown++;
    });
    $$("#filters .chip").forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.filter === filter)));
    $("#log").hidden = shown === 0;
    $("#log-empty").hidden = shown !== 0;
  }

  /* ---------- modals ---------- */
  const Modal = (() => {
    let current = null, opener = null, after = null;
    function open(node, opts) {
      if (current) close();
      current = node;
      opener = document.activeElement;
      after = (opts && opts.onClose) || null;
      node.hidden = false;
      document.body.classList.add("modal-open");
      Arena.setPaused(true);
      Trail.block(true);
      const target = (opts && opts.focus) || $("button", node);
      if (target) target.focus({ preventScroll: true });
      Sound.play("open");
    }
    function close() {
      if (!current) return;
      const node = current;
      current = null;
      node.hidden = true;
      document.body.classList.remove("modal-open");
      Arena.setPaused(false);
      Trail.block(false);
      if (after) after();
      after = null;
      if (opener && document.contains(opener) && opener.focus) opener.focus({ preventScroll: true });
      opener = null;
      Sound.play("close");
    }
    document.addEventListener("keydown", (e) => {
      if (!current || e.key !== "Tab") return;
      const items = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', current).filter((n) => !n.disabled && n.getClientRects().length && getComputedStyle(n).visibility !== "hidden");
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], lastItem = items[items.length - 1], here = document.activeElement;
      if (!current.contains(here) || !items.includes(here)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && here === first) { e.preventDefault(); lastItem.focus(); }
      else if (!e.shiftKey && here === lastItem) { e.preventDefault(); first.focus(); }
    });
    return { open, close, is: (node) => current === node, any: () => !!current };
  })();

  /* ---------- photo viewer ---------- */
  const lb = $("#lightbox"), lbImg = $("#lb-img"), lbFrame = $("#lb-frame");
  const viewer = { set: [], i: 0 };
  function photoSet(key) {
    if (key === "gallery") return photos;
    const m = missions.find((x) => "m" + x.no === key);
    return m ? m.photos || [] : [];
  }
  function showPhoto() {
    const p = viewer.set[viewer.i];
    if (!p) return;
    lbFrame.classList.remove("wipe");
    lbImg.onload = () => { void lbFrame.offsetWidth; lbFrame.classList.add("wipe"); };
    lbImg.src = p.src;
    lbImg.alt = p.caption || "";
    $("#lb-count").textContent = `${pad2(viewer.i + 1)} / ${pad2(viewer.set.length)}`;
    $("#lb-text").textContent = p.caption || "";
    $("#lb-date").textContent = p.date ? fmtDate(p.date, true) : "";
    const vis = viewer.set.length > 1 ? "visible" : "hidden";
    $("#lb-prev").style.visibility = vis;
    $("#lb-next").style.visibility = vis;
  }
  function stepPhoto(dir) {
    if (viewer.set.length < 2) return;
    viewer.i = (viewer.i + dir + viewer.set.length) % viewer.set.length;
    showPhoto();
    Sound.play("click");
  }
  function initViewer() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-shots]");
      if (!btn) return;
      const set = photoSet(btn.dataset.shots);
      if (!set.length) return;
      viewer.set = set; viewer.i = Number(btn.dataset.i) || 0;
      Modal.open(lb, { focus: $("#lb-close"), onClose: () => { lbImg.removeAttribute("src"); lbFrame.classList.remove("wipe"); } });
      showPhoto();
    });
    $("#lb-close").addEventListener("click", () => Modal.close());
    $("#lb-prev").addEventListener("click", () => stepPhoto(-1));
    $("#lb-next").addEventListener("click", () => stepPhoto(1));
    lb.addEventListener("click", (e) => { if (e.target === lb) Modal.close(); });
    let touchX = null;
    lb.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) stepPhoto(dx < 0 ? 1 : -1);
      touchX = null;
    });
  }

  /* ---------- control deck ---------- */
  const deck = $("#deck"), deckBtn = $("#deck-btn");
  const small = () => window.innerWidth <= 640;
  function setDeck(open, quiet) {
    if (deck.classList.contains("open") === open) return;
    deck.classList.toggle("open", open);
    document.body.classList.toggle("deck-open", open);
    deckBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      if (small()) setConsole(false, true);
      const first = $('input[name="circuit"]:checked', deck) || $("input", deck);
      if (first) first.focus({ preventScroll: true });
    } else if (deck.contains(document.activeElement)) deckBtn.focus({ preventScroll: true });
    if (!quiet) Sound.play(open ? "open" : "close");
  }
  function syncDeck() {
    const s = Settings.all();
    $$("#deck [data-set]").forEach((input) => {
      const key = input.dataset.set;
      if (input.type === "checkbox") input.checked = !!s[key];
      else {
        input.value = s[key];
        input.style.setProperty("--fill", ((s[key] - input.min) / (input.max - input.min) * 100).toFixed(1) + "%");
      }
    });
    $$('#deck input[name="circuit"]').forEach((radio) => { radio.checked = radio.value === s.circuit; });
    $("#out-glow").textContent = s.glow + "%";
    $("#out-speed").textContent = (s.speed / 100).toFixed(2) + "x";
  }
  function initDeck() {
    $$("#deck [data-set]").forEach((input) => {
      const key = input.dataset.set;
      if (input.type === "checkbox") {
        input.addEventListener("change", () => { Settings.set(key, input.checked); Sound.play(input.checked ? "on" : "off"); });
      } else {
        input.addEventListener("input", () => Settings.set(key, Number(input.value)));
      }
    });
    $$('#deck input[name="circuit"]').forEach((radio) => radio.addEventListener("change", () => {
      if (radio.checked) { Settings.set("circuit", radio.value); Sound.play("on"); }
    }));
    Settings.on((key, value) => {
      if (key === "sound") Sound.setEnabled(value);
      syncDeck();
    });
    syncDeck();
  }
  function flip(key) {
    const value = Settings.toggle(key);
    Sound.play(value ? "on" : "off");
    toast(`${LABEL[key]} ${value ? "on" : "off"}`);
  }
  function cycleCircuit() {
    const list = Settings.CIRCUITS;
    const next = list[(list.indexOf(Settings.get("circuit")) + 1) % list.length];
    Settings.set("circuit", next);
    Sound.play("on");
    toast(`Circuit: ${CIRCUIT_NAME[next]}`);
  }
  function resetDeck() {
    Settings.reset();
    toast("Deck reset");
  }
  function pulse() {
    Arena.pulse();
    Sound.play("pulse");
    if (reduced) return;
    root.classList.remove("surge");
    void root.offsetWidth;
    root.classList.add("surge");
    setTimeout(() => root.classList.remove("surge"), 950);
  }
  function replayIntro() {
    if (reduced) { toast("The intro is off while reduced motion is on"); return; }
    setDeck(false, true);
    setConsole(false, true);
    window.scrollTo(0, 0);
    root.classList.remove("no-intro");
    const old = $("#intro");
    if (old) old.remove();
    const fresh = document.createElement("div");
    fresh.className = "intro"; fresh.id = "intro"; fresh.setAttribute("aria-hidden", "true");
    fresh.innerHTML = '<i class="intro-top"></i><i class="intro-bot"></i><i class="intro-line"></i>';
    document.body.prepend(fresh);
    armIntro();
    setIntroSplit();
    [$("#sign"), $("#sign-mirror")].forEach((node) => { node.classList.remove("lit"); void node.offsetWidth; node.classList.add("lit"); });
  }

  /* ---------- trail duel ---------- */
  let duelReady = false;
  function openGame() {
    if (!duelReady) return;
    setDeck(false, true);
    setConsole(false, true);
    Modal.open($("#game"), { focus: $("#game-go"), onClose: () => Duel.onClose() });
    Duel.onOpen();
  }

  /* ---------- console ---------- */
  const consoleBox = $("#console"), consoleOut = $("#console-out"), consoleInput = $("#console-input");
  const slug = String(SITE.family).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "family";
  const PROMPT = `guest@${slug}:~$`;
  const history = [];
  let historyAt = 0, greeted = false;
  function say(text, cls) {
    const row = document.createElement("div");
    row.className = "c-line" + (cls ? " " + cls : "");
    row.textContent = text;
    consoleOut.appendChild(row);
    while (consoleOut.childElementCount > 300) consoleOut.firstElementChild.remove();
    consoleOut.scrollTop = consoleOut.scrollHeight;
  }
  const fail = (text) => { say(text, "err"); Sound.play("error"); };
  function setConsole(open, quiet) {
    if (consoleBox.classList.contains("open") === open) return;
    consoleBox.classList.toggle("open", open);
    if (open) {
      if (small()) setDeck(false, true);
      if (!greeted) { greeted = true; say(`${SITE.family} console. Type help to see what it can do.`, "ok"); }
      consoleInput.focus({ preventScroll: true });
    } else if (consoleBox.contains(document.activeElement)) document.activeElement.blur();
    if (!quiet) Sound.play(open ? "open" : "close");
  }
  function goTo(id) {
    const behavior = reduced ? "auto" : "smooth";
    if (id === "top") { window.scrollTo({ top: 0, behavior }); return true; }
    const node = document.getElementById(id);
    if (!node) return false;
    node.scrollIntoView({ behavior, block: "start" });
    return true;
  }
  const switchCmd = (key, word) => (args) => {
    const arg = (args[0] || "toggle").toLowerCase();
    if (!["on", "off", "toggle"].includes(arg)) return fail(`Use on or off. For example: ${word} on`);
    const next = arg === "toggle" ? !Settings.get(key) : arg === "on";
    Settings.set(key, next);
    say(`${LABEL[key]} ${next ? "on" : "off"}.`, "ok");
    Sound.play(next ? "on" : "off");
  };
  const numberCmd = (key, word, min, max) => (args) => {
    const n = Number(args[0]);
    if (args[0] == null || isNaN(n)) return say(`${word[0].toUpperCase() + word.slice(1)} is ${Settings.get(key)}. Set it with a number from ${min} to ${max}. For example: ${word} ${Math.round((min + max) / 2)}`);
    Settings.set(key, n);
    say(`${word[0].toUpperCase() + word.slice(1)} set to ${Settings.get(key)}.`, "ok");
  };
  const COMMANDS = {
    help: { about: "List the commands", run() {
      say("Commands:");
      Object.keys(COMMANDS).forEach((name) => { if (COMMANDS[name].about) say("  " + name.padEnd(9) + COMMANDS[name].about); });
      say("Tab completes a command. The up arrow brings back the last one.");
    } },
    roster: { about: "Show the members", run() {
      const open = crew.length - members.length;
      say(`Roster: ${members.length} ${plural(members.length, "member")}${open ? `, ${open} open ${plural(open, "slot")}` : ""}`);
      members.forEach((m, i) => say(`  ${pad2(i + 1)}  ${m.name}${m.role ? ", " + m.role : ""}`));
    } },
    missions: { about: "Show the mission log", run() {
      if (!missions.length) return say("No missions logged yet.");
      say("Mission log:");
      missions.slice().sort((a, b) => (a.no || 0) - (b.no || 0)).forEach((m) => say(`  #${String(m.no).padEnd(3)} ${String(m.title).padEnd(22)} ${String(m.points || 0).padStart(3)} pts  ${STATUS[m.status] || m.status}`));
    } },
    points: { about: "Show the points tally", run() { say(`${earned} points earned, ${inPlay} in play.`); } },
    photos: { about: "Count the photos", run() { say(photos.length ? `${photos.length} ${plural(photos.length, "photo")} in the gallery.` : "No photos yet. The gallery is holding slots for them."); } },
    goto: { about: "Jump to a section: goto roster", run(args) {
      const where = (args[0] || "").toLowerCase();
      if (!["top", "roster", "photos", "missions"].includes(where)) return fail("Pick one of: top, roster, photos, missions");
      goTo(where);
      say(`Jumping to ${where}.`, "ok");
    } },
    open: { about: "Jump to a mission: open 7", run(args) {
      const m = missions.find((x) => String(x.no) === String(args[0] || "").replace("#", ""));
      if (!m) return fail("No mission with that number. Type missions to see the log.");
      if (filter !== "all") { filter = "all"; applyFilter(); }
      goTo("mission-" + m.no);
      say(`Opening mission #${m.no}, ${m.title}.`, "ok");
    } },
    color: { about: "Change the circuit: color ember", run(args) {
      const name = (args[0] || "").toLowerCase();
      if (!name) return say(`Circuits: ${Settings.CIRCUITS.join(", ")}. Current: ${Settings.get("circuit")}.`);
      if (!Settings.set("circuit", name)) return fail(`No circuit called ${name}. Try: ${Settings.CIRCUITS.join(", ")}`);
      say(`Circuit set to ${CIRCUIT_NAME[name]}.`, "ok");
      Sound.play("on");
    } },
    grid: { about: "Grid motion: grid off", run: switchCmd("motion", "grid") },
    waves: { about: "Floor waves: waves on", run: switchCmd("waves", "waves") },
    runners: { about: "Light runners: runners off", run: switchCmd("runners", "runners") },
    ceiling: { about: "Ceiling grid: ceiling off", run: switchCmd("ceiling", "ceiling") },
    trail: { about: "Cursor trail: trail off", run: switchCmd("trail", "trail") },
    scan: { about: "Scanlines: scan on", run: switchCmd("scan", "scan") },
    sound: { about: "Sound: sound on", run: switchCmd("sound", "sound") },
    glow: { about: "Glow from 0 to 150: glow 130", run: numberCmd("glow", "glow", 0, 150) },
    speed: { about: "Speed from 25 to 300: speed 200", run: numberCmd("speed", "speed", 25, 300) },
    pulse: { about: "Send a pulse through the grid", run() { pulse(); say("Pulse sent.", "ok"); } },
    duel: { about: "Play trail duel", run() { say("Starting trail duel.", "ok"); openGame(); } },
    status: { about: "Show the deck settings", run() {
      const s = Settings.all();
      say(`Circuit ${s.circuit}, glow ${s.glow}, speed ${s.speed}`);
      Object.keys(LABEL).forEach((key) => say(`  ${LABEL[key].padEnd(14)} ${s[key] ? "on" : "off"}`));
    } },
    intro: { about: "Replay the intro", run() { replayIntro(); } },
    reset: { about: "Reset the deck", run() { resetDeck(); say("Deck reset.", "ok"); } },
    clear: { about: "Clear the console", run() { consoleOut.textContent = ""; } },
    exit: { about: "Close the console", run() { setConsole(false); } },
    /* a few extras that help leaves out */
    whoami: { run() { say("guest"); } },
    ls: { run() { say("roster  photos  missions"); } },
    sudo: { run() { fail("Nice try. Guests don't get root on this deck."); } },
    hello: { run() { say(`Hello from ${SITE.family}.`, "ok"); } }
  };
  const ALIAS = { "?": "help", crew: "roster", members: "roster", log: "missions", circuit: "color", colour: "color", play: "duel", game: "duel", cd: "goto", go: "goto", cls: "clear", quit: "exit", close: "exit", hi: "hello" };
  function runCommand(raw) {
    const text = raw.trim();
    say(PROMPT + " " + text, "echo");
    if (!text) return;
    history.push(text);
    historyAt = history.length;
    const parts = text.split(/\s+/);
    const name = ALIAS[parts[0].toLowerCase()] || parts[0].toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, name)) return fail(`Unknown command: ${parts[0]}. Type help to see the list.`);
    COMMANDS[name].run(parts.slice(1));
  }
  function initConsole() {
    $("#console-prompt").textContent = PROMPT;
    $("#console-form").addEventListener("submit", (e) => {
      e.preventDefault();
      runCommand(consoleInput.value);
      consoleInput.value = "";
    });
    consoleInput.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (!history.length) return;
        e.preventDefault();
        historyAt = clamp(historyAt + (e.key === "ArrowUp" ? -1 : 1), 0, history.length);
        consoleInput.value = history[historyAt] || "";
      } else if (e.key === "Tab" && consoleInput.value.trim() && !/\s/.test(consoleInput.value.trim())) {
        e.preventDefault();
        const typed = consoleInput.value.trim().toLowerCase();
        const hits = Object.keys(COMMANDS).filter((name) => COMMANDS[name].about && name.startsWith(typed));
        if (hits.length === 1) consoleInput.value = hits[0] + " ";
        else if (hits.length > 1) say(hits.join("  "));
      } else if (e.key.length === 1) Sound.play("key");
    });
  }

  /* ---------- page chrome: progress line, current section, trace lines ---------- */
  function initChrome() {
    const bar = $("#progress");
    let queued = false;
    const update = () => {
      queued = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.setProperty("--p", max > 0 ? clamp(window.scrollY / max, 0, 1).toFixed(4) : "0");
    };
    window.addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener("resize", update);
    update();

    if ("IntersectionObserver" in window) {
      const links = new Map($$(".nav a").map((a) => [a.getAttribute("href").slice(1), a]));
      const spy = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const link = links.get(entry.target.id);
          if (!link) return;
          if (entry.isIntersecting) { links.forEach((a) => a.removeAttribute("aria-current")); link.setAttribute("aria-current", "true"); }
          else link.removeAttribute("aria-current");
        });
      }, { rootMargin: "-40% 0px -55% 0px" });
      $$("main .section").forEach((section) => spy.observe(section));

      if (!reduced) {
        const draw = new IntersectionObserver((entries) => {
          entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.remove("pre"); draw.unobserve(entry.target); } });
        }, { rootMargin: "0px 0px -10% 0px" });
        $$(".trace").forEach((line) => {
          if (line.getBoundingClientRect().top > window.innerHeight * 0.9) { line.classList.add("pre"); draw.observe(line); }
        });
      }
    }
  }

  /* ---------- actions, sounds and shortcuts ---------- */
  const ACTIONS = {
    deck: () => setDeck(!deck.classList.contains("open")),
    console: () => setConsole(!consoleBox.classList.contains("open")),
    game: openGame,
    "game-close": () => Modal.close(),
    pulse,
    intro: replayIntro,
    reset: resetDeck
  };
  function initInput() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (btn && ACTIONS[btn.dataset.act]) { e.preventDefault(); ACTIONS[btn.dataset.act](); return; }
      if (e.target.closest("a, button")) Sound.play("click");
    });
    let lastHover = null;
    document.addEventListener("pointerover", (e) => {
      const node = e.target.closest && e.target.closest("a, button, .card, .shot, .sw, .swatch, .entry");
      if (node && node !== lastHover) Sound.play("hover");
      lastHover = node;
    });
    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        if (Modal.any()) Modal.close();
        else if (consoleBox.classList.contains("open")) setConsole(false);
        else if (deck.classList.contains("open")) setDeck(false);
        return;
      }
      if (Modal.is($("#game"))) { if (Duel.handleKey(e)) e.preventDefault(); return; }
      if (Modal.is(lb)) {
        if (e.key === "ArrowLeft") stepPhoto(-1);
        else if (e.key === "ArrowRight") stepPhoto(1);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const node = e.target;
      const typing = node.isContentEditable || node.tagName === "TEXTAREA" || node.tagName === "SELECT" || (node.tagName === "INPUT" && !["checkbox", "radio", "range"].includes(node.type));
      if (typing) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      switch (key) {
        case "d": ACTIONS.deck(); break;
        case "/": case "`": e.preventDefault(); setConsole(true); break;
        case "g": flip("motion"); break;
        case "w": flip("waves"); break;
        case "r": flip("runners"); break;
        case "t": flip("trail"); break;
        case "l": flip("scan"); break;
        case "m": flip("sound"); break;
        case "c": cycleCircuit(); break;
        case "p": pulse(); break;
        case "x": openGame(); break;
        default: break;
      }
    });
  }

  /* ---------- start ---------- */
  renderHero();
  Arena.relayout();
  armIntro();
  setIntroSplit();
  renderRoster();
  renderPhotos();
  renderMissions();
  initDeck();
  initConsole();
  initViewer();
  initChrome();
  initInput();
  duelReady = !!(Duel && Duel.mount());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { Arena.relayout(); setIntroSplit(); });
  window.addEventListener("load", () => Arena.relayout());
})();
