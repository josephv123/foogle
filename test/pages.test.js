import test from "node:test";
import assert from "node:assert/strict";
import { planFromAnswers, jevPlan, titleFromURL, defaultPlan } from "../lib/jev.js";
import { blockEnd, generatePage, cleanSection, cleanFactLine, paintPictures } from "../lib/pages.js";

const args = { url: "https://garden.example/repairs", title: "Gardeners", snippet: "Repairs for greenhouses" };
const plan = planFromAnswers(args, { kind: { choice: "forum" }, mood: { choice: "light" } });
const noFacts = async function* () {};

test("Jev plans preserve context and use a stable domain palette", () => {
  assert.equal(plan.kind, "forum");
  assert.ok(plan.secs.every(s => s.includes(args.snippet)));
  assert.equal(plan.hue, planFromAnswers({ ...args, url: "https://garden.example/other" }, { kind: { choice: "store" }, mood: { choice: "dark" } }).hue);
  assert.throws(() => planFromAnswers(args, { kind: { choice: "invalid" } }), /Invalid Jev/);
});

test("Jev pages are named by their domain; the clicked result titles the page, not the site", () => {
  assert.equal(plan.site, "garden.example");
  assert.equal(plan.title, "Gardeners");
  const inner = planFromAnswers({ url: "https://garden.example/field-notes/fog-signals" }, { kind: { choice: "blog" }, mood: { choice: "paper" } });
  assert.equal(inner.title, "Fog Signals");
  assert.equal(inner.tag, "");
  assert.equal(titleFromURL("https://shop.example/search?q=brass+lamps"), "Search — “brass lamps”");
});

test("Jev sends the documented request and rejects provider failures", async () => {
  let sent;
  const actual = await jevPlan(args, { apiKey: "test", fetchImpl: async (url, init) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ answers: { kind: { choice: "forum" }, mood: { choice: "light" } } }) };
  } });
  assert.deepEqual(actual, plan);
  assert.equal(sent.model, "jev-latest");
  assert.deepEqual(Object.keys(sent.questions), ["kind", "mood"]);
  await assert.rejects(jevPlan(args, { apiKey: "test", fetchImpl: async () => ({ ok: false, status: 429 }) }), /Jev HTTP 429/);
});

test("styled shell is emitted before section requests; concurrent completions retain document order", async () => {
  const resolvers = [];
  const gen = generatePage(args, { looks: new Map(), facts: noFacts, planWithJev: async () => plan, complete: () => new Promise(resolve => resolvers.push(resolve)) });
  const first = await gen.next();
  assert.match(first.value, /<style>/);
  assert.match(first.value, /Gardeners/);
  assert.equal(resolvers.length, 0);
  const second = gen.next();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolvers.length, 4);
  resolvers[3]("<section>fourth</section>");
  resolvers[2]("<section>third</section>");
  resolvers[1]("<section>second</section>");
  resolvers[0]("<section>first</section>");
  assert.equal((await second).value, "<section>first</section>");
  assert.equal((await gen.next()).value, "<section>second</section>");
  assert.equal((await gen.next()).value, "<section>third</section>");
  assert.equal((await gen.next()).value, "<section>fourth</section>");
  assert.match((await gen.next()).value, /<\/html>$/);
  assert.equal((await gen.next()).done, true);
});

test("the section being written streams live, minus any code fence around it", async () => {
  const streams = [];
  const stream = () => (async function* () {
    const s = { push: null, queue: [] };
    streams.push(s);
    for (;;) {
      const next = s.queue.length ? s.queue.shift() : await new Promise(resolve => { s.push = resolve; });
      if (next === null) return;
      yield next;
    }
  })();
  const send = (i, text) => { const s = streams[i]; if (s.push) { const p = s.push; s.push = null; p(text); } else s.queue.push(text); };
  const gen = generatePage(args, { looks: new Map(), facts: noFacts, planWithJev: async () => plan, stream });
  await gen.next(); // shell
  const pending = gen.next();
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 1; i < streams.length; i++) { send(i, `<section>later ${i}</section>`); send(i, null); }
  send(0, "```html\n<section><h2>Live</h2>");
  assert.equal((await pending).value, "<section><h2>Live</h2>"); // visible before the section ends
  send(0, "<p>more</p></section>\n```");
  send(0, null);
  assert.equal((await gen.next()).value.trim(), "<p>more</p></section>");
  assert.equal((await gen.next()).value, "<section>later 1</section>");
});

