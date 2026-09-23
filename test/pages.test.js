import test from "node:test";
import assert from "node:assert/strict";
import { planFromAnswers, jevPlan, titleFromURL, defaultPlan } from "../lib/jev.js";
import { STYLE_KEYS } from "../lib/styles.js";
import { blockEnd, generatePage, cleanSection, cleanFactLine, paintPictures, salvageSection } from "../lib/pages.js";
import { TruncatedError, DroppedError } from "../lib/llm.js";
import { sketchFor } from "../lib/images.js";

const args = { url: "https://garden.example/repairs", title: "Gardeners", snippet: "Repairs for greenhouses" };
const plan = planFromAnswers(args, { kind: { choice: "forum" }, style: { choice: "phpbb" } });
const noFacts = async function* () {};

test("Jev plans preserve context and use a stable domain palette", () => {
  assert.equal(plan.kind, "forum");
  assert.ok(plan.secs.every(s => s.includes(args.snippet)));
  assert.equal(plan.hue, planFromAnswers({ ...args, url: "https://garden.example/other" }, { kind: { choice: "store" }, style: { choice: "saas" } }).hue);
  assert.throws(() => planFromAnswers(args, { kind: { choice: "invalid" } }), /Invalid Jev/);
});

test("Jev pages are named by their domain; the clicked result titles the page, not the site", () => {
  assert.equal(plan.site, "garden.example");
  assert.equal(plan.title, "Gardeners");
  const inner = planFromAnswers({ url: "https://garden.example/field-notes/fog-signals" }, { kind: { choice: "blog" }, style: { choice: "editorial" } });
  assert.equal(inner.title, "Fog Signals");
  assert.equal(inner.tag, "");
  assert.equal(titleFromURL("https://shop.example/search?q=brass+lamps"), "Search — “brass lamps”");
});

