import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  calc, evaluate, units, exchange, convertUnit, unitFormula, stockSeries, fxSeries, findUnit, rangeLabels,
} from "../public/fw/answers.js";
import { createAnswers, byCode, cityTime, decide, checkFix, NORMALIZE, CARD_P, TYPO_P } from "../lib/answers.js";
import { RENDER, didYouMean } from "../lib/answer-cards.js";
import { answerPrompt, spellPrompt } from "../lib/prompts.js";
import { searchQuestions } from "../lib/jev.js";
import { fakeReply, fakeJevAnswers } from "../lib/fake-fixtures.js";
import { ACTION_USD } from "../lib/limits.js";

const now = new Date("2026-09-23T14:05:00Z"); // a Wednesday; New York's market is open
const ctx = (query) => ({ query, now });
const card = (type, raw, query = "q") => RENDER[type](NORMALIZE[type](raw, ctx(query)), query);

test("the calculator is code: real arithmetic from the words people type", () => {
  const value = (q) => calc(q)?.value;
  assert.equal(value("17% of 2340"), 397.8);
  assert.equal(value("what is 15 times 3"), 45);
  assert.equal(Math.round(value("100 + 10%") * 1e9) / 1e9, 110); // a pocket calculator's percent
  assert.equal(value("(4+5)*3"), 27);
  assert.equal(value("2^10"), 1024);
  assert.equal(value("5!"), 120);
  assert.equal(value("1,234 * 2"), 2468);
  assert.equal(value("10 mod 3"), 1);
  assert.ok(Math.abs(value("2pi") - 2 * Math.PI) < 1e-12);
  assert.ok(Math.abs(value("sin(30°)") - 0.5) < 1e-12);
  assert.ok(Math.abs(value("sqrt 2") - Math.SQRT2) < 1e-12);
  assert.equal(value("2 plus 2 equals"), 4);
  // Numbers with nothing done to them, and words, are not sums.
  for (const q of ["2048", "pi", "weather tokyo", "storm lanterns", "flight UA 902"]) assert.equal(calc(q), null, q);
  // The keypad's own expressions: degrees, Ans, an unclosed parenthesis.
  assert.equal(evaluate("sin(90", { deg: true }).value, 1);
  assert.equal(evaluate("ans*2", { ans: 21 }).value, 42);
  assert.throws(() => evaluate("2 + alert(1)"));
});

test("unit and currency conversions are parsed and computed by code", () => {
  assert.deepEqual(units("5 miles in km"), { value: 5, cat: "length", from: "mile", to: "kilometer" });
  assert.ok(Math.abs(convertUnit(5, "length", "mile", "kilometer") - 8.04672) < 1e-12);
  assert.ok(Math.abs(convertUnit(350, "temperature", "fahrenheit", "celsius") - 176.6667) < 1e-4);
  assert.deepEqual(units("how many cups in a liter"), { value: 1, cat: "volume", from: "liter", to: "us-cup" });
  assert.deepEqual(units("5 in in cm"), { value: 5, cat: "length", from: "inch", to: "centimeter" });
  assert.equal(unitFormula("length", "mile", "kilometer"), "multiply the length value by 1.609");
  assert.equal(unitFormula("temperature", "fahrenheit", "celsius", 350), "(350°F − 32) × 5/9 = 176.667°C");
  assert.equal(findUnit("ton")[1], "us-ton"); // not the tonne
  // Pounds can be money or weight; the other side decides.
  assert.equal(units("10 pounds to euros"), null);
  assert.deepEqual(exchange("10 pounds to euros"), { amount: 10, from: "GBP", to: "EUR" });
  assert.deepEqual(exchange("$100 to eur"), { amount: 100, from: "USD", to: "EUR" });
  assert.deepEqual(exchange("10k yen to usd"), { amount: 10000, from: "JPY", to: "USD" });
  assert.equal(exchange("time in lagos"), null);
});

