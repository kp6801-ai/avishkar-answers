// Four-tap answer flow. Arrives from an email tile (?lid=…&v=…&goal=…), logs each tap to the Apps Script endpoint,
// keeps state in the URL so a reload resumes, ends on a summary + optional WhatsApp hand-off. No names/emails in URLs.
(() => {
  const C = window.ANSWER_CONFIG || {}, O = window.ANSWER_OPTIONS;
  const app = document.getElementById("app");
  const LID_RE = /^[A-Za-z0-9_-]{6,40}$/;
  const url = new URL(location.href), P = url.searchParams;
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
  const sess = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch { return null; } };

  // Lead id: from the email; visitors without one get a local id so their answers still count (variant "site").
  let lid = P.get("lid"), variant = P.get("v");
  if (!LID_RE.test(lid || "")) {
    lid = store("ad_lid") || "w" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("");
    store("ad_lid", lid); variant = "site";
  }
  if (!O.variants.includes(variant)) variant = "site";
  const device = matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop";
  const label = (q, a) => (O.questions[q].options.find(([v]) => v === a) || [])[1];
  const state = {}; for (const q of O.order) if (label(q, P.get(q))) state[q] = P.get(q);

  function log(q, a, src) {
    const key = `ad_${lid}_${q}_${a}`; if (sess(key)) return; sess(key, "1");
    if (!C.endpoint) return console.info("[answers] no endpoint configured — not logged", q, a);
    const body = JSON.stringify({ lid, q, a, v: variant, src, d: device });
    const sent = navigator.sendBeacon && navigator.sendBeacon(C.endpoint, new Blob([body], { type: "text/plain;charset=UTF-8" }));
    if (!sent) fetch(C.endpoint, { method: "POST", mode: "no-cors", keepalive: true, headers: { "Content-Type": "text/plain;charset=UTF-8" }, body }).catch(() => {});
  }
  function syncUrl() {
    const u = new URL(location.href); u.search = "";
    u.searchParams.set("lid", lid); u.searchParams.set("v", variant);
    for (const q of O.order) if (state[q]) u.searchParams.set(q, state[q]);
    history.replaceState(null, "", u);
  }

  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const progress = (at) => `<ol class="prog" aria-label="Progress">${O.order.map((q, i) =>
    `<li class="${i < at ? "done" : i === at ? "now" : ""}"${i === at ? ' aria-current="step"' : ""}>0${i + 1} ${esc(O.questions[q].label.replace(/ \(.*\)/, ""))}</li>`).join("")}</ol>`;
  const HEAD = { goal: ["What brings you", "to Dubai?"], area: ["Where do you", "see yourself?"], budget: ["What budget", "feels right?"], timing: ["When would you", "like to move?"] };

  function options(q) {
    const opts = O.questions[q].options, imgs = O.images[q];
    if (imgs) return `<div class="cards" role="group" aria-label="${esc(O.questions[q].label)}">${opts.map(([v, l], i) =>
      `<button type="button" class="card${state[q] === v ? " sel" : ""}" data-a="${v}" aria-pressed="${state[q] === v}">
        <span class="ph"><img src="img/${imgs[v]}.webp" alt="" loading="${i < 4 ? "eager" : "lazy"}" width="480" height="533"><span class="n">0${i + 1}</span></span>
        <span class="lb">${esc(l)}<i aria-hidden="true">→</i></span></button>`).join("")}</div>`;
    return `<div class="rows" role="group" aria-label="${esc(O.questions[q].label)}">${opts.map(([v, l], i) =>
      `<button type="button" class="row${state[q] === v ? " sel" : ""}" data-a="${v}" aria-pressed="${state[q] === v}">
        <span>${q === "budget" ? '<small>AED&nbsp;</small>' : ""}${esc(l)}</span><i aria-hidden="true">→</i></button>`).join("")}</div>`;
  }

  let busy = false;
  function swap(node) {
    const old = app.querySelector(".step, .done");
    const put = () => { app.replaceChildren(node); node.querySelector("h1")?.focus({ preventScroll: true }); scrollTo({ top: 0, behavior: "smooth" }); busy = false; };
    if (old && !matchMedia("(prefers-reduced-motion: reduce)").matches) { old.classList.add("out"); setTimeout(put, 200); } else put();
  }

  function show(i) {
    if (i >= O.order.length) return done();
    const q = O.order[i], [a, b] = HEAD[q];
    const node = el(`<section class="step" data-q="${q}">${progress(i)}
      <p class="mono">0${i + 1} / 0${O.order.length}</p>
      <h1 tabindex="-1">${esc(a)} <span>${esc(b)}</span></h1>
      ${options(q)}
      ${i > 0 ? '<button type="button" class="back">← Back</button>' : ""}</section>`);
    node.addEventListener("click", (e) => {
      if (busy) return;
      if (e.target.closest(".back")) { busy = true; return show(i - 1); }
      const btn = e.target.closest("[data-a]"); if (!btn) return;
      busy = true; state[q] = btn.dataset.a; syncUrl(); log(q, state[q], "page");
      node.querySelectorAll("[data-a]").forEach((b) => { b.classList.toggle("sel", b === btn); b.setAttribute("aria-pressed", b === btn); });
      node.querySelector(".rows")?.classList.add("dim");
      setTimeout(() => show(next(i + 1)), 260);
    });
    swap(node);
  }
  const next = (from) => { for (let j = from; j < O.order.length; j++) if (!state[O.order[j]]) return j; return O.order.length; };

  function done() {
    const lines = O.order.map((q) => `${O.questions[q].label.replace(/ \(.*\)/, "")}: ${label(q, state[q])}`);
    const wa = C.whatsapp && /^\d{8,15}$/.test(C.whatsapp)
      ? `<a class="pill" href="https://wa.me/${C.whatsapp}?text=${encodeURIComponent(`Hello Avishkar — ${lines.join(" · ")}`)}" target="_blank" rel="noopener">Talk to Avishkar on WhatsApp <span aria-hidden="true">→</span></a>` : "";
    const node = el(`<section class="done step">${progress(O.order.length)}
      <p class="mono">All four in</p>
      <h1 tabindex="-1">Thank you. <span>Your shortlist is in motion.</span></h1>
      <ul class="chips">${O.order.map((q) => `<li><b>${esc(O.questions[q].label)}</b>${esc(label(q, state[q]))}</li>`).join("")}</ul>
      ${wa}
      <p class="note">I'll come back personally, only with homes that match. Want to change something? <button type="button" class="edit">Edit answers</button></p>
      <div class="band">Shown privately. <span>Costed to the last dirham.</span></div></section>`);
    node.querySelector(".edit").addEventListener("click", () => show(0));
    swap(node);
  }

  if (C.brn) document.getElementById("brn").textContent = `BRN ${C.brn}`;
  syncUrl();
  if (state.goal) log("goal", state.goal, P.get("src") === "page" ? "page" : "email");   // the tap that opened this page
  show(next(0));
})();
