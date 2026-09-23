// Foogle's browser: tabs, back / forward / reload and the address bar with
// its suggestions (see lib/browserbar.js). Each tab is an iframe showing a
// Foogle page, on Foogle's own origin, so this script can follow what happens
// in it: links and forms open in the tab (or a new one), and its URL, title,
// favicon and loading state show in the bar.
//
// A tab has its own history. Pages in a tab move with location.replace(), so
// the frames never add to the real history themselves; instead this document
// adds one entry per page the visible tab opens, which the real back button
// (or a phone's back gesture) walks, always in the visible tab.
const v = new URL(import.meta.url).search;
const { addressOf, displayURL, isHome, tabTitle, classify, primaryRows, recentRows, searchPath, svgImage, FOOGLE_ICON } = await import(`./browsing.js${v}`);
// AI suggestions and recent searches, shared with Foogle's own search boxes.
const { createEngine, normalize, recordSearch, recentSearches, removeRecent, completionHTML, siteHref, siteIcon, ICONS: SUGGEST_ICONS } = await import("/suggest.js");

const $ = (sel, root = document) => root.querySelector(sel);
const ui = {
  root: $(".browser"), strip: $(".tabs"), newTab: $(".new"), back: $(".back"), fwd: $(".fwd"), reload: $(".reload"),
  form: $(".omni"), input: $(".omni input"), url: $(".omni .url"), drop: $(".drop"), count: $(".count"),
  switcher: $(".switcher"), grid: $(".sw-grid"), views: $(".views"), certHost: $(".cert-host"), icon: $('link[rel="icon"]'),
};
const tabTemplate = $(".tab", ui.strip);
tabTemplate.remove();
const GLOBE = svgImage('<svg viewBox="0 0 24 24"><path fill="#80868b" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.4 1.1-2.8 1.9-4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h3a15.7 15.7 0 0 0 1.3 3.6A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.3-3.6C8.8 5.5 8.4 6.7 8.1 8zM12 20c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.4-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6zm1.8-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4z"/></svg>');
const pathOf = (loc) => loc.pathname + loc.search + loc.hash;

// ---------- state ----------
// A tab: { id, entries: [{ url, y }], i, title, icon } plus, while this page
// is open, its frame, the document it's watching and whether it's loading.
// Kept in sessionStorage so the tabs outlive reloads and typed-in URLs.
const KEY = "fb:browser";
let tabs = [];
let active = null;
let nextId = 1;
// This document's real history entries: hist[n] = { tab, i }, n the current one.
let hist = [];
let n = 0;

const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
function persist() {
  const plain = tabs.map(({ id, entries, i, title, icon }) => ({ id, entries, i, title, icon }));
  try { sessionStorage.setItem(KEY, JSON.stringify({ tabs: plain, active: active.id, nextId, hist, n })); } catch { /* storage full or off */ }
}

const iconFor = (url) => (addressOf(url).site ? null : FOOGLE_ICON);
const makeTab = (url, icon = iconFor(url)) => ({ id: nextId++, entries: [{ url, y: 0 }], i: 0, title: tabTitle(url), icon });
const current = (tab) => tab.entries[tab.i];

// ---------- the real history ----------
const stateOf = (tab) => ({ fb: 1, n, tab: tab.id, i: tab.i });
function pushTop() {
  n++;
  hist.length = n;
  hist[n] = { tab: active.id, i: active.i };
  history.pushState(stateOf(active), "", current(active).url);
}
function replaceTop() {
  hist[n] = { tab: active.id, i: active.i };
  history.replaceState(stateOf(active), "", current(active).url);
}

// The real back and forward buttons (a phone's back gesture) always move the
// visible tab, like a browser's: an entry another tab made just counts as a
// step. With nowhere left to go in this tab, they keep going, out of Foogle.
addEventListener("popstate", (e) => {
  const s = e.state;
  if (!s?.fb) return;
  const dir = s.n < n ? -1 : 1;
  n = s.n;
  const tab = active;
  const i = s.tab === tab.id && tab.entries[s.i] ? s.i : tab.i + dir;
  if (!tab.entries[i]) return history.go(dir);
  if (i !== tab.i) go(tab, i);
  replaceTop();
  persist();
  update();
});