test("code answers what it can alone, and without Jev shows only what it is sure of", () => {
  assert.equal(byCode("17% of 2340").type, "calculator");
  assert.equal(byCode("5 miles in km").type, "units");
  assert.equal(byCode("100 usd to eur").type, "currency");
  assert.deepEqual(cityTime("time in lagos"), { tz: "Africa/Lagos", place: "Lagos, Nigeria", utcOffset: null });
  assert.equal(cityTime("what time is it in tokyo?").tz, "Asia/Tokyo");
  assert.equal(cityTime("neo tokyo time"), null);
  assert.equal(byCode("storm lanterns"), null);

  const jev = (type, p = 1) => ({ type, p, typo: 0 });
  assert.equal(decide(jev("weather"), null), "weather");
  assert.equal(decide(jev("none"), byCode("7-11")), null, "Jev vetoes 7-Eleven as a sum");
  assert.equal(decide(jev("weather", CARD_P - 0.1), null), null, "an unsure classifier shows nothing");
  assert.equal(decide(jev("units"), byCode("10 pounds to euros")), "currency", "the parse settles units against money");
  assert.equal(decide(null, byCode("17% of 2340")), "calculator");
  assert.equal(decide(null, byCode("7-11")), null, "without Jev, a bare a-b isn't shown");
  assert.equal(decide(null, null), null);
});

test("weather: the model's numbers are made consistent before they are drawn", () => {
  const raw = {
    place: "Olympus Mons Colony, Mars", tz: "Mars/Olympus", utcOffset: 0, unit: "C",
    now: { temp: -20, cond: "Dusty haze", precip: 0, humidity: 3, wind: 40 },
    days: Array.from({ length: 8 }, (_, i) => ({ hi: -30 - i, lo: -70, cond: i % 2 ? "dust storm" : "clear", precip: 0, wind: 30 + i })),
  };
  const d = NORMALIZE.weather(raw, ctx("weather olympus mons colony"));
  assert.equal(d.days.length, 8);
  assert.ok(d.days[0].lo <= d.now.temp && d.now.temp <= d.days[0].hi, "now lies inside today's range");
  assert.equal(d.now.cond, "dust storm", "free-text conditions map onto the icon set");
  assert.equal(d.days[0].name, "Wednesday");
  assert.equal(d.days[1].short, "Thu");
  for (const day of d.days) {
    assert.equal(day.hours.temp.length, 8);
    assert.ok(day.hours.temp.every((t) => t >= day.lo - 1 && t <= day.hi + 1 || day === d.days[0]));
  }
  assert.equal(d.days[0].hours.temp[0], -20, "today's chart starts at the current temperature");
  assert.equal(d.days[0].hours.time[0], "2 PM");
  const html = RENDER.weather(d, "weather olympus mons colony");
  assert.match(html, /data-ia="weather"/);
  assert.match(html, /Results for <b>Olympus Mons Colony, Mars<\/b>/);
  assert.equal((html.match(/class="ia-wx-day"/g) ?? []).length, 8);
  assert.throws(() => NORMALIZE.weather({ place: "x", now: {}, days: [] }, ctx("x")), /missing/);
});

