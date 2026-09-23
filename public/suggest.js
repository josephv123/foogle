// Search suggestions in the browser: Google's autocomplete dropdown under a
// search box. The visitor's recent searches (localStorage "foogle.recent")
// come first, then suggestions a small model writes (GET /api/suggest, see
// lib/suggest.js).
//
//   <input name="q" data-suggest>  +  <script type="module" src="/suggest.js">
//
// attaches it to every input[data-suggest] (data-suggest="home" adds the
// homepage's buttons to the dropdown). Other pages can import attachSuggest,
// recordSearch and createEngine from this file.
//
// It has to feel instant, and most keystrokes never wait for the network:
// every list fetched is kept, and the lists of shorter prefixes are filtered
// for the current text. The list for "cnn" answers "cnn " and "cnn l" at
// once while the list for "cnn l" streams in, a suggestion at a time.

const RECENT_KEY = "foogle.recent";
const RECENT_MAX = 50;

// Typed text as the server keys it: lowercase, one space between words, no
// leading space. A trailing space stays ("cnn " has finished a word).
export const normalize = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").replace(/^ /, "").slice(0, 100);

// Whether a suggestion still fits what's typed. A site fits its own name
// with a space after it, so "cnn " still offers cnn.com.
export const fits = (item, key) => item.q.startsWith(key) || (item.type === "site" && item.q === key.trimEnd());

// ---------- the suggestion lists (no DOM; the latency script runs it in Node) ----------
// set(text) returns what can be shown now and asks the server for the text
// itself only when the lists already here can't fill the dropdown. onChange
// fires as streamed suggestions arrive.
export function createEngine({
  endpoint = "/api/suggest",
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  minPool = 5,
  maxLists = 400,
  prefetch = true,
  patience = 0,
  onChange = () => {},
  now = () => performance.now(),
} = {}) {
  const lists = new Map(); // key -> { items, done }; insertion order is last use
  const pending = new Map(); // key -> AbortController
  let current = null;
  let pausedUntil = 0;
  let deferred = null;
  const counts = { requests: 0, prefetches: 0, aborted: 0 };

  // What can be suggested for `key`: its own list, then those of its shorter
  // prefixes, filtered to what still fits.
  function pool(key) {
    const out = [];
    const seen = new Set();
    for (let n = key.length; n >= 0; n--) {
      const list = lists.get(key.slice(0, n));
      if (!list) continue;
      for (const item of list.items) {
        if (seen.has(item.q) || !fits(item, key)) continue;
        seen.add(item.q);
        out.push(item);
      }
    }
    return out;
  }

  const wanted = (key) => now() >= pausedUntil && !lists.get(key)?.done && !pending.has(key) && pool(key).length < minPool;

  function set(text) {
    const key = normalize(text);
    current = key;
    // A request for text that has since been edited away can't help any more;
    // one for a shorter prefix of it still can (its list gets filtered).
    for (const [k, ctl] of pending) {
      if (key.startsWith(k)) continue;
      ctl.abort();
      pending.delete(k);
      counts.aborted++;
    }
    ask(key);
    return pool(key);
  }

  // Fetch the text's own list if the dropdown needs it. With `patience`, a
  // list for a shorter prefix that is still coming (and may well cover this
  // text: "weather in tokyo to" has "weather in tokyo tomorrow…") gets that
  // many ms, or until it's in, before this text is asked for. It saves about a
  // quarter of the requests but made suggestions slower (EXPERIMENTS.md), so
  // it's off by default.
  function ask(key, { waited = false } = {}) {
    clearTimeout(deferred);
    if (!wanted(key)) return;
    if (!waited && patience > 0 && [...pending.keys()].some((k) => k !== key && key.startsWith(k))) {
      deferred = setTimeout(() => { if (current === key) ask(key, { waited: true }); }, patience);
      return;
    }
    request(key);
  }

  function remember(key, list) {
    lists.delete(key);
    lists.set(key, list);
    for (const k of lists.keys()) {
      if (lists.size <= maxLists) break;
      if (!pending.has(k)) lists.delete(k);
    }
  }

  async function request(key, { speculative = false } = {}) {
    const ctl = new AbortController();
    pending.set(key, ctl);
    speculative ? counts.prefetches++ : counts.requests++;
    const list = lists.get(key) ?? { items: [], done: false };
    remember(key, list);
    const add = (item) => {
      if (typeof item?.q !== "string" || list.items.some((i) => i.q === item.q)) return;
      list.items.push(item.type === "site" && item.domain
        ? { type: "site", q: item.q, domain: String(item.domain), title: String(item.title || item.domain) }
        : { type: "search", q: item.q });
      if (current.startsWith(key)) onChange(key);
    };
    try {
      const res = await fetchImpl(`${endpoint}?q=${encodeURIComponent(key)}&stream=1`, { signal: ctl.signal });
      if (!res.ok) {
        // Over the visitor's limit or the day's budget: no dropdown for a while.
        const wait = Number(res.headers.get("retry-after"));
        pausedUntil = now() + Math.min(Number.isFinite(wait) && wait > 0 ? wait : 30, 600) * 1000;
        list.done = true;
        return;
      }
      await readLines(res, add);
      list.done = true;
    } catch (err) {
      if (err?.name !== "AbortError") list.done = true; // failed: don't ask again
      else if (!list.items.length) lists.delete(key);
    } finally {
      if (pending.get(key) === ctl) pending.delete(key);
      if (current.startsWith(key)) onChange(key);
      if (current !== key && current.startsWith(key)) ask(current, { waited: true }); // was waiting on this
      if (prefetch && !speculative && list.done && key === current) prefetchNext(key);
    }
  }

  // The visitor has paused on `key` and its list is in. If the top
  // suggestion's next letter would leave the dropdown thin, fetch it now, so
  // that keystroke is instant too. One per pause, never a chain.
  function prefetchNext(key) {
    const top = pool(key).find((item) => item.q.length > key.length);
    const next = top && normalize(top.q.slice(0, key.length + 1));
    if (next && next !== key && wanted(next)) request(next, { speculative: true });
  }

  return { set, pool, lists, pending, counts, current: () => current };
}

