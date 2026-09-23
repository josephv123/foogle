import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { knownSite, siteForQuery, parseBrandSpec, SITE_COUNT, ARCHES } from "../lib/brands.js";
import { brandPlan, siteResult, brandFavicon } from "../lib/brandtheme.js";
import { themeCSS, themeHeader, themeFooter, heroFacts, artColors } from "../lib/theme.js";
import { generatePage } from "../lib/pages.js";
import { planFromAnswers } from "../lib/jev.js";
import { searchShardPrompt, pageSectionPrompt } from "../lib/prompts.js";
import { brandSpecPrompt } from "../lib/brands.js";
import { fakeReply } from "../lib/fake-fixtures.js";

const CSS_COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d.,% ]+\))$/i;
const noFacts = async function* () {};

test("queries that name a known site find it; topics and common words don't", () => {
  const home = (q) => { const hit = siteForQuery(q); return hit && !hit.topic ? hit.site.name : hit ? `${hit.site.name}: ${hit.topic}` : null; };
  assert.equal(home("cnn"), "CNN");
  assert.equal(home("CNN news"), "CNN");
  assert.equal(home("cnn.com"), "CNN");
  assert.equal(home("new york times"), "The New York Times");
  assert.equal(home("nyt"), "The New York Times");
  assert.equal(home("stack overflow"), "Stack Overflow");
  assert.equal(home("reddit sourdough"), "Reddit: sourdough");
  assert.equal(home("octopus wiki"), "Wikipedia: octopus");
  assert.equal(home("amazon"), "Amazon");
  assert.equal(home("amazon.com kindle"), "Amazon: kindle");
  assert.equal(home("apple iphone"), "Apple: iphone");
  assert.equal(home("apple"), "Apple");
  // Brands that are also words need the site's own context.
  assert.equal(home("apple pie recipe"), null);
  assert.equal(home("amazon rainforest"), null);
  assert.equal(home("target practice"), null);
  assert.equal(home("x factor"), null);
  assert.equal(home("best hiking boots"), null);
  assert.equal(home("haunted lighthouse forum"), null);
});

test("hosts map to their site, subdomains and regional domains included", () => {
  assert.equal(knownSite("www.cnn.com").name, "CNN");
  assert.equal(knownSite("edition.cnn.com").name, "CNN");
  assert.equal(knownSite("en.wikipedia.org").name, "Wikipedia");
  assert.equal(knownSite("de.wikipedia.org").name, "Wikipedia");
  assert.equal(knownSite("old.reddit.com").name, "Reddit");
  assert.equal(knownSite("amazon.co.uk").name, "Amazon");
  assert.equal(knownSite("oakland.craigslist.org").name, "craigslist");
  assert.equal(knownSite("twitter.com").name, "X");
  assert.equal(knownSite("news.ycombinator.com").name, "Hacker News");
  assert.equal(knownSite("ycombinator.com"), null);
  assert.equal(knownSite("garden.example"), null);
  assert.equal(knownSite("cnnworlddesk.example"), null);
  assert.ok(SITE_COUNT >= 50);
});

test("a search names the real page: home with sitelinks, or a deep link in the site's own URL scheme", () => {
  const cnn = siteResult(siteForQuery("cnn"));
  assert.equal(cnn.url, "https://www.cnn.com/");
  assert.equal(cnn.title, "CNN: Breaking News, Latest News and Videos");
  assert.equal(cnn.links.length, 6);
  assert.deepEqual(cnn.links[0].slice(0, 2), ["World", "/world"]);
  assert.equal(siteResult(siteForQuery("wikipedia octopus")).url, "https://en.wikipedia.org/wiki/Octopus");
  assert.equal(siteResult(siteForQuery("reddit sourdough")).url, "https://www.reddit.com/r/sourdough/");
  assert.equal(siteResult(siteForQuery("youtube octopus escape")).url, "https://www.youtube.com/results?search_query=octopus+escape");
  assert.equal(siteResult(siteForQuery("apple iphone")).title, "iPhone - Apple"); // the site's own casing
  assert.match(brandFavicon(knownSite("reddit.com")), /<svg/);
  assert.match(brandFavicon(knownSite("cnn.com")), />CNN</);
});

