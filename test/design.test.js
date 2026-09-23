import test from "node:test";
import assert from "node:assert/strict";
import { createSiteSpecs, normalizeSpec, sanitizeCSS, cleanIcon, compileRoute, matchRoute, siteSpecPrompt, SPEC_PARTS, ARCH_PAGES } from "../lib/sitespec.js";
import { designPlan, pageTypeOf, searchTarget, designFavicon, designFaviconSVG, specCSS, inventedPageType } from "../lib/design.js";
import { themeCSS, themeHeader, themeFooter, heroFacts, artColors } from "../lib/theme.js";
import { generatePage } from "../lib/pages.js";
import { planFromAnswers } from "../lib/jev.js";
import { searchShardPrompt, pageSectionPrompt } from "../lib/prompts.js";
import { fakeReply } from "../lib/fake-fixtures.js";

const noFacts = async function* () {};
const HEX = /^#[0-9a-f]{6}$/;
// Test inputs may name real sites; nothing in lib/ does.
const RAW = {
  real: true, name: "Tidepool", arch: "community", page: "feed", url: "https://www.tidepool.com/c/sourdough", tagline: "Communities for everything", voice: "Casual, specific, full vote counts.",
  colors: { bg: "#ffffff", text: "#1a1a1b", accent: "#ff4500", header: "#ffffff", headerText: "#1a1a1b", link: "#0079d3", button: "#ff4500", footer: "#f6f7f8", subnav: "" },
  fonts: ["sans", "rounded"], logo: { text: "tidepool", style: "word", color: "#ff4500", weight: 800, case: "lower" },
  nav: ["Home", "Popular", ["All", "/c/all"]], actions: ["Get App", "*Log In", "small line|big line"], search: "Search Tidepool", subnav: [], location: "", promo: "", strip: "",
  left: [["Communities", ["c/sourdough", "c/space"]]], right: [], prefix: "c/", user: "u/", buttons: [],
  routes: { thread: "/c/:community/comments/:id/:slug", feed: "/c/:community", profile: "/user/:name", search: "/search?q=:query", bogus: "/x" }, legal: "Tidepool, Inc.",
  icon: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#ff4500"/></svg>`,
  css: ".d-nav a{font-weight:700}",
};

test("a spec is checked before it reaches a page: colours, names, routes, placeholders", () => {
  const spec = normalizeSpec({ ...RAW, colors: { ...RAW.colors, header: "red;}</style><script>" }, nav: ["Home", "<b>Top</b>"] }, "www.tidepool.com");
  assert.equal(spec.key, "tidepool.com");
  assert.equal(spec.colors.head, null); // an invalid colour is dropped for a default
  assert.deepEqual(spec.nav.map(([l]) => l), ["Home", "bTop/b"]);
  assert.deepEqual(spec.actions.map((a) => a.label), ["Get App", "Log In"]); // the prompt's placeholder is not a link
  assert.ok(spec.actions[1].primary);
  assert.deepEqual(spec.routes.map((r) => r.type).sort(), ["feed", "profile", "search", "thread"]); // "bogus" isn't a page type
  assert.equal(normalizeSpec({ real: false }, "x.example"), null);
  assert.equal(normalizeSpec({ real: true, arch: "blog" }, "odd.example").arch, "landing");
});

