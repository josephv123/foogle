// Turns a tiny JSON site brief into a complete stylesheet, header and footer.
//
// The point is latency. Asking a 9B model to hand-write a stylesheet costs
// ~1200 tokens before the visitor sees anything but unstyled text — about a
// minute at local speeds. The same model can pick a *kind*, a *mood* and a
// *hue* in ~35 tokens (~2s), and those three fields are enough to build a page
// that looks deliberately designed. Diversity survives because the model still
// chooses the archetype, palette, name, nav and content; what it stops doing is
// retyping flexbox from memory.

import { siteMark } from "./icons.js";
import { siteImageStyle } from "./images.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const FONTS = {
  sans: `-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif`,
  serif: `Georgia,"Iowan Old Style",Palatino,"Times New Roman",serif`,
  mono: `ui-monospace,Menlo,Consolas,"SF Mono",monospace`,
  grot: `"Avenir Next",Futura,"Trebuchet MS",-apple-system,sans-serif`,
  cond: `"Oswald","Arial Narrow",Impact,sans-serif`,
  humanist: `Optima,"Gill Sans","Segoe UI",Candara,sans-serif`,
  didone: `Didot,"Bodoni 72","Bodoni MT","Playfair Display",Georgia,serif`,
  slab: `Rockwell,"Roboto Slab","Museo Slab","Courier New",serif`,
  rounded: `ui-rounded,"SF Pro Rounded",Nunito,"Varela Round",system-ui,sans-serif`,
  book: `Charter,"Iowan Old Style","Hoefler Text",Baskerville,Georgia,serif`,
  typewriter: `"American Typewriter","Courier Prime","Courier New",monospace`,
};

// A site's structure, chosen per domain from what suits its kind: font
// pairing, header, hero, side rail and footer. Seeded by the domain, so every
// page of a site shares one design while two sites of the same kind rarely do.
const VARIANTS = {
  forum: { fonts: [["sans", "sans"], ["humanist", "humanist"], ["sans", "rounded"]], header: ["stacked", "bar"], hero: ["split", "compact"], side: ["right", "right", "none"], footer: ["simple", "fat"] },
  store: { fonts: [["sans", "grot"], ["humanist", "didone"], ["sans", "rounded"], ["book", "slab"]], header: ["stacked", "center", "bar"], hero: ["split", "center"], side: ["none", "left"], footer: ["fat"] },
  wiki: { fonts: [["serif", "serif"], ["book", "book"], ["sans", "serif"]], header: ["sidebar", "bar"], hero: ["compact"], side: ["none"], footer: ["simple"] },
  blog: { fonts: [["serif", "serif"], ["book", "didone"], ["sans", "grot"], ["book", "typewriter"]], header: ["minimal", "masthead"], hero: ["split", "center"], side: ["none", "right"], footer: ["simple"] },
  news: { fonts: [["serif", "cond"], ["book", "didone"], ["sans", "slab"]], header: ["masthead", "stacked"], hero: ["split", "center"], side: ["none"], footer: ["fat"] },
  startup: { fonts: [["sans", "grot"], ["sans", "rounded"], ["humanist", "grot"]], header: ["pill", "bar"], hero: ["center", "split"], side: ["none"], footer: ["fat"] },
  gov: { fonts: [["sans", "sans"], ["humanist", "slab"]], header: ["stacked", "sidebar"], hero: ["compact", "split"], side: ["left", "none"], footer: ["fat"] },
  zine: { fonts: [["mono", "mono"], ["typewriter", "cond"], ["mono", "didone"]], header: ["masthead", "sidebar"], hero: ["split", "center"], side: ["none"], footer: ["simple"] },
};

// Navigation a site of each kind would actually have. Four or five are picked
// per domain, in this order.
const NAVS = {
  forum: ["Latest", "Categories", "Top", "Unanswered", "Members", "Guidelines"],
  store: ["Shop all", "New in", "Bestsellers", "Sale", "Journal", "Stockists"],
  wiki: ["Main page", "Contents", "Random article", "Recent changes", "Help"],
  blog: ["Essays", "Notes", "Reading list", "Now", "Newsletter", "About"],
  news: ["World", "Local", "Business", "Science", "Opinion", "Culture"],
  startup: ["Product", "Pricing", "Docs", "Customers", "Changelog", "Careers"],
  gov: ["Services", "Apply", "Forms", "News", "Contact us", "Accessibility"],
  zine: ["Issues", "Features", "Contributors", "Events", "Submit", "Shop"],
};