test("Jev sends the documented request and rejects provider failures", async () => {
  let sent;
  const actual = await jevPlan(args, { apiKey: "test", fetchImpl: async (url, init) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    sent = JSON.parse(init.body);
    // One yes/no rating per style; phpbb is the only plausible one here.
    const ratings = Object.fromEntries(STYLE_KEYS.map((k) => [`style_${k}`, { type: "noul", noul: k === "phpbb" ? 0.9 : 0.1 }]));
    return { ok: true, json: async () => ({ answers: { kind: { choice: "forum" }, ...ratings } }) };
  } });
  assert.deepEqual(actual, plan);
  assert.equal(sent.model, "jev-latest");
  assert.deepEqual(Object.keys(sent.questions), ["kind", ...STYLE_KEYS.map((k) => `style_${k}`), "real_site"]);
  assert.ok(Object.values(sent.questions).slice(1).every((q) => q.type === "noul"));
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
  const planWithJev = async (a) => { jevCalls++; return planFromAnswers(a, { kind: { choice: "zine" }, style: { choice: "cyber" } }); };
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

test("section pictures get the site palette, medium and sketch, and a half-written picture is never streamed", async () => {
  assert.match(paintPictures('<img class="pic" src="/img/brass%20lamp" alt="">', plan), /src="\/img\/brass%20lamp\?s=\w+&amp;a=landscape&amp;bg=[^&"]+&amp;fg=[^&"]+" style="background:radial-gradient\([^"]*\)" alt="">$/);
  assert.match(paintPictures('<img src="/img/brass lamp">', plan), /src="\/img\/brass%20lamp\?/);
  // The sketch is the one /img will draw for the src, and goes under the
  // model's own style, so a background the model chose wins.
  const src = paintPictures('<img src="/img/brass%20lamp">', plan).match(/src="\/img\/brass%20lamp\?([^"]*)"/)[1].replaceAll("&amp;", "&");
  const sketch = sketchFor("brass lamp", src);
  assert.match(paintPictures('<img style="width:50%" class="pic" src="/img/brass%20lamp">', plan), new RegExp(`^<img style="background:${sketch.replace(/[()]/g, "\\$&")};width:50%" class="pic" src=`));
  assert.match(paintPictures(`<img src="/img/x" style='border:0'>`, plan), /style='background:radial-gradient\([^']*\);border:0'>$/);
  assert.match(paintPictures('<img src="/img/x?s=blueprint&amp;a=tall">', plan), /^<img src="\/img\/x\?s=blueprint&amp;a=tall" style="background:[^"]*linear-gradient\(#1f4f8f, #163a6a\)">$/);
  // Never a second style attribute, and nothing for pictures from elsewhere.
  assert.equal(paintPictures('<img src="/img/x?s=photo" style=width:9px>', plan), '<img src="/img/x?s=photo" style=width:9px>');
  assert.equal(paintPictures('<img src="/fw/logo.svg" alt="">', plan), '<img src="/fw/logo.svg" alt="">');
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
  push('%20lamp" alt="lamp');
  await new Promise(resolve => setImmediate(resolve));
  push('"></section>');
  await new Promise(resolve => setImmediate(resolve));
  push(null);
  assert.match((await rest).value, /^<img class="pic" src="\/img\/brass%20lamp\?s=\w+&amp;a=landscape&amp;bg=[^"]*" style="background:radial-gradient\([^"]*\)" alt="lamp">/);
});

test("the hero's invented counts defer to ones the page already states", async () => {
  const forum = planFromAnswers({ url: "https://breadheads.net/t/grey", title: "My starter went grey", snippet: "Day 9, grey liquid on top. 31 replies." }, { kind: { choice: "forum" }, style: { choice: "phpbb" } });
  const specs = [];
  const chunks = [];
  for await (const c of generatePage({ url: "https://breadheads.net/t/grey" }, { looks: new Map(), facts: noFacts, planWithJev: async () => forum, complete: async (spec) => { specs.push(spec); return "<section>x</section>"; } })) chunks.push(c);
  assert.match(chunks[0], /· 31 replies ·/);
  assert.ok(specs.every(s => s.user.includes("31 replies so far")));
});

test("store pages name their products only in sections that have the fact sheet", async () => {
  const store = planFromAnswers({ url: "https://lumenloom.example/lamps", title: "Desk Lamps" }, { kind: { choice: "store" }, style: { choice: "phpbb" } });
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

test("a section is done at its closing tag: a model that runs on can't hold up or fail the page", { timeout: 5000 }, async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let drained = 0;
  const stream = () => (async function* () {
    yield "<section><h2>A</h2><p>ok</p></sec";
    yield "tion>";
    await gate; // the model is still writing
    yield "\n \n \n<style>section{}</style><section>again</section>";
    drained++;
    throw new TruncatedError();
  })();
  const chunks = [];
  for await (const c of generatePage(args, { looks: new Map(), facts: noFacts, planWithJev: async () => plan, stream })) chunks.push(c);
  const html = chunks.join("");
  assert.equal((html.match(/<section><h2>A<\/h2><p>ok<\/p><\/section>/g) ?? []).length, 4);
  assert.match(html, /<\/html>$/);
  assert.doesNotMatch(html, /<style>section|again/);
  // The rest of each reply is still read, so its cost is counted, and its error goes nowhere.
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, 4);
});

test("a section cut off by the token limit keeps its whole blocks and is closed there", async () => {
  assert.equal(salvageSection('<section><h2>T</h2><div class="grid"><div class="card"><h3>A</h3></div><div class="card"><h3>B'), '<section><h2>T</h2><div class="grid"><div class="card"><h3>A</h3></div></div></section>');
  assert.equal(salvageSection("<section><h2>T</h2><table><tbody><tr><td>1</td></tr><tr><td>2"), "<section><h2>T</h2><table><tbody><tr><td>1</td></tr></tbody></table></section>");
  assert.equal(salvageSection('<section><h2>T</h2><form data-calc><label>Bill'), ""); // only the heading was whole
  // Live or finished in the background, the page ends up the same and is complete.
  const cut = ['<section><h2>First</h2><p>one</p></section>', '<section><h2>T</h2><p>kept</p><ul><li>a</li><li>b', '<section><h2>T</h2><p>kept</p><ul><li>a</li><li>b'];
  const stream = (spec) => (async function* () {
    const i = Number(spec.user.match(/Write section (\d)/)[1]) - 1;
    yield cut[i] ?? "<section><p>last</p></section>";
    if (cut[i] && !cut[i].endsWith("</section>")) throw new TruncatedError();
  })();
  const chunks = [];
  for await (const c of generatePage(args, { looks: new Map(), facts: noFacts, planWithJev: async () => plan, stream })) chunks.push(c);
  const html = chunks.join("");
  assert.equal((html.match(/<section><h2>T<\/h2><p>kept<\/p><ul><li>a<\/li><\/ul><\/section>/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<li>b/);
  assert.match(html, /<p>last<\/p><\/section>[\s\S]*<\/html>$/);
});

// OpenRouter ends a stream early now and then ("Stream ended before a terminal response event").
const dropped = () => new DroppedError(new Error("Stream ended before a terminal response event"));
const sectionOf = (spec) => Number(spec.user.match(/Write section (\d)/)[1]) - 1;

test("a section whose stream drops keeps its whole blocks, live or in the background", async () => {
  const cut = ["<section><h2>First</h2><p>one</p><p>tw", '<section><h2>T</h2><p>kept</p><ul><li>a</li><li>b', '<section><h2>T</h2><p>kept</p><ul><li>a</li><li>b'];
  const calls = [];
  const stream = (spec) => (async function* () {
    const i = sectionOf(spec);
    calls.push(i);
    yield cut[i] ?? "<section><p>last</p></section>";
    if (cut[i]) throw dropped();
  })();
  const chunks = [];
  for await (const c of generatePage(args, { looks: new Map(), facts: noFacts, planWithJev: async () => plan, stream })) chunks.push(c);
  const html = chunks.join("");
  assert.match(html, /<section><h2>First<\/h2><p>one<\/p><\/section>/);
  assert.equal((html.match(/<section><h2>T<\/h2><p>kept<\/p><ul><li>a<\/li><\/ul><\/section>/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<p>tw|<li>b/);
  assert.match(html, /<p>last<\/p><\/section>[\s\S]*<\/html>$/);
  assert.equal(calls.length, 4); // they had whole blocks to keep, so none was written again
});

test("a section whose stream drops before anything but its heading is whole is written once more", async () => {
  const attempts = [0, 0, 0, 0];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const stream = (spec) => (async function* () {
    const i = sectionOf(spec);
    const n = ++attempts[i];
    if (i === 0 && n === 1) { yield "<section><h2>Live</h2>"; await gate; yield "<p>half"; throw dropped(); }
    // The live section's heading is already on the page: the new reply carries on after it.
    if (i === 0) { yield "```html\n<section><h2>Again</h2><p>who"; yield "le</p>"; yield "<p>more</p></section>"; return; }
    if (i === 1 && n === 1) { yield "<section><h2>Ear"; throw dropped(); }
    yield `<section><h2>S${i + 1}</h2><p>try ${n}</p></section>`;
  })();
  const gen = generatePage(args, { looks: new Map(), facts: noFacts, planWithJev: async () => plan, stream });
  await gen.next(); // shell
  const chunks = [(await gen.next()).value];
  assert.equal(chunks[0], "<section><h2>Live</h2>"); // shown before its stream dropped
  release();
  for await (const c of gen) chunks.push(c);
  const html = chunks.join("");
  assert.match(html, /^<section><h2>Live<\/h2><p>whole<\/p><p>more<\/p><\/section><section><h2>S2<\/h2><p>try 2<\/p><\/section><section><h2>S3<\/h2><p>try 1<\/p><\/section>/);
  assert.doesNotMatch(html, /Again|half|Ear/);
  assert.match(html, /<\/html>$/);
  assert.deepEqual(attempts, [2, 2, 1, 1]);
});

test("a section is written again only once: a second early drop fails the page", async () => {
  let calls = 0;
  const stream = () => (async function* () { calls++; yield "<section><h2>Gone"; throw dropped(); })();
  await assert.rejects(async () => {
    for await (const _ of generatePage(args, { looks: new Map(), facts: noFacts, planWithJev: async () => ({ ...plan, secs: plan.secs.slice(0, 1) }), stream })) { /* exhaust */ }
  }, /Stream dropped mid-reply: Stream ended before a terminal response event/);
  assert.equal(calls, 2);
});

test("a truncated section with nothing whole but its heading still fails the page", async () => {
  const stream = () => (async function* () { yield '<section><h2>Estimate</h2><form data-calc><label>Bill <input name="bill">'; throw new TruncatedError(); })();
  await assert.rejects(async () => {
    for await (const _ of generatePage(args, { looks: new Map(), facts: noFacts, planWithJev: async () => ({ ...plan, secs: plan.secs.slice(0, 1) }), stream })) { /* exhaust */ }
  }, /token limit/);
});
