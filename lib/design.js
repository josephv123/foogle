// Foogle's generic design system for real, well-known sites.
//
// The model describes a site once (lib/sitespec.js): its colours, type and
// wordmark, its header, rails and URL scheme, and which structure its pages
// have (a news portal, a community of threads, an encyclopedia, a shop…).
// This file renders any such spec with one set of primitives named for what
// they are: header rows, a masthead, rails, a buy box, a player, an infobox,
// tabs, a contents box. Nothing in here knows any particular site: every name,
// label, colour and link comes from the spec, and the spec's own scoped CSS
// adds the final touches.
//
// The page type comes from the URL (the spec's routes, else the structure's
// usual URL shapes), so every link on a site keeps its look and lands on the
// right layout. Code renders everything that frames the page at once; the four
// section writers are told which site they write for, with briefs in that
// site's structure.

import { STYLE_FONTS } from "./styles.js";
import { ARCH_PAGES, matchRoute, hostKey } from "./sitespec.js";
import { sketchFor } from "./images.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Title-case, leaving words that already have their own capitals ("eBook").
const cap = (s) => String(s).replace(/(^|\s)(\S+)/gu, (m, a, w) => a + (/\p{Lu}/u.test(w.slice(1)) ? w : w.charAt(0).toUpperCase() + w.slice(1)));
const initials = (s) => String(s).replace(/^[@/\w]{1,2}\//, "").split(/[\s_.-]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "•";
function fnv(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function seeded(key) {
  let h = fnv(key);
  return (n) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h ^= h >>> 13;
    return (h >>> 0) % n;
  };
}
const b64 = (s) => Buffer.from(s).toString("base64");
export const svgDataURI = (svg) => `data:image/svg+xml;base64,${b64(svg)}`;

// ---------- colour ----------
const rgb = (hex) => {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = [...h].map((x) => x + x).join("");
  const n = parseInt(h, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128];
};
const toHex = (a) => `#${a.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
export const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export function hueOf(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 210;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
}
const onColor = (hex) => (contrast(hex, "#111111") >= contrast(hex, "#ffffff") ? "#111111" : "#ffffff");
// A colour readable on `bg`: itself if it is, else nudged toward black or white.
const readable = (c, bg, min = 3) => {
  if (contrast(c, bg) >= min) return c;
  const to = onColor(bg);
  for (let t = 0.2; t <= 1; t += 0.2) { const m = mix(c, to, t); if (contrast(m, bg) >= min) return m; }
  return to;
};

// Every colour a page needs, from the few a spec names. All hex, so pictures
// can be drawn in them (see /img in server.js).
export function designPalette(spec) {
  const k = spec?.colors ?? {};
  const bg = k.bg ?? "#ffffff";
  const dark = lum(bg) < 0.18;
  const fg = readable(k.fg ?? (dark ? "#f2f2f2" : "#111111"), bg, 4.5);
  const acc = k.acc ?? k.link ?? k.buy ?? "#1a73e8";
  const panel = dark ? mix(bg, "#ffffff", 0.07) : lum(bg) > 0.95 ? mix(bg, fg, 0.035) : mix(bg, "#ffffff", 0.35);
  const head = k.head ?? bg;
  const buy = k.buy ?? acc;
  return {
    bg, fg, acc, dark, panel,
    line: mix(bg, fg, dark ? 0.2 : 0.14),
    muted: mix(fg, bg, 0.42),
    acc2: mix(acc, fg, 0.3),
    on: onColor(acc),
    head,
    headFg: readable(k.headFg ?? (head === bg ? fg : onColor(head)), head, 4),
    link: readable(k.link ?? acc, bg, 3),
    buy, buyFg: onColor(buy),
    now: mix(buy, "#ff6a00", 0.35),
    sub: k.sub ?? null,
    subFg: k.sub ? onColor(k.sub) : null,
    foot: k.foot ?? (dark ? mix(bg, "#ffffff", 0.05) : mix(bg, fg, 0.04)),
    tint: mix(bg, k.link ?? acc, dark ? 0.2 : 0.1),
    heroA: panel,
    heroB: mix(panel, acc, 0.12),
  };
}

// ---------- type ----------
const FONT_STACKS = {
  sans: `-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif`,
  serif: `"Linux Libertine","Georgia","Times",serif`,
  roboto: `Roboto,Arial,"Helvetica Neue",sans-serif`,
  franklin: `"Franklin Gothic Medium","Libre Franklin","Helvetica Neue",Arial,sans-serif`,
  blackletter: `"Old English Text MT","Engravers Old English","UnifrakturMaguntia","Luminari","Goudy Text MT",Georgia,serif`,
  script: `"Snell Roundhand","Brush Script MT","Segoe Script","Apple Chancery",cursive`,
  cond: `"Bebas Neue","Oswald","Arial Narrow","Helvetica Neue Condensed Bold",Impact,sans-serif`,
  rounded: `ui-rounded,"SF Pro Rounded","Nunito","Varela Round","Arial Rounded MT Bold",sans-serif`,
  mono: `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`,
  didone: `Didot,"Bodoni 72","Bodoni MT",Georgia,serif`,
  ...STYLE_FONTS,
};
export const designFont = (name) => FONT_STACKS[name] ?? FONT_STACKS.sans;
const cssFont = (name) => designFont(name).replaceAll('"', "'");

// ---------- marks ----------
// The site's own icon, drawn by the model (sanitized in lib/sitespec.js), as
// an image: inline it could style or script the page.
const markStyle = (spec) => (spec.icon ? ` style="background-image:url(${svgDataURI(spec.icon)})"` : "");

// The site's wordmark, as text styled like it, with its mark if it has one.
export function designLogo(spec, { size = 1 } = {}) {
  const l = spec.logo ?? { text: spec.name };
  const t = l.text ?? spec.name;
  const fs = (l.size ?? 1.3) * size;
  const font = `font-family:${cssFont(l.font ?? spec.fonts?.[1] ?? "sans")};font-weight:${l.weight ?? 800};${l.italic ? "font-style:italic;" : ""}letter-spacing:${l.track ?? 0}em;`;
  const c = designPalette(spec);
  const bg = l.bg ?? c.acc;
  const fg = l.fg ?? onColor(bg);
  let word;
  if (l.style === "block") word = `<span class="lw lblock" style="${font}background:${bg};color:${fg};font-size:${fs}rem">${esc(t)}</span>`;
  else if (l.style === "blocks") word = `<span class="lw lblocks" style="${font}font-size:${fs}rem">${[...t].map((ch, i) => `<i style="background:${l.colors?.[i] ?? bg};color:${fg}">${esc(ch)}</i>`).join("")}</span>`;
  else if (l.style === "tag") word = `<span class="lw ltag" style="${font}background:${bg};color:${fg};font-size:${fs}rem">${esc(t)}</span>`;
  else if (l.style === "oval") word = `<span class="lw loval" style="${font}font-size:${fs}rem"><i style="background:${bg};color:${fg}">${esc(t)}</i></span>`;
  else if (l.style === "stack") word = `<span class="lw lstack" style="color:${l.color ?? "inherit"}"><b style="${font}font-size:${fs}rem">${esc(t)}</b>${l.sub ? `<small>${esc(l.sub)}</small>` : ""}</span>`;
  else word = `<span class="lw" style="${font}font-size:${fs}rem;color:${l.color ?? "inherit"}">${l.colors?.length ? [...t].map((ch, i) => `<span style="color:${l.colors[i % l.colors.length]}">${esc(ch)}</span>`).join("") : esc(t)}</span>`;
  const sub = l.sub && l.style !== "stack" ? `<small class="lsub">${esc(l.sub)}</small>` : "";
  return `<span class="logo"><i class="d-mark"${markStyle(spec)}></i>${sub ? `<span class="lwrap">${word}${sub}</span>` : word}</span>`;
}

// A result's or a tab's favicon: the site's mark, or its letters in its colours.
function faviconLetters(spec) {
  const l = spec.logo ?? {};
  const c = designPalette(spec);
  const boxed = ["block", "blocks", "tag", "oval"].includes(l.style);
  const bg = boxed ? (l.style === "blocks" ? l.colors?.[0] : null) ?? l.bg ?? c.acc : c.acc;
  const t = String(l.text || spec.name).replace(/^the\s+/i, "");
  const letters = boxed && t.length <= 4 ? t : t.slice(0, 1).toUpperCase();
  return { bg, fg: boxed && l.fg ? l.fg : onColor(bg), letters, font: l.font ?? "sans" };
}

export function designFavicon(spec, size = 28) {
  if (spec.icon) return `<span class="bfav" style="width:${size}px;height:${size}px"><img src="${svgDataURI(spec.icon)}" width="${Math.round(size * 0.78)}" height="${Math.round(size * 0.78)}" alt=""></span>`;
  const f = faviconLetters(spec);
  return letterFavicon({ ...f, size });
}

// A plain letter mark, for a real site whose spec hasn't been written yet.
export function letterFavicon({ letters, bg, fg = onColor(bg), font = "sans", size = 28 }) {
  const n = String(letters).length;
  return `<span class="bfav" style="width:${size}px;height:${size}px;background:${bg};color:${fg};font:${n > 2 ? 800 : 700} ${n > 2 ? Math.round(size * 0.3) : Math.round(size * 0.52)}px/1 ${cssFont(font)}">${esc(letters)}</span>`;
}

export function designFaviconSVG(spec) {
  if (spec.icon) return spec.icon;
  const f = faviconLetters(spec);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${f.bg}"/><text x="16" y="${f.letters.length > 2 ? 20 : 23}" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="${f.letters.length > 2 ? 11 : 19}" fill="${f.fg}">${esc(f.letters)}</text></svg>`;
}

// ---------- URLs and page types ----------
const segs = (u) => u.pathname.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
const wordsIn = (s) => String(s).replace(/\.(html?|php|aspx?)$/i, "").split(/[-_+\s]+/).filter((w) => /\p{L}/u.test(w));
const isDated = (p) => /\/(?:19|20)\d\d\/(?:\d{1,2}|[a-z]{3})\/(?:\d{1,2}\/)?/i.test(p);
const isStory = (u) => isDated(u.pathname) || /\/(?:articles?|story|stories|live)\//.test(u.pathname) || /\.html?$/.test(u.pathname) && !/index\.html?$/.test(u.pathname) || segs(u).some((s) => wordsIn(s).length >= 4);
const q = (s) => encodeURIComponent(s).replace(/%20/g, "+");
const SEARCH_PARAMS = ["q", "k", "query", "search", "search_query", "term", "keywords"];