// ---------- tabs and their frames ----------
function frameFor(tab) {
  if (tab.frame) return tab.frame;
  const frame = document.createElement("iframe");
  frame.src = current(tab).url;
  tab.frame = frame;
  tab.loading = true;
  ui.views.append(frame);
  watch(tab);
  return frame;
}

// Loads one of the tab's entries into its frame.
function open(tab, url, y = 0) {
  tab.pending = true; // the frame is on its way to this entry; wherever it lands (after redirects) is it
  tab.restoreY = y;
  tab.loading = true;
  if (!tab.frame) frameFor(tab);
  else tab.frame.contentWindow.location.replace(url);
  watch(tab);
}

function saveScroll(tab) {
  try { if (tab.doc) current(tab).y = tab.doc.defaultView.scrollY; } catch { /* the frame is gone */ }
}

// A new page in this tab.
function navigate(tab, url) {
  saveScroll(tab);
  tab.entries.length = tab.i + 1;
  tab.entries.push({ url, y: 0 });
  tab.i++;
  tab.title = tabTitle(url);
  open(tab, url);
  if (tab === active) pushTop();
  persist();
  update();
}

// One of the tab's own pages again: back, forward, or from the real history.
function go(tab, i) {
  if (!tab.entries[i]) return;
  saveScroll(tab);
  tab.i = i;
  open(tab, current(tab).url, current(tab).y);
}

// The bar's back and forward buttons. When the real history's neighbouring
// entry is this tab's neighbouring page, walk the real history, so the
// browser's own buttons stay in step; otherwise go directly.
function step(d) {
  const tab = active;
  const i = tab.i + d;
  if (!tab.entries[i]) return;
  const h = hist[n + d];
  if (h && h.tab === tab.id && h.i === i) return history.go(d);
  go(tab, i);
  replaceTop();
  persist();
  update();
}

function activate(tab, { top = true } = {}) {
  active = tab;
  frameFor(tab); // a tab restored after a reload loads when it's first shown
  for (const t of tabs) t.frame?.classList.toggle("on", t === tab);
  closeDrop();
  ui.input.blur();
  if (top) replaceTop();
  persist();
  update();
  tab.frame.focus();
}

// Opens `url` in a new tab next to `after`, in the background or in front.
function openTab(url, { background = false, after = active } = {}) {
  const tab = makeTab(url);
  tabs.splice(tabs.indexOf(after) + 1, 0, tab);
  frameFor(tab); // background tabs load at once, as in a browser
  if (background) { persist(); update(); } else activate(tab);
  return tab;
}

function closeTab(tab) {
  const at = tabs.indexOf(tab);
  if (at === -1) return;
  tabs.splice(at, 1);
  clearInterval(tab.timer);
  tab.frame?.remove();
  tab.el?.remove();
  if (!tabs.length) return newTab();
  if (tab === active) activate(tabs[Math.min(at, tabs.length - 1)]);
  else { persist(); update(); }
}

// A fresh Foogle homepage tab, with the address bar ready to type in.
function newTab() {
  const tab = makeTab("/");
  tabs.push(tab);
  activate(tab);
  ui.input.value = "";
  ui.input.focus();
}

// ---------- following a tab's page ----------
// A frame's new document replaces the old one as soon as its first bytes
// arrive, so a loading tab is polled for it; the frame's load event is the
// backstop.
function watch(tab) {
  if (!tab.frame.isConnected) return;
  if (!tab.watching) {
    tab.watching = true;
    tab.frame.addEventListener("load", () => { attach(tab); loaded(tab); });
  }
  clearInterval(tab.timer);
  tab.timer = setInterval(() => { attach(tab); if (!tab.loading) clearInterval(tab.timer); }, 40);
  attach(tab);
}