test("a site's URL decides the kind of page: front pages, articles, threads, products", () => {
  const page = (url) => { const p = brandPlan({ url }, knownSite(new URL(url).hostname)); return `${p.page}:${p.title}`; };
  assert.equal(page("https://www.cnn.com/"), "front:");
  assert.equal(page("https://www.cnn.com/2046/03/04/politics/mars-vote-count/index.html"), "article:Mars vote count");
  assert.equal(page("https://www.cnn.com/climate"), "front:Climate");
  assert.equal(page("https://www.reddit.com/r/sourdough/"), "feed:r/sourdough");
  assert.equal(page("https://www.reddit.com/r/sourdough/comments/k3x9qa/my_starter_went_grey/"), "thread:My starter went grey");
  assert.equal(page("https://en.wikipedia.org/wiki/Giant_Pacific_octopus"), "article:Giant Pacific octopus");
  assert.equal(page("https://en.wikipedia.org/wiki/Main_Page"), "main:");
  assert.equal(page("https://www.amazon.com/Kindle-Paperwhite-32GB/dp/B0CFPJYX7P"), "product:Kindle Paperwhite 32GB");
  assert.equal(page("https://www.amazon.com/s?k=kindle"), "search:“kindle”");
  assert.equal(page("https://www.nytimes.com/2046/03/04/science/octopus-cities.html"), "article:Octopus Cities");
  assert.equal(page("https://github.com/rust-lang/rust"), "repo:rust-lang/rust");
  assert.equal(page("https://github.com/torvalds"), "profile:torvalds");
  assert.equal(page("https://stackoverflow.com/questions/78123456/how-to-await-in-a-loop"), "question:How to await in a loop");
  assert.equal(page("https://www.youtube.com/watch?v=octopus-escapes-a-jar"), "watch:Octopus Escapes A Jar");
  // A dated URL dates the byline.
  const story = brandPlan({ url: "https://www.cnn.com/2046/03/04/politics/mars-vote-count/index.html" }, knownSite("cnn.com"));
  assert.match(heroFacts(story)[0], /March 4, 2046/);
});

