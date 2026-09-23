import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fakeReply, fakeJevAnswers, topicOf } from "../lib/fake-fixtures.js";
import { fakeClient, respond } from "../lib/fake-llm.js";
import { recordingClient, replayingClient, recordingFetch, replayingFetch, promptKeys } from "../lib/llm-cache.js";
import {
  searchShardPrompt, newsShardPrompt, imageShardPrompt, mapsResultsPrompt, timelineResultsPrompt, overviewPrompt,
  pageFactsPrompt, SEARCH_ANGLES, NEWS_ANGLES, IMAGE_ANGLES, SECTION_CLASSES,
} from "../lib/prompts.js";
import { imageMessages, imageSpec, STYLES as MEDIA, SHAPES } from "../lib/images.js";
import { sanitizeSVG } from "../lib/llm.js";
import { questions, planFromAnswers } from "../lib/jev.js";
import { generatePage, cleanFactLine } from "../lib/pages.js";
import { replyWriter } from "../lib/interact.js";
import { sanitizeSection } from "../lib/widgets.js";

const reply = ({ system, user }) => fakeReply(system, user);
const lines = text => text.trim().split("\n").map(l => JSON.parse(l));

test("every results prompt gets canned lines in its own format", () => {
  const search = SEARCH_ANGLES.slice(0, 3).flatMap(angle => lines(reply(searchShardPrompt("storm lanterns", { count: 3, angle }))));
  assert.equal(search.length, 9);
  for (const r of search) {
    assert.ok(r.site && r.title && r.snippet && new URL(r.url).host, JSON.stringify(r));
    assert.ok(r.title.length <= 60);
  }
  assert.equal(new Set(search.map(r => new URL(r.url).host)).size, 9, "shards invent distinct sites");
  assert.ok(new Set(search.map(r => r.kind)).size >= 5, "a mix of result kinds");

  const news = lines(reply(newsShardPrompt("harbor festival", { count: 3, angle: NEWS_ANGLES[0] })));
  assert.ok(news.every(n => n.domain && n.headline && n.outlet && n.image));

  const images = IMAGE_ANGLES.flatMap(angle => lines(reply(imageShardPrompt("storm lanterns", { count: 4, angle }))));
  assert.equal(images.length, 12);
  assert.ok(images.every(t => t.site && t.image && Object.hasOwn(MEDIA, t.style) && Object.hasOwn(SHAPES, t.shape)));
  assert.ok(new Set(images.map(t => t.style)).size >= 8, "one grid mixes many media");

  const places = lines(reply(mapsResultsPrompt("late night ramen")));
  assert.equal(places.length, 6);
  assert.ok(places.every(p => p.name && p.domain && p.rating >= 3.4 && p.rating <= 5));

  const events = lines(reply(timelineResultsPrompt("lighthouses")));
  assert.equal(events.length, 10);
  const years = events.map(e => Number(e.date.match(/\d{4}/)[0]));
  assert.deepEqual(years, [...years].sort((a, b) => a - b), "in chronological order");
  assert.ok(years.filter(y => y > 2026).length >= 4);

  const overview = JSON.parse(reply(overviewPrompt("storm lanterns")));
  assert.ok(overview.summary && overview.facts.length >= 3 && overview.ask.length === 4 && overview.related.length === 6);

  const facts = reply(pageFactsPrompt({ url: "https://lanternworks.shop/storm-lanterns", title: "Storm Lanterns", query: "storm lanterns" })).split("\n");
  assert.ok(facts.length >= 5 && facts.length <= 7);
  assert.ok(facts.every(l => cleanFactLine(l)));
});

test("canned output is the same for the same prompt and differs between prompts", () => {
  const a = searchShardPrompt("storm lanterns", { count: 3, angle: SEARCH_ANGLES[0] });
  assert.equal(reply(a), reply(a));
  assert.notEqual(reply(a), reply(searchShardPrompt("sourdough starter", { count: 3, angle: SEARCH_ANGLES[0] })));
  assert.notEqual(reply(a), reply(searchShardPrompt("storm lanterns", { count: 3, angle: SEARCH_ANGLES[0], page: 2 })));
  assert.equal(topicOf("Storm Lanterns — Lanternworks").plural, "lanterns");
});