function attach(tab) {
  let doc;
  try { doc = tab.frame.contentDocument; } catch { return; }
  if (!doc || doc === tab.doc || doc.URL === "about:blank") return;
  tab.doc = doc;
  const win = doc.defaultView;
  arrived(tab, pathOf(win.location));
  win.addEventListener("click", (e) => onLink(tab, e));
  win.addEventListener("auxclick", (e) => onLink(tab, e));
  win.addEventListener("submit", (e) => onForm(tab, e));
  win.addEventListener("hashchange", () => { current(tab).url = pathOf(win.location); if (tab === active) replaceTop(); update(); });
  // Leaving by itself (a script, a form this can't send): the next page will say where it went.
  win.addEventListener("pagehide", () => {
    if (tab.doc !== doc || tab.pending || !tabs.includes(tab)) return;
    current(tab).y = win.scrollY;
    tab.loading = true;
    watch(tab);
    update();
  });
  if (doc.readyState !== "loading") return loaded(tab);
  // The page streams in: its <title> arrives with its first generated bytes.
  const titles = new MutationObserver(() => syncTitle(tab));
  titles.observe(doc, { childList: true, subtree: true });
  doc.addEventListener("DOMContentLoaded", () => { titles.disconnect(); loaded(tab); }, { once: true });
}

// A tab's frame showed a page at `url`: which of the tab's entries is it?
function arrived(tab, url) {
  const e = tab.entries;
  if (tab.pending) { e[tab.i].url = url; tab.pending = false; }
  else if (url === e[tab.i].url) { /* a reload */ }
  else if (e[tab.i - 1]?.url === url) tab.i--;
  else if (e[tab.i + 1]?.url === url) tab.i++;
  else { e.length = tab.i + 1; e.push({ url, y: 0 }); tab.i++; } // the page went somewhere by itself
  tab.title = tabTitle(url);
  tab.icon = iconFor(url) ?? tab.icon;
  if (tab === active) replaceTop();
  syncTitle(tab);
  persist();
  update();
}

function loaded(tab) {
  const doc = tab.doc;
  if (!doc || doc.readyState === "loading") return;
  tab.loading = false;
  syncTitle(tab);
  // A site's favicon is its logo (a known site's) or mark, fixed by now.
  if (addressOf(current(tab).url).site) tab.icon = `/api/favicon?${new URLSearchParams({ url: current(tab).url })}`;
  if (tab.restoreY) doc.defaultView.scrollTo(0, tab.restoreY);
  tab.restoreY = 0;
  persist();
  update();
}

function syncTitle(tab) {
  const t = tab.doc?.title?.trim();
  if (t && t !== tab.title) {
    tab.title = t;
    update();
  }
}

// ---------- links and forms in a tab ----------
// Plain clicks open in the tab; middle-click and ⌘/Ctrl-click open a
// background tab, ⌘/Ctrl-Shift-click and target=_blank a tab in front.
function onLink(tab, e) {
  const middle = e.type === "auxclick";
  if (e.defaultPrevented || e.button !== (middle ? 1 : 0)) return;
  const a = e.target.closest?.("a[href]");
  if (!a || a.hasAttribute("download")) return;
  // A page's own "Go back" link, which its content policy would block.
  if (/^javascript:\s*history\.back\(\)/i.test(a.getAttribute("href"))) {
    e.preventDefault();
    if (tab === active) step(-1);
    return;
  }
  let url;
  try { url = new URL(a.href); } catch { return; }
  if (url.origin !== location.origin) return;
  const loc = tab.doc.defaultView.location;
  const newTab = middle || e.metaKey || e.ctrlKey || /^_(blank|new)$/i.test(a.target);
  if (!newTab && url.hash && url.pathname === loc.pathname && url.search === loc.search) return; // in-page anchor
  e.preventDefault();
  if (newTab) openTab(pathOf(url), { background: middle || !(e.shiftKey || /^_/.test(a.target)), after: tab });
  else navigate(tab, pathOf(url));
}

function onForm(tab, e) {
  if (e.defaultPrevented) return;
  const form = e.target;
  const sub = e.submitter;
  let action;
  try { action = new URL(sub?.hasAttribute("formaction") ? sub.formAction : form.action); } catch { return; }
  if (action.origin !== location.origin) return;
  const method = (sub?.getAttribute("formmethod") || form.getAttribute("method") || "get").toLowerCase();
  const inNewTab = /^_(blank|new)$/i.test(sub?.getAttribute("formtarget") || form.target);
  const data = new URLSearchParams(new FormData(form, sub));
  if (method === "get") {
    e.preventDefault();
    action.search = data.toString();
    const url = action.pathname + action.search;
    if (inNewTab) openTab(url, { after: tab });
    else navigate(tab, url);
  } else if (method === "post" && !inNewTab && form.enctype === "application/x-www-form-urlencoded") {
    e.preventDefault();
    post(tab, form, action, data);
  }
}