// Read NDJSON suggestions as they stream; a plain JSON answer
// ({"suggestions": […]}, as a refusal sends) works too.
async function readLines(res, add) {
  const parse = (line) => {
    if (!line.trim()) return;
    try {
      const obj = JSON.parse(line);
      for (const item of Array.isArray(obj?.suggestions) ? obj.suggestions : [obj]) add(item);
    } catch { /* a torn line: skip it */ }
  };
  if (!res.body?.getReader) return (await res.text()).split("\n").forEach(parse);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  parse(buffer);
}

// ---------- recent searches ----------
function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((q) => typeof q === "string" && q.trim()) : [];
  } catch {
    return [];
  }
}
function writeRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch { /* private mode, full */ }
}
// Newest first, one entry per search (whatever its case or spacing).
export const recentSearches = () => readRecent();
export function recordSearch(text) {
  const q = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!q) return;
  writeRecent([q, ...readRecent().filter((r) => normalize(r) !== normalize(q))]);
}
export function removeRecent(text) {
  writeRecent(readRecent().filter((r) => normalize(r) !== normalize(text)));
}

// ---------- the dropdown ----------
export const ICONS = {
  search: "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  recent: "M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z",
  trend: "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z",
  fill: "M7 7v10h2v-6.59l8.29 8.3 1.42-1.42L10.41 9H17V7z",
};
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Google's emphasis: what was typed in normal weight, the completion in bold.
export function completionHTML(text, typed) {
  const key = normalize(typed);
  const cut = key && normalize(text).startsWith(key) ? Math.min(text.length, key.length) : 0;
  return `${esc(text.slice(0, cut))}<b>${esc(text.slice(cut))}</b>`;
}
// Where a site suggestion goes, and its icon (the site's favicon on the fake web).
export const siteHref = (item) => `/web/${item.domain}?${new URLSearchParams({ fq: item.q, ft: item.title || item.domain })}`;
export const siteIcon = (domain) => `/api/favicon?${new URLSearchParams({ url: `/web/${domain}` })}`;