test("Jev failure falls back to a default layout from the clicked result's kind", async () => {
  const chunks = [];
  for await (const c of generatePage({ ...args, resultKind: "store" }, { looks: new Map(), facts: noFacts, planWithJev: async () => { throw new Error("timeout"); }, complete: async () => "<section>content</section>" })) chunks.push(c);
  assert.match(chunks.join(""), /<\/html>$/);
  assert.equal(defaultPlan({ ...args, resultKind: "store" }).kind, "store");
  assert.equal(defaultPlan({ ...args, resultKind: "video" }).kind, "blog");
});

test("later pages on a site reuse its first page's look without re-planning", async () => {
  const looks = new Map();
  let jevCalls = 0;
  const planWithJev = async (a) => { jevCalls++; return planFromAnswers(a, { kind: { choice: "zine" }, mood: { choice: "neon" } }); };
  const run = async (url) => {
    const chunks = [];
    for await (const c of generatePage({ url }, { looks, facts: noFacts, planWithJev, complete: async () => "<section>x</section>" })) chunks.push(c);
    return chunks[0];
  };
  const first = await run("https://garden.example/");
  const second = await run("https://garden.example/archive");
  assert.equal(jevCalls, 1);
  assert.equal(first.match(/<style>[\s\S]*?<\/style>/)[0], second.match(/<style>[\s\S]*?<\/style>/)[0]);
  assert.match(second, /<h1>Archive<\/h1>/);
});

test("the fact sheet streams alongside planning; the first section never waits for it", async () => {
  const order = [];
  let release;
  const facts = async function* () {
    order.push("facts");
    yield "Keeper: Elias Venn, 78";
    await new Promise(resolve => { release = resolve; });
    yield "Trenchline 300: $8,450";
  };
  const planWithJev = async () => { order.push("plan"); return plan; };
  const specs = [];
  const gen = generatePage(args, { looks: new Map(), planWithJev, facts, factsWaitMs: 5000, complete: async (spec) => { specs.push(spec); return "<section>x</section>"; } });
  const first = await gen.next(); // the shell does not wait for the fact sheet
  assert.deepEqual(order, ["facts", "plan"]);
  const next = gen.next();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(specs.length, 1); // section 1 is already being written…
  assert.ok(!specs[0].user.includes("Elias Venn")); // …with only the header's facts
  release();
  await next;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(specs.length, 4);
  assert.ok(specs.slice(1).every(s => s.user.includes("Keeper: Elias Venn, 78\nTrenchline 300: $8,450")));
  // The hero's invented byline reaches every writer, exactly as displayed.
  const starter = first.value.match(/Started by <b>(\w+)<\/b>/)[1];
  assert.ok(specs.every(s => s.user.includes(`Thread started by ${starter}`)));
  // Only the middle sections may carry a picture.
  assert.deepEqual(specs.map(s => s.system.includes('class="pic"')), [false, true, true, false]);
});

test("later sections wait only briefly, then take the fact lines that have arrived", async () => {
  const specs = [];
  const facts = async function* () { yield "Keeper: Elias Venn, 78"; await new Promise(() => {}); };
  const started = Date.now();
  for await (const _ of generatePage(args, { looks: new Map(), planWithJev: async () => plan, facts, factsWaitMs: 30, complete: async (spec) => { specs.push(spec); return "<section>x</section>"; } })) { /* exhaust */ }
  assert.ok(Date.now() - started < 1000);
  assert.ok(specs.slice(1).every(s => s.user.includes("Elias Venn")));
});

test("a failed fact sheet never blocks the page", async () => {
  const chunks = [];
  const facts = async function* () { throw new Error("provider down"); };
  for await (const c of generatePage(args, { looks: new Map(), planWithJev: async () => plan, facts, complete: async (spec) => { assert.match(spec.user, /Fact sheet:\nThread started by \w+ on .* \(shown in the page header\)\n(?:.* \(shown in the page header\)\n)*Write section/); return "<section>x</section>"; } })) chunks.push(c);
  assert.match(chunks.join(""), /<\/html>$/);
  assert.equal(cleanFactLine("- Keeper: Elias Venn"), "Keeper: Elias Venn");
  assert.equal(cleanFactLine("2. Lantern lit 1871"), "Lantern lit 1871");
  assert.equal(cleanFactLine("```"), null);
});