// A POST can't be sent with location.replace(), so it is sent here, and the
// tab opens wherever it redirects to (a confirmation page, ?order=4821).
async function post(tab, form, action, data) {
  tab.loading = true;
  update();
  const stop = new AbortController();
  try {
    const res = await fetch(action, { method: "POST", body: data, signal: stop.signal });
    stop.abort(); // only where it went matters; the tab loads that itself
    const to = new URL(res.url);
    navigate(tab, to.pathname + to.search);
  } catch {
    if (!stop.signal.aborted) form.submit(); // let the browser send it after all
  }
}

// ---------- the bar ----------
function tabEl(tab) {
  if (tab.el) return tab.el;
  const el = tabTemplate.cloneNode(true);
  el.addEventListener("click", () => activate(tab));
  el.addEventListener("auxclick", (e) => { if (e.button === 1) closeTab(tab); });
  $(".x", el).addEventListener("click", (e) => { e.stopPropagation(); closeTab(tab); });
  tab.el = el;
  return el;
}

function paintTab(tab, el) {
  el.classList.toggle("on", tab === active);
  el.classList.toggle("loading", !!tab.loading);
  el.setAttribute("aria-selected", String(tab === active));
  el.title = tab.title;
  if (tab.frame) tab.frame.title = tab.title;
  $(".title", el).textContent = tab.title;
  const img = $(".fav", el);
  const src = tab.icon || GLOBE;
  if (img.getAttribute("src") !== src) img.src = src;
}

// The homepage is the new-tab page: its address bar is empty, as Chrome's
// is with Google, and shows its placeholder.
const addressText = () => (isHome(current(active).url) ? "" : displayURL(current(active).url));
function showAddress() {
  const { host, path } = addressOf(current(active).url);
  const home = isHome(current(active).url);
  ui.input.value = addressText();
  ui.root.classList.toggle("home", home);
  const www = host.startsWith("www.") ? "www." : "";
  $(".s", ui.url).textContent = home ? "" : "https://";
  $(".w", ui.url).textContent = home ? "" : www;
  $(".h", ui.url).textContent = home ? "" : host.slice(www.length);
  $(".p", ui.url).textContent = home || path === "/" ? "" : path;
  ui.certHost.textContent = host;
}

function update() {
  let prev = null;
  for (const tab of tabs) {
    const el = tabEl(tab);
    paintTab(tab, el);
    const spot = prev ? prev.nextSibling : ui.strip.firstChild;
    if (el !== spot) ui.strip.insertBefore(el, spot);
    prev = el;
  }
  ui.back.disabled = active.i === 0;
  ui.fwd.disabled = active.i >= active.entries.length - 1;
  ui.root.classList.toggle("loading", !!active.loading);
  if (document.activeElement !== ui.input) showAddress();
  if (document.title !== active.title) document.title = active.title;
  const icon = active.icon || GLOBE;
  if (ui.icon.getAttribute("href") !== icon) ui.icon.href = icon;
  $("span", ui.count).textContent = tabs.length;
  ui.count.setAttribute("aria-label", `Show tabs (${tabs.length})`);
  if (!ui.switcher.hidden) renderSwitcher();
}

ui.back.addEventListener("click", () => step(-1));
ui.fwd.addEventListener("click", () => step(1));
ui.reload.addEventListener("click", () => {
  const tab = active;
  if (tab.loading) {
    try { tab.frame.contentWindow.stop(); } catch { /* nothing to stop */ }
    tab.loading = false;
    return update();
  }
  saveScroll(tab);
  tab.restoreY = current(tab).y;
  tab.loading = true;
  tab.frame.contentWindow.location.reload();
  watch(tab);
  update();
});
ui.newTab.addEventListener("click", newTab);