test("every known site renders complete CSS, header and footer on each of its page types", () => {
  const urls = ["/", "/2046/03/04/world/some-long-story-slug/index.html", "/r/space/comments/ab12cd/a_long_thread_title_here/", "/wiki/Some_Article", "/Some-Product-Name-Here/dp/B0ABCDEFGH", "/s?k=lamps", "/watch?v=some-video-title", "/owner/repo", "/owner/repo/issues/12", "/questions/12345678/some-question-title", "/iphone", "/search/sss?query=bike", "/sfc/bik/d/nice-road-bike/7712345678.html", "/nasa", "/nasa/status/1234567890123456789", "/title/81234567-some-show", "/item?id=40001234"];
  const hosts = new Set();
  for (const q of ["cnn", "bbc", "fox news", "nbc news", "reuters", "ap news", "bloomberg", "yahoo", "npr", "espn", "nytimes", "wapo", "wsj", "guardian", "economist", "ft", "la times", "reddit", "hacker news", "wikipedia", "amazon", "ebay", "walmart", "target", "best buy", "etsy", "ikea", "home depot", "airbnb", "booking.com", "zillow", "yelp", "nike", "youtube", "twitch", "vimeo", "github", "gitlab", "stack overflow", "quora", "apple", "microsoft", "samsung", "tesla", "craigslist", "twitter", "facebook", "instagram", "linkedin", "netflix", "spotify", "imdb", "disney plus", "openai", "anthropic", "notion", "slack", "stripe", "discord", "duolingo", "paypal"]) {
    const site = siteForQuery(q)?.site;
    assert.ok(site, `no site for ${q}`);
    assert.ok(ARCHES.includes(site.arch), `${site.name} arch`);
    hosts.add(site.host);
    for (const p of urls) {
      const plan = brandPlan({ url: `https://${site.host}${p}` }, site);
      const out = themeCSS(plan) + themeHeader(plan, site.host, { art: true }) + themeFooter(plan, site.host);
      assert.doesNotMatch(out, /undefined|NaN|\[object/, `${site.name} ${p}`);
      const css = themeCSS(plan);
      assert.equal(css.split("{").length, css.split("}").length, `unbalanced braces: ${site.name} ${p}`);
      assert.match(css.match(/--panel:([^;]+);/)[1], /^#[0-9a-f]{6}$/i, `${site.name} panel`);
      // The widgets runtime finds the header's log-in and cart, and knows the page is done by its footer.
      assert.match(out, /<header class="site bh">/);
      assert.match(out, /<footer class="site bf">/);
      assert.equal(plan.secs.length, 4);
      const art = new URLSearchParams(artColors(plan));
      assert.match(art.get("bg"), CSS_COLOR);
      assert.match(art.get("fg"), CSS_COLOR);
    }
  }
  assert.equal(hosts.size, SITE_COUNT); // every curated site, once
});

test("a model's brand spec is checked before it can reach a page", () => {
  const spec = parseBrandSpec(JSON.stringify({ known: true, name: "Letterboxd", arch: "community", bg: "#14181c", fg: "#fff", accent: "#00e054", header: "red;}</style><script>", font: "sans", logo: "Letterboxd", nav: ["Films", "<b>Lists</b>"] }), "letterboxd.com");
  assert.equal(spec.name, "Letterboxd");
  assert.equal(spec.colors.acc, "#00e054");
  assert.equal(spec.colors.head, "#14181c"); // an invalid colour falls back
  assert.deepEqual(spec.nav, ["Films", "bLists/b"]);
  assert.equal(parseBrandSpec('{"known": false}', "crumbforum.net"), null);
  assert.equal(parseBrandSpec("not json", "x.example"), null);
  assert.equal(parseBrandSpec({ known: true, name: "Odd", arch: "blog" }, "odd.example").arch, "landing");
  // Fake mode answers the prompt in the format it asks for.
  const fake = (d) => { const p = brandSpecPrompt(d); return parseBrandSpec(fakeReply(p.system, p.user), d); };
  assert.ok(ARCHES.includes(fake("letterboxd.com").arch));
  assert.equal(fake("garden.example"), null);
  const plan = brandPlan({ url: "https://letterboxd.com/film/some-film/" }, spec);
  assert.doesNotMatch(themeCSS(plan) + themeHeader(plan, "letterboxd.com"), /<script|undefined/);
});

test("a known site renders as itself without asking Jev, and its writers know which site they imitate", async () => {
  const specs = [];
  const chunks = [];
  const planWithJev = async () => { throw new Error("Jev must not be asked about a known site"); };
  for await (const c of generatePage({ url: "https://www.cnn.com/", query: "cnn" }, { looks: new Map(), facts: noFacts, planWithJev, complete: async (spec) => { specs.push(spec); return "<section><h2>x</h2></section>"; } })) chunks.push(c);
  assert.match(chunks[0], /class="lw lblock"[^>]*>CNN</);
  assert.match(chunks[0], /class="bx bx-newsportal bp-front/);
  assert.equal(specs.length, 4);
  assert.ok(specs.every((s) => s.system.includes("CNN (www.cnn.com), the real, well-known website")));
  assert.ok(specs.every((s) => s.system.includes("/web/www.cnn.com/2046/03/04/world/")));
  assert.match(specs[0].user, /The lead package/);
  assert.match(specs[3].system, /exactly 4 pictures/);
});

test("a real site Jev recognises gets a brand spec; an invented one never waits for one", async () => {
  const run = async (url, realSite) => {
    const learned = [];
    const planWithJev = async (a) => ({ ...planFromAnswers(a, { kind: { choice: "forum" }, style: { choice: "phpbb" } }), realSite });
    const learn = async (d) => { learned.push(d); return parseBrandSpec({ known: true, name: "Letterboxd", arch: "community", bg: "#14181c", fg: "#ffffff", accent: "#00e054" }, d); };
    const chunks = [];
    for await (const c of generatePage({ url }, { looks: new Map(), facts: noFacts, planWithJev, learn, learning: () => null, learned: () => null, complete: async () => "<section><h2>x</h2></section>" })) chunks.push(c);
    return { learned, head: chunks[0] };
  };
  const real = await run("https://letterboxd.com/", 0.97);
  assert.deepEqual(real.learned, ["letterboxd.com"]);
  assert.match(real.head, /bx-community/);
  assert.match(real.head, /--hbg:#14181c/);
  const invented = await run("https://crumbforum.net/", 0.07);
  assert.deepEqual(invented.learned, []);
  assert.doesNotMatch(invented.head, /class="bx /);
  // A slow spec can't hold the header back for long.
  const slow = [];
  const started = Date.now();
  for await (const c of generatePage({ url: "https://slowsite.example/" }, { looks: new Map(), facts: noFacts, brandWaitMs: 30, planWithJev: async (a) => ({ ...planFromAnswers(a, { kind: { choice: "blog" }, style: { choice: "minimal" } }), realSite: 0.9 }), learn: () => new Promise(() => {}), learning: () => null, learned: () => null, complete: async () => "<section>x</section>" })) slow.push(c);
  assert.ok(Date.now() - started < 1000);
  assert.doesNotMatch(slow[0], /class="bx /);
});

test("search batches invent every site unless a real one is asked for or already shown", () => {
  const plain = searchShardPrompt("sourdough", { count: 3, angle: "a" }).system;
  assert.match(plain, /Invent every site/);
  assert.doesNotMatch(plain, /"real": true|already shown/);
  assert.match(searchShardPrompt("letterboxd", { count: 3, angle: "a", real: "allow" }).system, /"real": true/);
  assert.match(searchShardPrompt("cnn", { count: 3, angle: "a", real: { taken: { name: "CNN", host: "www.cnn.com" } } }).system, /CNN \(www\.cnn\.com\) is already shown as the top result/);
  // Generic pages keep their generic writer prompt.
  const plan = planFromAnswers({ url: "https://garden.example/" }, { kind: { choice: "forum" }, style: { choice: "phpbb" } });
  const p = pageSectionPrompt({ plan, domain: "garden.example", url: "https://garden.example/", brief: plan.secs[0], index: 0, total: 4, briefs: plan.secs });
  assert.match(p.system, /^You write ONE section of the body of a web page that doesn't exist/);
});

test("a search naming a known site shows it first, before any model result, and Lucky goes straight there", async (t) => {
  const script = `
    globalThis.fetch = async (url, init) => {
      const p = JSON.parse(init.body);
      if (url === "https://api.typesafe.ai/v1/systemone") return Response.json({ answers: { kind: { choice: "news" }, style: { choice: "newsprint" } } });
      const system = p.messages[0].content;
      if (system.includes("search index")) console.log("SHARD_TAKEN=" + system.includes("already shown as the top result"));
      const sse = (content) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] }) + '\\n\\ndata: [DONE]\\n\\n', { headers: { "Content-Type": "text/event-stream" } });
      if (system.includes("overview writer")) return Response.json({ choices: [{ message: { content: JSON.stringify({ title: "CNN", summary: "A news network." }) }, finish_reason: "stop" }] });
      if (p.stream && system.includes("search index")) return sse(JSON.stringify({ site: "CNN Watch", title: "CNN anchors, tracked", url: "https://cnnwatch.example/anchors", snippet: "Every anchor change since 2031." }) + "\\n" + JSON.stringify({ site: "CNN", title: "CNN again", url: "https://edition.cnn.com/", snippet: "dupe" }) + "\\n");
      if (p.stream) return sse("<section><h2>x</h2></section>");
      return Response.json({ choices: [{ message: { content: "<svg xmlns='http://www.w3.org/2000/svg'></svg>" }, finish_reason: "stop" }] });
    };
    await import("./scripts/start.js");
  `;
  const imageCache = await mkdtemp(path.join(tmpdir(), "foogle-img-"));
  t.after(() => rm(imageCache, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, "--", "--port", "0"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, OPENROUTER_API_KEY: "test", TYPESAFE_API_KEY: "test", FOOGLE_IMAGE_CACHE: imageCache },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => { child.kill(); await once(child, "exit"); });
  let output = "";
  child.stdout.on("data", (d) => { output += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server did not start")), 5000);
    child.stdout.on("data", (d) => { const m = String(d).match(/http:\/\/localhost:(\d+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
  });
  const base = `http://localhost:${port}`;
  const serp = await (await fetch(`${base}/search?q=cnn`)).text();
  const top = serp.indexOf('class="result top-site"');
  assert.ok(top > 0);
  assert.ok(top < serp.indexOf("CNN anchors, tracked"));
  assert.match(serp, /https:\/\/www\.cnn\.com/);
  assert.match(serp, /<div class="bsl">[\s\S]*>World<\/a>/);
  assert.doesNotMatch(serp, /CNN again/); // the site isn't listed twice
  assert.match(output, /SHARD_TAKEN=true/);
  const lucky = await fetch(`${base}/search?q=reddit&lucky=1`, { redirect: "manual" });
  assert.equal(lucky.status, 302);
  assert.match(lucky.headers.get("location"), /^\/web\/www\.reddit\.com[/?]/);
  const page = await (await fetch(`${base}/web/www.cnn.com/?fq=cnn`)).text();
  assert.match(page, /bx-newsportal/);
  assert.match(page, /<\/html>/);
});