test("section pictures get the site palette and medium, and a half-written picture src is never streamed", async () => {
  assert.match(paintPictures('<img class="pic" src="/img/brass%20lamp" alt="">', plan), /src="\/img\/brass%20lamp\?s=\w+&amp;a=landscape&amp;bg=[^&"]+&amp;fg=[^&"]+"/);
  assert.match(paintPictures('<img src="/img/brass lamp">', plan), /src="\/img\/brass%20lamp\?/);
  let push;
  const stream = () => (async function* () { for (;;) { const t = await new Promise(r => { push = r; }); if (t === null) return; yield t; } })();
  const gen = generatePage(args, { looks: new Map(), facts: noFacts, planWithJev: async () => ({ ...plan, secs: plan.secs.slice(0, 1) }), stream });
  await gen.next();
  const first = gen.next();
  await new Promise(resolve => setImmediate(resolve));
  push('<section><h2>Lamps</h2><img class="pic" src="/img/brass');
  assert.equal((await first).value, '<section><h2>Lamps</h2>'); // whole blocks only: the picture waits
  const rest = gen.next();
  await new Promise(resolve => setImmediate(resolve));
  push('%20lamp" alt=""></section>');
  await new Promise(resolve => setImmediate(resolve));
  push(null);
  assert.match((await rest).value, /^<img class="pic" src="\/img\/brass%20lamp\?s=\w+&amp;a=landscape&amp;bg=/);
});

test("the hero's invented counts defer to ones the page already states", async () => {
  const forum = planFromAnswers({ url: "https://breadheads.net/t/grey", title: "My starter went grey", snippet: "Day 9, grey liquid on top. 31 replies." }, { kind: { choice: "forum" }, mood: { choice: "light" } });
  const specs = [];
  const chunks = [];
  for await (const c of generatePage({ url: "https://breadheads.net/t/grey" }, { looks: new Map(), facts: noFacts, planWithJev: async () => forum, complete: async (spec) => { specs.push(spec); return "<section>x</section>"; } })) chunks.push(c);
  assert.match(chunks[0], /· 31 replies ·/);
  assert.ok(specs.every(s => s.user.includes("31 replies so far")));
});

test("store pages name their products only in sections that have the fact sheet", async () => {
  const store = planFromAnswers({ url: "https://lumenloom.example/lamps", title: "Desk Lamps" }, { kind: { choice: "store" }, mood: { choice: "light" } });
  const specs = [];
  const facts = async function* () { yield "Products: Weft 1 desk lamp $89; Warp 2 floor lamp $149"; };
  for await (const _ of generatePage({ url: "https://lumenloom.example/lamps" }, { looks: new Map(), facts, planWithJev: async () => store, complete: async (spec) => { specs.push(spec); return "<section>x</section>"; } })) { /* exhaust */ }
  const brief = (s) => s.user.match(/Write section \d of \d: ([^\n]*)/)[1];
  assert.match(brief(specs[0]), /Name no individual products/); // written before the sheet arrives
  assert.ok(!specs[0].user.includes("Weft 1"));
  assert.match(brief(specs[1]), /^Featured products/); // the lineup comes from the sheet
  assert.ok(specs.slice(1).every(s => s.user.includes("Weft 1 desk lamp $89")));
});

test("invalid sections fail the generation rather than being silently cached", async () => {
  assert.throws(() => cleanSection("<section>truncated"), /incomplete/);
  assert.throws(() => cleanSection("<section><script>bad()</script></section>"), /invalid/);
  assert.equal(cleanSection("```html\n<section>ok</section>\n```"), "<section>ok</section>");
  await assert.rejects(async () => {
    for await (const _ of generatePage(args, { looks: new Map(), facts: noFacts, planWithJev: async () => plan, complete: async () => "<section>truncated" })) { /* exhaust */ }
  }, /incomplete/);
});

test("live sections are cut only after whole blocks: a paragraph, a card, a table row, a post", () => {
  const cut = (html) => html.slice(0, blockEnd(html));
  assert.equal(cut('<section><h2>T</h2><p>one <b>two</b> thr'), "<section><h2>T</h2>");
  assert.equal(cut('<section><div class="grid"><div class="card"><h3>A</h3></div><div class="card"><h3>B'), '<section><div class="grid"><div class="card"><h3>A</h3></div>');
  assert.equal(cut("<section><table><tbody><tr><td>1</td></tr><tr><td>2"), "<section><table><tbody><tr><td>1</td></tr>");
  assert.equal(cut('<section><div class="post"><div class="who"><b>u</b></div><p>hi'), ""); // nothing until the post is whole
});

test("anything a model writes after its section closes never reaches the page", async () => {
  const chunks = [];
  const junk = "<section><h2>A</h2><p>ok</p></section>\nNeed 80-150 words. Current ~100!<section><h2>A</h2><p>again</p></section>";
  for await (const c of generatePage(args, { looks: new Map(), facts: async function* () {}, planWithJev: async () => ({ ...plan, secs: plan.secs.slice(0, 1) }), complete: async () => junk })) chunks.push(c);
  const html = chunks.join("");
  assert.match(html, /<p>ok<\/p><\/section>/);
  assert.doesNotMatch(html, /Need 80|again/);
});