// ---------- phones: the tab switcher ----------
function renderSwitcher() {
  ui.grid.replaceChildren(...tabs.map((tab) => {
    const card = document.createElement("div");
    card.className = `card${tab === active ? " on" : ""}${tab.loading ? " loading" : ""}`;
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    const top = document.createElement("div");
    top.className = "top";
    const ico = document.createElement("span");
    ico.className = "ico";
    const img = document.createElement("img");
    img.className = "fav";
    img.alt = "";
    img.src = tab.icon || GLOBE;
    const spin = document.createElement("i");
    spin.className = "spin";
    ico.append(img, spin);
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = tab.title;
    top.append(ico, title);
    const host = document.createElement("div");
    host.className = "host";
    host.textContent = addressOf(current(tab).url).host;
    const x = $(".x", tabTemplate).cloneNode(true);
    x.addEventListener("click", (e) => { e.stopPropagation(); closeTab(tab); });
    card.append(top, host, x);
    card.addEventListener("click", () => { toggleSwitcher(false); activate(tab); });
    return card;
  }));
}
function toggleSwitcher(show = ui.switcher.hidden) {
  ui.switcher.hidden = !show;
  if (show) { closeDrop(); renderSwitcher(); }
}
ui.count.addEventListener("click", () => toggleSwitcher());
$(".sw-done").addEventListener("click", () => toggleSwitcher(false));
$(".sw-new").addEventListener("click", () => { toggleSwitcher(false); newTab(); });

// ---------- the address field and its suggestions ----------
// Sources of suggestion rows, asked in order; each takes the typed text (and
// an abort signal, for when the text changes) and resolves to rows
// ({ kind, label, detail, fill, target }, see public/fw/browsing.js). Rows
// show as each source answers, in this order; ones that go to the same place
// are shown once, first wins.
const here = location.host;
const fromServer = (path) => async (text, signal) => (await (await fetch(`${path}?${new URLSearchParams({ q: text })}`, { signal })).json()).rows ?? [];

// AI suggestions (/api/suggest, through public/suggest.js): what's shown now
// comes from lists already fetched, and more stream in (see aiArrived). A
// site the model thinks the text names comes first, with its favicon. A URL
// goes where it says, so it gets none.
const ai = createEngine({ onChange: () => aiArrived() });
let aiShown = { key: null, items: [] };
function aiRows(text) {
  const key = normalize(text);
  if (key.trim() && classify(text, { here }).kind !== "search") return [];
  let items = ai.pool(key);
  if (aiShown.key === key) {
    // Rows on screen stay put while the text does; new ones join below.
    const kept = aiShown.items.filter((i) => items.includes(i));
    items = [...kept, ...items.filter((i) => !kept.includes(i))];
  } else {
    const site = items.findIndex((i) => i.type === "site");
    if (site > 0) items = [items[site], ...items.filter((_, j) => j !== site)];
  }
  aiShown = { key, items };
  return items.map((i) => (i.type === "site"
    ? { kind: "site", label: i.domain, detail: i.title && i.title.toLowerCase() !== i.domain ? i.title : "", fill: i.domain, target: siteHref(i), icon: siteIcon(i.domain) }
    : { kind: key ? "suggest" : "trend", label: i.q, detail: "", fill: i.q, target: searchPath(i.q) }));
}
const SOURCES = [
  async (text) => primaryRows(text, { here }), // the first is what Enter does
  async (text) => recentRows(text, recentSearches()),
  fromServer("/api/sites"), // known sites the text names (lib/brands.js)
  async (text) => { ai.set(classify(text, { here }).kind === "search" ? text : ""); return aiRows(text); },
];
const AI_SOURCE = SOURCES.length - 1;
const ROW_ICONS = {
  search: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  url: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 17.93A8 8 0 0 1 4 12c0-.62.08-1.21.21-1.79L9 15v1a2 2 0 0 0 2 2v1.93zm6.9-2.54A2 2 0 0 0 16 16h-1v-3a1 1 0 0 0-1-1H8v-2h2a1 1 0 0 0 1-1V7h2a2 2 0 0 0 2-2v-.41a7.98 7.98 0 0 1 2.9 12.8z",
};
ROW_ICONS.site = ROW_ICONS.url;
ROW_ICONS.recent = "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z";
ROW_ICONS.suggest = ROW_ICONS.search;
ROW_ICONS.trend = SUGGEST_ICONS.trend;
let rows = [];
let lists = [];
let picked = 0;
let typed = "";
let asking = null;
// With nothing typed (a new tab), the field offers recent searches and
// what's trending, as Foogle's search boxes do, and nothing is picked:
// arrowing past either end comes back to the empty field.
const zero = () => !typed.trim();