function fnv(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
const choose = (plan, salt, options) => options[fnv(`${plan.site}|${plan.kind}|${salt}`) % options.length];

export function siteStyle(plan) {
  const v = VARIANTS[plan.kind] ?? VARIANTS.blog;
  return {
    fonts: choose(plan, "fonts", v.fonts),
    header: choose(plan, "header", v.header),
    hero: choose(plan, "hero", v.hero),
    side: choose(plan, "side", v.side),
    footer: choose(plan, "footer", v.footer),
  };
}

export function defaultNav(kind, site) {
  const pool = NAVS[kind] ?? NAVS.blog;
  const drop = fnv(`${site}|nav`) % pool.length;
  return pool.filter((_, i) => i !== drop).slice(0, 4 + (fnv(site) % 2));
}

// Archetype: typography, measure and shape. This is what makes a forum not look
// like a storefront even when they land on the same hue.
const KINDS = {
  forum: { body: "sans", head: "sans", maxw: 980, rad: 4, tight: 1, caps: 0 },
  store: { body: "sans", head: "grot", maxw: 1080, rad: 12, tight: 0, caps: 1 },
  wiki: { body: "serif", head: "serif", maxw: 900, rad: 2, tight: 1, caps: 0 },
  blog: { body: "serif", head: "serif", maxw: 720, rad: 6, tight: 0, caps: 0 },
  news: { body: "sans", head: "cond", maxw: 960, rad: 3, tight: 1, caps: 1 },
  startup: { body: "sans", head: "grot", maxw: 1100, rad: 16, tight: 0, caps: 1 },
  gov: { body: "sans", head: "sans", maxw: 940, rad: 2, tight: 1, caps: 0 },
  zine: { body: "mono", head: "mono", maxw: 860, rad: 0, tight: 0, caps: 1 },
};

// Palette. Everything derives from one hue so the page reads as coordinated.
const MOODS = {
  dark: (h) => ({
    bg: `hsl(${h},16%,8%)`, panel: `hsl(${h},15%,12%)`, fg: `hsl(${h},12%,92%)`,
    muted: `hsl(${h},10%,60%)`, line: `hsl(${h},14%,21%)`,
    acc: `hsl(${h},80%,63%)`, acc2: `hsl(${(h + 40) % 360},72%,58%)`,
    heroA: `hsl(${h},40%,14%)`, heroB: `hsl(${(h + 55) % 360},45%,10%)`, bw: 1, glow: 0,
  }),
  light: (h) => ({
    bg: `hsl(${h},32%,97%)`, panel: `#fff`, fg: `hsl(${h},25%,13%)`,
    muted: `hsl(${h},12%,42%)`, line: `hsl(${h},20%,87%)`,
    acc: `hsl(${h},68%,40%)`, acc2: `hsl(${(h + 35) % 360},60%,45%)`,
    heroA: `hsl(${h},55%,92%)`, heroB: `hsl(${(h + 45) % 360},60%,86%)`, bw: 1, glow: 0,
  }),
  paper: (h) => ({
    bg: `hsl(40,38%,93%)`, panel: `hsl(42,46%,97%)`, fg: `hsl(28,22%,15%)`,
    muted: `hsl(30,14%,40%)`, line: `hsl(32,22%,79%)`,
    acc: `hsl(${h},55%,33%)`, acc2: `hsl(12,58%,42%)`,
    heroA: `hsl(40,42%,89%)`, heroB: `hsl(28,38%,82%)`, bw: 1, glow: 0,
  }),
  neon: (h) => ({
    bg: `hsl(${h},42%,5%)`, panel: `hsl(${h},40%,9%)`, fg: `hsl(${h},16%,95%)`,
    muted: `hsl(${h},18%,62%)`, line: `hsl(${h},55%,24%)`,
    acc: `hsl(${h},100%,64%)`, acc2: `hsl(${(h + 155) % 360},100%,62%)`,
    heroA: `hsl(${h},70%,10%)`, heroB: `hsl(${(h + 155) % 360},70%,8%)`, bw: 1, glow: 1,
  }),
  brutal: (h) => ({
    bg: `hsl(${h},55%,95%)`, panel: `#fff`, fg: `#000`,
    muted: `#3a3a3a`, line: `#000`,
    acc: `hsl(${h},95%,38%)`, acc2: `#000`,
    heroA: `hsl(${h},90%,62%)`, heroB: `hsl(${(h + 40) % 360},90%,70%)`, bw: 3, glow: 0,
  }),
};

export function normalizePlan(raw = {}) {
  const kind = KINDS[String(raw.kind ?? "").toLowerCase()] ? String(raw.kind).toLowerCase() : "blog";
  const mood = MOODS[String(raw.mood ?? "").toLowerCase()] ? String(raw.mood).toLowerCase() : "light";
  let hue = parseInt(raw.hue, 10);
  if (!Number.isFinite(hue)) hue = 210;
  hue = ((hue % 360) + 360) % 360;
  const nav = (Array.isArray(raw.nav) ? raw.nav : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
  const secs = (Array.isArray(raw.secs) ? raw.secs : []).map((s) => String(s).trim()).filter(Boolean);
  return {
    kind,
    mood,
    hue,
    site: String(raw.site ?? "").trim().slice(0, 40),
    // The page's own headline, when it differs from the site name (e.g. the
    // search-result title the visitor clicked). Empty means "this is the site".
    title: String(raw.title ?? "").trim().slice(0, 140),
    tag: String(raw.tag ?? "").trim().slice(0, 200),
    // What the visitor searched for. A title alone can be ambiguous to draw
    // ("French Roadster" came out as a car on a bicycle site).
    topic: String(raw.topic ?? "").trim().slice(0, 100),
    // The kind of search result the visitor clicked; picks the logo glyph so
    // the site's mark matches its favicon on the results page.
    mark: String(raw.mark ?? "").trim().toLowerCase().slice(0, 20),
    nav,
    secs,
  };
}

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "index";

// A background texture per mood, so pages don't sit on a flat fill.
const TEXTURES = {
  dark: (h) => `body{background-image:radial-gradient(1100px 520px at 85% -12%,hsla(${h},70%,50%,.13),transparent 70%);background-attachment:fixed}`,
  light: (h) => `body{background-image:radial-gradient(900px 420px at 8% -10%,hsla(${h},85%,70%,.2),transparent 70%);background-attachment:fixed}`,
  paper: () => `body{background-image:radial-gradient(hsla(30,40%,30%,.08) 1px,transparent 1.3px);background-size:5px 5px}`,
  neon: (h) => `body{background-image:linear-gradient(hsla(${h},100%,60%,.05) 1px,transparent 1px),linear-gradient(90deg,hsla(${h},100%,60%,.05) 1px,transparent 1px);background-size:34px 34px}h1,.brand span{text-shadow:0 0 18px hsla(${h},100%,60%,.55)}`,
  brutal: () => `.hero{background-image:repeating-linear-gradient(-45deg,transparent 0 22px,rgba(0,0,0,.05) 22px 24px)}`,
};

// Per-archetype hero and heading treatment — the structural difference
// between a newspaper, a wiki and a product launch.
const KIND_CSS = {
  forum: () => `.hero{padding:26px 0 22px}.hero h1{font-size:clamp(1.5rem,3.2vw,2.1rem)}.hero .art{width:min(170px,26%);aspect-ratio:1}
section>h2{font-size:.95rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}`,
  store: () => `.hero{padding:56px 0 48px}.hero h1{font-size:clamp(2rem,4.8vw,3.2rem)}
section>h2::after{content:"";display:block;width:44px;height:3px;background:var(--acc);margin-top:.35em;border-radius:2px}
section:nth-of-type(even){background:var(--panel);box-shadow:0 0 0 100vmax var(--panel);clip-path:inset(-28px -100vmax);padding:4px 0}`,
  wiki: () => `.hero{background:none;animation:none;border-bottom:0;padding:26px 0 0}.hero h1{font-weight:400}.hero .art{width:min(250px,32%)}
section>h2{font-weight:400;border-bottom:var(--bw) solid var(--line);padding-bottom:.2em}`,
  blog: () => `.hero{background:none;animation:none;border-bottom:0;padding:56px 0 8px}.hero .wrap{flex-direction:column;align-items:stretch;gap:26px}.hero .art{width:100%;aspect-ratio:16/7}
.hero h1{font-size:clamp(2.1rem,5vw,3.1rem)}`,
  news: ({ headFont }) => `.hero{background:var(--panel);animation:none;padding:30px 0 26px}.hero .wrap{flex-direction:column;align-items:stretch;gap:22px}.hero .art{width:100%;aspect-ratio:21/8}
.hero h1{font-size:clamp(2rem,5vw,3.3rem);font-family:${headFont}}
section>h2{border-top:3px solid var(--fg);padding-top:.45em}`,
  startup: ({ plan }) => `.hero{position:relative;overflow:hidden;padding:76px 0 66px}.hero .wrap{position:relative}.hero h1{font-size:clamp(2.3rem,5.6vw,3.7rem)}
.hero::before{content:"";position:absolute;width:560px;height:560px;right:-140px;top:-220px;border-radius:50%;background:radial-gradient(circle,hsla(${plan.hue},95%,62%,.38),transparent 65%);animation:float 9s ease-in-out infinite alternate}
@keyframes float{to{transform:translate(-60px,50px) scale(1.08)}}
section>h2::after{content:"";display:block;width:44px;height:3px;background:var(--acc);margin-top:.35em;border-radius:2px}
section:nth-of-type(even){background:var(--panel);box-shadow:0 0 0 100vmax var(--panel);clip-path:inset(-28px -100vmax);padding:4px 0}`,
  gov: () => `.hero{animation:none;border-left:0;padding:34px 0 30px}.hero .art{width:min(200px,28%);aspect-ratio:1}
section>h2{border-left:5px solid var(--acc);padding-left:.5em}`,
  zine: ({ onAcc }) => `.hero h1{display:inline-block;background:var(--acc);color:${onAcc};padding:.05em .3em;transform:rotate(-1.5deg)}.hero .art{transform:rotate(2.5deg)}
section>h2{display:inline-block;background:var(--fg);color:var(--bg);padding:.1em .4em;transform:rotate(-1deg)}`,
};

// CSS for the structural variants chosen by siteStyle(): header, hero, side
// rail and footer, plus block fade-ins so streamed blocks arrive cleanly.
function STRUCTURE_CSS({ c, plan, onAcc, headFont, shadow, st }) {
  const css = [`
.brand{display:inline-flex;align-items:center;gap:10px}.brand .mark{flex:none;border-radius:0}
.brand-text{display:flex;flex-direction:column;line-height:1.1;min-width:0;overflow-wrap:anywhere}
.actions{display:flex;gap:10px;align-items:center;margin-left:18px}
.top-row .actions{margin-left:auto}
.btn.sm{padding:.4em .9em;font-size:.82rem;box-shadow:none}
.search{display:flex;align-items:center;gap:6px;background:var(--bg);border:var(--bw) solid var(--line);border-radius:${plan.mood === "brutal" ? 0 : 999}px;padding:6px 12px;min-width:0}
.search input{border:0;background:none;color:var(--fg);font:inherit;font-size:.86rem;outline:none;width:100%;min-width:90px}
.cart{font-family:${headFont};font-size:.86rem;color:var(--fg);white-space:nowrap}
section>*,section .grid>*,section .row>*,section tbody>tr,section ul>li,section ol>li,section .bars>p,section details{animation:blockin .45s ease-out both}
@keyframes blockin{from{opacity:0;transform:translateY(6px)}}
.layout{display:grid;gap:44px;align-items:start}
.layout>main{min-width:0;padding-top:34px}
.rail{position:sticky;top:84px;padding-top:34px;display:flex;flex-direction:column;gap:16px;font-size:.9rem}
.rail .card h4{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 .6em}
.rail ul{list-style:none;margin:0}.rail li{margin:.35em 0}
.rail label{display:flex;gap:8px;align-items:center;margin:.35em 0}
.rail .tags{display:flex;flex-wrap:wrap;gap:6px}
.rail form{display:flex;flex-direction:column;gap:8px}
.rail input[type=email]{background:var(--bg);border:var(--bw) solid var(--line);border-radius:var(--rad);padding:.55em .7em;color:var(--fg);font:inherit}
footer.fat .cols{display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:28px;width:100%}
footer.fat h4{font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:var(--fg);margin-bottom:.6em}
footer.fat ul{list-style:none;margin:0}footer.fat li{margin:.35em 0}
footer.fat .small{width:100%;border-top:var(--bw) solid var(--line);padding-top:16px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px}`];
  // Headers
  if (st.header === "stacked") css.push(`header.site .wrap{padding-bottom:10px}
header.site .top-row{display:flex;align-items:center;gap:22px;width:100%}
header.site .top-row .search{flex:1;max-width:420px;margin-left:auto}
header.site nav.top{margin:0;width:100%;border-top:var(--bw) solid var(--line);padding-top:10px;gap:26px}`);
  if (st.header === "center") css.push(`header.site .wrap{display:grid;grid-template-columns:1fr auto 1fr;align-items:center}
header.site nav.top{margin:0;grid-column:1;grid-row:1}header.site .brand{grid-column:2;justify-self:center}header.site .actions{grid-column:3;justify-self:end}`);
  if (st.header === "masthead") css.push(`header.site{position:static}
header.site .wrap{flex-direction:column;align-items:center;gap:10px;padding-top:18px}
header.site .mast-top{display:flex;justify-content:space-between;width:100%;font-size:.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
header.site .brand{font-size:clamp(2rem,6vw,3.4rem);letter-spacing:-.02em}
header.site nav.top{margin:0;justify-content:center;border-top:3px double var(--line);border-bottom:var(--bw) solid var(--line);width:100%;padding:8px 0;text-transform:uppercase;font-size:.8rem;letter-spacing:.1em}`);
  if (st.header === "minimal") css.push(`header.site{position:static;background:none;border:0}
header.site .wrap{flex-direction:column;gap:8px;padding-top:34px}
header.site .brand{font-size:1.1rem}header.site nav.top{margin:0;font-size:.85rem}`);
  if (st.header === "pill") css.push(`header.site{background:none;border:0;padding-top:14px}
header.site .wrap{background:color-mix(in srgb,var(--panel) 82%,transparent);backdrop-filter:blur(12px);border:var(--bw) solid var(--line);border-radius:999px;padding:10px 12px 10px 20px;box-shadow:${shadow}}
header.site nav.top{margin:0 0 0 auto}`);
  if (st.header === "sidebar") css.push(`.frame{display:grid;grid-template-columns:230px minmax(0,1fr);min-height:100vh}
header.site.side{position:sticky;top:0;height:100vh;overflow:auto;border-bottom:0;border-right:var(--bw) solid var(--line)}
header.site.side .wrap{flex-direction:column;align-items:stretch;gap:18px;padding:24px 18px}
header.site.side nav.top{margin:0;flex-direction:column;gap:8px;font-size:.92rem}
header.site.side .tools{font-size:.82rem;color:var(--muted)}header.site.side .tools b{display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.4em}
header.site.side .tools a{display:block;color:var(--muted);margin:.25em 0}
@media(max-width:800px){.frame{display:block}header.site.side{position:static;height:auto;border-right:0;border-bottom:var(--bw) solid var(--line)}header.site.side nav.top{flex-direction:row;flex-wrap:wrap}header.site.side .tools{display:none}}`);
  // Heroes
  if (st.hero === "center") css.push(`.hero .wrap{flex-direction:column;text-align:center;align-items:center}
.hero .hero-text{max-width:760px}.hero .tagline{margin:0 auto}
.hero .ctas,.hero .byline,.hero .row{justify-content:center}.hero .art{width:min(560px,100%);aspect-ratio:16/7}`);
  if (st.hero === "compact") css.push(`.hero{background:none;animation:none;border-bottom:0;padding:30px 0 0}.hero .art{width:min(220px,30%)}`);
  // Side rail
  if (st.side !== "none") css.push(`.wrap{max-width:${KINDS[plan.kind].maxw + 300}px}
.layout{grid-template-columns:${st.side === "left" ? "240px minmax(0,1fr)" : "minmax(0,1fr) 270px"}}
.layout>main{grid-row:1;grid-column:${st.side === "left" ? 2 : 1}}.layout>.rail{grid-row:1;grid-column:${st.side === "left" ? 1 : 2}}
@media(max-width:860px){.layout{grid-template-columns:1fr}.layout>main,.layout>.rail{grid-column:1;grid-row:auto}.rail{position:static;padding-top:0}}`);
  css.push(`@media(max-width:640px){header.site .top-row .search,header.site .actions .search{display:none}footer.fat .cols{grid-template-columns:1fr 1fr}}`);
  return css.join("\n");
}

// Cheap, deterministic variety: a page always gets the same byline, counts
// and dates, without spending model tokens on them.
function seeded(plan) {
  let h = 2166136261;
  for (const ch of `${plan.site}|${plan.title}|${plan.kind}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (n) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h ^= h >>> 13;
    return (h >>> 0) % n;
  };
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const AUTHORS = ["Mara Okafor", "Theo Lindqvist", "Priya Raman", "Jules Ferreira", "Nadia Brandt", "Sam Achebe", "Iris Novak", "Kenji Moreau", "Lucía Paredes", "Owen Hart"];
const HANDLES = ["mossbyte", "quietferment", "lina_k", "deltaSprocket", "oldharbor", "pixelfern", "tinmouse", "saltmarsh42"];
const initials = (name) => name.split(/[\s_]+/).map((w) => w[0]).join("").slice(0, 2);

// The hero's invented particulars — byline, dates, counts. Computed once so
// the hero and the section writers (via heroFacts) agree on them.
function heroDetails(plan) {
  const r = seeded(plan);
  const year = 2040 + (plan.hue % 9);
  // A count the page already states (the clicked snippet shows in the hero)
  // beats an invented one: "31 replies" in the tagline must not sit beside "89".
  const stated = (re) => `${plan.title} ${plan.tag}`.match(re)?.[1];
  const d = {
    year,
    date: `${MONTHS[r(12)]} ${1 + r(28)}, ${year}`,
    author: AUTHORS[r(AUTHORS.length)],
    user: HANDLES[r(HANDLES.length)],
    replies: 14 + r(90),
    views: (1 + r(90) / 10).toFixed(1),
    minutes: 3 + r(55),
    readMin: 4 + r(12),
    shipOver: [40, 50, 60, 75][r(4)],
    returnDays: [14, 30, 60][r(3)],
    memberPct: 5 + r(4) * 5,
    rating: `4.${6 + r(4)}`,
    reviews: `${(1 + r(9)).toLocaleString("en-US")},${String(r(1000)).padStart(3, "0")}`,
    version: `${2 + r(7)}.${r(10)}`,
    issue: 3 + r(60),
    issueMonth: MONTHS[r(12)],
    members: `${(2 + r(40)).toLocaleString("en-US")},${String(r(1000)).padStart(3, "0")}`,
    online: 40 + r(900),
    phone: `${200 + r(700)}-555-0${100 + r(899)}`,
  };
  d.replies = Number(stated(/(\d[\d,]*)\s+(?:replies|comments|answers)\b/i)?.replace(/,/g, "")) || d.replies;
  d.reviews = stated(/(\d[\d,]*)\s+(?:reviews|ratings)\b/i) ?? d.reviews;
  return d;
}

// What the hero states, as plain facts for the section writers.
export function heroFacts(plan) {
  const d = heroDetails(plan);
  return {
    forum: [`Thread started by ${d.user} on ${d.date}; ${d.replies} replies so far`, `The forum has ${d.members} members; ${d.online} online now`],
    store: [`Store rating ${d.rating} from ${d.reviews} reviews`, `Free shipping over $${d.shipOver}; ${d.returnDays}-day returns; members save ${d.memberPct}%`],
    blog: [`Written by ${d.author}, published ${d.date}`],
    news: [`Reported by ${d.author}, ${d.date}`],
    startup: [`Current release: v${d.version}`],
    gov: [`Page last updated ${d.date}`, `Help line: ${d.phone}`],
    zine: [`This is issue #${d.issue}, ${d.issueMonth} ${d.year}`],
  }[plan.kind] ?? [];
}

// Archetype furniture around the hero: an announcement bar, a byline, a
// breadcrumb, calls to action. Returns HTML slots for themeHeader.
function chrome(plan, domain) {
  const d = heroDetails(plan);
  const link = (label) => navHref(domain, label);
  const site = esc(plan.site || domain);
  const byline = (extra) => `<div class="byline"><span class="av">${esc(initials(d.author))}</span><span>By <b>${esc(d.author)}</b></span><span>· ${d.date}</span><span>· ${extra}</span></div>`;
  switch (plan.kind) {
    case "forum":
      return {
        pre: `<div class="crumbs"><a href="${link("Forums")}">Forums</a> › <a href="${link("Community")}">Community</a> › Thread</div>`,
        meta: `<div class="byline"><span class="av">${esc(d.user.slice(0, 2))}</span><span>Started by <b>${esc(d.user)}</b></span><span>· ${d.date}</span><span>· ${d.replies} replies · ${d.views}K views</span><span class="tag hot">Hot</span></div>`,
      };
    case "store":
      return {
        above: `<div class="announce">Free shipping over $${d.shipOver} · ${d.returnDays}-day returns · Members save ${d.memberPct}%</div>`,
        meta: `<div class="ctas"><a class="btn" href="${link("Shop")}">Shop now</a><a class="btn ghost" href="${link("Bestsellers")}">Bestsellers</a></div><div class="byline"><span class="stars" style="--r:${d.rating}"></span><span>${d.rating} from ${d.reviews} reviews</span></div>`,
      };
    case "wiki":
      return {
        sub: `<div class="meta">From ${site}, the free encyclopedia</div>`,
        meta: `<div class="wtabs"><a class="on" href="${link("Article")}">Article</a><a href="${link("Talk")}">Talk</a><span>Read</span><a href="${link("Edit")}">Edit</a><a href="${link("History")}">View history</a></div>`,
      };
    case "blog":
      return { meta: byline(`${d.readMin} min read`) };
    case "news":
      return {
        above: `<div class="dateline"><div class="wrap"><span>${d.date}</span><span><i class="live"></i>Live updates</span></div></div>`,
        pre: `<span class="tag hot">${esc(plan.nav[1] || "Latest")}</span>`,
        meta: byline(`Updated ${d.minutes} min ago`),
      };
    case "startup":
      return {
        pre: `<div class="row"><span class="tag hot">New</span><a href="${link("Changelog")}">v${d.version} is live →</a></div>`,
        meta: `<div class="ctas"><a class="btn" href="${link("Get started")}">Get started free</a><a class="btn ghost" href="${link("Demo")}">Book a demo</a></div>`,
      };
    case "gov":
      return {
        above: `<div class="official"><div class="wrap">🏛 An official website of ${site}. <a href="${link("About")}">Here's how you know</a></div></div>`,
        pre: `<div class="crumbs"><a href="${link("Home")}">Home</a> › <a href="${link("Services")}">Services</a></div>`,
        meta: `<div class="byline">Last updated ${d.date}</div>`,
      };
    case "zine":
      return {
        above: plan.tag || plan.title ? `<div class="ticker"><span>${esc(`${plan.title || plan.tag} ✦ `.repeat(4))}</span></div>` : "",
        pre: `<div class="sticker">Issue #${d.issue} · ${d.issueMonth} ${d.year}</div>`,
      };
    default:
      return {};
  }
}

export function themeCSS(plan) {
  const k = KINDS[plan.kind];
  const c = MOODS[plan.mood](plan.hue);
  const st = siteStyle(plan);
  const bodyFont = FONTS[st.fonts[0]];
  const headFont = FONTS[st.fonts[1]];
  const rad = plan.mood === "brutal" ? 0 : k.rad;
  const shadow = plan.mood === "brutal" ? `4px 4px 0 ${c.line}` : c.glow ? `0 0 24px hsla(${plan.hue},100%,50%,.18)` : `0 1px 3px rgba(0,0,0,.08)`;
  const onAcc = plan.mood === "dark" || plan.mood === "neon" ? "#0b0b0b" : "#fff";

  return `<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:${c.bg};--panel:${c.panel};--fg:${c.fg};--muted:${c.muted};--line:${c.line};--acc:${c.acc};--acc2:${c.acc2};--rad:${rad}px;--bw:${c.bw}px}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--fg);font-family:${bodyFont};line-height:${k.tight ? 1.55 : 1.68};font-size:16px;-webkit-font-smoothing:antialiased}
.wrap{max-width:${k.maxw}px;margin:0 auto;padding:0 22px}
h1,h2,h3,h4{font-family:${headFont};line-height:1.15;${k.caps ? "letter-spacing:-.02em;" : ""}}
h1{font-size:clamp(1.9rem,4.4vw,2.9rem);margin:0 0 .35em}
h2{font-size:clamp(1.35rem,2.6vw,1.85rem);margin:0 0 .5em}
h3{font-size:1.16rem;margin:1.3em 0 .4em}
p{margin:0 0 1em}
a{color:var(--acc);text-decoration:none;border-bottom:1px solid transparent;transition:border-color .18s,color .18s}
a:hover{border-bottom-color:var(--acc)}
b,strong{font-weight:700}
code{font-family:${FONTS.mono};font-size:.9em;background:var(--panel);border:var(--bw) solid var(--line);border-radius:3px;padding:.1em .35em}
ul,ol{margin:0 0 1em 1.25em}li{margin:.3em 0}
hr{border:0;border-top:var(--bw) solid var(--line);margin:2em 0}
table{width:100%;border-collapse:collapse;margin:0 0 1.2em;font-size:.95rem}
th,td{border-bottom:var(--bw) solid var(--line);padding:.6em .7em;text-align:left}
th{font-family:${headFont};font-size:.82rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
blockquote,.quote{border-left:3px solid var(--acc);padding:.2em 0 .2em 1em;margin:0 0 1.2em;color:var(--muted);font-style:${k.body === "mono" ? "normal" : "italic"};font-size:1.05rem}
header.site{border-bottom:var(--bw) solid var(--line);background:var(--panel);position:sticky;top:0;z-index:50}
header.site .wrap{display:flex;align-items:center;gap:22px;flex-wrap:wrap;padding-top:14px;padding-bottom:14px}
.brand{font-family:${headFont};font-weight:800;font-size:1.3rem;color:var(--fg);border:0;${k.caps ? "text-transform:uppercase;letter-spacing:.04em;" : ""}}
.brand span{color:var(--acc)}
.brand small{display:block;font-weight:400;font-size:.7rem;color:var(--muted);letter-spacing:.02em;text-transform:none}
nav.top{margin-left:auto;display:flex;gap:20px;flex-wrap:wrap;font-family:${headFont};font-size:.9rem}
nav.top a{color:var(--muted)}
nav.top a:hover{color:var(--acc)}
.hero{background:linear-gradient(115deg,${c.heroA},${c.heroB});background-size:200% 200%;animation:drift 14s ease-in-out infinite;border-bottom:var(--bw) solid var(--line);padding:46px 0 40px}
.hero .tagline{color:var(--muted);font-size:1.12rem;max-width:60ch}
.hero .wrap{display:flex;gap:32px;align-items:center;justify-content:space-between}
.hero .art{flex:none;width:min(340px,38%);min-width:0;height:auto;aspect-ratio:4/3;object-fit:contain;background:${c.panel};border:var(--bw) solid var(--line);border-radius:var(--rad);box-shadow:${shadow};opacity:0;transition:opacity .8s}
@keyframes drift{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
main.wrap{padding-top:34px;padding-bottom:10px}
section{margin:0 0 40px;animation:rise .45s ease-out both}
section:nth-of-type(2){animation-delay:.06s}section:nth-of-type(3){animation-delay:.12s}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.card{background:var(--panel);border:var(--bw) solid var(--line);border-radius:var(--rad);padding:18px 20px;box-shadow:${shadow};transition:transform .18s,box-shadow .18s}
.card:hover{transform:translateY(-2px)}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));margin:0 0 1.2em}
.row{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin:0 0 1.2em}
.lead{font-size:1.16rem;color:var(--muted);margin-bottom:1.1em}
.meta{font-size:.82rem;color:var(--muted);letter-spacing:.02em}
.tag{display:inline-block;font-family:${headFont};font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;padding:.25em .6em;border:var(--bw) solid var(--line);border-radius:${rad ? 999 : 0}px;color:var(--acc);background:var(--panel)}
.btn{display:inline-block;font-family:${headFont};font-weight:600;font-size:.92rem;padding:.6em 1.15em;border:var(--bw) solid ${plan.mood === "brutal" ? "var(--line)" : "transparent"};border-radius:var(--rad);background:var(--acc);color:${plan.mood === "dark" || plan.mood === "neon" ? "#0b0b0b" : "#fff"};box-shadow:${shadow}}
.btn:hover{background:var(--acc2);border-bottom-color:${plan.mood === "brutal" ? "var(--line)" : "transparent"}}
.stat{background:var(--panel);border:var(--bw) solid var(--line);border-radius:var(--rad);padding:14px 16px}
.stat b{display:block;font-family:${headFont};font-size:1.9rem;line-height:1;color:var(--acc)}
.stat span{font-size:.8rem;color:var(--muted)}
.thumb{aspect-ratio:16/9;border-radius:var(--rad);border:var(--bw) solid var(--line);background:linear-gradient(135deg,${c.heroA},${c.acc2});background-size:180% 180%;animation:drift 11s ease-in-out infinite;margin:0 0 1em}
img{max-width:100%;height:auto;border-radius:var(--rad);display:block}
img.pic{width:100%;aspect-ratio:4/3;object-fit:contain;background:var(--panel);border:var(--bw) solid var(--line);margin:0 0 1em}
footer.site{border-top:var(--bw) solid var(--line);background:var(--panel);margin-top:40px;padding:26px 0 40px;font-size:.88rem;color:var(--muted)}
footer.site .wrap{display:flex;gap:26px;flex-wrap:wrap;justify-content:space-between}
footer.site a{color:var(--muted)}footer.site a:hover{color:var(--acc)}
${TEXTURES[plan.mood](plan.hue)}
.hero .hero-text{flex:1;min-width:0}
section:nth-of-type(4){animation-delay:.18s}
section::after{content:"";display:block;clear:both}
.card h3{margin-top:0}.card>:last-child,.band>:last-child,.callout>:last-child,.post>:last-child{margin-bottom:0}
.split{display:grid;grid-template-columns:1.15fr 1fr;gap:28px;align-items:center;margin:0 0 1.2em}
.band{background:var(--panel);border:var(--bw) solid var(--line);border-radius:var(--rad);padding:24px 26px;margin:0 0 1.2em;box-shadow:${shadow}}
.icon{display:block;font-size:1.9rem;line-height:1;margin-bottom:.45em}
.callout{background:hsla(${plan.hue},70%,50%,.09);border:var(--bw) solid var(--line);border-left:4px solid var(--acc);border-radius:var(--rad);padding:14px 18px;margin:0 0 1.2em}
.infobox,table.infobox{float:right;width:min(300px,45%);margin:0 0 1em 1.4em;background:var(--panel);border:var(--bw) solid var(--line);border-radius:var(--rad);font-size:.86rem;box-shadow:${shadow}}
.infobox table{margin:0}.infobox th,.infobox td{padding:.45em .7em}.infobox caption{font-family:${headFont};font-weight:700;padding:.6em .7em;text-align:left}
.thumb{display:grid;place-items:center;font-size:clamp(2.2rem,5vw,3.4rem);line-height:1}
.thumb.stripes{background:repeating-linear-gradient(135deg,${c.heroA} 0 14px,${c.heroB} 14px 28px)}
.thumb.dots{background:radial-gradient(var(--acc) 2px,transparent 2.6px) 0 0/16px 16px,${c.heroA}}
.thumb.rings{background:repeating-radial-gradient(circle at 30% 40%,${c.heroA} 0 12px,${c.heroB} 12px 24px)}
.bars{margin:0 0 1.2em}
.bars p{display:grid;grid-template-columns:minmax(90px,32%) 1fr 3.5em;gap:12px;align-items:center;margin:.5em 0;font-size:.92rem}
.bars i{height:12px;border-radius:99px;background:var(--line);position:relative;overflow:hidden}
.bars i::after,.progress::after{content:"";position:absolute;inset:0 auto 0 0;width:var(--v,50%);background:linear-gradient(90deg,var(--acc),var(--acc2));border-radius:inherit;animation:grow 1.1s cubic-bezier(.2,.8,.2,1) both}
.bars b{font-family:${headFont};text-align:right}
.progress{position:relative;height:10px;border-radius:99px;background:var(--line);overflow:hidden;margin:.4em 0 1em}
@keyframes grow{from{width:0}}
.stars{font-size:0;display:inline-block;vertical-align:middle}
.stars::before{content:"★★★★★";font-size:1rem;letter-spacing:2px;background:linear-gradient(90deg,#f5b301 calc(var(--r,4)*20%),var(--line) 0);-webkit-background-clip:text;background-clip:text;color:transparent}
.price{font-family:${headFont};font-weight:800;font-size:1.35rem;color:var(--fg);margin:.2em 0 .4em}
ol.steps{list-style:none;margin:0 0 1.2em;counter-reset:s}
ol.steps li{counter-increment:s;position:relative;padding:0 0 1em 3em;margin:0}
ol.steps li::before{content:counter(s);position:absolute;left:0;top:-.1em;width:2em;height:2em;border-radius:50%;display:grid;place-items:center;background:var(--acc);color:${onAcc};font:700 .9rem/1 ${headFont}}
ol.steps li:not(:last-child)::after{content:"";position:absolute;left:1em;top:2.1em;bottom:.3em;border-left:2px solid var(--line)}
ol.steps b{display:block}
ul.timeline{list-style:none;margin:0 0 1.2em .4em;padding-left:1.4em;border-left:2px solid var(--line)}
ul.timeline li{position:relative;margin:0 0 1em}
ul.timeline li::before{content:"";position:absolute;left:calc(-1.4em - 6px);top:.4em;width:10px;height:10px;border-radius:50%;background:var(--acc);box-shadow:0 0 0 3px var(--bg)}
ul.timeline b{display:block;font-family:${headFont};font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--acc)}
details.faq{border:var(--bw) solid var(--line);border-radius:var(--rad);background:var(--panel);margin:0 0 .6em;padding:0 16px}
details.faq summary{cursor:pointer;padding:12px 0;font-weight:600;list-style:none;display:flex;justify-content:space-between;gap:12px}
details.faq summary::-webkit-details-marker{display:none}
details.faq summary::after{content:"+";color:var(--acc);font-weight:700;transition:transform .2s}
details.faq[open] summary::after{transform:rotate(45deg)}
details.faq p{margin:0;padding:0 0 12px;color:var(--muted)}
.post{background:var(--panel);border:var(--bw) solid var(--line);border-radius:var(--rad);padding:14px 18px;margin:0 0 12px}
.post .who{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.post .who .meta{margin-left:auto}
.post p{margin:0 0 .6em}
.av{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--acc),var(--acc2));color:${onAcc};font:700 .75rem/1 ${headFont};text-transform:uppercase;flex:none;border:0}
.tag.hot{background:var(--acc);border-color:var(--acc);color:${onAcc}}
.btn.ghost{background:transparent;color:var(--acc);border-color:var(--acc);box-shadow:none}
.btn.ghost:hover{background:var(--acc);color:${onAcc}}
mark{background:hsla(${plan.hue},90%,60%,.3);color:inherit;padding:0 .15em;border-radius:2px}
kbd{font-family:${FONTS.mono};font-size:.82em;border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:.05em .4em;background:var(--panel)}
tbody tr:nth-child(even) td{background:hsla(${plan.hue},30%,50%,.06)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.announce{background:var(--acc);color:${onAcc};text-align:center;font:600 .8rem/1.4 ${headFont};letter-spacing:.03em;padding:7px 12px}
.official,.dateline{border-bottom:var(--bw) solid var(--line);font-size:.78rem;color:var(--muted);padding:6px 0;background:var(--bg)}
.dateline{text-transform:uppercase;letter-spacing:.08em}.dateline .wrap{display:flex;justify-content:space-between;gap:12px}
.live{display:inline-block;width:8px;height:8px;border-radius:50%;background:#e5383b;margin-right:6px;animation:pulse 1.4s infinite}
@keyframes pulse{50%{opacity:.25}}
.ticker{overflow:hidden;white-space:nowrap;background:var(--fg);color:var(--bg);font:.78rem/1 ${FONTS.mono};text-transform:uppercase;letter-spacing:.12em;padding:8px 0}
.ticker span{display:inline-block;padding-left:100%;animation:tick 30s linear infinite}
@keyframes tick{to{transform:translateX(-100%)}}
.crumbs{font-size:.82rem;color:var(--muted);margin-bottom:.8em}.crumbs a{color:var(--muted)}
.byline{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:.88rem;color:var(--muted);margin-top:.9em}
.byline b{color:var(--fg)}
.ctas{display:flex;gap:12px;flex-wrap:wrap;margin-top:1.3em}
.wtabs{display:flex;gap:20px;font-size:.85rem;margin-top:1em;border-bottom:1px solid var(--line)}
.wtabs a,.wtabs span{padding:.45em 0;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px}
.wtabs .on{color:var(--fg);border-bottom-color:var(--acc)}
.sticker{display:inline-block;font:700 .75rem/1 ${FONTS.mono};padding:.45em .8em;border:2px dashed var(--acc);color:var(--acc);transform:rotate(-3deg);margin-bottom:1.1em;text-transform:uppercase;letter-spacing:.1em}
${KIND_CSS[plan.kind]({ c, plan, onAcc, headFont })}
${STRUCTURE_CSS({ c, plan, onAcc, headFont, shadow, st })}
@media(max-width:640px){nav.top{margin-left:0;gap:14px;font-size:.82rem}.hero{padding:30px 0 26px}.hero .wrap{flex-direction:column;align-items:stretch}.hero .art{width:100%}.split{grid-template-columns:1fr}.infobox,table.infobox{float:none;width:auto;margin:0 0 1em}}
</style>`;
}

// "Home" is the site root, not a /home page that duplicates it.
const navHref = (domain, label) => `/web/${esc(domain)}/${slug(label) === "home" ? "" : slug(label)}`;

// The site's palette and picture medium, which its pictures are drawn with
// (see /img in server.js and lib/images.js).
export const artColors = (plan) => {
  const c = MOODS[plan.mood](plan.hue);
  return `s=${siteImageStyle(plan)}&a=landscape&bg=${encodeURIComponent(c.panel)}&fg=${encodeURIComponent(c.acc)}`;
};

// Utility controls a site of each kind puts in its header.
function headerActions(plan, domain, name, link) {
  const search = (ph) => `<form class="search" action="/web/${esc(domain)}/search" method="get"><span aria-hidden="true">⌕</span><input name="q" placeholder="${esc(ph)}" aria-label="Search"></form>`;
  return {
    forum: `${search("Search threads")}<a class="btn ghost sm" href="${link("Log in")}">Log in</a><a class="btn sm" href="${link("Sign up")}">Sign up</a>`,
    store: `${search("Search the shop")}<a class="cart" href="${link("Cart")}">🛒 Cart (0)</a>`,
    wiki: search(`Search ${name}`),
    blog: `<a class="btn sm" href="${link("Subscribe")}">Subscribe</a>`,
    news: `<a class="btn sm" href="${link("Subscribe")}">Subscribe</a>`,
    startup: `<a class="btn ghost sm" href="${link("Log in")}">Log in</a><a class="btn sm" href="${link("Sign up")}">Start free</a>`,
    gov: search("Search services"),
    zine: `<a class="btn ghost sm" href="${link("Submit")}">Submit work</a>`,
  }[plan.kind] ?? "";
}

const STOP = new Set("the and for with from that this your into what when how why are you our about over after before their them than then have has was were will just more most less near best guide".split(" "));
const topicWords = (plan) => [...new Set(`${plan.title} ${plan.tag}`.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) ?? [])].filter((w) => w.length > 3 && !STOP.has(w)).slice(0, 6);

// The side rail: widgets a site of this kind would have, built from what the
// page already knows, so it costs no model tokens and is on screen at once.
function rail(plan, domain, link) {
  const d = heroDetails(plan);
  const tags = topicWords(plan).map((w) => `<a class="tag" href="${link(`tags/${w}`)}">${esc(w)}</a>`).join("");
  switch (plan.kind) {
    case "forum":
      return `<div class="card"><h4>Community</h4><p><b>${d.members}</b> members · <b>${d.online}</b> online now</p><a class="btn sm" href="${link("New thread")}">Start a thread</a></div>
${tags ? `<div class="card"><h4>Tags</h4><div class="tags">${tags}</div></div>` : ""}
<div class="card"><h4>Guidelines</h4><ol><li>Search before you post.</li><li>Share what you tried.</li><li>Be kind; mark answers solved.</li></ol></div>`;
    case "blog":
      return `<div class="card"><h4>About the author</h4><p><span class="av">${esc(initials(d.author))}</span> <b>${esc(d.author)}</b></p><p class="meta">Writing about ${esc(topicWords(plan).slice(0, 3).join(", ") || "whatever won't leave me alone")}.</p></div>
<div class="card"><h4>Newsletter</h4><form action="/web/${esc(domain)}/newsletter" method="get"><input type="email" name="email" placeholder="you@example.com" aria-label="Email"><button class="btn sm" type="submit">Subscribe</button></form></div>
${tags ? `<div class="card"><h4>Topics</h4><div class="tags">${tags}</div></div>` : ""}`;
    case "store":
      return `<div class="card"><h4>Price</h4>${["Under $25", "$25 – $75", "$75 – $150", "$150 +"].map((p) => `<label><input type="checkbox"> ${p}</label>`).join("")}</div>
<div class="card"><h4>Rating</h4><label><input type="checkbox" checked> <span class="stars" style="--r:4"></span> &amp; up</label></div>
<div class="card"><h4>Availability</h4><label><input type="checkbox" checked> In stock</label><label><input type="checkbox"> Ships this week</label></div>`;
    case "gov":
      return `<div class="card"><h4>In this section</h4><ul>${(plan.nav.length ? plan.nav : defaultNav("gov", plan.site)).map((n) => `<li><a href="${link(n)}">${esc(n)}</a></li>`).join("")}</ul></div>
<div class="card"><h4>Need help?</h4><p>Call <b>${d.phone}</b><br><span class="meta">Mon–Fri, 8am–6pm</span></p></div>`;
    default:
      return tags ? `<div class="card"><h4>Topics</h4><div class="tags">${tags}</div></div>` : "";
  }
}

// Side-nav extras for the sidebar header.
function sideTools(plan, link) {
  const d = heroDetails(plan);
  const [title, items] = {
    wiki: ["Tools", ["What links here", "Related changes", "Cite this page", "Printable version"]],
    gov: ["Popular", ["Renew a permit", "Pay a fee", "Report an issue", "Book an appointment"]],
    zine: ["Back issues", [1, 2, 3, 4].map((n) => `Issue #${Math.max(1, d.issue - n)}`)],
  }[plan.kind] ?? ["More", ["About", "Contact"]];
  return `<div class="tools"><b>${title}</b>${items.map((i) => `<a href="${link(i)}">${esc(i)}</a>`).join("")}</div>`;
}

export function themeHeader(plan, domain, { art = false } = {}) {
  const st = siteStyle(plan);
  const name = plan.site || domain;
  const link = (label) => navHref(domain, label);
  // Put the accent colour on the last word, or on the TLD when the site is
  // named by its domain.
  const parts = name.split(/\s+/);
  const tld = parts.length === 1 && name.match(/^(.+?)(\.[a-z.]+)$/i);
  const brand = tld
    ? `${esc(tld[1])}<span>${esc(tld[2])}</span>`
    : parts.length > 1
      ? `${esc(parts.slice(0, -1).join(" "))} <span>${esc(parts[parts.length - 1])}</span>`
      : `<span>${esc(name)}</span>`;
  const nav = (plan.nav.length ? plan.nav : defaultNav(plan.kind, name))
    .map((n) => `<a href="${link(n)}">${esc(n)}</a>`)
    .join("");
  // With a page title the tag describes this page, so it belongs in the hero,
  // not under the site's wordmark.
  const siteTag = plan.title ? "" : plan.tag;
  const heroArt = art
    ? `<img class="art" src="/img/${encodeURIComponent(heroImagePrompt(plan))}?${esc(artColors(plan))}" alt="" onload="this.style.opacity=1">`
    : "";
  // The logo mark is the same one the search results show for this domain.
  const mark = siteMark(domain, { kind: plan.mark || plan.kind, size: st.header === "masthead" ? 46 : 30, hue: plan.hue });
  const brandLink = `<a class="brand" href="/web/${esc(domain)}/">${mark}<div class="brand-text"><div>${brand}</div>${siteTag ? `<small>${esc(siteTag)}</small>` : ""}</div></a>`;
  const actions = headerActions(plan, domain, name, link);
  const d = heroDetails(plan);

  const header = {
    stacked: `<header class="site"><div class="wrap"><div class="top-row">${brandLink}<div class="actions">${actions}</div></div><nav class="top">${nav}</nav></div></header>`,
    center: `<header class="site"><div class="wrap"><nav class="top">${nav}</nav>${brandLink}<div class="actions">${actions.replace(/<form[\s\S]*?<\/form>/, "")}</div></div></header>`,
    masthead: `<header class="site"><div class="wrap"><div class="mast-top"><span>${plan.kind === "zine" ? `Issue #${d.issue}` : d.date}</span><span>${plan.kind === "news" ? `<i class="live"></i>Live` : esc(siteTag.slice(0, 60))}</span></div>${brandLink}<nav class="top">${nav}</nav></div></header>`,
    minimal: `<header class="site"><div class="wrap">${brandLink}<nav class="top">${nav}</nav></div></header>`,
    pill: `<header class="site"><div class="wrap">${brandLink}<nav class="top">${nav}</nav><div class="actions">${actions}</div></div></header>`,
    sidebar: `<header class="site side"><div class="wrap">${brandLink}${actions.includes("<form") ? actions.match(/<form[\s\S]*?<\/form>/)[0] : ""}<nav class="top">${nav}</nav>${sideTools(plan, link)}</div></header>`,
    bar: `<header class="site"><div class="wrap">${brandLink}<nav class="top">${nav}</nav><div class="actions">${actions.replace(/<form[\s\S]*?<\/form>/, "")}</div></div></header>`,
  }[st.header];

  const ch = chrome(plan, domain);
  // A masthead already carries the date line.
  if (st.header === "masthead" && plan.kind === "news") ch.above = "";
  const sideRail = st.side !== "none" ? rail(plan, domain, link) : "";

  return `<title>${esc(plan.title ? `${plan.title} — ${name}` : `${name}${plan.tag ? ` — ${plan.tag}` : ""}`)}</title>
${ch.above ?? ""}
${st.header === "sidebar" ? `<div class="frame">${header}<div class="frame-main">` : header}
<div class="hero"><div class="wrap">
<div class="hero-text">
${ch.pre ?? ""}
<h1>${esc(plan.title || name)}</h1>
${ch.sub ?? ""}
${plan.tag ? `<p class="tagline">${esc(plan.tag)}</p>` : ""}
${ch.meta ?? ""}
</div>
${heroArt}
</div></div>
${sideRail ? `<div class="wrap layout"><aside class="rail">${sideRail}</aside><main>` : `<main class="wrap">`}
`;
}

const FOOTER_COLS = {
  store: [["Shop", ["New in", "Bestsellers", "Gift cards"]], ["Help", ["Shipping", "Returns", "Contact"]], ["Company", ["About", "Stockists", "Journal"]]],
  startup: [["Product", ["Features", "Pricing", "Changelog"]], ["Developers", ["Docs", "API", "Status"]], ["Company", ["About", "Careers", "Press"]]],
  news: [["Sections", ["World", "Business", "Opinion"]], ["Services", ["Newsletters", "Podcasts", "Archive"]], ["Company", ["About", "Contact", "Corrections"]]],
  gov: [["Services", ["Apply", "Forms", "Fees"]], ["About", ["Leadership", "Budget", "News"]], ["Help", ["Contact us", "Accessibility", "Privacy"]]],
  forum: [["Community", ["Guidelines", "Moderators", "Badges"]], ["Help", ["FAQ", "Contact", "Privacy"]], ["More", ["Blog", "Donate", "API"]]],
};

export function themeFooter(plan, domain) {
  const st = siteStyle(plan);
  const link = (label) => navHref(domain, label);
  const name = plan.site || domain;
  const year = 2040 + (plan.hue % 9);
  const close = `${st.side !== "none" ? "</main></div>" : "</main>"}`;
  const end = st.header === "sidebar" ? "</div></div>" : "";
  if (st.footer === "fat") {
    const cols = (FOOTER_COLS[plan.kind] ?? FOOTER_COLS.forum)
      .map(([h, items]) => `<div><h4>${esc(h)}</h4><ul>${items.map((i) => `<li><a href="${link(i)}">${esc(i)}</a></li>`).join("")}</ul></div>`).join("");
    return `${close}
<footer class="site fat"><div class="wrap">
<div class="cols"><div>${siteMark(domain, { kind: plan.mark || plan.kind, size: 34, hue: plan.hue })}<p class="meta" style="margin-top:10px">${esc(plan.tag && !plan.title ? plan.tag : name)}</p></div>${cols}</div>
<div class="small"><span>© ${year} ${esc(name)}</span><span><a href="${link("Privacy")}">Privacy</a> · <a href="${link("Terms")}">Terms</a> · <a href="${link("Colophon")}">Colophon</a></span></div>
</div></footer>${end}
`;
  }
  const nav = (plan.nav.length ? plan.nav : defaultNav(plan.kind, name))
    .map((n) => `<a href="${link(n)}">${esc(n)}</a>`)
    .join(" · ");
  return `${close}
<footer class="site"><div class="wrap">
<div>${nav}</div>
<div>© ${year} ${esc(name)} · <a href="/web/${esc(domain)}/colophon">colophon</a></div>
</div></footer>${end}
`;
}

// A hero image prompt built from the brief alone — no extra model tokens, and it
// starts generating while the sections are still being written.
export function heroImagePrompt(plan) {
  const look = { dark: "moody low-key lighting", neon: "neon-lit night", paper: "warm archival tone", brutal: "harsh flat daylight", light: "bright natural light" }[plan.mood];
  const subject = plan.title || plan.tag || plan.site;
  const topic = plan.topic && !subject.toLowerCase().includes(plan.topic.toLowerCase()) ? ` — ${plan.topic}` : ""; // no parens: they end an /img/ src in the stream scanner
  return `${subject}${topic}, ${plan.kind} website hero image, ${look}, no text`;
}