test("stocks and currencies: the chart passes through the numbers the card states", () => {
  const d = NORMALIZE.stock({
    name: "Zyntraxis Corp", ticker: "ZTXS", exchange: "NEOX", currency: "USD", price: 212.5, prevClose: 204.1, mktCap: "88.4B", pe: 41.2, divYield: null,
    hist: { d5: 199, m1: 180, m6: 140, ytd: 150, y1: 96, y5: null },
  }, ctx("zyntraxis corp stock"));
  const day = d.ranges["1D"].pts;
  assert.ok(Math.abs(day.at(-1) - 212.5) < 1e-9, "today's line ends at the price");
  assert.ok(day.length < 79, "mid-session, the day's chart is still being drawn");
  assert.ok(d.high >= 212.5 && d.low <= 212.5 && d.high52 >= d.high && d.low52 <= d.low);
  assert.ok(Math.abs(d.ranges["1Y"].pts[0] - 96) < 1e-9, "a year ago is last year's close");
  assert.equal(d.ranges["5Y"], undefined, "no five-year chart for a young listing");
  assert.match(d.stamp, /Sep 23, 10:05 AM EDT/);
  // The browser recomputes the same series from the card's data.
  assert.deepEqual(stockSeries(d.series).ranges["1M"].pts, d.ranges["1M"].pts);
  const html = RENDER.stock(d, "zyntraxis corp stock");
  assert.match(html, /\+8\.40 \(4\.12%\) ↑ today/);
  assert.match(html, /NEOX: ZTXS/);
  assert.deepEqual(rangeLabels(d.ranges["1Y"], d.today).map(([, t]) => t), ["Jan", "Apr", "Jul"]);

  const fx = NORMALIZE.currency({ amount: 500, from: { code: "LCR", name: "lunar credit", perUSD: 2.3 }, to: { code: "USD" } }, ctx("500 lunar credits in usd"));
  assert.ok(Math.abs(fx.rate - 1 / 2.3) < 1e-12);
  assert.deepEqual(fx.extra[0].slice(0, 4), ["LCR", "Lunar credit", "LCR", 2.3]);
  assert.ok(Math.abs(fx.series["1M"].pts.at(-1) - fx.rate) < 1e-12);
  assert.deepEqual(fxSeries({ seed: "LCR>USD|2026-09-23", rate: fx.rate, vol: 0.03 })["1Y"].pts, fx.series["1Y"].pts);
  assert.match(RENDER.currency(fx), /217\.39<\/span> <span>United States Dollar/);
  assert.throws(() => NORMALIZE.currency({ from: { code: "ZZQ" }, to: { code: "USD" } }, ctx("x")), /rate/);
});