test("a spec's CSS can restyle but not fetch, escape, reach Foogle's UI or re-lay out the page", () => {
  const css = sanitizeCSS(`--acc:#c00;:root{--bg:#fff}body{background:url(http://evil)}.d-main{max-width:700px;line-height:1.6}header.site{position:fixed;background:#111}
.card{margin:0 auto;border:1px solid red}</style><script>alert(1)</script>{color:red}@import url(x);@font-face{src:url(x)}.fw-toast,#__fvc{display:none}
@media (max-width:600px){.d-nav{display:none}}a\\62 c{color:red}.x{background:expression(alert(1))}`);
  assert.doesNotMatch(css, /url\(|@import|@font-face|<|expression|fw-toast|__fv|max-width:700px|position:fixed/);
  assert.match(css, /^\.dz\{--acc:#c00\}/m);
  assert.match(css, /\.dz\{--bg:#fff\}/);
  assert.match(css, /\.dz \.d-main\{line-height:1\.6\}/);
  assert.match(css, /\.dz \.card\{margin:0 auto;border:1px solid red\}/); // components may have margins
  assert.match(css, /@media \(max-width:600px\)\{\.dz \.d-nav\{display:none\}\}/);
  // Font keywords become the renderer's own stacks.
  assert.match(specCSS(".dz .x{font-family:franklin,serif}"), /Franklin Gothic Medium/);
  // An icon is a small, inert, standalone SVG.
  const icon = cleanIcon(`<svg viewBox="0 0 32 32"><style>body{display:none}</style><circle r="3" onload="x()"/><image href="http://x"/><text>CNN</text></svg>`);
  assert.match(icon, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="32" height="32" viewBox="0 0 32 32"><circle r="3"\/><\/svg>$/);
  assert.equal(cleanIcon("<b>no</b>"), "");
});

test("routes decide a URL's page type; the structure's usual URL shapes cover the rest", () => {
  const u = (p) => new URL(p, "https://www.tidepool.com");
  assert.ok(matchRoute(compileRoute("/c/:community/comments/:id/:slug"), u("/c/sourdough/comments/k3x9/my_loaf/")));
  assert.ok(!matchRoute(compileRoute("/c/:community"), u("/c/sourdough/comments/k3x9/my_loaf")));
  assert.ok(matchRoute(compileRoute("/watch?v=:id"), u("/watch?v=abc")) && !matchRoute(compileRoute("/watch?v=:id"), u("/watch")));
  assert.ok(matchRoute(compileRoute("/wiki/**"), u("/wiki/A/B")));
  assert.ok(matchRoute(compileRoute("/:title/dp/:id"), u("/Lantern-Mk-II/dp/B0C1")));
  const spec = normalizeSpec(RAW, "www.tidepool.com");
  assert.equal(pageTypeOf(spec, "https://www.tidepool.com/"), "feed");
  assert.equal(pageTypeOf(spec, "https://www.tidepool.com/c/space/comments/ab12/a_title"), "thread");
  assert.equal(pageTypeOf(spec, "https://www.tidepool.com/user/mossbyte"), "profile");
  assert.deepEqual(searchTarget(spec), ["/search", "q"]);
  const plan = designPlan({ url: "https://www.tidepool.com/c/space" }, spec);
  assert.equal(plan.title, "c/space");
  const news = normalizeSpec({ real: true, name: "Daily", arch: "news" }, "daily.example");
  assert.equal(pageTypeOf(news, "https://daily.example/2046/03/04/world/some-story/index.html"), "article");
});

test("every structure renders every page type completely, with any spec, safely", () => {
  for (const [arch, pages] of Object.entries(ARCH_PAGES)) {
    for (const [i, page] of pages.entries()) {
      const spec = normalizeSpec({ ...RAW, arch, page, url: "https://www.tidepool.com/x" }, "www.tidepool.com");
      const plan = { ...designPlan({ url: `https://www.tidepool.com/some/path-${i}`, title: "A title" }, spec), page };
      const out = themeCSS(plan) + themeHeader(plan, "www.tidepool.com", { art: true }) + themeFooter(plan, "www.tidepool.com");
      assert.doesNotMatch(out, /undefined|NaN|\[object|<script/, `${arch}/${page}`);
      const css = themeCSS(plan);
      assert.equal(css.split("{").length, css.split("}").length, `unbalanced braces: ${arch}/${page}`);
      assert.match(out, /<header class="site d-head">/);
      assert.match(out, /<footer class="site d-foot">/);
      assert.equal(plan.secs.length, 4);
      assert.ok(heroFacts(plan).every((f) => !/undefined/.test(f)));
      const art = new URLSearchParams(artColors(plan));
      assert.match(art.get("bg"), HEX);
    }
    // A spec that has only said what the site is still renders.
    const bare = designPlan({ url: "https://bare.example/" }, normalizeSpec({ real: true, name: "Bare", arch }, "bare.example"));
    assert.doesNotMatch(themeCSS(bare) + themeHeader(bare, "bare.example"), /undefined|NaN/);
  }
  const spec = normalizeSpec(RAW, "www.tidepool.com");
  assert.match(designFavicon(spec), /<img src="data:image\/svg\+xml;base64,/);
  assert.match(designFaviconSVG(normalizeSpec({ ...RAW, icon: "" }, "www.tidepool.com")), /<text[^>]*>T<\/text>/);
});

test("section writers are told which real site they imitate, its voice and its URL scheme", () => {
  const spec = normalizeSpec(RAW, "www.tidepool.com");
  const plan = designPlan({ url: "https://www.tidepool.com/c/sourdough" }, spec);
  const p = pageSectionPrompt({ plan, domain: "www.tidepool.com", url: plan.url, brief: plan.secs[0], index: 0, total: 4, briefs: plan.secs });
  assert.match(p.system, /^You write ONE section of a page on Tidepool \(www\.tidepool\.com\), the real, well-known website/);
  assert.match(p.system, /Casual, specific, full vote counts/);
  assert.match(p.system, /thread pages \/web\/www\.tidepool\.com\/c\/<community>\/comments\/<id>\/<slug>/);
  // Invented sites keep their own writer prompt.
  const invented = planFromAnswers({ url: "https://garden.example/" }, { kind: { choice: "forum" }, style: { choice: "phpbb" } });
  assert.match(pageSectionPrompt({ plan: invented, domain: "garden.example", url: "https://garden.example/", brief: invented.secs[0], index: 0, total: 4 }).system, /^You write ONE section of the body of a web page that doesn't exist/);
});

// A spec registry whose parts stream only when the test says so.
function manualSpecs() {
  const parts = {};
  const stream = (spec) => {
    const part = spec.user.match(/Part: (\w+)/)[1];
    const p = parts[part] = { queue: [], wake: null };
    return (async function* () {
      for (;;) {
        const next = p.queue.length ? p.queue.shift() : await new Promise((r) => { p.wake = r; });
        if (next === null) return;
        yield next;
      }
    })();
  };
  const send = (part, text) => { const p = parts[part]; if (!p) return; if (p.wake) { const w = p.wake; p.wake = null; w(text); } else p.queue.push(text); };
  return { specs: createSiteSpecs({ stream, dir: null, log: { log() {}, warn() {} } }), send, parts };
}

test("a real site's spec streams in parts: a neutral header at once, writers on the first line, the real header with the look", async () => {
  const { specs, send, parts } = manualSpecs();
  const written = [];
  const planWithJev = async () => { throw new Error("Jev must not be asked when a search result said the site is real"); };
  const gen = generatePage({ url: "https://www.tidepool.com/c/sourdough", real: true, title: "c/sourdough" }, { specs, looks: new Map(), facts: noFacts, planWithJev, complete: async (s) => { written.push(s); return "<section><h2>x</h2></section>"; } });
  const first = await gen.next();
  assert.match(first.value, /class="d-skel"/); // before any spec line
  assert.doesNotMatch(first.value, /<title>/);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(Object.keys(parts).sort(), ["about", "header", "icon", "look"]); // concurrent parts; style waits for the look
  const next = gen.next();
  send("about", `${JSON.stringify({ real: true, name: "Tidepool", arch: "community", page: "feed", voice: "Casual." })}\n`);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(written.length, 4); // the writers started on the first line
  send("look", `${JSON.stringify({ colors: RAW.colors, fonts: RAW.fonts, logo: RAW.logo })}\n`);
  send("header", `${JSON.stringify({ nav: RAW.nav, actions: RAW.actions, search: RAW.search })}\n`);
  const shell = (await next).value;
  assert.match(shell, /^<style>\.d-skel\{display:none\}<\/style>/);
  assert.match(shell, /<title>c\/sourdough \| Tidepool<\/title>/);
  assert.match(shell, /class="d-page d-arch-community d-type-feed/);
  assert.match(shell, /--acc:#ff4500/);
  for (const part of ["about", "look", "header", "icon"]) send(part, null);
  await new Promise((r) => setTimeout(r, 5));
  send("style", `${JSON.stringify({ routes: RAW.routes })}\n${JSON.stringify({ css: RAW.css })}\n`);
  send("style", null);
  let rest = "";
  for await (const c of gen) rest += c;
  assert.match(rest, /<style>\.dz \.d-nav a\{font-weight:700\}<\/style>/); // the CSS is adopted by the page on screen
  assert.match(rest, /<\/html>$/);
  // The next page of the site renders its look at once, with no skeleton.
  const again = generatePage({ url: "https://www.tidepool.com/c/space/comments/ab12/a_title" }, { specs, looks: new Map(), facts: noFacts, planWithJev, complete: async () => "<section>x</section>" });
  const head = (await again.next()).value;
  assert.doesNotMatch(head, /d-skel/);
  assert.match(head, /d-type-thread/);
});

test("an invented site never waits for a spec; a site the spec says isn't real keeps its invented look", async () => {
  const { specs, send } = manualSpecs();
  const run = async (realSite) => {
    const chunks = [];
    const planWithJev = async (a) => ({ ...planFromAnswers(a, { kind: { choice: "forum" }, style: { choice: "phpbb" } }), realSite });
    const gen = generatePage({ url: "https://crumbforum.net/t/some-thread", title: "A thread" }, { specs, looks: new Map(), facts: noFacts, planWithJev, complete: async () => "<section>x</section>" });
    const pending = (async () => { for await (const c of gen) chunks.push(c); })();
    await new Promise((r) => setTimeout(r, 5));
    send("about", `${JSON.stringify({ real: false })}\n`);
    for (const part of ["about", "look", "header", "icon", "style"]) send(part, null);
    await pending;
    return chunks.join("");
  };
  const invented = await run(0.05);
  assert.doesNotMatch(invented, /d-skel|d-page/);
  assert.match(invented, /<header class="site/);
  const notReal = await run(0.9);
  assert.match(notReal, /d-skel/); // it looked real to Jev…
  assert.doesNotMatch(notReal, /class="d-page/); // …but the spec said no
  assert.equal(specs.peek("crumbforum.net").real, false); // and that answer is kept
});

test("the search's first batch decides whether the query names a real site; fake mode answers every spec part", () => {
  assert.doesNotMatch(searchShardPrompt("sourdough", { count: 3, angle: "a" }).system, /"real": true/);
  const allowed = searchShardPrompt("tidepool", { count: 3, angle: "a", real: true }).system;
  assert.match(allowed, /"real": true/);
  assert.match(allowed, /sitelinks/);
  const first = JSON.parse(fakeReply(allowed, "Search query: tidepool\nProduce exactly 3 results.\nThis batch covers only: a").split("\n")[0]);
  assert.equal(first.real, true);
  assert.equal(first.url, "https://www.tidepool.com/");
  assert.ok(first.links.length >= 3 && first.links.every((l) => l.length === 3));
  const raw = {};
  for (const part of SPEC_PARTS) {
    const p = siteSpecPrompt({ domain: "www.tidepool.com", url: "https://www.tidepool.com/r/sourdough/", part, known: part === "style" ? { arch: "community" } : null });
    for (const line of fakeReply(p.system, p.user).trim().split("\n")) Object.assign(raw, JSON.parse(line));
  }
  const spec = normalizeSpec(raw, "www.tidepool.com");
  assert.equal(spec.arch, "community");
  assert.ok(spec.look && spec.header && spec.routes.length && spec.css !== null);
  const no = siteSpecPrompt({ domain: "garden.example", part: "about" });
  assert.deepEqual(JSON.parse(fakeReply(no.system, no.user)), { real: false });
});

test("invented sites share the page archetypes: feeds, front pages, product pages, main pages", () => {
  assert.equal(inventedPageType("forum", "https://crumbforum.net/"), "feed");
  assert.equal(inventedPageType("forum", "https://crumbforum.net/t/starter-smells-like-nail-polish"), "thread");
  assert.equal(inventedPageType("store", "https://lanternworks.shop/products/kestrel-mk-ii"), "product");
  assert.equal(inventedPageType("news", "https://harborledger.news/"), "front");
  assert.equal(inventedPageType("blog", "https://x.example/"), null);
  const plan = (url, extra = {}) => planFromAnswers({ url, ...extra }, { kind: { choice: url.includes("shop") ? "store" : "forum" }, style: { choice: "minimal" } });
  const feed = plan("https://crumbforum.net/latest");
  assert.equal(feed.page, "feed");
  assert.match(feed.secs[0], /latest threads/);
  assert.match(themeHeader(feed, "crumbforum.net"), /Start a thread/);
  // A search result names one page, so a titled deep link stays a thread.
  assert.equal(plan("https://crumbforum.net/repairs", { title: "Gardeners" }).page, null);
  const product = plan("https://lanternworks.shop/products/kestrel-mk-ii", { title: "Kestrel Mk II — $89" });
  assert.equal(product.page, "product");
  assert.match(themeHeader(product, "lanternworks.shop"), /data-add-to-cart data-name="Kestrel Mk II — \$89" data-price="89"/);
  assert.match(heroFacts(product)[0], /costs \$89/);
});