// Each structure: the kind the generic machinery treats its pages as (widget
// hints), how its usual URLs map to page types when the spec's routes don't
// say, where its search goes, and the components its stylesheet adds.
const ARCH = {
  news: {
    kind: "news", search: ["/search", "q"],
    page: (u) => (/\/videos?\//.test(u.pathname) ? "video" : isStory(u) ? "article" : "front"),
    urls: `stories /web/DOMAIN/2046/03/04/world/some-story-slug/index.html, sections /web/DOMAIN/politics, videos /web/DOMAIN/videos/some-video-slug`,
    vocab: `.breaking (a breaking-news strip: <p class="breaking"><b>Breaking</b> <a href="…">headline</a></p>); ul.heads (a dense headline list: <ul class="heads"><li><a href="…">Headline</a> <span class="tag hot">Live</span></li>…</ul>); .story (a teaser: <div class="story"><img class="pic" …><h3><a href="…">Headline</a></h3><p class="meta">3 min read</p></div>); .kicker (small label above a headline); .vcard (video teaser: <a class="vcard" href="…"><img class="pic" …><span class="dur">3:12</span><b>Headline</b></a>)`,
  },
  newspaper: {
    kind: "news", search: ["/search", "query"],
    page: (u) => (isStory(u) && !/\/(?:topic|section)\//.test(u.pathname) ? "article" : "front"),
    urls: `stories /web/DOMAIN/2046/03/04/science/some-story-slug.html, sections /web/DOMAIN/section/world`,
    vocab: `ul.heads (headline list: <ul class="heads"><li><a href="…">Headline</a><p>one-line summary</p></li>…</ul>); .story (a teaser: <div class="story"><h3><a href="…">Headline</a></h3><p>summary</p><p class="meta">5 min read</p></div>; one may hold an img.pic); .kicker (small caps label above a headline)`,
  },
  community: {
    kind: "forum", search: ["/search", "q"],
    page: (u) => (/\/(?:comments|posts?|threads?|t)\//.test(u.pathname) || segs(u).some((s) => wordsIn(s).length >= 4) ? "thread" : /^\/(?:user|u|users|profile)\//.test(u.pathname) ? "profile" : "feed"),
    urls: `threads /web/DOMAIN/<community path>/<id>/<title-words>, communities /web/DOMAIN/<community path>, users /web/DOMAIN/<user path>`,
    vocab: `.post as a post card: <div class="post"><div class="who"><span class="av">SR</span><b>COMMUNITY</b><span class="meta">USER · 5h</span></div><h3><a href="…">Title</a></h3><p>preview or body</p><div class="meta">▲ 1,204 · 💬 214 comments · Share</div></div> (write vote counts in full, like 14,712, never 14.7k); as a comment: <div class="post"><div class="who"><span class="av">QF</span><b>USER</b><span class="meta">3h</span></div><p>…</p><div class="meta">▲ 88 · Reply</div></div>, and a reply to it is a .post nested inside it`,
  },
  linkboard: {
    kind: "forum", search: ["/search", "q"],
    page: (u) => (/^\/(?:item|comments|discuss|s)\b/.test(u.pathname) || u.searchParams.get("id") ? "item" : "front"),
    urls: `discussion pages /web/DOMAIN/item?id=<8 digits>&t=<title-as-slug>; story links go to invented outside domains`,
    vocab: `ol.hn (ranked links: <ol class="hn" start="1"><li><a href="/web/invented.tld/path">Title</a> <span class="meta">(invented.tld)</span><p class="meta">312 points by user 3 hours ago | <a href="/web/DOMAIN/item?id=…">148 comments</a></p></li>…</ol>); comments are .post blocks with .who (username, age) and nested replies`,
  },
  encyclopedia: {
    kind: "wiki", search: ["/search", "search"],
    page: (u) => (["search", "q"].some((k) => u.searchParams.get(k)) || /search/i.test(segs(u).at(-1) ?? "") ? "search" : segs(u).length && !/^(?:main|home|index)/i.test(segs(u).at(-1)) ? "article" : "main"),
    urls: `articles /web/DOMAIN/<article path>/Article_Title (link generously within prose, like a reference work)`,
    vocab: `.infobox (a floated fact table: <table class="infobox"><caption>Name</caption><tr><th>Label</th><td>Value</td></tr>…</table>, may start with an img.pic row); <sup>[1]</sup> citation markers; ol.refs (references list); .hatnote (italic note at the top)`,
  },
  marketplace: {
    kind: "store", search: ["/search", "q"],
    page: (u) => (/\/(?:product|products|item|items|listing|listings|p)\//.test(`${u.pathname}/`) ? "product"
      : /^\/(?:s|search|browse|shop|c|category)(?:\/|$)/.test(u.pathname) || SEARCH_PARAMS.some((k) => u.searchParams.get(k)) ? "search"
      : segs(u).some((s) => wordsIn(s).length >= 3) ? "product" : "home"),
    urls: `products /web/DOMAIN/<product path>, searches /web/DOMAIN/<search path>?<param>=<words+joined+by+plus>`,
    vocab: `products are .card items (an img.pic, an <h3><a href="…">keyword-rich product title</a></h3>, .stars with a .meta count, a .price and an Add to cart .btn with data-add-to-cart data-name data-price) in a .grid`,
  },
  video: {
    kind: "blog", search: ["/results", "q"],
    page: (u) => (/^\/(?:watch|shorts|videos?|v)\b/.test(u.pathname) ? "watch" : /^\/(?:results|search)/.test(u.pathname) ? "results" : /^\/(?:@|c\/|channel\/|user\/)/.test(u.pathname) || segs(u).length === 1 && !/^(?:feed|browse|directory|explore|trending)$/.test(segs(u)[0]) ? "channel" : "home"),
    urls: `videos /web/DOMAIN/watch?v=<the-video-title-as-a-slug>, channels /web/DOMAIN/@ChannelName`,
    vocab: `.vcard (a video: <a class="vcard" href="/web/DOMAIN/…"><img class="pic" src="/img/…" alt=""><span class="dur">12:41</span><b>Video title</b><span class="meta">Channel · 1.2M views · 3 days ago</span></a>) inside a .grid`,
  },
  codehost: {
    kind: "startup", search: ["/search", "q"],
    page: (u) => {
      const s = segs(u);
      if (!s.length) return "home";
      if (/^(?:search|topics|explore|trending)$/.test(s[0])) return "search";
      if (/^(?:features|pricing|about|enterprise|login|signup|solutions|resources)$/.test(s[0])) return "home";
      if (s.length === 1) return "profile";
      return /^(?:issues|pull|pulls|merge_requests|discussions)$/.test(s[2] ?? "") && /^\d+$/.test(s[3] ?? "") ? "issue" : "repo";
    },
    urls: `repositories /web/DOMAIN/<owner>/<repo>, files /web/DOMAIN/<owner>/<repo>/blob/main/<path>, issues /web/DOMAIN/<owner>/<repo>/issues/<number>, users /web/DOMAIN/<login>`,
    vocab: `code blocks as <pre><code>…</code></pre>; file listings as a table (name with 📁 or 📄, last commit message, age); .tag for topics and labels`,
  },
  qa: {
    kind: "forum", search: ["/search", "q"],
    page: (u) => (/^\/questions\/\d+/.test(u.pathname) || /\/(?:q|answer|question)\//.test(u.pathname) || segs(u).some((s) => wordsIn(s).length >= 3) ? "question" : "list"),
    urls: `questions /web/DOMAIN/questions/<8 digits>/<question-title-as-slug>, tags /web/DOMAIN/questions/tagged/<tag>, users /web/DOMAIN/users/<id>/<name>`,
    vocab: `a question or answer is a .post: <div class="post"><p>…</p><pre><code>…</code></pre><div class="row"><a class="tag" href="…">tag</a></div><div class="who"><span class="av">JM</span><b>username</b><span class="meta">answered Mar 4, 2046 · 12.4k rep</span></div><div class="meta">▲ 42</div></div> (the vote count is shown beside it); add <span class="tag hot">✓ Accepted</span> to the accepted answer; list pages use .qsum (<div class="qsum"><div class="stats"><span><b>12</b> votes</span><span class="ans"><b>3</b> answers</span><span><b>1k</b> views</span></div><div><h3><a href="…">Question title</a></h3><p>excerpt</p><div class="row"><a class="tag" href="…">tag</a></div><p class="meta">user asked 2 mins ago</p></div></div>)`,
  },
  productbrand: {
    kind: "startup", search: ["/search", "q"],
    page: (u) => (segs(u).length ? "product" : "home"),
    urls: `products /web/DOMAIN/<product-name>/, buying /web/DOMAIN/shop/buy-<product-name>`,
    vocab: `.tile (a full-width product panel: <div class="tile"><h2>Product</h2><p class="lead">tagline</p><div class="row"><a class="btn" href="…">Learn more</a><a class="btn ghost" href="…">Buy</a></div><img class="pic" …></div>)`,
  },
  classifieds: {
    kind: "store", search: ["/search", "query"],
    page: (u) => (/\/d\/.+|\/\d{7,}\.html$/.test(u.pathname) || segs(u).some((s) => wordsIn(s).length >= 3) ? "posting" : /^\/search\b/.test(u.pathname) || u.searchParams.get("query") ? "search" : "home"),
    urls: `category searches /web/DOMAIN/search/<category code>, postings /web/DOMAIN/<area>/<category>/d/<title-slug>/<10 digits>.html`,
    vocab: `plain lists of small links (ul, no bullets, no cards); .price; .meta for neighbourhoods in parentheses`,
  },
  social: {
    kind: "forum", search: ["/search", "q"],
    page: (u) => (/\/(?:status|posts|p|reel|permalink|post)\//.test(u.pathname) ? "post" : segs(u).length === 1 && !/^(?:home|explore|search|notifications|messages|feed|i|jobs|reels|watch|groups|marketplace)$/.test(segs(u)[0]) ? "profile" : "feed"),
    urls: `profiles /web/DOMAIN/<handle>, posts /web/DOMAIN/<handle>/status/<19 digits>`,
    vocab: `a post is a .post: <div class="post"><div class="who"><span class="av">MO</span><b>Display Name</b><span class="meta">@handle · 2h</span></div><p>text with #hashtags and @mentions</p><div class="meta">💬 212 · 🔁 1,204 · ♥ 8,412</div></div> (counts in full digits); it may hold one img.pic`,
  },
  streaming: {
    kind: "blog", search: ["/search", "q"],
    page: (u) => (/\/(?:title|watch|album|playlist|show|movie|series|artist|episode|track|name|film)\//.test(u.pathname) ? "title" : "home"),
    urls: `titles /web/DOMAIN/title/<8 digits>-<title-slug>, playlists and albums /web/DOMAIN/playlist/<title-slug>`,
    vocab: `.tile (a title card: <a class="tile" href="…"><img class="pic" …><b>Title</b><span class="meta">98% Match · 2046 · 3 Seasons</span></a>) in a .grid; track or episode lists as a table`,
  },
  landing: {
    kind: "startup", search: ["/search", "q"],
    page: (u) => (segs(u).length ? "page" : "home"),
    urls: `pages /web/DOMAIN/<section>/<page>`,
    vocab: `the standard components, in the site's own voice`,
  },
};
export const archOf = (spec) => ARCH[spec?.arch] ?? ARCH.landing;

// Invented sites share the page archetypes: the URL says whether a forum's
// page is its feed of threads or one thread, a shop's page a category or one
// product, a news site's page its front or one story, a wiki's page its main
// page or an article. They keep their own style (lib/styles.js); the page
// type picks their briefs and hero (lib/jev.js, lib/theme.js).
const KIND_ARCH = { forum: "community", store: "marketplace", wiki: "encyclopedia", news: "news" };
export function inventedPageType(kind, url) {
  const arch = KIND_ARCH[kind];
  if (!arch) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  return !segs(u).length && !u.search ? ARCH_PAGES[arch][0] : ARCH[arch].page(u);
}

// The variables of the route a URL matched ({community: "sourdough"}).
function routeVars(spec, u) {
  for (const r of spec.routes ?? []) {
    if (!matchRoute(r, u)) continue;
    const names = r.pattern.split("?")[0].split("/").filter(Boolean);
    const vals = segs(u);
    return { type: r.type, vars: Object.fromEntries(names.map((n, i) => [n, vals[i]]).filter(([n, v]) => n.startsWith(":") && v).map(([n, v]) => [n.slice(1), v])) };
  }
  return null;
}

// Which of the site's page types a URL is: its routes, else the page the spec
// was written for, else the usual URL shapes of its structure.
export function pageTypeOf(spec, url) {
  const u = new URL(url);
  const pages = ARCH_PAGES[spec.arch] ?? ARCH_PAGES.landing;
  if (!segs(u).length && !u.search) return pages[0];
  const hit = routeVars(spec, u);
  if (hit && pages.includes(hit.type)) return hit.type;
  if (hit?.type === "search" && pages.includes("search")) return "search";
  if (hit?.type === "search") return pages.includes("results") ? "results" : pages.includes("list") ? "list" : archOf(spec).page(u);
  return archOf(spec).page(u);
}

// Where the site's search goes: its "search" route, else its structure's usual.
export function searchTarget(spec) {
  const r = (spec.routes ?? []).find((x) => x.type === "search");
  if (r) {
    const [p, qs = ""] = r.pattern.split("?");
    const param = qs.split("&").map((kv) => kv.split("=")[0]).find((k) => /^[\w-]+$/.test(k));
    if (param && !/:/.test(p)) return [p || "/search", param];
  }
  return archOf(spec).search;
}

// Fill a route with values ("/c/:community" + "sourdough" -> "/c/sourdough").
function routePath(spec, type, value) {
  const r = (spec.routes ?? []).find((x) => x.type === type);
  if (!r) return null;
  let used = false;
  const p = r.pattern.split("?")[0].replace(/:[\w-]+|\*\*?/g, () => (used ? "" : (used = true, encodeURIComponent(value)))).replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1/");
  return used ? p : null;
}

// A rail item's link: a community ("c/sourdough") goes to its feed.
function itemPath(spec, [label, p]) {
  if (spec.prefix && label.startsWith(spec.prefix)) {
    const name = label.slice(spec.prefix.length);
    return routePath(spec, "feed", name) ?? `/${spec.prefix}${name}`.replace(/\/+/g, "/");
  }
  return p;
}

// ---------- the page plan ----------
// The page's own title: the words in its URL, else the search result's title
// minus the site's name, else nothing (a site's front page has no headline).
function pageTitle(spec, u, page, args) {
  const params = SEARCH_PARAMS.map((k) => u.searchParams.get(k)).find(Boolean);
  const nm = spec.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const key = spec.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fromResult = String(args.title ?? "").replace(new RegExp(`\\s*[-|–—·:\\\\•]+\\s*(?:${nm}|${key})[^-|–—·]*$`, "i"), "").replace(new RegExp(`^(?:${nm}|${key})\\s*[:|–—•-]\\s*`, "i"), "").trim();
  if (["front", "main", "home", "feed"].includes(page) && !segs(u).length || page === "main") return "";
  if (params && ["search", "results", "list", "feed"].includes(page)) return `“${params}”`;
  const vars = routeVars(spec, u)?.vars ?? {};
  const community = vars.community ?? vars.sub ?? vars.group ?? vars.forum ?? vars.board;
  if (spec.arch === "community" && page === "feed" && community) return `${spec.prefix}${community}`;
  if (spec.arch === "codehost" && page === "repo") return segs(u).slice(0, 2).join("/");
  if (spec.arch === "codehost" && page === "profile") return segs(u)[0];
  if (spec.arch === "video" && page === "watch") { const v = u.searchParams.get("v"); if (v && wordsIn(v).length >= 2) return cap(wordsIn(v).join(" ")); }
  const best = segs(u).filter((s) => !/^(?:index\.html?|dp|wiki|r|c|t|comments|questions|status|d|p|watch|title|story|article|articles|_|id|issues|pull|topic|section|tagged|video|videos|search|products?|items?)$/i.test(s) && !/^[A-Z0-9]{8,}$/.test(s) && !/^[a-z0-9]{5,8}$/.test(s) && !/^\d+(?:\.html)?$/.test(s))
    .map((s) => wordsIn(s)).filter((w) => w.length).sort((a, z) => z.length - a.length)[0];
  const fromURL = best ? (spec.arch === "encyclopedia" ? best.join(" ") : best.length >= 3 && best.every((w) => w === w.toLowerCase()) && spec.arch !== "marketplace" ? best.join(" ").replace(/^./, (c) => c.toUpperCase()) : cap(best.join(" "))) : "";
  const label = spec.nav.find(([l]) => slug(l) === slug(fromURL))?.[0];
  if (spec.arch === "codehost" && page === "issue") return (fromResult || `${segs(u).slice(0, 2).join("/")} #${segs(u)[3]}`).slice(0, 140);
  if (spec.arch === "social" && page === "profile") return segs(u)[0].replace(/^@/, "");
  if (label) return label;
  if (fromResult && (!fromURL || wordsIn(fromURL).length < 3 || spec.arch === "codehost")) return fromResult.slice(0, 140);
  return (fromURL || fromResult || (page === "watch" ? "Video" : "")).slice(0, 140);
}

// Section briefs for each type of page of each structure. Four writers, in
// document order; the layout CSS places them (a news front page puts the
// first section in the middle column, the second on the left…). `pics` says
// how many pictures each section draws.
const BRIEFS = {
  news: {
    front: { pics: [1, 0, 3, 4], briefs: [
      "The lead package (it sits in the wide middle column): start with a .breaking strip naming the biggest breaking story, then ONE big picture of it, a huge h2 headline link to the story, a one-sentence summary, and a ul.heads of 3 related headline links (one tagged Live)",
      "The left headline rail: h2 'Top headlines' then a ul.heads of 9-10 short, punchy headline links from every section, some with a .tag (Live, Analysis, Opinion)",
      "The right rail: h2 'More top stories' then 3 .story teasers, each with a small picture, a .kicker, a headline link and a .meta, then a ul.heads of 3 more",
      "A full-width video row: h2 'Featured videos' then a .grid of 4 .vcard video teasers with pictures and runtimes, then a ul.heads 'Paid partner content' of 3 lines in .meta",
    ] },
    article: { pics: [0, 1, 0, 3], briefs: [
      "The story's opening: a first paragraph beginning with an all-caps dateline naming the city and this site in the site's own style, then 3-4 short paragraphs with the who, what, when and where",
      "The reporting continues: 3 paragraphs with named sources and exact numbers, one .quote with attribution, and one picture with a caption in a .meta",
      "Context and what's next: an h2 subhead, 3 short paragraphs, then a 'What we know' ul of 4 facts with numbers in <b>",
      "Below the story: h2 'More from' and the site's name, and a .grid of 3 .story teasers with pictures and headline links",
    ] },
    video: { pics: [0, 0, 4, 0], briefs: [
      "The video's description under the player: 2 short paragraphs, then .meta with the air date, runtime and the show it aired on",
      "Up next: h2 'Up next' and a ul.heads of 6 video headline links, each with its runtime in .meta",
      "h2 'More videos' and a .grid of 4 .vcard video teasers with pictures and runtimes",
      "h2 'Related stories' and a ul.heads of 5 headline links",
    ] },
  },
  newspaper: {
    front: { pics: [1, 0, 1, 0], briefs: [
      "The lead story package (wide left column): a .kicker, a big h2 headline link, a 2-sentence summary, one picture with a .meta photo credit, then 2 related .story teasers (headline link and one-line summary each)",
      "The opinion column (narrow right): h2 'Opinion' then 5 .story teasers, each a columnist's name in .kicker, a headline link and a one-line summary",
      "More news (wide left): 4 .story teasers separated by rules, each with a .kicker, a headline link, a 2-sentence summary and a .meta read time; one has a picture",
      "The right column below: h2 'Most popular' as an ol of 5 headline links, then a small box of the site's own games, recipes or newsletters with 3 links",
    ] },
    article: { pics: [0, 1, 0, 0], briefs: [
      "The article's opening: 4 elegant paragraphs of reported prose that set the scene and state the news in the second paragraph",
      "The reporting continues: an h2 subhead, 3 paragraphs with named sources and numbers, and one picture with a .meta caption and photo credit",
      "Analysis and stakes: 3 paragraphs, one .quote pull quote, and a closing paragraph",
      "After the article: a short italic author note in .meta (who reported it and from where), then h2 'More on this story' as a ul.heads of 4 headline links with one-line summaries",
    ] },
  },
  community: {
    feed: { kind: "forum", pics: [0, 1, 0, 0], briefs: [
      "Three post cards (.post with the community, username and age in .who, a title link to the thread, a 1-2 sentence preview and a .meta '▲ N · 💬 N comments · Share' with N in full digits); make one a text post and one a question, and tag one with a .tag flair",
      "Three more post cards, one of them an image post with ONE picture instead of a preview; vary scores from 12 to 24k",
      "Three more post cards, including one tagged .tag.hot 'Pinned' by a moderator and one with a spicy disagreement in the title",
      "Two more post cards and a .callout from the moderators about the community's weekly thread",
    ] },
    thread: { kind: "forum", pics: [1, 0, 0, 0], briefs: [
      "The original post's body: 2-3 paragraphs in the poster's own voice with specifics (and ONE picture if it's an image post), then an 'EDIT:' line in .meta and the post's .meta '▲ N · 💬 N comments · Share' — no title, no username (both are shown above)",
      "The top comment thread: 1 highly upvoted comment (.post) with 2 nested replies (.post inside it), each with a username and age in .who and a .meta '▲ N · Reply'; one reply is from the original poster",
      "Two more top-level comment threads, one of them a joke that got more upvotes than it deserved, each with one nested reply",
      "Two more top-level comments with lower scores, one a dissent with a detailed counterpoint, one a late useful answer, then a .meta 'View more comments'",
    ] },
    profile: { kind: "forum", pics: [0, 0, 0, 0], briefs: [
      "The user's recent posts: 3 .post cards in different communities",
      "The user's recent comments: 3 short .post comments, each with the thread title it replied to in .meta",
      "Trophy case: a ul of 4 trophies with dates",
      "Moderator of: a ul of 3 communities with member counts in .meta",
    ] },
  },
  linkboard: {
    front: { pics: [0, 0, 0, 0], briefs: [
      "Ranked stories 1-10 as ol.hn start=\"1\": mixed show-and-tell posts, questions to the community, essays, papers and launches, each with points, username, age and comment count",
      "Ranked stories 11-20 as ol.hn start=\"11\"",
      "Ranked stories 21-30 as ol.hn start=\"21\"",
      "A single .meta line: 'More' link, then a .meta line of the site's own notice about an upcoming event",
    ] },
    item: { pics: [0, 0, 0, 0], briefs: [
      "The top comment thread: a .post with a long, precise, slightly contrarian comment and 2 nested .post replies",
      "A second thread: a practitioner's detailed war story as a .post with one nested reply that nitpicks it",
      "A third thread: a short sharp comment with 3 nested replies arguing",
      "Two more short top-level .post comments, one linking to prior discussion",
    ] },
  },
  encyclopedia: {
    article: { kind: "wiki", pics: [1, 0, 1, 0], briefs: [
      "The article's lead: a floated .infobox table (a picture as its first row, then 6-8 fields) and 2-3 lead paragraphs that begin with the subject's name in <b>, dense with internal links and <sup>[1]</sup> citations. No h2: the lead has no heading, so start with the infobox",
      "h2 'History' with 2 h3 subsections of encyclopedic prose, dated facts, internal links and citations",
      "h2 with the article's main descriptive section (e.g. 'Description', 'Design', 'Biology', 'Mechanism'), 2-3 paragraphs, one data table and one picture floated in prose with a .meta caption",
      "h2 'See also' as a ul of 4 internal links, then h2 'References' as ol.refs of 6 invented citations (author, title in quotes, publication, date, 'Retrieved' date)",
    ] },
    main: { kind: "wiki", pics: [1, 0, 0, 0], briefs: [
      "h2 'From today's featured article': one picture floated left, a paragraph summary of an invented article beginning with its name in bold, ending with a '(Full article...)' link, and a .meta 'Recently featured' line of 3 links",
      "h2 'In the news': a ul of 5 one-sentence news items with bold links, then a .meta 'Ongoing: …' line and a 'Recent deaths: …' line",
      "h2 'Did you know ...': a ul of 6 '... that …?' hooks, each with a bold link",
      "h2 'On this day': the date in bold, then a ul of 5 dated events with links, then a .meta line of more anniversaries",
    ] },
    search: { kind: "wiki", pics: [0, 0, 0, 0], briefs: [
      "A .meta 'Results 1 – 20 of 4,812', then 4 results, each an h3 link to an article, a 2-line snippet with <mark> on the matched words, and a .meta word count and date",
      "4 more results in the same format",
      "4 more results in the same format",
      "h3 'Related articles' as a ul of 5 links",
    ] },
  },
  marketplace: {
    home: { pics: [1, 1, 1, 1], briefs: [
      "One home-page card: an h2 like a real deal-tile headline for this site, ONE picture, 3 item links with .price, and a 'See more' link",
      "Another home-page card in a different category: h2, ONE picture, 3 item links with .price, and a 'Shop now' link",
      "Another home-page card for a seasonal or trending pick: h2, ONE picture, a short line and an 'Explore' link",
      "Another card: h2 'Deals for you' or similar, ONE picture, 3 deals with a .tag.hot percentage off and .price",
    ] },
    search: { kind: "store", pics: [3, 3, 0, 0], briefs: [
      "Search results 1-3: a .grid of 3 product .card items (picture, keyword-rich title link, .stars and rating count in .meta, .price, a delivery line in .meta, an Add to cart .btn); tag one .tag 'Best Seller' and one .tag 'Sponsored'",
      "Search results 4-6: another .grid of 3 product .card items in the same format with different price points",
      "Search results 7-10 as a compact .grid of 4 .card items without pictures (title link, .stars, .price, delivery .meta, Add to cart .btn)",
      "h2 'Related searches' as a .row of 6 .tag links, then a .callout 'Need help? Visit the help section or contact us'",
    ] },
    product: { kind: "store", pics: [0, 3, 0, 0], briefs: [
      "'About this item': a ul of 5 detailed bullets, each starting with an ALL-CAPS lead phrase in <b>, then a small table of 4 key specs (brand, material or capacity, dimensions, model). Use exactly the product and price in the page header",
      "h2 'Products related to this item' or 'Frequently bought together': a .grid of 3 product .card items with pictures, title links, .stars, .price and Add to cart .btn",
      "h2 'Product information': a two-column table of 8 technical details and additional information (customer rating, best sellers rank, date first available)",
      "h2 'Customer reviews': the overall .stars and rating count from the page header, .bars for 5 to 1 stars with percentages, then 3 review .post blocks (title in <b>, 'Verified Purchase' .tag, date, body, .meta 'Helpful N')",
    ] },
  },
  video: {
    home: { pics: [4, 4, 0, 0], briefs: [
      "A .grid of 4 .vcard videos about varied topics, each with a picture, runtime, title, channel and views · age",
      "A .grid of 4 more .vcard videos with pictures",
      "h2 'Shorts' then a .grid of 4 short .vcard items WITHOUT pictures (title, views) — vertical shorts",
      "A .grid of 4 .vcard videos WITHOUT pictures in .meta-only form, titled 'Recommended' in an h2",
    ] },
    watch: { kind: "blog", pics: [0, 0, 4, 0], briefs: [
      "The description box: a .meta line of views, upload date and 3 #hashtags, then 2 paragraphs of the creator's description and a ul of 4 chapter timestamps ('0:00 Intro')",
      "h2 with the comment count ('2,314 Comments'), then 4 comments as .post (an @handle in .who with age, text, .meta '👍 1,204 · Reply' in full digits), one pinned by the creator",
      "Up next (the right column): 4 .vcard videos with pictures, runtimes, titles, channels and views, then 3 more as text-only .vcard",
      "3 more comments as .post, one with a nested reply from the creator",
    ] },
    channel: { kind: "blog", pics: [4, 0, 0, 0], briefs: [
      "h2 'Videos' then a .grid of 4 .vcard videos with pictures",
      "h2 'Popular' then a .grid of 4 .vcard videos without pictures",
      "h2 'About' with 2 paragraphs about the channel, the join date and total views in .meta",
      "h2 'Featured channels' as a ul of 4 channel links with subscriber counts in .meta",
    ] },
    results: { kind: "blog", pics: [3, 3, 0, 0], briefs: [
      "3 search results, each a .vcard with a picture, title, views · age, channel, and a one-line description in .meta",
      "3 more .vcard results with pictures",
      "h2 'People also watched' then 3 .vcard results without pictures",
      "h2 'Searches related to this' as a .row of 6 .tag links",
    ] },
  },
  codehost: {
    repo: { kind: "startup", pics: [0, 0, 0, 0], briefs: [
      "The file list: a table of 9 rows (📁 folders first, then 📄 files like README.md, LICENSE, package.json or Cargo.toml), each with a link to /blob/main/<path> or /tree/main/<dir>, a realistic last commit message and an age in .meta. No h2",
      "The README, part 1: an h2 with the project name, a .row of 3-4 .tag badges (build passing, version, license), a one-paragraph pitch, then an h3 'Install' with a <pre><code> install command",
      "The README, part 2: h3 'Usage' with a short paragraph and a realistic <pre><code> example, then h3 'Features' as a ul of 5",
      "The README, part 3: h3 'Roadmap' as a ul of 3 checkbox-style items, h3 'Contributing' with one paragraph, h3 'License' with one line",
    ] },
    issue: { kind: "forum", pics: [0, 0, 0, 0], briefs: [
      "The opening comment as a .post: the author's login in .who with 'commented 3 days ago', then steps to reproduce as an ol, expected vs actual behaviour, and a <pre><code> error log",
      "Two replies as .post comments: a maintainer asking a precise question, the author answering with version info",
      "A contributor's .post with a root-cause analysis and a <pre><code> diff-like snippet, then a .meta event line 'linked a pull request that will close this issue'",
      "A maintainer's closing .post thanking everyone and naming the release, then a .meta event line 'closed this as completed in #N'",
    ] },
    profile: { kind: "startup", pics: [0, 0, 0, 0], briefs: [
      "h2 'Popular repositories' then a .grid of 6 .card repos: repo link, 'Public' .tag, one-line description, language and stars in .meta",
      "h2 'Contribution activity' with a ul.timeline of 4 dated activity items (created repositories, opened pull requests, reviewed)",
      "A profile README: an h3 greeting, 2 sentences about what they build, a ul of 3 current projects",
      "h2 'Organizations' as a .row of 3 .tag links and a .meta 'Achievements' line",
    ] },
    search: { kind: "startup", pics: [0, 0, 0, 0], briefs: [
      "A .meta results count, then 3 repository results as .card items: owner/repo link, description, 3 topic .tag links, language, stars and 'Updated 2 days ago' in .meta",
      "3 more repository .card results",
      "3 more repository .card results",
      "h2 'Related topics' as a .row of 6 .tag links",
    ] },
    home: { kind: "startup", pics: [1, 0, 0, 0], briefs: [
      "The platform pitch: a .lead line, a .row of an email field and a 'Sign up' .btn, and ONE picture of a product screenshot",
      "h2 on collaboration features and a .grid of 3 .card features with short copy",
      "h2 on AI and automation with 3 .stat figures and a short <pre><code> example",
      "h2 on customers: 3 .quote testimonials from invented companies, then a pricing .callout",
    ] },
  },
  qa: {
    question: { kind: "forum", pics: [0, 0, 0, 0], briefs: [
      "The question as one .post: 2 paragraphs describing the problem precisely, a <pre><code> minimal example and the exact error, 'What I tried' as a ul, a .row of 3-4 .tag tags, the asker in .who ('asked Mar 4, 2046'), and its score in the last .meta ('▲ 42'). No h2",
      "h2 with the answer count (e.g. '3 Answers'), then the accepted answer as a .post with <span class=\"tag hot\">✓ Accepted</span>, a precise explanation, a <pre><code> fix and why it works, the answerer in .who with reputation, and its score in the last .meta",
      "A second answer as a .post with an alternative approach, a <pre><code> example and a caveat, and a lower score",
      "A third, short answer as a .post with a low score, then a .callout 'Not the answer you're looking for? Browse other questions tagged …'",
    ] },
    list: { kind: "forum", pics: [0, 0, 0, 0], briefs: [
      "4 question summaries as .qsum blocks (votes, answers, views; title link; one-line excerpt; tags; asker and age)",
      "4 more .qsum question summaries; one with an accepted answer",
      "4 more .qsum question summaries",
      "A .meta line with pagination links (1 2 3 … 48291 Next)",
    ] },
  },
  productbrand: {
    home: { pics: [1, 1, 1, 0], briefs: [
      "A full-width .tile for the flagship product: h2 name, a .lead tagline, 'Learn more' .btn and 'Buy' .btn.ghost links, and ONE picture of the product",
      "A second full-width .tile for another product line, same structure, with ONE picture",
      "A third .tile for a service or accessory, same structure, with ONE picture",
      "A .grid of 4 small .card tiles (name, one-line tagline, 'Learn more' link) for more of the lineup, then a .meta line of footnote-style fine print",
    ] },
    product: { kind: "startup", pics: [1, 0, 1, 0], briefs: [
      "'Get the highlights': a .grid of 3 .card highlights, each with a big claim in <b>, one sentence, and ONE picture in the first",
      "'Why upgrade': a .grid of 4 .stat figures comparing to the previous generation, then 2 sentences",
      "A .split with ONE picture beside a feature story (h2, 2 short paragraphs, a 'Learn more' link)",
      "'Which model is right for you?': a comparison table of 3 models (price from, display, chip or engine, battery or range), then 'Buy' .btn links",
    ] },
  },
  classifieds: {
    home: { pics: [0, 0, 0, 0], briefs: [
      "Directory column 1: h2 'community' with a ul of 16 category links (the classic ones plus a few futuristic ones), then h2 'services' with a ul of 14",
      "Directory column 2: h2 'housing' with a ul of 10 category links, then h2 'for sale' with a ul of 20 (include 2-3 future things like drone parts or exosuits)",
      "Directory column 3: h2 'jobs' with a ul of 16 category links, then h2 'gigs' with 8 and h2 'resumes'",
      "The right column: h2 'nearby' with a ul of 12 city links, then h2 'cities' with 6 and 'worldwide' with 4",
    ] },
    search: { kind: "store", pics: [0, 0, 0, 0], briefs: [
      "10 listings as a plain ul: each li has a short date in .meta, a title link to the posting, a .price and the neighbourhood in .meta parentheses",
      "10 more listings in the same format",
      "8 more listings, a couple with no price",
      "A .meta line with pagination ('1 - 120 / 3,000') and 'nearby areas' links",
    ] },
    posting: { kind: "store", pics: [1, 0, 0, 0], briefs: [
      "The posting body: ONE picture, then 2-3 short, plain paragraphs written by the seller, with condition, why they're selling and pickup details",
      "The attributes as a small table (condition, make / manufacturer, model name / number, size / dimensions) and a line 'do NOT contact me with unsolicited services or offers'",
      "A reply box: a <form method=\"post\"> with name, email and message fields and a 'reply' button",
      "A .meta line with the post id, posted and updated timestamps, then a 'more ads by this user' link",
    ] },
  },
  social: {
    feed: { kind: "forum", pics: [1, 0, 1, 0], briefs: [
      "3 posts (.post) from different accounts, one with ONE picture; varied lengths and counts",
      "3 more posts, one a quote-post style reply to a big account",
      "3 more posts, one with ONE picture and one a thread starter ('1/')",
      "2 more posts, including one from a verified organisation",
    ] },
    profile: { kind: "forum", pics: [1, 0, 0, 0], briefs: [
      "A pinned post by this account (.tag 'Pinned') and 2 recent posts, one with ONE picture",
      "3 more posts by this account, one a reply to another account",
      "2 reposts by this account of other accounts' posts, marked in .meta",
      "2 more posts by this account",
    ] },
    post: { kind: "forum", pics: [1, 0, 0, 0], briefs: [
      "The post itself as a large .post: text (and ONE picture if it suits), the exact time and date and view count in .meta, then the reply/repost/like counts",
      "3 replies as .post blocks from different accounts, one from the author",
      "3 more replies, one arguing, one adding a source",
      "2 more replies and a .meta 'Show more replies' line",
    ] },
  },
  streaming: {
    home: { pics: [1, 5, 0, 0], briefs: [
      "The featured title (the billboard): h2 title, a .meta line (match %, year, rating, seasons), a one-sentence synopsis, a .row of a '▶ Play' .btn and a 'More Info' .btn.ghost, and ONE wide picture of the key art",
      "h2 'Trending Now' then a .grid of 5 .tile titles with pictures",
      "h2 'New Releases' then a .grid of 6 .tile titles WITHOUT pictures (title and .meta only)",
      "h2 'Because You Watched' plus an invented title, then a .grid of 6 .tile titles WITHOUT pictures",
    ] },
    title: { kind: "blog", pics: [0, 4, 0, 0], briefs: [
      "About the title: the synopsis in 2 sentences, a .meta line of cast, genres and moods, and a .row of '▶ Play' .btn and '+ My List' .btn.ghost",
      "h2 'More Like This' then a .grid of 4 .tile titles with pictures",
      "h2 'Episodes' (or 'Tracks') as a table of 6 rows: number, title, one-line description, duration",
      "h2 'About' with a small table of cast, creators, genres, maturity rating",
    ] },
  },
  landing: {
    home: { kind: "startup", pics: [0, 1, 0, 0], briefs: [
      "The value proposition under the hero: a .grid of 3 .card features with .icon emoji or short bold claims, in the brand's voice",
      "How it works: a .split with ONE picture beside ol.steps of 3 steps",
      "Proof: a .grid of 3 .stat figures, then 2 .quote testimonials from invented customers",
      "Pricing or getting started: a .grid of 3 plan .card items with .price and a .btn, then a short details.faq",
    ] },
    page: { kind: "startup", pics: [0, 1, 0, 0], briefs: [
      "The page's introduction: a .lead and a .grid of 3 .card points",
      "The main content: an h2 and a .split with ONE picture beside 2 paragraphs",
      "Details: a table or ol.steps with specifics",
      "A closing call to action .band with a .btn, and a short details.faq",
    ] },
  },
};

// Header facts the writers must agree with: the byline, counts and prices
// the code-rendered header already shows.
function details(plan) {
  const r = seeded(`${plan.site}|${plan.title}|${plan.page}`);
  const dated = String(plan.url ?? "").match(/\/(20\d\d)\/(\d{1,2})\/(\d{1,2})\//);
  const year = Number(dated?.[1]) || 2040 + (fnv(plan.site) % 9);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const mi = dated ? Math.min(11, Number(dated[2]) - 1) : r(12), day = dated ? Number(dated[3]) : 1 + r(28);
  const people = ["Mara Okafor", "Theo Lindqvist", "Priya Raman", "Jules Ferreira", "Nadia Brandt", "Sam Achebe", "Iris Novak", "Kenji Moreau", "Lucía Paredes", "Owen Hart"];
  const handles = ["quiet_ferment", "mossbyte", "deltaSprocket", "oldharbor_", "pixelfern", "tinmouse", "saltmarsh42", "lina_k", "orbital_otter", "neon_gnocchi"];
  const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k` : String(n));
  const stated = String(`${plan.title} ${plan.tag} ${plan.snippet ?? ""}`).match(/\$\s?(\d[\d,]*(?:\.\d\d)?)/)?.[1];
  const price = stated ? Number(stated.replace(/,/g, "")) : [14.99, 19.99, 24.99, 29.99, 34.99, 39.99, 49.99, 59.99, 79.99, 89.99, 99.99, 129.99, 149.99, 199.99, 249.99][r(15)];
  const topicWord = cap(wordsIn(plan.topic || plan.title || plan.site)[0] ?? "Future");
  return {
    year, date: `${months[mi]} ${day}, ${year}`, short: `${months[mi].slice(0, 3)} ${day}, ${year}`, dow: days[r(7)], time: `${1 + r(11)}:${String(r(60)).padStart(2, "0")} ${r(2) ? "PM" : "AM"}`,
    author: people[r(people.length)], author2: people[r(people.length)], user: handles[r(handles.length)],
    hours: 1 + r(22), score: k(120 + r(24000)), comments: 40 + r(1400), members: k(20000 + r(9000000)), online: k(200 + r(40000)),
    rating: (3.9 + r(11) / 10).toFixed(1), ratings: (200 + r(48000)).toLocaleString("en-US"), price, list: Math.round(price * (1.12 + r(30) / 100)) - 0.01,
    views: k(2000 + r(4000000)), likes: k(100 + r(90000)), subs: k(5000 + r(8000000)),
    stars: k(200 + r(90000)), forks: k(20 + r(9000)), issues: 3 + r(400), pulls: 1 + r(60), watch: 10 + r(900),
    asked: 1 + r(9), viewed: (500 + r(90000)).toLocaleString("en-US"), rep: k(300 + r(90000)),
    minutes: 2 + r(50), num: 100 + r(8000), lang: ["TypeScript", "Rust", "Python", "Go", "Zig", "Kotlin", "Swift", "Elixir"].find((l) => new RegExp(`\\b${l}\\b`, "i").test(`${plan.title} ${plan.topic}`)) ?? ["TypeScript", "Rust", "Python", "Go", "Zig", "Kotlin", "C++", "Elixir"][r(8)],
    channel: `${topicWord} ${["Lab", "Explained", "Daily", "Works", "Studio", "Weekly"][r(6)]}`,
  };
}
const money = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function designFacts(plan) {
  const d = details(plan);
  const s = plan.design;
  const f = {
    "news/article": [`Reported by ${d.author}, ${s.name}; updated ${d.time} ET, ${d.dow.slice(0, 3)} ${d.date}`],
    "newspaper/article": [`By ${d.author}; published ${d.date}, updated ${d.time} ET`],
    "community/feed": [`${plan.title || "The front page"}: ${d.members} members, ${d.online} online now`],
    "community/thread": [`Posted by ${s.user}${d.user} ${d.hours} hours ago; score ${d.score}; ${d.comments} comments`],
    "marketplace/product": [`Price ${money(d.price)} (was ${money(d.list)}); rated ${d.rating} out of 5 from ${d.ratings} ratings`],
    "video/watch": [`Uploaded by ${d.channel} (${d.subs} subscribers); ${d.views} views; ${d.likes} likes`],
    "codehost/repo": [`${plan.title}: ${d.stars} stars, ${d.forks} forks, ${d.issues} open issues, ${d.pulls} pull requests; mostly ${d.lang}`],
    "codehost/issue": [`Issue opened by ${d.user} ${d.hours} days ago; ${d.comments % 40} comments`],
    "qa/question": [`Asked ${d.asked} years ago by ${d.user}; viewed ${d.viewed} times`],
    "encyclopedia/article": [`Page last edited ${d.date}`],
    "social/profile": [`${plan.title}: ${d.subs} followers`],
  }[`${s.arch}/${plan.page}`];
  return f ?? [];
}

const pageKey = (url) => { try { const u = new URL(url); return `${hostKey(u.hostname)}${u.pathname.replace(/\/+$/, "")}${u.search}`; } catch { return ""; } };
const samePage = (a, b) => Boolean(a && b) && pageKey(a) === pageKey(b);

// A plan for a page on a real site. It has the fields the generic machinery
// reads (kind, site, title, nav, secs…) plus the spec itself.
export function designPlan(args, spec) {
  const u = new URL(args.url);
  const arch = archOf(spec);
  const firstPage = spec.page && samePage(args.url, spec.url) ? spec.page : null;
  const page = args.submission ? "confirm" : firstPage ?? pageTypeOf(spec, args.url);
  const title = args.submission ? String(args.title ?? "") : pageTitle(spec, u, page, args);
  const query = String(args.query ?? "").replace(new RegExp(`\\b(?:${spec.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${spec.key.split(".")[0]})\\b`, "gi"), "").replace(/\s+/g, " ").trim();
  const topic = [title, args.snippet, query, args.siteContext?.query].filter(Boolean).join(". ") || `whatever is big on ${spec.name} in the 2040s`;
  const sets = BRIEFS[spec.arch] ?? BRIEFS.landing;
  const set = sets[page] ?? Object.values(sets)[0];
  const c = designPalette(spec);
  return {
    kind: set.kind ?? arch.kind ?? "blog",
    style: "minimal", mood: c.dark ? "dark" : "light", hue: hueOf(c.acc),
    site: spec.name, title, tag: title ? String(args.snippet ?? "").slice(0, 200) : "", topic: query.slice(0, 100), snippet: args.snippet ?? "",
    mark: "", nav: spec.nav.map(([l]) => l).slice(0, 5),
    secs: set.briefs.map((s) => `${s}. Topic: ${topic}`),
    pics: set.pics, picShape: spec.arch === "video" || spec.arch === "streaming" || page === "video" ? "wide" : spec.arch === "marketplace" ? "square" : undefined,
    design: spec, page, url: args.url,
  };
}

// What the section writers are told about the site they are imitating.
export function designPrompt(plan, domain) {
  const s = plan.design;
  const arch = archOf(s);
  const routes = (s.routes ?? []).filter((r) => r.type !== "search").map((r) => `${r.type} pages /web/${domain}${r.pattern.replace(/:([\w-]+)/g, "<$1>")}`);
  return {
    intro: `You write ONE section of a page on ${s.name} (${domain}), the real, well-known website, as it will look in the 2040s. It must read exactly like ${s.name}: its real page structure, section names, labels, tone and conventions, filled with invented, futuristic content (never real current events, never real private people). The page's header, navigation, rails and footer already exist and are drawn in ${s.name}'s own look.`,
    voice: s.voice ? `${s.name}'s voice: ${s.voice}` : `${s.name}'s own voice.`,
    vocab: arch.vocab.replaceAll("DOMAIN", domain).replaceAll("COMMUNITY", s.prefix ? `${s.prefix}name` : "Community name").replaceAll("USER", s.user ? `${s.user}name` : "username"),
    links: `Internal links follow ${s.name}'s real URL scheme: ${routes.length ? routes.join(", ") : arch.urls.replaceAll("DOMAIN", domain)}. Outbound links go to invented domains as /web/<domain>/<path>.`,
  };
}

// ---------- rendering ----------
const TOKENS = {
  news: { fs: 16, lh: 1.45, rad: 0, h2: "1.25rem", hw: 800, secgap: "22px", pill: "3px", maxw: 1280 },
  newspaper: { fs: 17, lh: 1.55, rad: 0, h2: "1.3rem", hw: 700, secgap: "20px", pill: "0", maxw: 1200 },
  community: { fs: 14, lh: 1.5, rad: 16, h2: "1.05rem", hw: 700, secgap: "8px", pill: "999px", maxw: 1280 },
  linkboard: { fs: 13.5, lh: 1.35, rad: 0, h2: "1rem", hw: 700, secgap: "0", pill: "0", maxw: 1000 },
  encyclopedia: { fs: 14.5, lh: 1.6, rad: 0, h2: "1.55rem", hw: 400, secgap: "18px", pill: "2px", maxw: 1400 },
  marketplace: { fs: 14.5, lh: 1.45, rad: 8, h2: "1.3rem", hw: 700, secgap: "22px", pill: "999px", maxw: 1500 },
  video: { fs: 14, lh: 1.45, rad: 12, h2: "1.2rem", hw: 700, secgap: "20px", pill: "999px", maxw: 1700 },
  codehost: { fs: 14, lh: 1.5, rad: 6, h2: "1.45rem", hw: 600, secgap: "0", pill: "999px", maxw: 1280 },
  qa: { fs: 14, lh: 1.5, rad: 5, h2: "1.2rem", hw: 400, secgap: "14px", pill: "4px", maxw: 1260 },
  productbrand: { fs: 17, lh: 1.47, rad: 18, h1: "clamp(2.6rem,6vw,4.8rem)", h2: "clamp(2rem,4vw,3.4rem)", hw: 600, htrack: "-.02em", secgap: "12px", pill: "999px", maxw: 1260 },
  classifieds: { fs: 14, lh: 1.35, rad: 0, h2: ".95rem", hw: 700, secgap: "8px", pill: "0", maxw: 1200 },
  social: { fs: 15, lh: 1.4, rad: 12, h2: "1.1rem", hw: 800, secgap: "0", pill: "999px", maxw: 1280 },
  streaming: { fs: 15, lh: 1.4, rad: 6, h2: "1.3rem", hw: 700, secgap: "26px", pill: "4px", maxw: 1800 },
  landing: { fs: 17, lh: 1.55, rad: 14, shadow: "0 1px 2px rgba(0,0,0,.06)", h1: "clamp(2.4rem,5.6vw,4.2rem)", h2: "clamp(1.6rem,3vw,2.3rem)", hw: 700, htrack: "-.02em", secgap: "56px", pill: "999px", maxw: 1160 },
};
export const designTokens = (plan) => ({ pad: "16px 18px", gap: "16px", shadow: "none", ...TOKENS[plan.design.arch] ?? TOKENS.landing });
export const designFonts = (plan) => [designFont(plan.design.fonts?.[0]), designFont(plan.design.fonts?.[1] ?? plan.design.fonts?.[0])];

// Pictures on a real site are drawn in its colours and in the medium its
// content really uses (news photos, product shots, screenshots…).
const MEDIA = { news: "photo", newspaper: "photo", community: "snapshot", linkboard: "screenshot", encyclopedia: "photo", marketplace: "product", video: "photo", codehost: "screenshot", qa: "diagram", productbrand: "product", classifieds: "snapshot", social: "snapshot", streaming: "poster", landing: "isometric" };
export const designMedium = (plan) => MEDIA[plan.design.arch] ?? "photo";

const imgPath = (s) => encodeURIComponent(s).replace(/['()!*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
// It shows its sketch until the picture fades in over it.
function picture(plan, prompt, shape, cls = "art") {
  const c = designPalette(plan.design);
  const query = `s=${designMedium(plan)}&a=${shape}&bg=${encodeURIComponent(c.panel)}&fg=${encodeURIComponent(c.acc)}`;
  return `<img class="${cls}" src="/img/${imgPath(prompt.slice(0, 300))}?${esc(query)}" style="background:${esc(sketchFor(prompt.slice(0, 300), query))}" alt="">`;
}
const subject = (plan) => plan.title || plan.topic || `${plan.site} in the 2040s`;

function searchBox(plan, domain, ph, cls = "d-search") {
  const [path, name] = searchTarget(plan.design);
  return `<form class="${cls}" action="/web/${esc(domain)}${path}" method="get"><input name="${esc(name)}" placeholder="${esc(ph)}" aria-label="Search"><button type="submit" aria-label="Search">⌕</button></form>`;
}

// The strip above some headers: live scores, market data.
function strip(plan, domain) {
  const s = plan.design;
  const r = seeded(`${plan.site}|strip|${plan.title}`);
  if (s.strip === "scores") {
    const teams = ["NYG", "DAL", "KC", "SF", "BUF", "MIA", "GB", "CHI", "LAL", "BOS", "GSW", "NYK", "DEN", "PHX", "MIL", "SEA", "LAR", "PHI"];
    const games = Array.from({ length: 8 }, () => { const a = teams[r(teams.length)], h = teams[(teams.indexOf(a) + 1 + r(teams.length - 1)) % teams.length]; return `<a href="/web/${esc(domain)}/scores/${40100000 + r(99999)}"><span><b>${a}</b> ${r(40) + 3}</span><span><b>${h}</b> ${r(40) + 3}</span><i>${["Final", "Final/OT", `Q${1 + r(4)} ${r(15)}:${String(r(60)).padStart(2, "0")}`, `${1 + r(11)}:${r(2) ? "30" : "00"} PM`][r(4)]}</i></a>`; }).join("");
    return `<div class="d-strip scores"><div class="d-in"><b class="lg">${["NFL", "NBA", "NHL", "MLS"][r(4)]}</b>${games}</div></div>`;
  }
  if (s.strip === "markets") {
    const rows = [["DOW", 71204], ["S&P 500", 12433], ["NASDAQ", 41887], ["10-YR", 3.12], ["BTC", 412880], ["GOLD", 5890], ["OIL", 61.2], ["EUR/USD", 1.31]];
    return `<div class="d-strip markets"><div class="d-in">${rows.map(([n, v]) => { const ch = (r(300) - 150) / 100; return `<span><b>${n}</b> ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} <i class="${ch < 0 ? "dn" : "up"}">${ch < 0 ? "▼" : "▲"}${Math.abs(ch).toFixed(2)}%</i></span>`; }).join("")}</div></div>`;
  }
  return "";
}

// Glyphs for nav labels a rail shows beside them, by common words.
const NAV_GLYPHS = [[/^home|^main/i, "⌂"], [/popular|trend|hot/i, "↗"], [/explore|discover/i, "◎"], [/^all$|browse/i, "▦"], [/search/i, "⌕"], [/notif|alert/i, "🔔"], [/message|inbox|chat/i, "✉"], [/communit|group|friend|network|people/i, "👥"], [/profile|you$|account|me$/i, "👤"], [/subscri|librar|saved|bookmark/i, "▤"], [/short|reel|clip/i, "⚡"], [/histor|recent/i, "↺"], [/video|watch|live|tv/i, "▶"], [/job|career/i, "💼"], [/market|shop|store/i, "🏪"], [/event|calendar/i, "📅"], [/create|post|new/i, "＋"], [/more/i, "⋯"], [/premium|plus|pro$/i, "✦"], [/question/i, "?"], [/tag/i, "#"], [/user|member/i, "👤"]];
const navGlyph = (label) => NAV_GLYPHS.find(([re]) => re.test(label))?.[1] ?? "•";

// Rail groups from the spec, as HTML.
function railGroups(spec, domain, groups, { dots = false } = {}) {
  const link = (p) => `/web/${esc(domain)}${p.startsWith("/") ? p : `/${p}`}`;
  return groups.map((g) => `${g.title ? `<h4>${esc(g.title)}</h4>` : ""}${g.items.map((item) => {
    const [label] = item;
    const dot = dots && spec.prefix && label.startsWith(spec.prefix) ? `<span class="cdot" style="background:hsl(${fnv(label) % 360},70%,50%)">${esc(spec.prefix)}</span>` : "";
    return `<a href="${link(itemPath(spec, item))}">${dot}${esc(label)}</a>`;
  }).join("")}`).join("");
}

// The utility links at the end of a header.
function actionLinks(spec, domain, fallback) {
  const link = (p) => `/web/${esc(domain)}${p.startsWith("/") ? p : `/${p}`}`;
  const acts = spec.actions.length ? spec.actions : fallback;
  return acts.map((a) => (isCart(a.label) ? `<a class="cart" href="${link("/cart")}">🛒 <b>${esc(a.label)}</b></a>` : a.small
    ? `<a class="acct" href="${link(a.path)}"><small>${esc(a.small)}</small><b>${esc(a.label)}</b></a>`
    : `<a class="${a.primary ? "d-btn" : /sign|log|account/i.test(a.label) && !spec.actions.length ? "d-btn ghost" : "plain"}" href="${link(a.path)}">${esc(a.label)}</a>`)).join("");
}
const act = (label, path, primary = false) => ({ small: "", label, path, primary });
// A cart, bag or basket in the header is the site's working cart (the widgets
// runtime opens its drawer).
const isCart = (label) => /\b(?:cart|bag|basket|trolley)\b/i.test(label);

// The community a page is in (from its URL), written the site's way.
function communityOf(spec, url) {
  const vars = routeVars(spec, new URL(url))?.vars ?? {};
  const name = vars.community ?? vars.sub ?? vars.group ?? vars.forum ?? vars.board ?? vars.subreddit ?? vars.topic;
  return name ? `${spec.prefix}${name}` : "";
}

// Header, rails and the code-built top of the page, per structure.
function frame(plan, domain) {
  const s = plan.design;
  const d = details(plan);
  const link = (p) => `/web/${esc(domain)}${p.startsWith("/") ? p : `/${p}`}`;
  const nav = s.nav;
  const navHTML = (n = nav) => n.map(([l, p]) => `<a href="${link(p)}">${esc(l)}</a>`).join("");
  const logo = `<a class="d-logo" href="/web/${esc(domain)}/" aria-label="${esc(s.name)}">${designLogo(s)}</a>`;
  const title = plan.title;
  const f = { above: strip(plan, domain) + (s.promo ? `<div class="promo">${esc(s.promo)}</div>` : ""), header: "", sub: "", left: "", right: "", top: "" };
  const search = (ph, cls) => (s.search === "" ? "" : searchBox(plan, domain, s.search || ph, cls));
  const acts = (fallback) => actionLinks(s, domain, fallback);
  const subnav = s.subnav.length ? `<nav class="d-sub"><div class="d-in">${navHTML(s.subnav)}</div></nav>` : "";
  const loc = s.location ? (() => { const [a, b] = s.location.split("|"); return `<a class="acct loc" href="${link("/location")}">${b ? `<small>${esc(a)}</small><b>📍 ${esc(b)}</b>` : `<b>📍 ${esc(a)}</b>`}</a>`; })() : "";
  switch (s.arch) {
    case "news": {
      f.header = `<div class="d-in"><span class="burger">☰</span>${logo}<nav class="d-nav">${navHTML()}</nav><div class="d-acts">${acts([act("Subscribe", "/subscribe", true), act("Sign in", "/login")])}</div></div>`;
      f.sub = subnav;
      if (plan.page === "article") {
        const section = segs(new URL(plan.url)).find((x) => /^[a-z]+$/.test(x) && x.length > 2) ?? "world";
        f.top = `<div class="d-top"><div class="kicker">${esc(cap(section))}</div><h1>${esc(title)}</h1><div class="byline"><span class="av">${esc(initials(d.author))}</span><span>By <b>${esc(d.author)}</b>, ${esc(s.name)}</span><span class="meta">${d.minutes} min read · Updated ${d.time} ET, ${d.dow.slice(0, 3)} ${d.date}</span></div>${picture(plan, `${subject(plan)}, news photograph`, "wide", "art lead")}<p class="meta cap">${esc(subject(plan))}. Photo: ${esc(s.name)}</p></div>`;
      } else if (plan.page === "video") {
        f.top = `<div class="d-top player"><div class="screen">${picture(plan, `${subject(plan)}, broadcast video still`, "wide")}<span class="playbtn">▶</span><div class="bar"><i style="width:${10 + (d.minutes % 60)}%"></i></div></div><h1>${esc(title)}</h1></div>`;
      } else if (title) f.top = `<div class="d-top"><h1 class="sect">${esc(title)}</h1></div>`;
      break;
    }
    case "newspaper": {
      const editions = s.subnav.length ? `<span class="eds">${s.subnav.slice(0, 5).map(([l, p]) => `<a href="${link(p)}">${esc(l)}</a>`).join(" · ")}</span>` : "";
      f.header = `<div class="bar1"><div class="d-in"><span>☰ ⌕</span>${editions}<span class="d-acts">${acts([act("Subscribe", "/subscribe", true), act("Log in", "/login")])}</span></div></div>
<div class="mast"><div class="d-in"><div class="mdate"><b>${d.dow}, ${d.date}</b><br>Today's Paper</div>${logo}<div class="mdate r">${plan.page === "article" ? "" : `${["Dow", "S&P", "Nasdaq"][d.num % 3]} <span class="up">+${(d.num % 90) / 100}%</span>`}</div></div></div>
<nav class="d-nav"><div class="d-in">${navHTML()}</div></nav>`;
      if (plan.page === "article") f.top = `<div class="d-top"><div class="kicker">${esc(cap(plan.topic || "News"))}</div><h1>${esc(title)}</h1>${plan.tag ? `<p class="deck">${esc(plan.tag)}</p>` : ""}${picture(plan, `${subject(plan)}, documentary news photograph`, "wide", "art lead")}<p class="meta cap">${esc(subject(plan))}. Photograph for ${esc(s.name)}</p><div class="byline">By <b>${esc(d.author)}</b> <span class="meta">${d.date} · Updated ${d.time} ET</span></div></div>`;
      else if (title) f.top = `<div class="d-top"><h1 class="sect">${esc(title)}</h1></div>`;
      break;
    }
    case "community": {
      const sub = communityOf(s, plan.url) || (plan.title?.startsWith(s.prefix || "\u0000") ? plan.title : "");
      f.header = `<div class="d-in">${logo}${search(sub ? `Search in ${sub}` : `Search ${s.name}`, "d-search pill")}<div class="d-acts">${acts([act("Get App", "/app"), act("Log In", "/login", true)])}<span class="dots">⋯</span></div></div>`;
      f.left = `<nav class="lnav">${nav.map(([n, p]) => `<a href="${link(p)}">${navGlyph(n)} ${esc(n)}</a>`).join("")}${railGroups(s, domain, s.left, { dots: true })}</nav>`;
      const card = (name, about) => `<div class="rcard"><b>${esc(name)}</b><p>${esc(about)}</p><p class="meta">Created ${d.short.replace(/\d{4}$/, String(d.year - 12))} · Public</p><div class="rstats"><span><b>${d.members}</b> Members</span><span><b>${d.online}</b> Online</span></div><a class="d-btn" data-toggle="Joined" href="${link(itemPath(s, [name, "/"]))}">Join</a></div>`;
      f.right = sub
        ? `${card(sub, plan.tag || `A community for everything ${sub.slice(s.prefix.length)}: questions, wins, disasters and deep dives.`)}<div class="rcard"><h4>Rules</h4><ol><li>Be civil</li><li>Stay on topic</li><li>No low-effort posts</li><li>Flair your posts</li><li>No spam or self-promotion</li></ol></div>`
        : s.right.length ? `<div class="rcard">${railGroups(s, domain, s.right, { dots: true })}</div>` : card(s.name, s.tagline || `The ${s.name} community.`);
      if (plan.page === "thread") f.top = `<div class="d-top tpost"><div class="who">${sub && s.prefix ? `<span class="cdot" style="background:hsl(${fnv(sub) % 360},70%,50%)">${esc(s.prefix)}</span>` : ""}<b>${esc(sub || s.name)}</b><span class="meta">· ${d.hours}h · ${esc(s.user)}${esc(d.user)}</span></div><h1>${esc(title)}</h1></div>`;
      else if (sub) f.top = `<div class="d-top cbanner"><div class="ban" style="background:linear-gradient(90deg,hsl(${fnv(sub) % 360},60%,45%),hsl(${(fnv(sub) + 50) % 360},60%,55%))"></div><div class="sh"><span class="cicon" style="background:hsl(${fnv(sub) % 360},70%,50%)">${esc(s.prefix || initials(sub))}</span><h1>${esc(sub)}</h1><a class="d-btn ghost" href="${link("/submit")}">+ Create Post</a><a class="d-btn" data-toggle="Joined" href="${link(itemPath(s, [sub, "/"]))}">Join</a></div><div class="sort">Best ▾ &nbsp; ▤</div></div>`;
      else f.top = `<div class="d-top"><div class="sort">Best ▾ &nbsp; Everywhere ▾ &nbsp; ▤</div></div>`;
      break;
    }
    case "linkboard":
      f.header = `<div class="d-in">${logo}<nav class="d-nav">${nav.map(([n, p]) => `<a href="${link(p)}">${esc(n)}</a>`).join(" | ")}</nav><span class="d-acts">${acts([act("login", "/login")])}</span></div>`;
      if (plan.page === "item") f.top = `<div class="d-top"><div class="lbitem"><a href="${link("/")}">${esc(title || "Discussion")}</a> <span class="meta">(${esc(slug(plan.topic || "example").split("-")[0] || "example")}.dev)</span><p class="meta">${d.num % 900 + 50} points by ${esc(d.user)} ${d.hours} hours ago | ${d.comments % 400} comments</p><textarea aria-label="Comment" rows="4"></textarea><br><button type="button">add comment</button></div></div>`;
      break;
    case "encyclopedia": {
      const wikiPath = (t) => routePath(s, "article", String(t).replace(/\s+/g, "_")) ?? `/${slug(t)}`;
      const groups = s.left.length ? s.left : [{ title: "Contribute", items: ["Help", "Community portal", "Recent changes"].map((x) => [x, wikiPath(x)]) }, { title: "Tools", items: ["What links here", "Related changes", "Permanent link", "Cite this page"].map((x) => [x, wikiPath(x)]) }];
      f.left = `<div class="wside">${logo}<nav>${nav.map(([n, p]) => `<a href="${link(p)}">${esc(n)}</a>`).join("")}${railGroups(s, domain, groups)}</nav></div>`;
      const pageName = title || "Main Page";
      f.header = `<div class="wtop">${acts([act("Create account", "/create-account"), act("Log in", "/login")]).replaceAll('class="d-btn ghost"', 'class="plain"').replaceAll('class="d-btn"', 'class="plain"')}</div>
<div class="wtabs"><span class="l"><a class="on" href="${link(plan.url ? new URL(plan.url).pathname : "/")}">${plan.page === "main" ? "Main Page" : "Article"}</a><a href="${link(wikiPath(`Talk:${pageName}`))}">Talk</a></span><span class="r"><a class="on" href="${link(plan.url ? new URL(plan.url).pathname : "/")}">Read</a><a href="${link(`${wikiPath(pageName)}?action=edit`)}">Edit</a><a href="${link(`${wikiPath(pageName)}?action=history`)}">View history</a>${search(`Search ${s.name}`)}</span></div>`;
      const from = s.tagline ? `From ${s.name}, ${s.tagline.replace(/^[A-Z](?=[a-z])/, (ch) => ch.toLowerCase()).replace(/\.$/, "")}` : `From ${s.name}`;
      f.top = plan.page === "main"
        ? `<div class="d-top welcome"><h1>Welcome to <a href="${link("/")}">${esc(s.name)}</a>,</h1><p>${esc(s.tagline || "the reference anyone can edit")}.</p><p class="meta"><b>${(7400000 + d.num * 311).toLocaleString("en-US")}</b> articles</p></div>`
        : `<div class="d-top"><h1 class="wtitle">${esc(plan.page === "search" ? "Search results" : title)}</h1><div class="meta wfrom">${esc(from)}</div></div>${plan.page === "article" ? `<nav class="toc" data-toc aria-label="Contents"><b>Contents</b></nav>` : ""}`;
      break;
    }
    case "marketplace": {
      const cartLink = s.actions.some((a) => isCart(a.label)) ? "" : `<a class="cart" href="${link("/cart")}">🛒 <b>Cart</b></a>`;
      f.header = `<div class="d-in">${logo}${loc}${search(`Search ${s.name}`, "d-search wide")}${acts([act("Sign in", "/login")])}${cartLink}</div>`;
      f.sub = `<nav class="d-sub"><div class="d-in">${navHTML(s.subnav.length ? s.subnav : nav)}</div></nav>`;
      if (plan.page === "product") {
        const maker = cap(wordsIn(title)[0] ?? s.name);
        const [add, buy] = [s.buttons[0] ?? "Add to Cart", s.buttons[1] ?? "Buy Now"];
        f.top = `<div class="gallery"><div class="thumbs">${"<i></i>".repeat(5)}</div>${picture(plan, `${subject(plan)}, e-commerce product photo on white`, "square", "art main")}</div>
<div class="pinfo"><h1>${esc(title)}</h1><a class="meta" href="${link(`/stores/${slug(maker)}`)}">Visit the ${esc(maker)} Store</a><div class="rate"><b>${d.rating}</b> <span class="stars" style="--r:${d.rating}"></span> <a href="#reviews">${d.ratings} ratings</a></div>${d.num % 3 ? `<span class="badge">#1 Best Seller</span>` : `<span class="badge">${esc(s.name)}'s Choice</span>`}<p class="meta">${(d.num % 9) + 1}K+ bought in past month</p><hr><div class="pp"><span class="off">-${Math.round((1 - d.price / d.list) * 100)}%</span> <span class="big">${money(d.price)}</span></div><p class="meta">List Price: <s>${money(d.list)}</s></p></div>
<aside class="buybox"><div class="big">${money(d.price)}</div><p>FREE delivery <b>${d.dow}, ${d.date.replace(/, \d{4}$/, "")}</b></p><p class="instock">In Stock</p><label class="meta">Quantity: <select aria-label="Quantity"><option>1</option><option>2</option><option>3</option></select></label><button class="buy1" type="button" data-add-to-cart data-name="${esc(title)}" data-price="${d.price}">${esc(add)}</button><a class="buy2" href="${link("/checkout")}">${esc(buy)}</a><table class="meta"><tr><td>Ships from</td><td>${esc(s.name)}</td></tr><tr><td>Sold by</td><td>${esc(s.name)}</td></tr><tr><td>Returns</td><td>30-day refund</td></tr><tr><td>Payment</td><td>Secure transaction</td></tr></table></aside>`;
      } else if (plan.page === "search") {
        f.left = `<div class="filters"><h4>Delivery Day</h4><label><input type="checkbox"> Get It by Tomorrow</label><h4>Customer Reviews</h4><label><input type="checkbox"> <span class="stars" style="--r:4"></span> &amp; Up</label><h4>Price</h4>${["Up to $25", "$25 to $50", "$50 to $100", "$100 & above"].map((p) => `<label><input type="checkbox"> ${esc(p)}</label>`).join("")}<h4>Deals &amp; Discounts</h4><label><input type="checkbox"> All Discounts</label><label><input type="checkbox"> Today's Deals</label></div>`;
        f.top = `<div class="d-top rbar"><span>1-48 of over ${(d.num * 7).toLocaleString("en-US")} results for <b class="q">${esc(title || plan.topic)}</b></span><span class="meta">Sort by: Featured ▾</span></div>`;
      } else {
        f.top = `<div class="d-top mhero">${picture(plan, `${plan.topic || "seasonal sale"} banner, lifestyle product photography`, "wide")}</div>`;
      }
      break;
    }
    case "video": {
      f.header = `<div class="d-in"><span class="burger">☰</span>${logo}${search("Search", "d-search vsearch")}<span class="mic">🎙</span><div class="d-acts"><span class="dots">⋮</span>${acts([act("Sign in", "/login")])}</div></div>`;
      if (plan.page !== "watch") f.left = `<nav class="guide">${nav.map(([n, p]) => `<a href="${link(p)}">${navGlyph(n)} ${esc(n)}</a>`).join("")}${s.left.length ? `<hr>${railGroups(s, domain, s.left)}` : ""}</nav>`;
      if (plan.page === "watch") {
        f.top = `<div class="d-top player"><div class="screen">${picture(plan, `${subject(plan)}, video frame`, "wide")}<span class="playbtn">▶</span><div class="bar"><i style="width:${8 + (d.minutes % 70)}%"></i></div></div><h1>${esc(title)}</h1><div class="chan"><span class="av">${esc(initials(d.channel))}</span><span><b>${esc(d.channel)}</b><br><span class="meta">${d.subs} subscribers</span></span><button class="d-btn dark" type="button" data-toggle="Subscribed">Subscribe</button><span class="acts"><span>👍 ${d.likes} | 👎</span><span>↗ Share</span><span>⤓ Download</span><span>⋯</span></span></div></div>`;
      } else if (plan.page === "channel") {
        f.top = `<div class="d-top chead">${picture(plan, `${subject(plan)} channel banner`, "wide", "art banner")}<div class="chan big"><span class="av">${esc(initials(title || "C"))}</span><span><h1>${esc(title)}</h1><span class="meta">@${esc(slug(title))} · ${d.subs} subscribers · ${d.num % 900 + 20} videos</span></span><button class="d-btn dark" type="button" data-toggle="Subscribed">Subscribe</button></div><div class="ctabs"><b>Home</b><span>Videos</span><span>Shorts</span><span>Live</span><span>Playlists</span><span>Posts</span></div></div>`;
      } else {
        const [sp, sq] = searchTarget(s);
        f.top = `<div class="d-top chips">${["All", plan.topic ? cap(plan.topic) : "Music", "Gaming", "Live", "Mixes", "News", "Podcasts", "Cooking", "Recently uploaded", "Watched", "New to you"].map((x, i) => `<a class="${i ? "" : "on"}" href="${link(`${sp}?${sq}=${q(x)}`)}">${esc(x)}</a>`).join("")}</div>`;
      }
      break;
    }
    case "codehost": {
      f.header = `<div class="d-in">${logo}<nav class="d-nav">${navHTML()}</nav>${search("Search or jump to...", "d-search dim")}<div class="d-acts">${acts([act("Sign in", "/login"), act("Sign up", "/signup")])}</div></div>`;
      const [owner = d.user, repo = slug(plan.topic || "project") || "project"] = segs(new URL(plan.url));
      const repoPath = `/${owner}/${repo}`;
      const tabs = [["‹› Code", ""], ["⊙ Issues", "/issues", d.issues], ["⇅ Pull requests", "/pulls", d.pulls], ["▷ Actions", "/actions"], ["▦ Projects", "/projects"], ["⛨ Security", "/security"], ["⌁ Insights", "/pulse"]];
      const rhead = `<div class="rhead"><div class="d-in"><h1 class="rname">📘 <a href="${link(`/${owner}`)}">${esc(owner)}</a> / <a href="${link(repoPath)}"><b>${esc(repo)}</b></a> <span class="tag">Public</span></h1><div class="racts"><span class="gbtn">🔔 Notifications</span><span class="gbtn">⑂ Fork <b>${d.forks}</b></span><span class="gbtn" data-toggle="★ Starred">☆ Star <b>${d.stars}</b></span></div></div><nav class="rtabs"><div class="d-in">${tabs.map(([l, p, n], i) => `<a${i ? "" : ' class="on"'} href="${link(`${repoPath}${p}`)}">${l}${n ? ` <i>${n}</i>` : ""}</a>`).join("")}</div></nav></div>`;
      if (plan.page === "repo") {
        f.sub = rhead;
        const langs = [d.lang, ["Shell", "Python", "HTML", "CSS", "Dockerfile"][d.num % 5], "Other"];
        f.right = `<div class="about"><h4>About</h4><p>${esc(plan.tag || `${cap(plan.topic || repo)} for the 2040s: fast, typed and boring in the best way.`)}</p><div class="topics">${[...new Set([slug(plan.topic || repo).split("-")[0], d.lang.toLowerCase(), "cli", "open-source"])].filter(Boolean).map((t) => `<a class="tag" href="${link(`/topics/${t}`)}">${esc(t)}</a>`).join("")}</div><p class="meta">📖 Readme · ⚖ MIT license · ☆ <b>${d.stars}</b> stars · 👁 <b>${d.watch}</b> watching · ⑂ <b>${d.forks}</b> forks</p><h4>Releases <span class="tag">${d.issues % 40 + 3}</span></h4><p>🏷 <b>v${d.asked}.${d.num % 20}.${d.minutes % 10}</b> <span class="tag grn">Latest</span><br><span class="meta">${d.short}</span></p><h4>Languages</h4><div class="lbar"><i style="width:71%;background:${mix(s.colors.acc ?? "#1a73e8", "#ffffff", 0.1)}"></i><i style="width:19%;background:#e3b341"></i><i style="width:10%;background:#d0d7de"></i></div><p class="meta">${langs.map((l, i) => `● ${l} ${[71.2, 19.3, 9.5][i]}%`).join(" &nbsp; ")}</p></div>`;
        f.top = `<div class="d-top branch"><span class="gbtn">⑂ main ▾</span><span class="meta">⑂ ${d.asked + 2} Branches · 🏷 ${d.issues % 40 + 3} Tags</span><span class="grow"></span><span class="gbtn">Go to file</span><span class="gbtn go">‹› Code ▾</span></div><div class="d-top commit"><span class="av">${esc(initials(d.user))}</span><b>${esc(d.user)}</b> <span class="meta">Merge pull request #${d.num % 900 + 10} · ${(d.num * 7919 % 0xfffffff).toString(16).slice(0, 7)} · ${d.hours} hours ago · 🕘 ${(d.num * 3).toLocaleString("en-US")} Commits</span></div>`;
      } else if (plan.page === "issue") {
        f.sub = rhead;
        f.top = `<div class="d-top ihead"><h1>${esc(title.replace(/ #\d+$/, ""))} <span class="meta">#${esc(new URL(plan.url).pathname.split("/").pop())}</span></h1><p><span class="state">⊙ Open</span> <b>${esc(d.user)}</b> <span class="meta">opened this issue ${d.hours} days ago · ${d.comments % 40} comments</span></p></div>`;
        f.right = `<div class="about side">${[["Assignees", d.author2.split(" ")[0].toLowerCase()], ["Labels", `<span class="tag red">bug</span> <span class="tag">needs-triage</span>`], ["Projects", "None yet"], ["Milestone", `v${d.asked + 1}.0`], ["Development", "1 linked pull request"], ["Participants", "👤👤👤👤"]].map(([h, v]) => `<h4>${h}</h4><p class="meta">${v}</p>`).join("")}</div>`;
      } else if (plan.page === "profile") {
        const days = Array.from({ length: 53 * 7 }, (_, i) => `<i class="l${(fnv(`${title}|${i}`) % 11) > 5 ? (fnv(`${title}|${i}`) % 4) + 1 : 0}"></i>`).join("");
        f.left = `<div class="pcard"><span class="av huge">${esc(initials(title))}</span><h1>${esc(cap(String(title).replace(/[-_]/g, " ")))}</h1><p class="meta">${esc(title)}</p><p>${esc(plan.tag || `Building tools for ${plan.topic || "the future"}.`)}</p><a class="d-btn ghost wide" data-toggle="Following" href="${link(`/${title}`)}">Follow</a><p class="meta">👥 <b>${d.subs}</b> followers · <b>${d.num % 300}</b> following</p></div>`;
        f.top = `<div class="d-top contrib"><p class="meta">${(d.num * 3).toLocaleString("en-US")} contributions in the last year</p><div class="cgrid">${days}</div></div>`;
      } else if (plan.page === "home") {
        f.top = `<div class="d-top chero"><h1>${esc(title || s.tagline || s.name)}</h1>${s.tagline && title ? `<p class="lead">${esc(s.tagline)}</p>` : ""}</div>`;
      } else f.top = `<div class="d-top"><h1 class="sect">${esc(title || "Search")}</h1></div>`;
      break;
    }
    case "qa": {
      f.header = `<div class="d-in">${logo}${s.subnav.length ? `<nav class="d-nav">${navHTML(s.subnav)}</nav>` : ""}${search("Search…", "d-search")}<div class="d-acts">${acts([act("Log in", "/login"), act("Sign up", "/signup", true)])}</div></div>`;
      f.left = `<nav class="qnav">${nav.map(([n, p], i) => `<a href="${link(p)}"${i === (nav.length > 1 ? 1 : 0) ? ' class="on"' : ""}>${esc(n)}</a>`).join("")}</nav>`;
      const hot = ["How do I stop my exosuit firmware from rebooting mid-stride?", "Is it rude to cite a paper written by its own AI co-author?", "Why does orbital time drift break my cron jobs?", "Can a quantum RNG be seeded for tests?"];
      f.right = `<div class="qside">${s.right.length ? `<div class="yb">${railGroups(s, domain, s.right).replace(/<a /g, "<a class=\"yl\" ")}</div>` : ""}<div class="hot"><h4>Hot questions</h4><ul>${hot.map((t) => `<li><a href="${link(`/questions/${70000000 + fnv(t) % 9000000}/${slug(t)}`)}">${esc(t)}</a></li>`).join("")}</ul></div></div>`;
      f.top = plan.page === "question"
        ? `<div class="d-top qhead"><h1>${esc(title)}</h1><a class="d-btn" href="${link("/questions/ask")}">Ask Question</a><p class="meta">Asked <b>${d.asked} years ago</b> · Modified <b>${d.hours} days ago</b> · Viewed <b>${d.viewed} times</b></p></div>`
        : `<div class="d-top qhead"><h1>${esc(title ? `Questions tagged [${title.replace(/[“”]/g, "")}]` : "Newest Questions")}</h1><a class="d-btn" href="${link("/questions/ask")}">Ask Question</a><p class="meta">${(24000000 + d.num * 97).toLocaleString("en-US")} questions <span class="qtabs"><b>Newest</b><span>Active</span><span>Bountied</span><span>Unanswered</span><span>More ▾</span></span></p></div>`;
      break;
    }
    case "productbrand":
      f.header = `<div class="d-in">${logo}<nav class="d-nav">${navHTML()}</nav><div class="d-acts">${s.actions.length ? acts([]) : `<a href="${link("/search")}" aria-label="Search">⌕</a><a class="cart" href="${link("/cart")}" aria-label="Bag">🛍</a>`}</div></div>`;
      if (plan.page === "product") {
        f.sub = `<nav class="pnav"><div class="d-in"><b>${esc(title)}</b><span class="grow"></span><a href="${link(`/${slug(title)}/`)}">Overview</a><a href="${link(`/${slug(title)}/specs/`)}">Tech Specs</a><a class="d-btn sm" href="${link(`/shop/buy-${slug(title)}`)}">Buy</a></div></nav>`;
        f.top = `<div class="d-top phero"><h1>${esc(title)}</h1>${plan.tag ? `<p class="lead">${esc(plan.tag)}</p>` : ""}<div class="row c"><a class="d-btn" href="${link(`/shop/buy-${slug(title)}`)}">Buy</a><a class="more" href="${link(`/${slug(title)}/`)}">Learn more ›</a></div>${picture(plan, `${subject(plan)}, studio product render`, "wide")}</div>`;
      }
      break;
    case "classifieds": {
      const area = s.location ? s.location.split("|").at(-1) : s.tagline || s.name;
      const cal = Array.from({ length: 28 }, (_, i) => `<a href="${link(`/search/events?sale_date=${i + 1}`)}">${i + 1}</a>`).join("");
      if (plan.page === "home") {
        f.left = `<div class="clleft">${logo}${acts([act("create a posting", "/post"), act("my account", "/login")]).replace(/class="d-btn( ghost)?"/g, 'class="plain"')}${search(`search ${s.name}`)}<h4>event calendar</h4><div class="cal">${["S", "M", "T", "W", "T", "F", "S"].map((x) => `<b>${x}</b>`).join("")}${cal}</div>${railGroups(s, domain, s.left)}</div>`;
        f.top = `<div class="d-top clarea"><b>${esc(area)}</b></div>`;
      } else {
        f.header = `<div class="d-in">${logo}<span class="crumb">› <a href="${link("/")}">${esc(area)}</a> › <a href="${link(searchTarget(s)[0])}">for sale</a>${plan.page === "posting" ? " › posting" : ""}</span>${plan.page === "search" ? search(`search ${plan.title || "for sale"}`) : ""}<a class="post" href="${link("/post")}">post</a><a href="${link("/login")}">account</a></div>`;
        f.top = plan.page === "posting" ? `<div class="d-top clpost"><h1>${esc(title)}</h1></div>` : `<div class="d-top"><span class="meta">▦ list · gallery · map &nbsp; newest ▾</span></div>`;
      }
      break;
    }
    case "social": {
      f.left = `<nav class="snav">${logo}${nav.map(([n, p]) => `<a href="${link(p)}"><span>${navGlyph(n)}</span> ${esc(n)}</a>`).join("")}<a class="d-btn big" href="${link("/compose/post")}">${esc(s.actions.find((a) => a.primary)?.label ?? "Post")}</a></nav>`;
      const trends = s.right.length ? railGroups(s, domain, s.right) : `<h4>What's happening</h4>${[plan.topic, "Mars harvest", "#OrbitalOpen", "Tidal grid", "Quantum weather"].filter(Boolean).slice(0, 4).map((t, i) => `<a href="${link(`${searchTarget(s)[0]}?${searchTarget(s)[1]}=${q(t)}`)}"><span class="meta">Trending${i ? "" : " in your area"}</span><br><b>${esc(t)}</b><br><span class="meta">${(fnv(t) % 90) + 3}K posts</span></a>`).join("")}`;
      f.right = `<div class="sside">${search("Search", "d-search pill")}<div class="scard">${trends}</div><div class="scard"><h4>Who to follow</h4>${["Orbital Weather", "Neon Gnocchi", "Tidewater Lab"].map((n) => `<p><span class="av">${initials(n)}</span> <b>${n}</b><br><span class="meta">${esc(s.user || "@")}${slug(n).replace(/-/g, "")}</span></p>`).join("")}</div></div>`;
      if (plan.page === "profile") f.top = `<div class="d-top sprof">${picture(plan, `${subject(plan)} profile banner`, "wide", "art banner")}<span class="av huge">${esc(initials(String(title).replace(/^@/, "")))}</span><a class="d-btn ghost fr" data-toggle="Following" href="${link(`/${title}`)}">Follow</a><h1>${esc(cap(String(title).replace(/^@/, "").replace(/[-_]/g, " ")))}</h1><p class="meta">${esc(s.user || "@")}${esc(String(title).replace(/^@/, ""))}</p><p>${esc(plan.tag || `Posting about ${plan.topic || "the future"}.`)}</p><p class="meta">📅 Joined ${d.short.replace(/^\w+ \d+, /, "")} · <b>${d.num % 900}</b> Following · <b>${d.subs}</b> Followers</p><div class="stabs"><b>Posts</b><span>Replies</span><span>Media</span><span>Likes</span></div></div>`;
      else if (plan.page === "post") f.top = `<div class="d-top shead"><b>← Post</b></div>`;
      else f.top = `<div class="d-top stabs"><b>For you</b><span>Following</span></div><div class="d-top compose"><span class="av">YO</span><span class="meta">What is happening?!</span><a class="d-btn sm" href="${link("/compose/post")}">Post</a></div>`;
      break;
    }
    case "streaming":
      f.header = `<div class="d-in">${logo}<nav class="d-nav">${navHTML()}</nav><div class="d-acts">${s.actions.length ? acts([]) : ""}<a href="${link(searchTarget(s)[0])}" aria-label="Search">⌕</a><span>🔔</span><span class="av sq">${esc(s.name.slice(0, 1))}</span></div></div>`;
      if (s.left.length) f.left = `<nav class="slib">${railGroups(s, domain, s.left).replace(/<a href="([^"]*)">([^<]*)<\/a>/g, (m, h, l) => `<a href="${h}"><span class="cov" style="background:hsl(${fnv(l) % 360},55%,45%)"></span>${l}<br><span class="meta">${esc(s.name)}</span></a>`)}</nav>`;
      if (plan.page === "title") f.top = `<div class="d-top bill">${picture(plan, `${subject(plan)}, cinematic key art`, "wide", "art bg")}<div class="bt"><h1>${esc(title)}</h1><p class="meta"><b class="grn">${88 + (d.num % 12)}% Match</b> ${d.year} <span class="tag">TV-14</span> ${d.asked} Seasons <span class="tag">HD</span></p>${plan.tag ? `<p>${esc(plan.tag)}</p>` : ""}<div class="row"><a class="d-btn light" href="${link(`/watch/${d.num}`)}">▶ Play</a><a class="d-btn ghost" data-toggle="✓ My List" href="${link("/my-list")}">＋ My List</a></div></div></div>`;
      break;
    default: {
      f.header = `<div class="d-in">${logo}<nav class="d-nav">${navHTML()}</nav><div class="d-acts">${acts([act("Log in", "/login"), act("Get started", "/signup", true)])}</div></div>`;
      f.sub = subnav;
      f.top = `<div class="d-top lhero"><h1>${esc(title || s.tagline || s.name)}</h1>${plan.tag || (title && s.tagline) ? `<p class="lead">${esc(plan.tag || s.tagline)}</p>` : ""}<div class="row c"><a class="d-btn" href="${link("/signup")}">Get started</a><a class="d-btn ghost" href="${link("/contact")}">Contact sales</a></div>${picture(plan, `${subject(plan)}, product illustration`, "wide")}</div>`;
    }
  }
  return f;
}

// The whole code-built top of a real site's page: title, anything above the
// header, the header, and the frame the sections stream into.
export function designHeader(plan, domain) {
  const s = plan.design;
  const f = frame(plan, domain);
  const t = plan.title ? `${plan.title} | ${s.name}` : s.tagline ? `${s.name}: ${s.tagline}` : s.name;
  return `<title>${esc(t)}</title>
<div class="dz">${f.above}
<header class="site d-head">${f.header}</header>${f.sub}
<div class="d-page d-arch-${s.arch} d-type-${plan.page}${f.left ? " has-l" : ""}${f.right ? " has-r" : ""}">${f.left ? `<aside class="d-left">${f.left}</aside>` : ""}${f.right ? `<aside class="d-right">${f.right}</aside>` : ""}
<main class="d-main">${f.top}
`;
}

export function designFooter(plan, domain) {
  const s = plan.design;
  const d = details(plan);
  const link = (p) => `/web/${esc(domain)}${p}`;
  const legal = s.legal || s.name;
  const small = ["Terms of Use", "Privacy Policy", "Cookie Settings", "Accessibility", "Help"].map((x) => `<a href="${link(`/${slug(x)}`)}">${x}</a>`).join("");
  let body;
  if (s.arch === "encyclopedia") body = `<p>This page was last edited on ${d.date.replace(/^(\w+) (\d+),/, "$2 $1")}, at ${d.time.replace(/ [AP]M$/, "")} (UTC).</p><p>Text is available under a Creative Commons license; additional terms may apply. By using this site, you agree to the Terms of Use and Privacy Policy. ${esc(s.name)} is run by ${esc(legal)}.</p><p class="links">${["Privacy policy", `About ${s.name}`, "Disclaimers", "Contact", "Code of Conduct", "Developers", "Statistics", "Mobile view"].map((x) => `<a href="${link(`/${slug(x)}`)}">${esc(x)}</a>`).join("")}</p>`;
  else if (s.arch === "linkboard") body = `<p class="links">${["Guidelines", "FAQ", "Lists", "API", "Security", "Legal", "Contact"].map((x) => `<a href="${link(`/${slug(x)}`)}">${x}</a>`).join(" | ")}</p>${searchBox(plan, domain, "Search")}`;
  else if (s.arch === "classifieds") body = `<p class="links">© ${d.year} ${esc(s.name)} ${["help", "safety", "privacy", "feedback", "terms", "about"].map((x) => `<a href="${link(`/about/${x}`)}">${x}</a>`).join(" ")}</p>`;
  else {
    const cols = [s.nav.slice(0, 4), s.nav.slice(4, 8), [["About", "/about"], ["Careers", "/careers"], ["Press", "/press"], ["Contact", "/contact"]]].filter((c) => c.length);
    body = `<div class="fcols"><div>${designLogo(s, { size: 0.9 })}</div>${cols.map((c) => `<ul>${c.map(([l, p]) => `<li><a href="${link(p)}">${esc(l)}</a></li>`).join("")}</ul>`).join("")}</div><p class="links">${small}</p><p class="meta">© ${d.year} ${esc(legal)}. All Rights Reserved.</p>`;
  }
  return `</main></div>
<footer class="site d-foot"><div class="d-in">${body}</div></footer></div>
`;
}

// ---------- while the spec is on its way ----------
// A neutral header bar, sent at once when a real site's look isn't known yet;
// the real header replaces it (hidden by the look's CSS) when it arrives.
export const SKELETON = `<style>.d-skel{height:58px;border-bottom:1px solid #e3e3e3;display:flex;align-items:center;gap:18px;padding:0 20px;font:600 1.05rem/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#9aa0a6}.d-skel i{height:12px;border-radius:6px;background:linear-gradient(90deg,#eef0f2 25%,#e2e5e8 50%,#eef0f2 75%);background-size:200% 100%;animation:dsk 1.2s infinite}@keyframes dsk{from{background-position:200% 0}to{background-position:-200% 0}}</style>`;
export const skeletonHeader = (domain) => `${SKELETON}<div class="d-skel" aria-hidden="true"><span>${esc(hostKey(domain))}</span><i style="width:56px"></i><i style="width:72px"></i><i style="width:48px"></i><i style="width:64px;margin-left:auto"></i></div>`;
export const HIDE_SKELETON = `<style>.d-skel{display:none}</style>`;

// Parts of a spec that arrive after the page is on screen: its icon and its
// own CSS, adopted by a late stylesheet.
export function lateIcon(spec) {
  return spec.icon ? `<style>.dz .d-mark:not([style]){display:inline-block;background-image:url(${svgDataURI(spec.icon)})}</style>` : "";
}
// A spec's CSS names fonts by the keywords its prompt lists; they become the
// same system stacks the renderer uses.
const FONT_WORDS = new RegExp(`(^|[,\\s])(${Object.keys(FONT_STACKS).join("|")})(?=\\s*(?:,|$))`, "gi");
export const specCSS = (css) => String(css ?? "").replace(/(font-family|font)\s*:([^;}]+)/gi, (m, prop, value) => `${prop}:${value.replace(FONT_WORDS, (w, pre, name) => `${pre}${designFont(name.toLowerCase())}`)}`);
export const lateCSS = (spec) => (spec.css ? `<style>${specCSS(spec.css)}</style>` : "");

// ---------- stylesheet ----------
export function designCSS(plan, { c, bodyFont, headFont }) {
  const s = plan.design;
  const t = designTokens(plan);
  const headDark = lum(c.head) < 0.3;
  const css = [`
:root{--hbg:${c.head};--hfg:${c.headFg};--link:${c.link};--buy:${c.buy};--buyfg:${c.buyFg};--now:${c.now};--foot:${c.foot};--tint:${c.tint}}
body{background:var(--bg)}a{color:var(--link)}main a{color:var(--link)}
.d-in{max-width:${t.maxw}px;margin:0 auto;padding:0 20px}
header.site.d-head{position:sticky;top:0;z-index:50;background:var(--hbg);color:var(--hfg);border-bottom:1px solid ${headDark ? "transparent" : c.line}}
.d-head>.d-in{display:flex;align-items:center;gap:18px;min-height:56px;flex-wrap:wrap}
.d-head a{color:inherit}.d-logo{display:inline-flex;align-items:center;text-decoration:none!important;color:var(--hfg);flex:none}
.logo{display:inline-flex;align-items:center;gap:8px;line-height:1;white-space:nowrap}.lwrap{display:inline-flex;flex-direction:column;gap:3px}.lsub{font-size:.62rem;font-weight:400;letter-spacing:.02em;opacity:.8}
.d-mark{display:none;width:30px;height:30px;flex:none;background:center/contain no-repeat}.d-mark[style]{display:inline-block}
.logo .lw{display:inline-block}.lblock{padding:.28em .32em;line-height:1}.lblocks{display:inline-flex;gap:3px}.lblocks i{font-style:normal;display:inline-grid;place-items:center;width:1.25em;height:1.25em;font-size:.9em}
.ltag{padding:.35em 1.1em .35em .45em;clip-path:polygon(0 0,86% 0,100% 50%,86% 100%,0 100%)}
.loval{padding:.28em .35em;display:inline-block}.loval i{font-style:normal;display:inline-block;padding:.12em .55em;border-radius:50%}
.lstack{display:inline-flex;flex-direction:column;align-items:center;font-family:${cssFont("serif")}}.lstack b{font-variant:small-caps;letter-spacing:.08em;font-weight:400}.lstack small{font-size:.72rem;font-style:italic;margin-top:3px}
.d-nav{display:flex;gap:18px;flex-wrap:wrap;font-size:.92rem}.d-nav a{color:inherit;white-space:nowrap}
.d-acts{margin-left:auto;display:flex;align-items:center;gap:14px;font-size:.9rem}
.d-btn{display:inline-block;padding:.45em 1em;border-radius:${t.pill};background:var(--buy);color:var(--buyfg)!important;font-weight:700;font-size:.88rem;border:1px solid transparent;text-decoration:none!important;cursor:pointer;font-family:inherit;white-space:nowrap}
.d-btn.ghost{background:transparent;color:inherit!important;border-color:currentColor}.d-btn.sm{padding:.3em .8em;font-size:.8rem}.plain{color:inherit}
.acct{display:flex;flex-direction:column;line-height:1.15;font-size:.82rem;color:var(--hfg)!important;padding:4px}.acct small{font-size:.72rem;opacity:.85}.acct b{font-size:.85rem}
.d-search{display:flex;align-items:center;flex:1;max-width:560px;min-width:160px;background:${headDark ? "#fff" : c.panel};border:1px solid ${c.line};border-radius:${t.pill};overflow:hidden}
.d-search input{flex:1;border:0;background:none;padding:.55em .9em;font:inherit;font-size:.92rem;color:${headDark ? "#111" : c.fg};outline:none;min-width:0}
.d-search button{border:0;background:none;padding:0 .9em;font-size:1.05rem;cursor:pointer;color:${headDark ? "#111" : c.fg}}
.d-sub{background:${c.sub ?? c.head};color:${c.subFg ?? c.headFg};font-size:.85rem;border-bottom:1px solid ${c.line}}.d-sub .d-in{display:flex;gap:18px;padding-top:8px;padding-bottom:8px;overflow:hidden;white-space:nowrap}.d-sub a{color:inherit!important}
.promo{background:${c.panel};text-align:center;font-size:.85rem;padding:10px}
.d-page{max-width:${t.maxw}px;margin:0 auto;padding:0 20px;display:grid;grid-template-columns:minmax(0,1fr);gap:0 28px;align-items:start}
.d-page.has-l{grid-template-columns:var(--lw,220px) minmax(0,1fr)}.d-page.has-r{grid-template-columns:minmax(0,1fr) var(--rw,312px)}.d-page.has-l.has-r{grid-template-columns:var(--lw,220px) minmax(0,1fr) var(--rw,312px)}
.d-left{grid-column:1;grid-row:1;position:sticky;top:70px;padding:16px 0;font-size:.9rem;max-height:calc(100vh - 80px);overflow:auto}
.d-main{grid-row:1;min-width:0;padding:18px 0 10px}.has-l .d-main{grid-column:2}.d-right{grid-row:1;grid-column:2;padding:18px 0;font-size:.88rem;position:sticky;top:70px}.has-l.has-r .d-right{grid-column:3}
.d-main>.d-top{margin-bottom:16px}.d-main h1{font-family:${headFont}}
img.art{display:block;width:100%;height:auto;object-fit:cover;background:${c.panel};border-radius:${t.rad}px}
.d-main img.pic{object-fit:cover}
.byline{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:.6em 0 1em;font-size:.9rem}
.kicker{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--acc);margin-bottom:.35em}
.cap{margin:.4em 0 1.2em}.grow{flex:1}.row.c{justify-content:center}
footer.site.d-foot{background:var(--foot);color:${lum(c.foot) < 0.3 ? "#e8e8e8" : c.muted};border-top:1px solid ${c.line};margin-top:30px;padding:26px 0 36px;font-size:.84rem}
footer.d-foot a{color:inherit}.d-foot .fcols{display:flex;gap:40px;flex-wrap:wrap;margin-bottom:14px}.d-foot ul{list-style:none;margin:0}.d-foot li{margin:.3em 0}.d-foot .links{display:flex;flex-wrap:wrap;gap:6px 16px;margin:.6em 0}
.d-strip{background:${mix(c.head, "#000", 0.25)};color:#ddd;font-size:.75rem;overflow:hidden;white-space:nowrap}.d-strip .d-in{display:flex;gap:4px;align-items:stretch}
.d-strip.scores a{display:grid;grid-template-columns:auto auto;gap:0 10px;padding:6px 12px;border-right:1px solid #444;color:#eee}.d-strip.scores a span{display:block}.d-strip.scores i{grid-column:2;grid-row:1/span 2;align-self:center;font-style:normal;color:#aaa;font-size:.7rem}
.d-strip .lg{align-self:center;padding:0 10px;color:#fff}.d-strip.markets .d-in{gap:22px;padding-top:6px;padding-bottom:6px}.d-strip i.up{color:#3ccf6e;font-style:normal}.d-strip i.dn{color:#ff5d5d;font-style:normal}
.stars::before{background:linear-gradient(90deg,${s.arch === "marketplace" ? mix(c.buy, "#ff8c00", 0.6) : "#f5b301"} calc(var(--r,4)*20%),${c.line} 0);-webkit-background-clip:text;background-clip:text}
ul.heads{list-style:none;margin:0 0 1em}ul.heads li{margin:0;padding:.5em 0;border-bottom:1px solid ${c.line};font-weight:700;line-height:1.3}ul.heads li p{font-weight:400;margin:.2em 0 0;color:var(--muted);font-size:.9rem}
ul.heads a,.story h3 a{color:var(--fg)}.story{margin:0 0 14px}.story h3{margin:.3em 0;font-size:1.02rem;line-height:1.25}.story img.pic{aspect-ratio:16/9;margin:0 0 .4em}
.vcard{display:block;color:var(--fg)!important;position:relative;text-decoration:none!important}.vcard img.pic{aspect-ratio:16/9;margin:0 0 .45em;border:0;border-radius:${Math.min(t.rad, 12)}px}.vcard .dur{position:absolute;right:6px;top:6px;background:rgba(0,0,0,.8);color:#fff;font-size:.72rem;font-weight:700;padding:1px 5px;border-radius:4px}
.vcard b{display:block;line-height:1.3;font-size:.95rem}.vcard .meta{display:block}
.breaking{background:var(--acc);color:${c.on};padding:10px 14px;font-weight:800;font-size:1.05rem;margin:0 0 14px}.breaking b{text-transform:uppercase;margin-right:8px;background:${c.on};color:var(--acc);padding:2px 6px;font-size:.8rem;vertical-align:2px}.breaking a{color:${c.on}!important}
.player .screen{position:relative;background:#000;border-radius:${Math.min(t.rad, 12)}px;overflow:hidden}.player .screen img{border-radius:0}.playbtn{position:absolute;inset:0;display:grid;place-items:center;font-size:3.2rem;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.6)}.player .bar{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.3)}.player .bar i{display:block;height:100%;background:var(--acc)}
.cdot,.cicon{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;color:#fff;font-size:.62rem;font-weight:800;margin-right:8px;vertical-align:middle;flex:none}
pre{background:${c.panel};border-radius:6px;padding:14px;overflow:auto;font-size:.85rem;margin:0 0 1em}pre code{background:none;border:0;padding:0}
@media(max-width:980px){.d-page.has-l,.d-page.has-r,.d-page.has-l.has-r{grid-template-columns:minmax(0,1fr)}.d-left,.d-right{position:static;grid-column:1!important;grid-row:auto;max-height:none}.d-main{grid-column:1!important;grid-row:auto}.d-head .d-nav{display:none}}
@media(max-width:640px){.d-head>.d-in{gap:10px}.d-search{min-width:0;flex-basis:100%;order:9}.d-acts{gap:8px}.acct small{display:none}.d-main table:not(.infobox){display:block;overflow-x:auto}}`];
  const A = {
    news: () => `.d-head>.d-in{min-height:64px}.d-head .d-nav{font-weight:700;font-size:.9rem;gap:16px}.burger{font-size:1.3rem}
.d-main section>h2{font-size:1.15rem;border-bottom:3px solid var(--fg);padding-bottom:6px;margin-bottom:10px}
.d-main h1{font-size:clamp(1.9rem,3.6vw,2.8rem);line-height:1.12;font-weight:800;margin:.1em 0 .2em}.d-main h1.sect{border-bottom:4px solid var(--acc);display:inline-block}
.d-type-front .d-main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2.1fr) minmax(0,1fr);gap:0 26px;align-items:start}
.d-type-front .d-main>.d-top{grid-column:1/-1}.d-type-front .d-main>section:nth-of-type(1){grid-column:2;grid-row:2}.d-type-front .d-main>section:nth-of-type(2){grid-column:1;grid-row:2}.d-type-front .d-main>section:nth-of-type(3){grid-column:3;grid-row:2}.d-type-front .d-main>section:nth-of-type(4){grid-column:1/-1;grid-row:3}
.d-type-front section:nth-of-type(1) img.pic{aspect-ratio:16/9}.d-type-front section:nth-of-type(1)>h2{font-size:clamp(1.6rem,3vw,2.3rem);border:0;line-height:1.1}.d-type-front section:nth-of-type(1)>h2 a{color:var(--fg)}
.d-type-front section:nth-of-type(4) .grid{grid-template-columns:repeat(4,minmax(0,1fr))}
.d-type-front section:nth-of-type(4){background:${c.dark ? c.panel : "#0c0c0c"};color:#fff;padding:18px;margin-top:10px}.d-type-front section:nth-of-type(4) a,.d-type-front section:nth-of-type(4) h2{color:#fff!important;border-color:#fff}.d-type-front section:nth-of-type(4) .meta{color:#bbb}
.d-type-article .d-main,.d-type-video .d-main{max-width:780px}.d-type-article .d-main>section{font-size:1.08rem;line-height:1.6}.d-type-article .d-main>section>h2{border:0;font-size:1.3rem}
@media(max-width:980px){.d-type-front .d-main{display:block}.d-type-front section:nth-of-type(4) .grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`,
    newspaper: () => `header.site.d-head{position:static;border-bottom:0}.bar1{font-size:.75rem;border-bottom:1px solid ${c.line};font-family:${cssFont("franklin")}}.bar1 .d-in{display:flex;gap:18px;align-items:center;min-height:40px}.bar1 .d-acts{margin-left:auto}.eds a{color:inherit}
.mast .d-in{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding-top:12px;padding-bottom:6px}.mast .d-logo{justify-self:center;font-size:clamp(1.6rem,4.8vw,3.3rem)}
.mast .logo .lw{font-size:1em!important}.mast .lsub{text-align:center;font-style:italic;font-size:.8rem}.mdate{font-size:.75rem;font-family:${cssFont("franklin")};line-height:1.35}.mdate.r{text-align:right}.mdate .up{color:#1a8a3a}
nav.d-nav .d-in{display:flex;justify-content:center;gap:4px 20px;flex-wrap:wrap;border-top:1px solid ${headDark ? "rgba(255,255,255,.3)" : c.fg};border-bottom:${headDark ? "0" : `3px double ${c.fg}`};padding:9px 20px;font-family:${cssFont("franklin")};font-size:.8rem;font-weight:600}
.d-main{padding-top:22px}.d-main section>h2{font-family:${cssFont("franklin")};font-size:.85rem;text-transform:uppercase;letter-spacing:.04em;border-top:1px solid var(--fg);padding-top:8px}
.story h3,.d-main h1,.d-type-front section:nth-of-type(1)>h2{font-family:${headFont};font-weight:700}.story{border-bottom:1px solid ${c.line};padding-bottom:12px}.story .meta,.kicker{font-family:${cssFont("franklin")}}
.d-type-front .d-main{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(0,1fr);gap:0 30px;align-items:start}.d-type-front .d-main>.d-top{grid-column:1/-1}
.d-type-front .d-main>section:nth-of-type(1){grid-column:1;grid-row:2}.d-type-front .d-main>section:nth-of-type(2){grid-column:2;grid-row:2 / span 2;border-left:1px solid ${c.line};padding-left:24px}.d-type-front .d-main>section:nth-of-type(3){grid-column:1;grid-row:3}.d-type-front .d-main>section:nth-of-type(4){grid-column:2;grid-row:4;border-left:1px solid ${c.line};padding-left:24px}
.d-type-front section:nth-of-type(1)>h2{font-size:clamp(1.6rem,3vw,2.3rem);text-transform:none;letter-spacing:0;border:0;padding:0;line-height:1.15}.d-type-front section:nth-of-type(1)>h2 a{color:var(--fg)}
.d-type-article .d-main{max-width:680px;margin:0 auto;width:100%}.d-type-article .d-main h1{font-size:clamp(2rem,4vw,2.8rem);line-height:1.12;margin:.2em 0}.deck{font-size:1.2rem;color:var(--muted);margin:.4em 0 1em}.d-type-article .d-main>section{font-family:${bodyFont};font-size:1.18rem;line-height:1.65}
.d-type-article .d-main>section>h2{text-transform:none;font-size:1.3rem;letter-spacing:0;font-family:${headFont};border:0}
@media(max-width:980px){.d-type-front .d-main{display:block}.d-type-front .d-main>section{border:0!important;padding-left:0!important}.mdate{display:none}.mast .d-in{grid-template-columns:1fr}}`,
    community: () => `.d-page{--lw:250px;--rw:316px}.d-head .d-search{max-width:560px;margin:0 auto}.d-search.pill{border-radius:999px;background:${c.dark ? c.panel : mix(c.bg, c.fg, 0.07)};border:0}.dots{font-size:1.2rem}
.lnav{display:flex;flex-direction:column;border-right:1px solid ${c.line};padding-right:14px}.lnav a{color:var(--fg)!important;padding:8px 12px;border-radius:8px;display:flex;align-items:center;gap:4px}.lnav a:hover{background:${c.panel};text-decoration:none}.lnav h4{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:18px 12px 6px;border-top:1px solid ${c.line};padding-top:14px}
.cicon{width:72px;height:72px;font-size:1.6rem;border:4px solid var(--bg);margin-top:-30px}
.rcard{background:${c.dark ? c.panel : mix(c.bg, c.fg, 0.03)};border-radius:16px;padding:14px 16px;margin-bottom:14px}.rcard h4{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:.6em 0}.rcard ol{margin:0 0 0 1.2em}.rcard li{border-bottom:1px solid ${c.line};padding:.4em 0}.rcard>a:not(.d-btn){display:flex;align-items:center;margin:.5em 0;color:var(--fg)!important}.rcard>.d-btn{display:block;text-align:center;margin-top:.6em}
.rstats{display:flex;gap:26px;margin:.6em 0}.rstats span{display:flex;flex-direction:column;font-size:.8rem;color:var(--muted)}.rstats b{font-size:1rem;color:var(--fg)}
.cbanner .ban{height:88px;border-radius:12px}.cbanner .sh{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px;padding:0 16px}.cbanner h1{font-size:1.9rem;margin:0 auto 4px 0;min-width:0;overflow-wrap:anywhere}
@media(max-width:640px){.cbanner h1{font-size:1.4rem}.cicon{width:56px;height:56px;font-size:1.2rem}}.sort{font-size:.8rem;color:var(--muted);padding:12px 4px;border-bottom:1px solid ${c.line}}
.d-main .post{background:transparent;border:0;padding:10px 14px;margin:0 0 4px;border-bottom:1px solid ${c.line};border-radius:0}.d-main .post:hover{background:${c.panel}}
.d-main .post .who{font-size:.78rem;gap:6px}.d-main .post .who .av{width:22px;height:22px;font-size:.55rem}.d-main .post .who .meta{margin-left:0}.d-main .post h3{font-size:1.12rem;margin:.2em 0 .4em;font-weight:600}.d-main .post h3 a{color:var(--fg)!important}
.d-main .post>.meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:.78rem;font-weight:700}.d-main .post .fw-vote,.d-main .post .fw-reply{background:${c.dark ? c.panel : mix(c.bg, c.fg, 0.08)};border-radius:999px;padding:4px 10px;border:0}
.d-main .post .post{border:0;border-left:2px solid ${c.line};border-radius:0;margin:8px 0 0 8px;padding:4px 0 4px 14px}.d-main section>h2{font-size:.95rem}
.tpost h1{font-size:1.5rem;line-height:1.25;margin:.4em 0 0}.tpost .who{display:flex;align-items:center;font-size:.8rem;gap:4px}.d-type-thread .d-main>section:first-of-type{border-bottom:1px solid ${c.line};padding-bottom:10px}`,
    linkboard: () => `.d-page,.d-head .d-in,.d-foot .d-in{max-width:${t.maxw}px}.d-head>.d-in{min-height:26px;gap:10px;padding:2px 4px;background:var(--hbg)}header.site.d-head{background:none;position:static;border:0;padding-top:8px}
.d-head .d-nav{gap:0;font-size:.82rem;white-space:pre}.d-head .d-nav a{margin:0 4px}.d-head .d-acts{font-size:.82rem}
.d-page{background:${mix(c.bg, c.head, 0.08)};padding:6px 10px}.d-main{padding:4px 0}ol.hn{margin:0 0 0 2.2em;color:var(--muted)}ol.hn li{margin:0 0 .5em;color:var(--fg)}ol.hn li::marker{color:var(--muted)}ol.hn>li>a{color:var(--fg)!important;font-size:.95rem}ol.hn p{margin:0;font-size:.72rem}ol.hn p a{color:var(--muted)!important}
.d-main .post{background:none;border:0;padding:4px 0;margin:0 0 10px;font-size:.85rem}.d-main .post .who{font-size:.72rem;color:var(--muted);margin-bottom:2px}.d-main .post .av{display:none}.d-main .post .post{margin-left:40px}.d-main section>h2{display:none}
.lbitem textarea{width:min(500px,100%);margin:10px 0 4px}footer.d-foot{background:var(--bg)!important;border-top:2px solid var(--hbg)!important;text-align:center}.d-foot .links{justify-content:center}.d-foot .d-search{margin:10px auto;max-width:260px}`,
    encyclopedia: () => {
      const tab = mix(c.link, c.bg, 0.62);
      return `.d-page{--lw:176px;max-width:none;padding:0;gap:0}header.site.d-head{position:static;background:none;border:0;margin-left:176px}
.wtop{display:flex;justify-content:flex-end;gap:14px;font-size:.78rem;padding:8px 16px}.wtop a{color:var(--link)!important}.wtabs{display:flex;justify-content:space-between;align-items:flex-end;padding:0 16px 0 0;font-size:.82rem;margin-top:14px}
.wtabs a{display:inline-block;padding:6px 10px;background:linear-gradient(${c.bg},${mix(c.bg, c.link, 0.05)});border:1px solid ${tab};border-bottom:0;margin-left:-1px;color:var(--link)!important}.wtabs .l a.on,.wtabs .r a.on{background:${c.bg};color:${c.fg}!important}.wtabs .r{display:flex;align-items:flex-end}.wtabs .d-search{border-radius:2px;min-width:200px;margin:0 0 4px 10px;background:${c.bg};flex:none}
.d-left{position:static;max-height:none;padding:10px 8px;font-size:.8rem}.wside .d-logo{display:flex;justify-content:center;margin:0 0 18px;color:${c.fg}}.wside .logo{flex-direction:column;gap:6px;text-align:center}.wside .d-mark{width:96px;height:96px}.wside nav a{display:block;padding:2px 6px;color:var(--link)!important}.wside h4{font-weight:400;color:var(--muted);font-size:.75rem;border-bottom:1px solid ${c.line};margin:12px 6px 4px}
.d-main{background:${c.bg};border:1px solid ${tab};border-right:0;padding:16px 24px 20px;font-family:${bodyFont};display:flex;flex-direction:column}.d-main>*{order:3}.d-main>.d-top{order:0}.d-main>section:first-of-type{order:1}.d-main>.toc{order:2}.d-main .lead{color:inherit;font-size:inherit}
.wtitle{font-family:${headFont};font-weight:400;font-size:1.9rem;border-bottom:1px solid ${c.line};margin:0;padding-bottom:2px}.wfrom{margin:6px 0 14px}
.d-main section>h2{font-family:${headFont};font-weight:400;border-bottom:1px solid ${c.line};padding-bottom:2px;margin:.8em 0 .4em}.d-main section>h2::after{content:" [edit]";font-family:${bodyFont};font-size:.55em;color:var(--link);vertical-align:middle}
.d-main h3{font-size:1.05rem;font-weight:700;font-family:${bodyFont}}.infobox,table.infobox{background:${c.panel};border:1px solid ${c.line};border-radius:0;font-size:.82rem;width:min(290px,45%);box-shadow:none}.infobox caption{font-size:1.1rem;text-align:center}.infobox img.pic{aspect-ratio:4/3;margin:0}
.d-main table:not(.infobox){width:auto;border:1px solid ${c.line};background:${c.panel}}.d-main th,.d-main td{border:1px solid ${c.line};padding:.3em .6em}.d-main th{color:${c.fg};text-transform:none;letter-spacing:0;font-size:.85rem;background:${mix(c.panel, c.fg, 0.05)}}tbody tr:nth-child(even) td{background:none}
sup{font-size:.7em;color:var(--link)}.toc{display:inline-block;align-self:flex-start;background:${c.panel};border:1px solid ${c.line};padding:8px 14px;margin:6px 0 14px;font-size:.85rem;min-width:220px}.toc b{display:block;text-align:center;margin-bottom:4px}.toc a{display:block;margin:2px 0}
.toc:not(:has(a)){display:none}.welcome{background:${c.panel};border:1px solid ${c.line};text-align:center;padding:12px}.welcome h1{font-family:${headFont};font-weight:400;font-size:1.8rem;margin:0}
.d-type-main .d-main{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:14px;align-items:start}.d-type-main .d-main>.d-top{grid-column:1/-1}
.d-type-main .d-main>section{border:1px solid ${mix(c.acc, c.bg, 0.75)};background:${mix(c.acc, c.bg, 0.95)};padding:0 10px 10px}.d-type-main .d-main>section>h2{margin:0 -10px 8px;padding:3px 8px;background:${mix(c.acc, c.bg, 0.8)};border:0;font-size:1.05rem;font-family:${bodyFont};font-weight:700}.d-type-main .d-main>section>h2::after{content:none}
.d-type-main .d-main>section:nth-of-type(1){grid-column:1;grid-row:2}.d-type-main .d-main>section:nth-of-type(2){grid-column:2;grid-row:2;border-color:${tab};background:${mix(c.link, c.bg, 0.95)}}.d-type-main .d-main>section:nth-of-type(2)>h2,.d-type-main .d-main>section:nth-of-type(4)>h2{background:${mix(c.link, c.bg, 0.82)}}
.d-type-main .d-main>section:nth-of-type(3){grid-column:1;grid-row:3}.d-type-main .d-main>section:nth-of-type(4){grid-column:2;grid-row:3;border-color:${tab};background:${mix(c.link, c.bg, 0.95)}}.d-type-main section img.pic{float:left;width:140px;margin:0 12px 6px 0;aspect-ratio:1}
footer.d-foot{margin:0 0 0 176px;background:${c.bg};border:1px solid ${tab};border-top:0;font-size:.75rem;color:${c.fg}}.d-foot .links a{color:var(--link)}
@media(max-width:980px){header.site.d-head,footer.d-foot{margin-left:0}.d-main{border:0;padding:12px}.wtop,.wtabs,.wtabs .r{flex-wrap:wrap}.wtabs .d-search{min-width:0;flex:1 1 160px}.infobox,table.infobox{float:none;width:auto;margin:0 0 1em}.d-main table:not(.infobox){display:block;overflow-x:auto}.d-type-main .d-main{display:flex}}`;
    },
    marketplace: () => `.d-head>.d-in{max-width:none;min-height:60px;gap:12px}
.cart{color:var(--hfg)!important;font-size:.95rem;white-space:nowrap}.d-search.wide{max-width:none;border-radius:${Math.min(t.rad, 6)}px;border:${headDark ? "0" : `2px solid ${c.fg}`}}.d-search.wide button{background:${mix(c.buy, "#ffb347", 0.5)};align-self:stretch;color:#111}
.d-sub .d-in{max-width:none}
.d-page{--lw:230px}.d-main .card{background:${c.dark ? c.panel : "#fff"};border:1px solid ${c.line};box-shadow:none}.d-main .card h3{font-size:.95rem;font-weight:400;line-height:1.35}.d-main .card h3 a{color:${c.fg}!important}.d-main .card img.pic{aspect-ratio:1;object-fit:contain;background:#fff;border:0}
.price{font-size:1.5rem;font-weight:500}.d-main .btn{background:var(--buy);color:var(--buyfg);border-radius:${t.pill};box-shadow:none;font-weight:500}.d-main .btn.ghost{background:transparent;color:var(--fg);border-color:${c.line}}
.d-type-home{max-width:none;background:${c.dark ? c.bg : mix(c.bg, c.fg, 0.1)}}.d-type-home .d-main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;max-width:${t.maxw}px;margin:0 auto;width:100%}.d-type-home .d-main>.d-top{grid-column:1/-1;margin:0 -20px -140px;position:relative;z-index:0}.mhero img{aspect-ratio:3/1;border-radius:0;mask-image:linear-gradient(#000 55%,transparent);-webkit-mask-image:linear-gradient(#000 55%,transparent)}
.d-type-home .d-main>section{background:${c.dark ? c.panel : "#fff"};padding:18px;z-index:1;position:relative;margin:0;align-self:stretch}.d-type-home .d-main>section>h2{font-size:1.2rem}.d-type-home section img.pic{aspect-ratio:1}
.gallery{grid-column:1;grid-row:1/span 2;display:grid;grid-template-columns:44px minmax(0,1fr);gap:10px;position:sticky;top:80px}.gallery .thumbs i{display:block;height:44px;border:1px solid ${c.line};border-radius:6px;margin-bottom:8px;background:${c.panel}}.gallery .thumbs i:first-child{border-color:${c.buy};box-shadow:0 0 0 2px ${mix(c.buy, c.bg, 0.6)}}.gallery img{aspect-ratio:1;object-fit:contain;background:#fff}
.d-type-product .d-main{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr) 250px;gap:0 26px;align-items:start}.pinfo{grid-column:2;grid-row:1}.buybox{grid-column:3;grid-row:1/span 2;border:1px solid ${c.line};border-radius:8px;padding:16px;font-size:.88rem}
.d-type-product .d-main>section:nth-of-type(1){grid-column:2;grid-row:2}.d-type-product .d-main>section:nth-of-type(n+2){grid-column:1/-1;border-top:1px solid ${c.line};padding-top:16px}
.pinfo h1{font-size:1.5rem;font-weight:400;line-height:1.3;margin:0 0 .2em;font-family:${bodyFont}}.pinfo .rate{display:flex;gap:6px;align-items:center;margin:.3em 0;font-size:.9rem}.badge{display:inline-block;background:${mix(c.buy, "#c45500", 0.5)};color:#fff;font-size:.75rem;padding:3px 8px;margin:.2em 0}.pp .big,.buybox .big{font-size:1.9rem;font-weight:500}.off{color:#cc0c39;font-size:1.5rem;font-weight:300}.instock{color:#007600;font-size:1.1rem}
.buy1,.buy2{display:block;width:100%;text-align:center;border:0;border-radius:999px;padding:9px;margin:8px 0;font:inherit;cursor:pointer;background:var(--buy);color:var(--buyfg)!important;text-decoration:none!important}.buy2{background:var(--now)}.buybox table{font-size:.78rem;margin-top:8px}.buybox td{border:0;padding:1px 4px}
.filters{font-size:.85rem}.filters h4{margin:14px 0 4px;font-size:.9rem}.filters label{display:flex;gap:6px;align-items:center;margin:4px 0}.rbar{display:flex;justify-content:space-between;border-bottom:1px solid ${c.line};padding:6px 0 10px;font-size:.9rem}.rbar .q{color:${mix(c.buy, "#c45500", 0.5)}}
.d-type-search .d-main section .grid{grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}
@media(max-width:980px){.d-type-home .d-main,.d-type-product .d-main{display:block}.gallery{position:static}.d-type-home .d-main>.d-top{margin:0 -20px 12px}}`,
    video: () => `.d-page{--lw:230px;max-width:none}.d-head>.d-in{max-width:none;min-height:56px}.vsearch{max-width:600px;margin:0 auto;border-radius:40px}.vsearch button{background:${c.panel};border-left:1px solid ${c.line};padding:0 20px;align-self:stretch}.mic{background:${c.panel};border-radius:50%;width:40px;height:40px;display:grid;place-items:center}
.guide{display:flex;flex-direction:column}.guide a{color:var(--fg)!important;padding:8px 12px;border-radius:10px}.guide a:hover{background:${c.panel};text-decoration:none}.guide h4{margin:10px 12px 4px}.guide hr{border:0;border-top:1px solid ${c.line};margin:10px 0}
.chips{display:flex;gap:10px;overflow:hidden;flex-wrap:nowrap}.chips a{background:${c.panel};color:var(--fg)!important;padding:6px 12px;border-radius:8px;font-size:.88rem;font-weight:600;white-space:nowrap}.chips a.on{background:var(--fg);color:var(--bg)!important}
.d-main .grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:24px 16px}.d-main section>h2{font-size:1.2rem}.d-main .vcard b{font-weight:600}
.d-type-watch .d-main{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:0 24px;align-items:start}.d-type-watch .d-main>.d-top{grid-column:1;grid-row:1}.d-type-watch .d-main>section:nth-of-type(1){grid-column:1;grid-row:2;background:${c.panel};border-radius:12px;padding:12px}
.d-type-watch .d-main>section:nth-of-type(2){grid-column:1;grid-row:3}.d-type-watch .d-main>section:nth-of-type(3){grid-column:2;grid-row:1/span 4}.d-type-watch .d-main>section:nth-of-type(4){grid-column:1;grid-row:4}
.d-type-watch .d-main>section:nth-of-type(3) .vcard{display:grid;grid-template-columns:168px minmax(0,1fr);gap:0 8px;margin-bottom:8px}.d-type-watch .d-main>section:nth-of-type(3) .vcard img{grid-row:1/span 3;margin:0}.d-type-watch .d-main>section:nth-of-type(3) .grid{display:block}
.player h1,.chead h1{font-size:1.25rem;font-weight:700;margin:12px 0 8px;font-family:${bodyFont}}.chan{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.chan .acts{margin-left:auto;display:flex;gap:8px}.chan .acts span{background:${c.panel};border-radius:999px;padding:6px 14px;font-size:.85rem;font-weight:600}
.d-btn.dark{background:var(--fg);color:var(--bg)!important;border:0}.chan.big .av{width:120px;height:120px;font-size:2.4rem}.banner{aspect-ratio:6/1;border-radius:14px;margin-bottom:12px}.ctabs{display:flex;gap:22px;border-bottom:1px solid ${c.line};padding:10px 0;margin-top:10px}
.d-main .post{background:none;border:0;padding:6px 0;margin:0 0 10px}.d-main .post .who .meta{margin-left:0}
@media(max-width:1100px){.d-type-watch .d-main{display:block}.d-main .grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`,
    codehost: () => {
      const soft = c.dark ? c.panel : mix(c.bg, c.fg, 0.03);
      return `.d-head>.d-in{max-width:none;min-height:62px}.d-head .d-nav{font-size:.95rem;font-weight:600;gap:20px}.d-search.dim{max-width:300px;background:transparent;border-color:${mix(c.head, c.headFg, 0.35)}}.d-search.dim input,.d-search.dim button{color:var(--hfg)}.d-head .d-btn.ghost{border-color:${mix(c.head, c.headFg, 0.5)};border-radius:6px}
.rhead{background:${soft};border-bottom:1px solid ${c.line};padding-top:16px}.rhead>.d-in{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.rname{font-size:1.25rem;font-weight:400;margin:0;font-family:${bodyFont}}.rname b{font-weight:600}.racts{margin-left:auto;display:flex;gap:8px}
.gbtn{display:inline-flex;gap:6px;align-items:center;border:1px solid ${c.line};background:${soft};border-radius:6px;padding:4px 12px;font-size:.82rem;font-weight:600;cursor:pointer}.gbtn b{background:${mix(soft, c.fg, 0.08)};border-radius:999px;padding:0 6px;font-size:.75rem}.gbtn.go{background:var(--buy);color:var(--buyfg);border-color:transparent}
.rtabs .d-in{display:flex;gap:4px;margin-top:10px;overflow:hidden}.rtabs a{color:var(--fg)!important;padding:8px 12px;border-bottom:2px solid transparent;font-size:.88rem;white-space:nowrap}.rtabs a.on{border-color:${mix(c.acc, "#fd8c73", 0.5)};font-weight:600}.rtabs i{font-style:normal;background:${mix(soft, c.fg, 0.08)};border-radius:999px;padding:0 6px;font-size:.75rem}
.d-page{--rw:296px;--lw:296px}.branch,.commit{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:.85rem}.commit{background:${soft};border:1px solid ${c.line};border-radius:6px 6px 0 0;padding:10px 14px;margin:0!important}.commit .av{width:22px;height:22px;font-size:.55rem}
.d-type-repo .d-main>section:nth-of-type(1){border:1px solid ${c.line};border-top:0;border-radius:0 0 6px 6px;margin-bottom:22px}.d-type-repo section:nth-of-type(1) table{margin:0;font-size:.88rem}.d-type-repo section:nth-of-type(1) td{border-bottom:1px solid ${c.line};padding:.5em .9em}.d-type-repo section:nth-of-type(1) th{display:none}.d-type-repo section:nth-of-type(1) td a{color:var(--fg)!important}
.d-type-repo .d-main>section:nth-of-type(n+2){border:1px solid ${c.line};border-top:0;border-bottom:0;padding:4px 26px;margin:0}.d-type-repo .d-main>section:nth-of-type(2){border-top:1px solid ${c.line};border-radius:6px 6px 0 0;padding-top:0}.d-type-repo .d-main>section:nth-of-type(2)::before{content:"📖 README";display:block;margin:0 -26px 14px;padding:10px 16px;border-bottom:1px solid ${c.line};font-size:.85rem;font-weight:600}
.d-type-repo .d-main>section:nth-of-type(4){border-bottom:1px solid ${c.line};border-radius:0 0 6px 6px;padding-bottom:18px}.d-type-repo section h2{border-bottom:1px solid ${c.line};padding-bottom:.3em;font-size:1.8rem}.d-main h3{border-bottom:1px solid ${c.line};padding-bottom:.3em;font-size:1.25rem}
.about{padding:18px 0;font-size:.88rem}.about h4{font-size:1rem;margin:16px 0 8px;border-top:1px solid ${c.line};padding-top:14px}.about h4:first-child{border:0;padding:0;margin-top:0}.topics{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.d-main .tag,.about .tag{background:${mix(c.link, c.bg, 0.86)};color:var(--link);border:0;text-transform:none;letter-spacing:0;font-size:.75rem;font-weight:600}.tag.grn{background:#dafbe1;color:#1a7f37}.tag.red{background:#ffebe9;color:#cf222e}
.lbar{display:flex;height:8px;border-radius:6px;overflow:hidden;margin:6px 0}.lbar i{display:block}
.ihead h1{font-size:2rem;font-weight:400;font-family:${bodyFont}}.state{background:#1f883d;color:#fff;border-radius:999px;padding:5px 12px;font-weight:600;font-size:.85rem}.d-type-issue .d-main .post{border:1px solid ${c.line};border-radius:6px;padding:0;background:${c.bg};margin-bottom:16px}.d-type-issue .d-main .post .who{background:${soft};border-bottom:1px solid ${c.line};padding:8px 14px;margin:0}.d-type-issue .d-main .post>:not(.who){margin-left:14px;margin-right:14px}.d-type-issue .d-main .post>p:first-of-type{margin-top:12px}
.pcard .av.huge{width:260px;height:260px;font-size:4rem;border:1px solid ${c.line}}.pcard h1{font-size:1.5rem;margin:12px 0 0;font-family:${bodyFont}}.d-btn.wide{display:block;text-align:center;border-radius:6px;background:${soft};border-color:${c.line};color:var(--fg)!important}
.cgrid{display:grid;grid-template-rows:repeat(7,10px);grid-auto-flow:column;gap:3px;overflow:hidden;border:1px solid ${c.line};border-radius:6px;padding:12px}.cgrid i{width:10px;height:10px;border-radius:2px;background:${mix(c.bg, c.fg, 0.08)}}.cgrid .l1{background:#9be9a8}.cgrid .l2{background:#40c463}.cgrid .l3{background:#30a14e}.cgrid .l4{background:#216e39}
.chero{text-align:center;background:${c.head};color:${c.headFg};margin:-18px -20px 20px;padding:70px 20px}.chero h1{font-size:clamp(2.2rem,5vw,4rem);line-height:1.08;color:inherit}.chero .lead{color:${mix(c.headFg, c.head, 0.35)}}
.d-main .card{box-shadow:none;border-radius:6px}`;
    },
    qa: () => `header.site.d-head{border-top:3px solid var(--acc);box-shadow:0 1px 2px rgba(0,0,0,.05)}.d-head>.d-in{min-height:50px}.d-head .d-search{border-radius:5px;max-width:640px}.d-head .d-btn{border-radius:5px;font-weight:400}.d-head .d-btn.ghost{background:${mix(c.link, c.bg, 0.86)};color:${mix(c.link, c.fg, 0.2)}!important;border-color:${mix(c.link, c.bg, 0.4)}}
.d-page{--lw:164px;--rw:300px}.qnav{display:flex;flex-direction:column;border-right:1px solid ${c.line};font-size:.85rem}.qnav a{color:var(--muted)!important;padding:6px 8px}.qnav a.on{background:${mix(c.bg, c.fg, 0.05)};color:${c.fg}!important;font-weight:700;border-right:3px solid var(--acc)}
.qhead{display:grid;grid-template-columns:1fr auto;gap:6px 16px;border-bottom:1px solid ${c.line};padding-bottom:10px}.qhead h1{font-size:1.65rem;font-weight:400;line-height:1.3;margin:0;font-family:${bodyFont}}.qhead .meta{grid-column:1/-1;font-size:.8rem}.qhead .meta b{font-weight:400;color:${c.fg}}.qhead .d-btn{border-radius:5px;font-weight:400;align-self:start}.qtabs{float:right;display:inline-flex;border:1px solid ${c.line};border-radius:5px;overflow:hidden}.qtabs>*{padding:4px 9px;border-left:1px solid ${c.line}}.qtabs b{background:${mix(c.bg, c.fg, 0.08)}}
.d-main .post{display:grid;grid-template-columns:52px minmax(0,1fr);gap:0 14px;background:none;border:0;border-bottom:1px solid ${c.line};border-radius:0;padding:16px 0;margin:0}.d-main .post>*{grid-column:2}.d-main .post>.meta:last-child{grid-column:1;grid-row:1/span 20;display:flex;flex-direction:column;align-items:center;font-size:1.3rem;color:var(--muted)}
.d-main .post>.meta:last-child .fw-vote{flex-direction:column;border:0;background:none;font-size:1.2rem}.d-main .post .who{justify-self:end;background:${mix(c.link, c.bg, 0.85)};padding:6px 10px;border-radius:4px;font-size:.8rem;margin-top:10px}.d-main .post .who .meta{margin-left:0}
.d-main .tag{background:${mix(c.link, c.bg, 0.86)};color:${mix(c.link, c.fg, 0.2)};border:0;border-radius:4px;text-transform:none;letter-spacing:0;font-size:.75rem;font-family:${bodyFont};padding:.3em .55em}.d-main .tag.hot{background:#2f6f44;color:#fff}.d-main section>h2{font-size:1.2rem;font-weight:400;margin:14px 0 0}
.qside .yb{background:${mix("#fdf7e2", c.bg, c.dark ? 0.8 : 0)};border:1px solid ${mix("#f1e5bc", c.bg, c.dark ? 0.8 : 0)};border-radius:3px;padding:0 0 8px;margin-bottom:16px}.qside .yb h4{background:${mix("#fbf3d5", c.bg, c.dark ? 0.8 : 0)};border-bottom:1px solid ${mix("#f1e5bc", c.bg, c.dark ? 0.8 : 0)};padding:10px 14px;font-size:.78rem;font-weight:700;margin:0 0 6px;color:var(--muted)}.qside .yb a{display:block;margin:4px 14px;font-size:.8rem}
.qside .hot h4{font-size:1.1rem;font-weight:400;padding:0 0 8px}.qside .hot ul{list-style:none;margin:0}.qside .hot li{margin:.5em 0}
.qsum{display:grid;grid-template-columns:108px minmax(0,1fr);gap:16px;border-bottom:1px solid ${c.line};padding:16px 0}.qsum .stats{display:flex;flex-direction:column;align-items:flex-end;gap:6px;font-size:.8rem;color:var(--muted)}.qsum .stats .ans{border:1px solid #2f6f44;color:#2f6f44;border-radius:3px;padding:1px 4px}.qsum h3{font-size:1.05rem;margin:0 0 .3em;font-weight:400}`,
    productbrand: () => `header.site.d-head{background:color-mix(in srgb,var(--hbg) 82%,transparent);backdrop-filter:saturate(180%) blur(20px);border:0}.d-head>.d-in{min-height:44px;justify-content:center;gap:34px;font-size:.78rem}.d-head .d-nav{gap:34px;font-size:.78rem;opacity:.85}.d-head .d-acts{margin-left:0;gap:26px}
.pnav{position:sticky;top:44px;z-index:40;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(20px);border-bottom:1px solid ${c.line}}.pnav .d-in{display:flex;align-items:center;gap:22px;min-height:52px;font-size:.8rem}.pnav b{font-size:1.3rem}
.d-main{padding-top:0}.d-page{max-width:none;padding:0}.d-main>section,.d-main>.d-top{text-align:center}.d-main .row.c{justify-content:center;gap:24px}.more{font-size:1.05rem}
.phero,.d-main .tile{padding:54px 20px 0;overflow:hidden}.phero h1{font-size:clamp(3rem,8vw,5.6rem);margin:0}.phero .lead,.d-main .tile .lead{font-size:clamp(1.2rem,2.4vw,1.75rem);color:${c.fg};margin:.2em 0 .8em}.phero img.art,.d-main .tile img.pic{max-width:1000px;margin:26px auto 0;aspect-ratio:2/1;object-fit:cover;background:transparent;border:0}
.d-main .tile h2{font-size:clamp(2.4rem,5vw,3.6rem);margin:0}.d-main>section:nth-of-type(odd) .tile{background:${c.panel}}.d-main>section{margin:0 0 12px}.d-main>section:nth-of-type(3) .tile{background:${c.dark ? c.panel : "#000"};color:#f5f5f7}.d-main>section:nth-of-type(3) .tile .lead{color:#f5f5f7}
.d-main .btn{background:var(--acc);border-radius:999px;box-shadow:none;font-weight:400;padding:.6em 1.3em}.d-main .btn.ghost{background:transparent;color:var(--acc);border:1px solid var(--acc)}.d-main>section>h2{font-size:clamp(1.8rem,3.4vw,2.8rem);padding-top:40px}
.d-main .grid{max-width:1260px;margin:0 auto 1.2em;padding:0 12px}.d-main .card{background:${c.panel};border:0;border-radius:18px;padding:36px 24px;text-align:center}.d-main .stat{background:${c.panel};border:0;border-radius:18px}.d-main .stat b{color:${c.fg}}.d-main table{max-width:900px;margin:0 auto 1.2em;text-align:left}`,
    classifieds: () => `header.site.d-head{position:static;border:0;background:none}.d-head>.d-in{min-height:40px;font-size:.85rem;gap:10px}.d-head .post{margin-left:auto}.crumb{color:var(--muted)}
.d-page{--lw:190px;--rw:170px;max-width:1200px}.d-left{position:static;max-height:none}.clleft{display:flex;flex-direction:column;gap:6px;font-size:.82rem}.clleft .d-logo{margin-bottom:8px}.clleft .d-search{border-radius:0;max-width:none;flex:none}.clleft h4{margin:12px 0 0;font-size:.8rem}
.cal{display:grid;grid-template-columns:repeat(7,1fr);font-size:.7rem;text-align:center;border:1px solid ${c.line}}.cal b{background:${c.panel}}.cal a{padding:2px 0}
.clarea{text-align:center;font-size:.9rem}.clarea b{font-size:1.1rem}
.d-type-home .d-main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0 12px;align-items:start}.d-type-home .d-main>.d-top{grid-column:1/-1}.d-type-home .d-main>section:nth-of-type(4){font-size:.78rem}
.d-main section>h2{background:${c.panel};text-align:center;font-size:.85rem;font-weight:700;padding:3px;margin:10px 0 4px;border:1px solid ${c.line};text-transform:lowercase}.d-main ul{list-style:none;margin:0 0 .8em 0;columns:2;column-gap:10px;font-size:.8rem}.d-main ul li{margin:0 0 1px;break-inside:avoid}
.d-type-search .d-main ul,.d-type-posting .d-main ul{columns:1}.d-type-search .d-main ul li{padding:5px 0;border-bottom:1px solid ${c.line};font-size:.9rem}.d-main .price{font-size:.85rem;font-weight:400;color:var(--muted);margin:0 4px;display:inline}
.clpost h1{font-size:1.2rem;font-weight:700;font-family:${bodyFont}}.d-type-posting .d-main img.pic{max-width:600px;aspect-ratio:4/3}footer.d-foot{background:none!important;border:0!important;text-align:center}
@media(max-width:980px){.d-type-home .d-main{grid-template-columns:repeat(2,minmax(0,1fr))}}`,
    social: () => `header.site.d-head{display:none}.d-page{--lw:260px;--rw:350px;max-width:1280px}.d-main{border-left:1px solid ${c.line};border-right:1px solid ${c.line};padding:0;min-height:100vh}
.snav{display:flex;flex-direction:column;gap:2px;font-size:1.15rem}.snav .d-logo{padding:10px 12px;margin-bottom:6px;color:var(--fg)}.snav a:not(.d-btn){color:var(--fg)!important;padding:10px 12px;border-radius:999px}.snav a:not(.d-btn):hover{background:${c.panel};text-decoration:none}.snav>a>span:first-child{display:inline-block;width:28px}
.d-btn.big{text-align:center;padding:.8em;margin-top:12px;font-size:1rem}.sside .scard{border:1px solid ${c.line};border-radius:16px;padding:12px 16px;margin:14px 0}.sside .scard h4{font-size:1.2rem;margin-bottom:6px}.sside .scard a{display:block;color:var(--fg)!important;padding:8px 0}.sside .d-search.pill{max-width:none;border-radius:999px;background:${c.panel};border:0}
.stabs{display:flex;border-bottom:1px solid ${c.line};margin:0!important}.stabs>*{flex:1;text-align:center;padding:14px 0;color:var(--muted)}.stabs b{color:var(--fg);box-shadow:inset 0 -4px 0 var(--acc)}
.compose{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid ${c.line};margin:0!important}.compose .meta{flex:1;font-size:1.2rem}
.d-main .post{background:none;border:0;border-bottom:1px solid ${c.line};border-radius:0;margin:0;padding:12px 16px}.d-main .post .who .meta{margin-left:0}.d-main .post img.pic{border-radius:16px;aspect-ratio:16/10}.d-main .post>.meta{display:flex;justify-content:space-between;max-width:420px}
.d-main section>h2{display:none}
.sprof .banner{aspect-ratio:3/1;border-radius:0}.sprof .av.huge{width:120px;height:120px;font-size:2.2rem;border:4px solid var(--bg);margin:-60px 0 0 16px}.sprof h1,.sprof>p{margin-left:16px;margin-right:16px}.sprof h1{font-size:1.4rem;margin-top:8px;font-family:${bodyFont}}.fr{float:right;margin:12px 16px 0 0}.shead{padding:14px 16px;font-size:1.2rem;margin:0!important}
@media(max-width:980px){.d-main{border:0}}`,
    streaming: () => `header.site.d-head{background:linear-gradient(${c.head},transparent);border:0;position:sticky}.d-head>.d-in{max-width:none;padding:0 4%;min-height:68px}.d-head .d-nav{font-size:.88rem;gap:20px;opacity:.9}.av.sq{border-radius:4px;width:32px;height:32px}
.d-page{max-width:none;padding:0 4%}.d-page.has-l{--lw:300px}.slib{background:${c.panel};border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:8px}.slib h4{margin:6px 0}.slib a{color:var(--fg)!important;font-size:.9rem;display:grid;grid-template-columns:44px 1fr;align-items:center;gap:0 10px}.slib .cov{grid-row:1/span 2;width:44px;height:44px;border-radius:4px}
.d-main .grid{grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}.tile{display:block;color:var(--fg)!important;background:${c.panel};border-radius:6px;overflow:hidden;min-height:118px;padding:0 0 8px;transition:transform .2s}.tile:hover{transform:scale(1.04);text-decoration:none}.tile img.pic{aspect-ratio:16/9;margin:0 0 6px;border:0;border-radius:0}.tile b,.tile .meta{display:block;padding:0 10px}.tile:not(:has(img)){padding:14px 12px;background:linear-gradient(135deg,${mix(c.panel, c.acc, 0.25)},${c.panel})}
.d-type-home .d-main>section:nth-of-type(1){position:relative;min-height:56vh;display:flex;flex-direction:column;justify-content:flex-end;padding:0 0 40px 4.5%;margin:0 -4.5% 20px}
.d-type-home .d-main>section:nth-of-type(1) img.pic{position:absolute;inset:0;width:100%;height:100%;aspect-ratio:auto;margin:0;z-index:-1;border-radius:0;object-fit:cover;-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,.95),rgba(0,0,0,.35));mask-image:linear-gradient(90deg,rgba(0,0,0,.95),rgba(0,0,0,.35))}
.d-type-home .d-main>section:nth-of-type(1)>h2{font-size:clamp(2.4rem,6vw,4.6rem);max-width:12ch;line-height:1}.d-type-home .d-main>section:nth-of-type(1)>p{max-width:46ch}.d-main .btn{background:#fff;color:#000;border-radius:4px;font-weight:700;box-shadow:none}.d-main .btn.ghost{background:rgba(109,109,110,.7);color:#fff;border:0}
.bill{position:relative;min-height:60vh;display:flex;align-items:flex-end;margin:0 -4.5%}.bill img.bg{position:absolute;inset:0;height:100%;border-radius:0}.bill .bt{position:relative;padding:0 4.5% 40px;max-width:640px;background:linear-gradient(90deg,${c.bg} 20%,transparent)}.bill h1{font-size:clamp(2.4rem,6vw,4.4rem);line-height:1}.d-btn.light{background:#fff;color:#000!important;border-radius:4px}.grn{color:#46d369}
.d-main section>h2{font-size:1.3rem}.d-main table{font-size:.9rem}.d-main th{color:var(--muted)}`,
    landing: () => `.d-head>.d-in{min-height:64px}.d-head .d-nav{font-size:.95rem;margin-left:12px}
.d-page{max-width:${t.maxw}px}.lhero{text-align:center;padding:60px 0 20px}.lhero h1{font-size:var(--h1);line-height:1.05;letter-spacing:-.02em;max-width:18ch;margin:0 auto .3em}.lhero .lead{font-size:1.25rem;color:var(--muted);max-width:44ch;margin:0 auto 1em}.lhero .row .d-btn.ghost{background:transparent;color:var(--fg)!important}
.lhero img.art{max-width:1000px;margin:30px auto 0;aspect-ratio:16/9;border-radius:${t.rad + 6}px}.d-main .btn{background:var(--buy);color:var(--buyfg)}.d-main section>h2{text-align:center}`,
  };
  css.push((A[s.arch] ?? A.landing)());
  if (plan.page === "confirm") css.push(`.d-main{display:block!important;max-width:800px}.d-main>section{grid-column:auto!important;grid-row:auto!important}`);
  return css.join("\n");
}