test("sports, flights, words and clocks are checked against themselves", () => {
  const s = NORMALIZE.sports({
    team: "Los Angeles Lakers", league: "NBA", sport: "basketball", standing: "7th in West", color: "#552583",
    last: { date: "Sun, May 3", status: "Final", home: { name: "Lakers", abbr: "LAL", color: "#552583", periods: [28, 31, 22, 25, 9] }, away: { name: "Warriors", abbr: "GSW", color: "#FFC72C", periods: [30, 20, 30, 26, 5], homeScore: 999 } },
    next: [{ date: "Tue, Sep 22", opp: "Utah Jazz" }, { date: "Tue, Oct 20", time: "7:30 PM", opp: "Golden State Warriors", home: false }, { date: "Sat, Jan 9", opp: "Phoenix Suns" }],
    standings: [{ team: "Warriors", w: 40, l: 42 }, { team: "Los Angeles Lakers", w: 50, l: 32 }],
  }, ctx("lakers score"));
  assert.deepEqual(s.next.map((x) => x.opp), ["Golden State Warriors", "Phoenix Suns"], "yesterday's game isn't upcoming; January is next year");
  assert.deepEqual([s.last.home.score, s.last.away.score], [115, 111], "scores are the sum of the periods");
  assert.deepEqual(s.last.labels, ["1", "2", "3", "4", "OT"]);
  assert.equal(s.last.status, "Final/OT");
  assert.equal(s.last.away.ink, "#202124", "a light team colour gets dark text");
  assert.deepEqual(s.standings.map((x) => [x.team, x.me]), [["Los Angeles Lakers", true], ["Warriors", false]]);
  assert.match(RENDER.sports(s, "lakers score"), /<td><b>115<\/b><\/td>/);

  const f = NORMALIZE.flight({
    airline: "United Airlines", number: "ua 902", status: "scheduled",
    from: { code: "SFO", city: "San Francisco", sched: "10:35 AM", actual: "11:20 AM" }, to: { code: "NRT", city: "Tokyo", sched: "2:40 PM" }, progress: 0.6,
  });
  assert.deepEqual([f.number, f.status, f.tone, f.progress, f.note], ["UA 902", "Delayed", "late", 0, "Departure delayed 45 min"]);
  const landed = NORMALIZE.flight({ number: "BA117", status: "Arrived", from: { code: "LHR", sched: "8:20 AM", actual: "8:22 AM" }, to: { code: "JFK", sched: "11:05 AM", actual: "10:50 AM" } });
  assert.deepEqual([landed.status, landed.tone, landed.progress, landed.note], ["Landed", "ok", 1, "Arrived 15 min early"]);
  assert.match(RENDER.flight(f, "flight ua 902"), /ia-pill late">Delayed/);

  const w = NORMALIZE.dictionary({
    word: "serendipity", syllables: "ser·en·dip·i·ty", phonetic: "/ˌserənˈdipədē/", origin: "Coined by Horace Walpole in 1754.",
    senses: [{ pos: "Noun", defs: [{ def: "happy chance", ex: "pure serendipity", syn: ["luck", "fluke", "chance", "fortune", "fate"] }, { def: "b" }, { def: "c" }, { def: "d" }] }, { pos: "verb", defs: [] }],
  });
  assert.deepEqual([w.senses.length, w.senses[0].pos, w.senses[0].defs.length, w.senses[0].defs[0].syn.length], [1, "noun", 3, 4]);
  const dict = RENDER.dictionary(w, "define serendipity");
  assert.equal((dict.match(/<li class="ia-extra">/g) ?? []).length, 1, "the third definition waits behind 'more'");
  assert.match(dict, /class="ia-more"/);

  const lagos = NORMALIZE.time({ tz: "Africa/Lagos", place: "Lagos, Nigeria" }, ctx("time in lagos"));
  assert.deepEqual([lagos.time, lagos.date], ["3:05 PM", "Wednesday, September 23, 2026"]);
  const colony = NORMALIZE.time({ place: "Neo Tokyo Arcology", tz: "Neo/Tokyo", utcOffset: 9.5, abbr: "NTST" }, ctx("neo tokyo time"));
  assert.deepEqual([colony.tz, colony.time, colony.abbr], [null, "11:35 PM", "NTST"]);
  assert.match(RENDER.time(colony), /Time in Neo Tokyo Arcology/);
});

test("cards escape everything the model wrote", () => {
  const html = card("time", { place: `<img src=x onerror=alert(1)>"`, tz: null, utcOffset: 0, abbr: "<b>" });
  assert.doesNotMatch(html, /<img|<b>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;/);
  const sp = card("sports", { team: "</div><script>x</script>", last: { home: { name: "A", color: "red;background:url(x)" }, away: { name: "B" } } });
  assert.doesNotMatch(sp, /<script>|url\(x\)/);
});

test("did you mean: only small respellings of real words, never a rewrite", () => {
  assert.equal(checkFix("recieve package", "receive package"), "receive package");
  assert.equal(checkFix("how to loose weight", "how to lose weight"), "how to lose weight");
  assert.equal(checkFix("wether in paris", "weather in paris"), "weather in paris");
  assert.equal(checkFix("tommorow weather", "tomorrow weather"), "tomorrow weather");
  assert.equal(checkFix("alot of fun", "a lot of fun"), "a lot of fun");
  assert.equal(checkFix("Recieve Package", "receive package"), "receive package");
  // Nothing to fix, a different query, an added word, a renamed invention.
  assert.equal(checkFix("storm lanterns", "storm lanterns"), null);
  assert.equal(checkFix("storm lanterns", null), null);
  assert.equal(checkFix("best pizza brooklyn", "best pizza in brooklyn"), null);
  assert.equal(checkFix("zyntraxis corp stock", "syntax corp stock"), null);
  assert.equal(checkFix("glorbix meaning", "global meaning"), null);
  assert.equal(checkFix("cheap flights", "cheap flights to paris from london"), null);
  assert.equal(
    didYouMean("recieve package", "receive package"),
    '<p class="dym-line">Did you mean: <a href="/search?q=receive%20package"><b><i>receive</i></b> package</a></p>',
  );
  assert.match(didYouMean("a", `"><script>`), /&quot;&gt;&lt;script&gt;/);
});

// A fake page stream for the orchestrator.
function run({ jev, reply = {}, charge = () => true, query }) {
  const out = [];
  const calls = [];
  const charged = [];
  const answers = createAnswers({
    classify: async () => { if (jev instanceof Error) throw jev; return jev; },
    complete: async (spec) => {
      calls.push(spec.system.split("\n")[0]);
      const r = spec.system.startsWith("You fix spelling") ? reply.spell : reply.card;
      if (r instanceof Error) throw r;
      return typeof r === "string" ? r : JSON.stringify(r);
    },
    charge: (req, action) => { charged.push(action); return charge(action); },
    now: () => now,
    log: { log() {}, warn() {} },
  });
  return answers.start(query, { req: {}, emit: (h) => out.push(h), shown: () => false }).then(() => ({ html: out.join(""), out, calls, charged }));
}
const WEATHER = { place: "Tokyo, Japan", tz: "Asia/Tokyo", utcOffset: 9, unit: "C", now: { temp: 24, cond: "partly cloudy", precip: 10, humidity: 60, wind: 11 }, days: Array.from({ length: 8 }, () => ({ hi: 27, lo: 19, cond: "sunny", precip: 10, wind: 9 })) };

test("most queries get no card, no model call and nothing on the page", async () => {
  const r = await run({ query: "storm lanterns", jev: { type: "none", p: 1, typo: 0.04 } });
  assert.deepEqual([r.html, r.calls, r.charged], ["", [], []]);
  const offline = await run({ query: "storm lanterns", jev: new Error("Jev HTTP 503") });
  assert.equal(offline.html, "");
});

test("a card the model fills reserves its space first, then fills it; code cards are free and instant", async () => {
  const w = await run({ query: "weather tokyo", jev: { type: "weather", p: 1, typo: 0.4 }, reply: { card: WEATHER } });
  assert.deepEqual(w.charged, ["answer"]);
  assert.deepEqual(w.calls, ["You fill in the weather answer card on Foogle, a search engine for a web that doesn't exist (yet). The data is invented but plausible and internally consistent: realistic for real places, teams, companies and words; confident and in-world for fictional or futuristic ones. Today is Wednesday, September 23, 2026; it is about 14:00 UTC."]);
  assert.equal(w.out.length, 2);
  assert.match(w.out[0], /^<link rel="stylesheet" href="\/fw\/answers\.css\?v=\w+"><template id="ia-t"><div class="ia-card ia-weather ia-skel"[\s\S]*s\.className="ia wait"/);
  assert.match(w.out[1], /<template id="ia-t"><div class="ia-card ia-weather" data-ia="weather"[\s\S]*s\.className="ia ld"[\s\S]*<script type="module" src="\/fw\/answers\.js\?v=\w+" async><\/script>/);

  const c = await run({ query: "17% of 2340", jev: { type: "calculator", p: 1, typo: 0 } });
  assert.deepEqual([c.calls, c.charged, c.out.length], [[], [], 1]);
  assert.match(c.html, /<div class="ia-calc-top">17% of 2340 =<\/div><div class="ia-calc-main">397\.8<\/div>/);
  const t = await run({ query: "time in lagos", jev: { type: "time", p: 1, typo: 0 } });
  assert.deepEqual(t.calls, []);
  assert.match(t.html, /Time in Lagos, Nigeria/);
  // No Jev at all: code still answers what it is sure of.
  const u = await run({ query: "5 miles in km", jev: null });
  assert.match(u.html, /value="8\.04672"/);

  // Jev knows it's arithmetic but code can't read it: the model writes the expression, code computes it.
  const words = await run({ query: "seventeen percent of two thousand three hundred forty", jev: { type: "calculator", p: 1, typo: 0 }, reply: { card: { expr: "17% * 2340" } } });
  assert.match(words.html, /ia-calc-main">397\.8</);
});

test("a failed or refused card gives its space back", async () => {
  const broken = await run({ query: "lakers score", jev: { type: "sports", p: 1, typo: 0 }, reply: { card: "sorry, no JSON" } });
  assert.equal(broken.out.length, 2);
  assert.match(broken.out[1], /s\.replaceChildren\(\);s\.className="ia"/);
  const invalid = await run({ query: "weather x", jev: { type: "weather", p: 1, typo: 0 }, reply: { card: { place: "x", days: [] } } });
  assert.match(invalid.out.at(-1), /className="ia"/);
  const broke = await run({ query: "weather tokyo", jev: { type: "weather", p: 1, typo: 0 }, charge: (a) => a !== "answer" });
  assert.deepEqual([broke.html, broke.calls], ["", []], "over budget: no card and no model call");
});

test("a likely typo gets one spelling call and a Did you mean line; an invented name gets none", async () => {
  const r = await run({ query: "recieve package", jev: { type: "none", p: 1, typo: 0.98 }, reply: { spell: { fixed: "receive package" } } });
  assert.deepEqual(r.charged, ["spell"]);
  assert.equal(r.calls.length, 1);
  assert.match(r.out[0], /document\.getElementById\("dym"\)\.className="dym wait"/);
  assert.match(r.out[1], /<p class="dym-line">Did you mean: <a href="\/search\?q=receive%20package"><b><i>receive<\/i><\/b> package<\/a><\/p>/);

  // Jev isn't worried: no call at all.
  const calm = await run({ query: "weather olympus mons colony", jev: { type: "weather", p: 1, typo: TYPO_P - 0.05 }, reply: { card: { ...WEATHER, place: "Olympus Mons Colony, Mars" } } });
  assert.ok(calm.calls.every((c) => !c.startsWith("You fix spelling")));
  // The model "fixes" an invented name: refused, and the line's space is given back.
  const renamed = await run({ query: "zyntraxis corp stock", jev: { type: "none", p: 1, typo: 0.8 }, reply: { spell: { fixed: "syntax corp stock" } } });
  assert.doesNotMatch(renamed.html, /Did you mean/);
  assert.match(renamed.out.at(-1), /className="dym"/);
  // Both at once: a misspelled weather query gets the card and the line.
  const both = await run({ query: "wether in paris", jev: { type: "weather", p: 1, typo: 0.95 }, reply: { card: { ...WEATHER, place: "Paris, France" }, spell: { fixed: "weather in paris" } } });
  assert.match(both.html, /Did you mean[\s\S]*<b><i>weather<\/i><\/b> in paris/);
  assert.match(both.html, /Results for <b>Paris, France<\/b>/);
});

test("every card prompt has a fake-mode fixture that makes a valid card", () => {
  const queries = { weather: "weather olympus mons colony", calculator: "what is 3 and 4 together", units: "a mile in kilometers", currency: "500 lunar credits in usd", stock: "NVDA stock", dictionary: "define serendipity", time: "neo tokyo time", sports: "lakers score", flight: "flight UA 902" };
  for (const [type, q] of Object.entries(queries)) {
    const spec = answerPrompt(type, q, { now });
    const d = NORMALIZE[type](JSON.parse(fakeReply(spec.system, spec.user)), ctx(q));
    assert.match(RENDER[type](d, q), new RegExp(`data-ia="${type}"`), type);
  }
  const spell = spellPrompt("recieve package");
  assert.deepEqual(JSON.parse(fakeReply(spell.system, spell.user)), { fixed: "receive package" });
  const jev = fakeJevAnswers({ state: { query: "weather tokyo" }, questions: searchQuestions });
  assert.deepEqual([jev.answer.choice, jev.typo.noul < TYPO_P], ["weather", true]);
  assert.ok(ACTION_USD.answer > 0 && ACTION_USD.spell > 0);
});

test("the results page streams the card into a reserved slot without holding up the results", async (t) => {
  // Jev answers after 400ms; the model's first result line after 50ms. The
  // results must not wait for Jev, and the card lands in its slot anyway.
  const script = `
    const sse = (content) => new Response('data: ' + JSON.stringify({choices:[{delta:{content},finish_reason:"stop"}]}) + '\\n\\ndata: [DONE]\\n\\n', {headers:{"Content-Type":"text/event-stream"}});
    const json = (content) => Response.json({choices:[{message:{content},finish_reason:"stop"}]});
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    globalThis.fetch = async (url, init) => {
      const p = JSON.parse(init.body);
      if (url === "https://api.typesafe.ai/v1/systemone") {
        await sleep(400);
        if (!p.questions.answer) return Response.json({ answers: { kind: { choice: "blog" } } });
        const q = p.state.query;
        const choice = q.startsWith("weather") ? "weather" : q.includes("%") ? "calculator" : "none";
        return Response.json({ answers: { answer: { choice, confidence: 1, probabilities: { [choice]: 1 } }, typo: { noul: q.startsWith("recieve") ? 0.97 : 0.03 } } });
      }
      const system = p.messages[0].content;
      if (system.includes("weather answer card")) { await sleep(300); return json(${JSON.stringify(JSON.stringify(WEATHER))}); }
      if (system.includes("fix spelling")) return json('{"fixed":"receive package"}');
      if (system.includes("overview writer")) return json('{"title":"T","summary":"S","related":["r"]}');
      if (p.stream) { await sleep(50); return sse(JSON.stringify({site:"Harbor",title:"Harbor",url:"https://" + Math.random().toString(36).slice(2) + ".example/harbor",snippet:"s"}) + "\\n"); }
      if (system.includes("ONE section")) return sse("<section><h2>x</h2><p>y</p></section>");
      if (system.includes("fact sheet")) return sse("- fact");
      return json('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
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
  child.stderr.on("data", (d) => { output += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start:\n${output}`)), 5000);
    child.stdout.on("data", () => {
      const m = output.match(/http:\/\/localhost:(\d+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
  });
  const get = (q) => fetch(`http://localhost:${port}/search?q=${encodeURIComponent(q)}`).then((r) => r.text());

  const serp = await get("weather tokyo");
  const at = (re) => serp.search(re);
  assert.ok(at(/<div id="dym" class="dym"><\/div><div id="ia" class="ia"><\/div>\s*<div id="shimmer">/) > 0, "the slots go out with the shell");
  assert.ok(at(/class="result"/) < at(/ia-skel/), "the first result didn't wait for the classifier");
  assert.ok(at(/ia-skel/) < at(/data-ia="weather"/), "the card fills the space its placeholder reserved");
  assert.match(serp, /<script type="module" src="\/fw\/answers\.js\?v=\w+" async>/);
  assert.equal((serp.match(/class="result"/g) ?? []).length, 3, "one result from each shard");

  const calc = await get("17% of 2340");
  assert.match(calc, /ia-calc-main">397\.8</);
  assert.doesNotMatch(calc, /ia-skel/, "a code card needs no placeholder");
  const dym = await get("recieve package");
  assert.match(dym, /Did you mean: <a href="\/search\?q=receive%20package">/);
  const plain = await get("storm lanterns");
  assert.doesNotMatch(plain, /<template id="(?:ia|dym)-t">|answers\.css/);
  const page2 = await fetch(`http://localhost:${port}/search?q=weather%20tokyo&page=2`).then((r) => r.text());
  assert.doesNotMatch(page2, /id="ia"/, "answers are for the first page only");

  const css = await fetch(`http://localhost:${port}/fw/answers.css`);
  assert.equal(css.status, 200);
  assert.match(output, /\[answers\] "weather tokyo" → weather/);
});