// Rows that go to the same place show once: a site by its host, a search by
// its words, whatever their case.
function rowKey(r) {
  const host = r.kind === "site" && r.target.match(/^\/web\/(?:www\.)?([^/?#]+)/)?.[1];
  if (host) return `site:${host}`;
  return r.kind === "url" ? r.target : `q:${normalize(r.fill).trim()}`;
}

function showRows() {
  const seen = new Set();
  rows = lists.flat().filter((r) => !seen.has(rowKey(r)) && seen.add(rowKey(r))).slice(0, zero() ? 10 : 8);
  picked = zero() ? Math.min(picked, rows.length - 1) : Math.max(0, Math.min(picked, rows.length - 1));
  renderDrop();
}

function suggest() {
  typed = ui.input.value;
  const text = typed.trim();
  asking?.abort();
  const ask = asking = new AbortController();
  if (!text) {
    picked = -1;
    ai.set("");
    lists = [recentSearches().slice(0, 6).map((q) => ({ kind: "recent", label: q, detail: "", fill: q, target: searchPath(q) })), aiRows("")];
    return showRows();
  }
  picked = 0;
  lists = SOURCES.map(() => []);
  SOURCES.forEach((source, i) => source(text, ask.signal).then((list) => {
    if (ask.signal.aborted) return; // typed on since
    lists[i] = list;
    showRows();
  }, () => {}));
}

// Streamed AI suggestions for what's in the field arrived.
function aiArrived() {
  if (document.activeElement !== ui.input || asking?.signal.aborted || !lists.length) return;
  lists[zero() ? 1 : AI_SOURCE] = aiRows(typed.trim() ? typed : "");
  showRows();
}

function renderDrop() {
  if (!rows.length) return hideDrop();
  const trendAt = rows.findIndex((r) => r.kind === "trend");
  ui.drop.replaceChildren(...rows.flatMap((row, i) => {
    const el = document.createElement("div");
    el.className = "row";
    el.dataset.kind = row.kind;
    el.id = `suggestion-${i}`;
    el.setAttribute("role", "option");
    el.setAttribute("aria-selected", String(i === picked));
    if (row.icon) el.append(Object.assign(document.createElement("img"), { className: "ico", src: row.icon, alt: "" }));
    else el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ROW_ICONS[row.kind] ?? ROW_ICONS.search}"/></svg>`;
    const label = document.createElement("span");
    label.className = "label";
    // Like Google, what was typed in normal weight and the completion in bold.
    if (["suggest", "recent", "site"].includes(row.kind)) label.innerHTML = completionHTML(row.label, typed);
    else label.textContent = row.label;
    el.append(label);
    if (row.detail) {
      const detail = document.createElement("span");
      detail.className = "detail";
      detail.textContent = row.detail;
      el.append(detail);
    }
    if (row.kind === "recent") {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "rm";
      rm.tabIndex = -1;
      rm.textContent = "Remove";
      rm.setAttribute("aria-label", `Remove ${row.label} from recent searches`);
      rm.addEventListener("click", (e) => { e.stopPropagation(); removeRecent(row.label); suggest(); });
      el.append(rm);
    }
    el.addEventListener("mousedown", (e) => e.preventDefault()); // keep the field focused
    el.addEventListener("click", () => goTo(row.target));
    if (i !== trendAt) return [el];
    const head = document.createElement("div");
    head.className = "head";
    head.textContent = "Trending searches";
    return [head, el];
  }));
  ui.drop.hidden = false;
  ui.form.classList.add("open");
  if (picked >= 0) ui.input.setAttribute("aria-activedescendant", `suggestion-${picked}`);
  else ui.input.removeAttribute("aria-activedescendant");
}

function closeDrop() {
  asking?.abort();
  rows = [];
  hideDrop();
}
function hideDrop() {
  ui.drop.hidden = true;
  ui.form.classList.remove("open");
  ui.input.removeAttribute("aria-activedescendant");
}

// What Enter does: the picked row, or for text never suggested on (the
// script's rows arrive a moment after typing), what the text itself means.
function goTo(target) {
  const query = (target.startsWith("/search?") && new URLSearchParams(target.slice(8)).get("q"))
    || (target.startsWith("/web/") && new URL(target, location.href).searchParams.get("fq"));
  if (query) recordSearch(query);
  closeDrop();
  ui.input.blur();
  navigate(active, target);
  active.frame.focus();
}

ui.input.addEventListener("input", suggest);
ui.input.addEventListener("keydown", (e) => {
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && rows.length && zero()) {
    e.preventDefault();
    const n = rows.length;
    picked = e.key === "ArrowDown" ? (picked + 1 >= n ? -1 : picked + 1) : (picked < 0 ? n - 1 : picked - 1);
    ui.input.value = picked >= 0 ? rows[picked].fill : typed;
    renderDrop();
  } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && rows.length) {
    e.preventDefault();
    picked = (picked + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
    ui.input.value = picked === 0 ? typed : rows[picked].fill;
    renderDrop();
  } else if (e.key === "Escape") {
    e.preventDefault();
    if (rows.length) { closeDrop(); ui.input.value = typed; }
    else if (ui.input.value !== addressText()) { showAddress(); ui.input.select(); }
    else { ui.input.blur(); active.frame.focus(); }
  }
});
ui.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = ui.input.value.trim();
  if (!text) return;
  const row = rows[picked];
  goTo(row && (picked > 0 || ui.input.value === typed || zero()) ? row.target : classify(text, { here }).target);
});