test("canned pictures are well-formed SVG on the requested canvas, in every medium", () => {
  const drawings = new Set();
  for (const style of Object.keys(MEDIA)) {
    const spec = imageSpec("a storm lantern on a harbour wall", { s: style, bg: "#f7f8fa", fg: "#1a73e8" });
    const svg = reply(imageMessages(spec));
    const [w, h] = SHAPES[spec.shape];
    assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">[\\s\\S]*</svg>$`));
    assert.equal(sanitizeSVG(svg), svg, `${style}: nothing for the sanitizer to strip or repair`);
    drawings.add(svg.replace(/\d+/g, ""));
  }
  assert.ok(drawings.size >= 8, "media are drawn differently");
});

// A page's classes must come from the vocabulary the section writers are given.
const VOCABULARY = new Set([
  ...[...SECTION_CLASSES.matchAll(/\.([a-z][\w-]*)/g)].map(m => m[1]),
  ...[...SECTION_CLASSES.matchAll(/class="([^"]*)"/g)].flatMap(m => m[1].split(" ")),
  "pic", // the section picture (pageSectionPrompt)
]);

async function page(args) {
  const plan = a => planFromAnswers(a, fakeJevAnswers({ state: a, questions }));
  const facts = a => (async function* () { yield* reply(pageFactsPrompt(a)).split("\n"); })();
  const stream = async function* (spec) { yield reply(spec); };
  let html = "";
  for await (const chunk of generatePage(args, { looks: new Map(), planWithJev: async a => plan(a), facts, stream, factsWaitMs: 0 })) html += chunk;
  return html;
}