const CSS = `
.fsg-open{border-color:transparent!important;box-shadow:0 1px 6px rgba(32,33,36,.28)!important;border-bottom-left-radius:0!important;border-bottom-right-radius:0!important}
.fsg{position:absolute;z-index:1000;background:#fff;box-shadow:0 4px 6px rgba(32,33,36,.28);clip-path:inset(0 -12px -12px -12px);padding-bottom:8px;text-align:left;font-family:arial,sans-serif;color:#202124;cursor:default;-webkit-tap-highlight-color:transparent}
.fsg[hidden]{display:none}
.fsg::before{content:"";display:block;border-top:1px solid #e8eaed;margin:0 14px 4px}
.fsg ul{list-style:none;margin:0;padding:0}
.fsg-row{display:flex;align-items:center;padding-right:20px;font-size:16px;line-height:22px}
.fsg-row.fsg-sel,.fsg-row:hover{background:#eee}
.fsg-a{flex:1;min-width:0;min-height:32px;display:flex;align-items:center;padding-left:var(--fsg-pad,16px);color:inherit;text-decoration:none;cursor:default}
.fsg-ico{flex:0 0 20px;height:20px;margin-right:var(--fsg-gap,12px);display:flex;align-items:center;justify-content:center;color:#9aa0a6}
.fsg-ico svg{width:20px;height:20px;fill:currentColor}
.fsg-site .fsg-a{min-height:46px}
.fsg-site .fsg-ico{flex-basis:28px;height:28px;margin-left:-4px;margin-right:calc(var(--fsg-gap,12px) - 4px);border-radius:8px;background:#f1f3f4}
.fsg-site .fsg-ico img{width:20px;height:20px;border-radius:4px;display:block}
.fsg-text{flex:1;min-width:0;padding:5px 0}
.fsg-q{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fsg-q b{font-weight:bold}
.fsg-recent .fsg-q{color:#52188c}
.fsg-sub{display:block;font-size:14px;line-height:18px;color:#70757a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fsg-rm{flex:none;border:0;background:none;padding:4px 0 4px 16px;font:14px arial,sans-serif;color:#70757a;cursor:pointer}
.fsg-rm:hover{text-decoration:underline;color:#202124}
.fsg-fill{display:none;flex:none;border:0;background:none;width:40px;height:40px;margin-right:-10px;padding:10px;color:#70757a;cursor:pointer}
.fsg-fill svg{width:20px;height:20px;fill:currentColor}
.fsg-head{padding:14px 20px 6px var(--fsg-pad,16px);font-size:14px;color:#70757a}
.fsg-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;padding:10px 20px 0;position:relative}
.fsg-foot button{background:#f8f9fa;border:1px solid #f8f9fa;border-radius:4px;color:#3c4043;font:14px arial,sans-serif;padding:0 16px;height:36px;cursor:pointer}
.fsg-foot button:hover{border-color:#dadce0;box-shadow:0 1px 1px rgba(0,0,0,.1);color:#202124}
.fsg-report{flex-basis:100%;text-align:right;font-size:12px;font-style:italic;color:#70757a;text-decoration:none;padding-top:4px}
.fsg-report:hover{text-decoration:underline}
@media (max-width:640px),(pointer:coarse){
.fsg-a{min-height:48px}.fsg-site .fsg-a{min-height:56px}.fsg-row{padding-right:16px}
.fsg-fill{display:block}
}`;

function injectStyles(root) {
  const host = root.head ?? root; // a document, or a shadow root
  if (host.querySelector?.("style[data-fsg]")) return;
  const style = document.createElement("style");
  style.dataset.fsg = "";
  style.textContent = CSS;
  host.append(style);
}

let ids = 0;