// Select everything on the first click, like an omnibox; a second click
// places the caret. A mouse click would place the caret after focusing, so
// it focuses by hand; a tap or Tab selects once focus has landed.
let pointer = "";
let focusedAt = 0;
ui.input.addEventListener("pointerdown", (e) => { pointer = e.pointerType; });
ui.input.addEventListener("mousedown", (e) => {
  if (pointer !== "mouse" || e.button !== 0 || document.activeElement === ui.input) return;
  e.preventDefault();
  ui.input.focus();
  ui.input.select();
});
ui.input.addEventListener("focus", () => {
  focusedAt = Date.now();
  if (!ui.input.value.trim()) suggest(); // a new tab: recent searches and trends
  setTimeout(() => { if (document.activeElement === ui.input && ui.input.selectionStart === ui.input.selectionEnd) ui.input.select(); }, 0);
});
ui.input.addEventListener("mouseup", (e) => { if (Date.now() - focusedAt < 400) e.preventDefault(); });
ui.input.addEventListener("blur", () => { closeDrop(); showAddress(); });

// ---------- start ----------
// The server drew one tab, showing this page. Bring back the tabs this
// browser tab had: after a reload or a step back into this page, exactly as
// they were; after a URL typed into the real address bar, with the tab that
// was in front going there.
{
  const saved = read();
  const url = pathOf(location);
  const frame = $(".views iframe");
  if (saved?.tabs?.length) {
    tabs = saved.tabs;
    nextId = saved.nextId;
    hist = saved.hist ?? [];
  }
  const s = history.state?.fb ? history.state : null;
  const back = s && tabs.find((t) => t.id === s.tab && t.entries[s.i]);
  if (back) {
    active = back;
    active.i = s.i;
    n = s.n;
    current(active).url = url;
    active.restoreY = current(active).y;
  } else {
    active = tabs.find((t) => t.id === saved?.active);
    if (!active) tabs.push(active = makeTab(url, $(".fav", tabTemplate).getAttribute("src")));
    else if (current(active).url !== url) {
      active.entries.length = active.i + 1;
      active.entries.push({ url, y: 0 });
      active.i++;
    }
    n = saved?.hist ? (saved.n ?? hist.length - 1) + 1 : 0;
    hist.length = n;
  }
  active.frame = frame;
  active.loading = true;
  active.pending = false;
  frame.classList.add("on");
  replaceTop();
  watch(active);
  addEventListener("pagehide", () => { for (const t of tabs) saveScroll(t); persist(); });
  persist();
  update();
  frame.focus(); // keys scroll the page, as in a browser
}
