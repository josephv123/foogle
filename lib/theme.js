// Turns a tiny JSON site brief into a complete stylesheet, header and footer.
//
// The point is latency. Asking a 9B model to hand-write a stylesheet costs
// ~1200 tokens before the visitor sees anything but unstyled text — about a
// minute at local speeds. The same model can pick a *kind*, a *mood* and a
// *hue* in ~35 tokens (~2s), and those three fields are enough to build a page
// that looks deliberately designed. Diversity survives because the model still
// chooses the archetype, palette, name, nav and content; what it stops doing is
// retyping flexbox from memory.

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const FONTS = {
  sans: `-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif`,
  serif: `Georgia,"Iowan Old Style",Palatino,"Times New Roman",serif`,
  mono: `ui-monospace,Menlo,Consolas,"SF Mono",monospace`,
  grot: `"Avenir Next",Futura,"Trebuchet MS",-apple-system,sans-serif`,
  cond: `"Oswald","Arial Narrow",Impact,sans-serif`,
};

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
    tag: String(raw.tag ?? "").trim().slice(0, 80),
    nav,
    secs,
  };
}

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "index";

export function themeCSS(plan) {
  const k = KINDS[plan.kind];
  const c = MOODS[plan.mood](plan.hue);
  const bodyFont = FONTS[k.body];
  const headFont = FONTS[k.head];
  const rad = plan.mood === "brutal" ? 0 : k.rad;
  const shadow = plan.mood === "brutal" ? `4px 4px 0 ${c.line}` : c.glow ? `0 0 24px hsla(${plan.hue},100%,50%,.18)` : `0 1px 3px rgba(0,0,0,.08)`;

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
@keyframes drift{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
main{padding:34px 0 10px}
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
footer.site{border-top:var(--bw) solid var(--line);background:var(--panel);margin-top:40px;padding:26px 0 40px;font-size:.88rem;color:var(--muted)}
footer.site .wrap{display:flex;gap:26px;flex-wrap:wrap;justify-content:space-between}
footer.site a{color:var(--muted)}footer.site a:hover{color:var(--acc)}
@media(max-width:640px){nav.top{margin-left:0;gap:14px;font-size:.82rem}.hero{padding:30px 0 26px}}
</style>`;
}

export function themeHeader(plan, domain) {
  const name = plan.site || domain;
  // Split the name so the accent colour lands on the last word — cheap, and it
  // makes the wordmark look chosen rather than defaulted.
  const parts = name.split(/\s+/);
  const brand =
    parts.length > 1
      ? `${esc(parts.slice(0, -1).join(" "))} <span>${esc(parts[parts.length - 1])}</span>`
      : `<span>${esc(name)}</span>`;
  const nav = (plan.nav.length ? plan.nav : ["Home", "About", "Archive", "Contact"])
    .map((n) => `<a href="/web/${esc(domain)}/${slug(n)}">${esc(n)}</a>`)
    .join("");

  return `<title>${esc(name)}${plan.tag ? ` — ${esc(plan.tag)}` : ""}</title>
<header class="site"><div class="wrap">
<a class="brand" href="/web/${esc(domain)}/">${brand}${plan.tag ? `<small>${esc(plan.tag)}</small>` : ""}</a>
<nav class="top">${nav}</nav>
</div></header>
<div class="hero"><div class="wrap">
<h1>${esc(plan.site || domain)}</h1>
${plan.tag ? `<p class="tagline">${esc(plan.tag)}</p>` : ""}
</div></div>
<main class="wrap">
`;
}

export function themeFooter(plan, domain) {
  const nav = (plan.nav.length ? plan.nav : ["About", "Archive"])
    .map((n) => `<a href="/web/${esc(domain)}/${slug(n)}">${esc(n)}</a>`)
    .join(" · ");
  const year = 2040 + (plan.hue % 9);
  return `</main>
<footer class="site"><div class="wrap">
<div>${nav}</div>
<div>© ${year} ${esc(plan.site || domain)} · <a href="/web/${esc(domain)}/colophon">colophon</a></div>
</div></footer>
`;
}

// A hero image prompt built from the brief alone — no extra model tokens, and it
// starts generating while the sections are still being written.
export function heroImagePrompt(plan) {
  const look = { dark: "moody low-key lighting", neon: "neon-lit night", paper: "warm archival tone", brutal: "harsh flat daylight", light: "bright natural light" }[plan.mood];
  return `${plan.tag || plan.site}, ${plan.kind} website hero image, ${look}, photographic, no text`;
}