test("canned sections build whole pages of every kind from the real component vocabulary", async () => {
  const kinds = ["forum", "store", "wiki", "blog", "news", "startup", "gov", "zine"];
  const widgets = {
    store: /data-add-to-cart/, forum: /data-comments/, gov: /form method="post"/,
    zine: /data-toggle/, news: /data-poll/, wiki: /data-quiz/, startup: /data-calc/, blog: /data-comments/,
  };
  for (const kind of kinds) {
    // generatePage throws if any section is incomplete or invalid.
    const html = await page({ url: `https://example-${kind}.test/some-page`, title: "Storm Lanterns", query: "storm lanterns", resultKind: kind });
    const body = html.slice(html.indexOf("<section"), html.lastIndexOf("</section>") + 10);
    assert.equal((body.match(/<section[\s>]/g) ?? []).length, 4, kind);
    assert.equal(sanitizeSection(body), body, `${kind}: nothing unsafe to strip`);
    assert.match(body, widgets[kind], `${kind} gets its interactive components`);
    const used = [...body.matchAll(/class="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/)).filter(Boolean);
    assert.deepEqual(used.filter(c => !VOCABULARY.has(c)), [], `${kind} uses only pre-styled classes`);
  }
  // The page's purpose is honoured: a calculator page opens with a calculator.
  const calc = await page({ url: "https://sunpatch.test/solar-savings-calculator", title: "Solar Savings Calculator", resultKind: "startup" });
  assert.match(calc.slice(calc.indexOf("<section")), /^<section><h2>[^<]*<\/h2><p>[^<]*<\/p><form data-calc>/);
});

test("fake Jev follows the clicked result, the URL's words and a style named in the URL", () => {
  const answer = state => planFromAnswers(state, fakeJevAnswers({ state, questions }));
  assert.equal(answer({ url: "https://a.test/x", resultKind: "gov" }).kind, "gov");
  assert.equal(answer({ url: "https://crumbs.test/forum/t/help" }).kind, "forum");
  const retro = answer({ url: "https://static.test/web1996/issue-12", resultKind: "zine" });
  assert.deepEqual([retro.kind, retro.style], ["zine", "web1996"]);
  const styles = new Set(["a", "b", "c", "d", "e", "f"].map(s => answer({ url: `https://${s}-shop.test/`, resultKind: "store" }).style));
  assert.ok(styles.size >= 3, "sites of one kind still get different styles");
});

test("the fake client streams like OpenRouter, costs nothing and honours max_tokens", async () => {
  const client = fakeClient({ delayMs: 0 });
  const messages = Object.entries(overviewPrompt("storm lanterns")).map(([role, content]) => ({ role, content }));
  const whole = await client.chat.completions.create({ messages, max_tokens: 900 });
  assert.equal(whole.choices[0].finish_reason, "stop");
  assert.equal(whole.usage.cost, 0);
  let text = "";
  let chunks = 0;
  let last;
  for await (const c of await client.chat.completions.create({ messages, max_tokens: 900, stream: true })) {
    text += c.choices[0].delta.content ?? "";
    chunks++;
    last = c;
  }
  assert.equal(text, whole.choices[0].message.content);
  assert.ok(chunks > 5, "arrives in pieces");
  assert.deepEqual([last.choices[0].finish_reason, last.usage.cost], ["stop", 0]);
  const cut = respond({ messages, max_tokens: 10 }, "x".repeat(100));
  assert.deepEqual([cut.choices[0].message.content.length, cut.choices[0].finish_reason], [40, "length"]);

  assert.throws(() => fakeReply("You are a brand-new prompt", "hi"), /no canned output[\s\S]*brand-new prompt/);
  // Comment replies parse with the real reply parser.
  const r = await replyWriter(async spec => reply(spec))({ comment: { page: "/x.test/a", name: "ada", text: "Does the seal matter?" }, context: { title: "Seals" } });
  assert.ok(r.name && r.text);
});

test("record then replay returns the real responses, tolerating a different fact sheet", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "foogle-llm-cache-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const real = { chat: { completions: { create: async req => respond(req, `real answer to ${req.messages[1].content.slice(-12)}`, { delayMs: 0 }) } } };
  const section = facts => ({ model: "m", stream: true, messages: [{ role: "system", content: "You write ONE section" }, { role: "user", content: `Site: x (blog) at x.test\n${facts ? `Fact sheet:\n${facts}\n` : ""}Write section 2 of 4: brief` }] });
  const drain = async res => { let s = ""; for await (const c of res) s += c.choices[0].delta.content ?? ""; return s; };

  const recorder = recordingClient(real, dir);
  const recorded = await drain(await recorder.chat.completions.create(section("A fact")));
  const plain = { model: "m", messages: [{ role: "system", content: "s" }, { role: "user", content: "question one" }] };
  await recorder.chat.completions.create(plain);
  assert.equal((await readdir(dir)).length, 3, "the section is saved under its exact and loose keys");

  const replayer = replayingClient({ chat: { completions: { create: async () => ({ fallback: true }) } } }, dir, (req, text, finish) => respond(req, text, { finish, delayMs: 0 }));
  assert.equal(await drain(await replayer.chat.completions.create(section("A fact"))), recorded);
  assert.equal(await drain(await replayer.chat.completions.create(section("A fact\nAnother fact"))), recorded);
  assert.equal((await replayer.chat.completions.create(plain)).choices[0].message.content, "real answer to question one");
  const unrecorded = { ...plain, messages: [plain.messages[0], { role: "user", content: "question two" }] };
  assert.deepEqual(await replayer.chat.completions.create(unrecorded), { fallback: true });
  assert.notEqual(promptKeys(plain)[0], promptKeys(unrecorded)[0]);

  const body = JSON.stringify({ state: { url: "https://x.test/" }, questions: {} });
  await recordingFetch(async () => Response.json({ answers: { kind: { choice: "wiki" } } }), dir)("https://api.typesafe.ai/v1/systemone", { body });
  const replayJev = replayingFetch(async () => Response.json({ answers: "fallback" }), dir);
  assert.deepEqual(await (await replayJev("u", { body })).json(), { answers: { kind: { choice: "wiki" } } });
  assert.deepEqual(await (await replayJev("u", { body: "{}" })).json(), { answers: "fallback" });
});

test("FOOGLE_FAKE_LLM serves the whole site with no key and no network", async t => {
  // Any network call fails the test: fake mode must never reach OpenRouter or Jev.
  const script = `
    globalThis.fetch = async (url) => { console.log("NETWORK " + url); throw new Error("network in fake mode"); };
    await import("./scripts/start.js");
  `;
  const imageCache = await mkdtemp(path.join(tmpdir(), "foogle-img-"));
  t.after(() => rm(imageCache, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, "--", "--port", "0"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, FOOGLE_FAKE_LLM: "1", FOOGLE_FAKE_LLM_DELAY_MS: "0", OPENROUTER_API_KEY: "", TYPESAFE_API_KEY: "", FOOGLE_IMAGE_CACHE: imageCache },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => { child.kill(); await once(child, "exit"); });
  let output = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start:\n${output}`)), 5000);
    child.stdout.on("data", () => {
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const base = `http://localhost:${port}`;
  const get = async p => { const r = await fetch(base + p); assert.equal(r.status, 200, p); return r.text(); };

  const serp = await get("/search?q=storm+lanterns");
  assert.equal((serp.match(/class="result"/g) ?? []).length, 9);
  assert.match(serp, /<template id="kpt">[\s\S]*People also ask/);
  assert.match(await get("/images?q=storm+lanterns"), /class="tile"/);
  assert.match(await get("/news?q=harbor+festival"), /class="ncard"/);
  assert.match(await get("/maps?q=ramen"), /class="place"/);
  assert.match(await get("/timelines?q=lighthouses"), /class="event/);

  const store = await get("/web/lanternworks.shop/storm-lanterns?fq=storm+lanterns&fk=store");
  assert.doesNotMatch(store, /collapsed mid-construction/);
  const product = store.match(/data-add-to-cart data-name="([^"]+)" data-price="(\d+)"/);
  assert.ok(product, "the store sells something");
  const svg = await fetch(`${base}${store.match(/src="(\/img\/[^"]+)"/)[1].replaceAll("&amp;", "&")}`);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.match(await svg.text(), /^<svg/);

  // Buy it: the cart, the checkout form and the confirmation page all work.
  const cart = await fetch(`${base}/fw/cart`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site: "lanternworks.shop", add: { name: product[1], price: product[2] } }) });
  const cookie = cart.headers.get("set-cookie").split(";")[0];
  const order = await fetch(`${base}/web/lanternworks.shop/checkout`, { method: "POST", redirect: "manual", headers: { cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: "_intent=checkout&name=Ada&email=ada%40example.com" });
  const receipt = await (await fetch(base + order.headers.get("location"), { headers: { cookie } })).text();
  assert.match(receipt, /Order #\d+ confirmed/);
  assert.ok(receipt.includes(product[1]));
  assert.doesNotMatch(receipt, /collapsed mid-construction/);

  // A comment gets a reply from someone on the site.
  const page = "/lanternworks.shop/storm-lanterns";
  await fetch(`${base}/fw/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page, name: "ada", text: "Is the seal replaceable?" }) });
  let comments = [];
  for (let i = 0; i < 50 && comments.length < 2; i++) {
    await new Promise(r => setTimeout(r, 20));
    comments = (await (await fetch(`${base}/fw/comments?page=${encodeURIComponent(page)}`)).json()).comments;
  }
  assert.equal(comments.filter(c => c.bot).length, 1);

  assert.doesNotMatch(output, /NETWORK|\[jev\]/, "no network calls, and Jev (faked) planned every page");
  assert.match(output, /model: {4}foogle\/fake-llm/);
});