// Google's autocomplete on `input`. The dropdown hangs off `box` (the visible
// search box the input sits in), sharing its width and extending its shape.
// Each row is a link, so a click goes wherever links go (in Foogle's browser,
// the tab); Enter clicks the highlighted one.
export function attachSuggest(input, {
  box = input.closest("[data-suggest-box]") ?? input.parentElement,
  buttons = false,
  max = 8,
  maxEmpty = 10,
  engine: engineOptions = {},
} = {}) {
  injectStyles(input.getRootNode());
  const id = `fsg-${++ids}`;
  const form = input.form;
  // Suggestions search where the box does (the Images tab's box, Images).
  const searchPath = form ? new URL(form.action, location.href).pathname : "/search";
  const drop = document.createElement("div");
  drop.className = "fsg";
  drop.id = id;
  drop.hidden = true;
  drop.innerHTML = `<ul role="listbox" aria-label="Suggestions"></ul><div class="fsg-foot">${buttons ? `<button type="submit">Foogle Search</button><button type="submit" name="lucky" value="1">I'm Feeling Lucky</button>` : ""}<a class="fsg-report" href="/search?q=report+inappropriate+predictions">Report inappropriate predictions</a></div>`;
  const ul = drop.firstElementChild;
  box.after(drop);
  if (getComputedStyle(box.parentElement).position === "static") box.parentElement.style.position = "relative";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", id);

  let typed = input.value; // what the visitor typed (arrowing through rows doesn't change it)
  let rows = [];
  let sel = -1;
  let active = false; // focused and wanting a dropdown
  let shown = { key: null, ai: [] }; // the AI rows on screen, kept in place while the text stands still
  let frame = 0;
  let pressing = false;
  const stats = []; // ms from a keystroke to suggestions on screen
  let pendingTiming = null;

  const engine = createEngine({ ...engineOptions, onChange: () => schedule() });
  const schedule = () => { frame ||= requestAnimationFrame(() => { frame = 0; update(); }); };

  function compute() {
    const key = normalize(typed);
    const recent = readRecent().filter((q) => normalize(q).startsWith(key)).slice(0, key ? 3 : 6);
    const taken = new Set(recent.map(normalize));
    let ai = engine.pool(key).filter((item) => !taken.has(item.q));
    if (shown.key === key) {
      // While the text stands still, rows already on screen stay where they
      // are and streamed ones join below: nothing jumps under the pointer.
      const now = new Set(ai.map((i) => i.q));
      const kept = shown.ai.filter((i) => now.has(i.q));
      const keptQ = new Set(kept.map((i) => i.q));
      ai = [...kept, ...ai.filter((i) => !keptQ.has(i.q))];
    } else {
      // A new text: the site it most likely names, if any, goes first.
      const site = ai.findIndex((i) => i.type === "site");
      if (site > 0) ai.unshift(...ai.splice(site, 1));
    }
    ai = ai.slice(0, Math.max(0, (key ? max : maxEmpty) - recent.length));
    shown = { key, ai };
    return [
      ...recent.map((q) => ({ type: "search", q, kind: "recent" })),
      ...ai.map((i) => ({ ...i, kind: !key ? "trend" : i.type === "site" ? "site" : "ai" })),
    ];
  }

  const hrefOf = (row) => (row.kind === "site" ? siteHref(row) : `${searchPath}?${new URLSearchParams({ q: row.q })}`);

  function rowHTML(row, i) {
    const icon = row.kind === "site" ? `<img src="${esc(siteIcon(row.domain))}" alt="">` : svg(ICONS[row.kind === "recent" ? "recent" : row.kind === "trend" ? "trend" : "search"]);
    const named = row.title && ![row.q, row.domain].includes(row.title.toLowerCase());
    const sub = row.kind === "site" ? `<span class="fsg-sub">${esc(named ? `${row.title} · ${row.domain}` : row.domain)}</span>` : "";
    const tail = row.kind === "recent" ? `<button class="fsg-rm" type="button" tabindex="-1" aria-label="Remove ${esc(row.q)} from recent searches">Remove</button>`
      : row.kind === "site" ? "" : `<button class="fsg-fill" type="button" tabindex="-1" aria-label="Fill in ${esc(row.q)}">${svg(ICONS.fill)}</button>`;
    return `<li class="fsg-row fsg-${row.kind}${i === sel ? " fsg-sel" : ""}" id="${id}-${i}" role="option" aria-selected="${i === sel}" data-i="${i}"><a class="fsg-a" href="${esc(hrefOf(row))}" tabindex="-1"><span class="fsg-ico">${icon}</span><span class="fsg-text"><span class="fsg-q">${completionHTML(row.q, typed)}</span>${sub}</span></a>${tail}</li>`;
  }

  function render() {
    const visible = active && rows.length > 0;
    if (visible) {
      const trendAt = rows.findIndex((r) => r.kind === "trend");
      ul.innerHTML = rows.map((r, i) => (i === trendAt ? `<li class="fsg-head" role="presentation">Trending searches</li>` : "") + rowHTML(r, i)).join("");
      place();
    }
    drop.hidden = !visible;
    box.classList.toggle("fsg-open", visible);
    input.setAttribute("aria-expanded", String(visible));
    if (sel >= 0 && visible) input.setAttribute("aria-activedescendant", `${id}-${sel}`);
    else input.removeAttribute("aria-activedescendant");
    if (pendingTiming && visible && rows.some((r) => r.kind !== "recent")) {
      stats.push({ key: pendingTiming.key, ms: Math.round(performance.now() - pendingTiming.t) });
      if (stats.length > 200) stats.shift();
      pendingTiming = null;
    }
  }

  function place() {
    const cs = getComputedStyle(box);
    const radius = cs.borderTopLeftRadius;
    Object.assign(drop.style, {
      top: `${box.offsetTop + box.offsetHeight}px`,
      left: `${box.offsetLeft}px`,
      width: `${box.offsetWidth}px`,
      borderRadius: `0 0 ${radius} ${radius}`,
    });
    // Line the row icons up with the box's own magnifier, or its text.
    drop.style.setProperty("--fsg-pad", cs.paddingLeft);
  }

  function update() {
    rows = compute();
    if (sel >= rows.length) sel = -1;
    render();
  }

  function open() {
    active = true;
    if (sel < 0) typed = input.value;
    engine.set(typed);
    update();
  }

  function close() {
    active = false;
    sel = -1;
    render();
  }

  input.addEventListener("input", (e) => {
    if (e.isComposing) return;
    typed = input.value;
    sel = -1;
    active = true;
    pendingTiming = { key: normalize(typed), t: performance.now() };
    engine.set(typed);
    update();
  });
  input.addEventListener("compositionend", () => input.dispatchEvent(new Event("input")));
  // Like Google, the box doesn't open for a page's own autofocus, only once
  // the visitor has done something.
  input.addEventListener("focus", () => { if (navigator.userActivation?.hasBeenActive ?? true) open(); });
  input.addEventListener("mousedown", () => { if (!active) open(); });
  input.addEventListener("blur", () => { if (!pressing) close(); });
  input.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!active || !rows.length) return open();
      const n = rows.length;
      sel = e.key === "ArrowDown" ? (sel + 1 >= n ? -1 : sel + 1) : (sel < 0 ? n - 1 : sel - 1);
      // The box shows the highlighted suggestion; past either end, what was typed.
      input.value = sel >= 0 ? rows[sel].q : typed;
      render();
    } else if (e.key === "Escape" && active) {
      e.preventDefault();
      input.value = typed;
      close();
    } else if (e.key === "Enter" && active && sel >= 0) {
      e.preventDefault();
      ul.querySelector(`[data-i="${sel}"] .fsg-a`)?.click();
    }
  });

  // Clicks in the dropdown must not take focus from the box.
  drop.addEventListener("pointerdown", () => { pressing = true; });
  for (const type of ["pointerup", "pointercancel"]) drop.addEventListener(type, () => setTimeout(() => { pressing = false; }));
  drop.addEventListener("mousedown", (e) => e.preventDefault());
  drop.addEventListener("click", (e) => {
    const li = e.target.closest?.(".fsg-row");
    const row = li && rows[Number(li.dataset.i)];
    if (!row) return;
    if (e.target.closest(".fsg-rm")) {
      e.preventDefault();
      removeRecent(row.q);
      input.focus();
      return update();
    }
    if (e.target.closest(".fsg-fill")) {
      // Phones: take the suggestion into the box and keep typing from there.
      e.preventDefault();
      input.value = typed = `${row.q} `;
      sel = -1;
      input.focus();
      engine.set(typed);
      return update();
    }
    // The row's link: a search or a site, recorded like any search.
    if (e.metaKey || e.ctrlKey || e.shiftKey) return; // a new tab or window
    recordSearch(row.q);
    input.value = row.q;
    close();
  });

  form?.addEventListener("submit", () => {
    recordSearch(input.value);
    close();
  });
  // Back to a page from the history: its dropdown was open when it was left.
  addEventListener("pageshow", () => { typed = input.value; close(); });
  addEventListener("resize", () => { if (!drop.hidden) place(); });

  return { engine, stats, open, close, get rows() { return rows; } };
}

if (typeof document !== "undefined") {
  for (const input of document.querySelectorAll("input[data-suggest]")) attachSuggest(input, { buttons: input.dataset.suggest === "home" });
}
