import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { parseSuggestion, siteFits, createSuggester, normalizeQuery, suggestPrompt } from "../lib/suggest.js";
import { createEngine, recordSearch, recentSearches, removeRecent } from "../public/suggest.js";

const quiet = { log() {}, warn() {} };
const tick = () => new Promise((r) => setTimeout(r, 0));

test("model lines become suggestions that continue what was typed", () => {
  assert.equal(normalizeQuery("  CNN   Live "), "cnn live ");
  assert.deepEqual(parseSuggestion("cnn | cnn.com | CNN", "cn"), { type: "site", q: "cnn", domain: "cnn.com", title: "CNN" });
  assert.deepEqual(parseSuggestion("2. \"CNN Live\"", "cn"), { type: "search", q: "cnn live" });
  assert.deepEqual(parseSuggestion("best buy | https://www.bestbuy.com/", "best "), { type: "site", q: "best buy", domain: "bestbuy.com", title: "bestbuy.com" });
  // A site may be exactly the finished word, so "cnn " still offers cnn.com.
  assert.deepEqual(parseSuggestion("cnn | cnn.com | CNN", "cnn "), { type: "site", q: "cnn", domain: "cnn.com", title: "CNN" });
  assert.deepEqual(parseSuggestion("cnn weather", "cnn "), { type: "search", q: "cnn weather" });
  assert.equal(parseSuggestion("cnnbc", "cnn "), null);
  // Lines that don't continue the text, and placeholders, are dropped.
  assert.equal(parseSuggestion("facebook login", "fl"), null);
  assert.equal(parseSuggestion("weather in [city]", "weather in"), null);
  // A site that isn't what the words name stays a plain search.
  assert.deepEqual(parseSuggestion("flu | cdc.gov | CDC", "fl"), { type: "search", q: "flu" });
  assert.ok(siteFits("american airlines", "aa.com"));
  assert.ok(siteFits("youtube music", "music.youtube.com"));
  assert.ok(!siteFits("is it safe to travel", "google.com"));
  assert.match(suggestPrompt("cn").system, /Reply with the 16 searches/);
  assert.match(suggestPrompt("how to m").system, /Reply with the 10 searches/);
  assert.match(suggestPrompt("").system, /trending searches/);
});

// A stand-in for streamText: yields the given lines, one per tick, and
// reports a cost like OpenRouter does.
function fakeStream(lines, calls = []) {
  return async function* (spec) {
    calls.push(spec);
    for (const line of lines(spec.user)) {
      await tick();
      yield `${line}\n`;
    }
    spec.onUsage?.({ cost: 0.00002 });
  };
}

test("one generation per prefix, shared by everyone who asks, then cached", async () => {
  const calls = [];
  const s = createSuggester({ stream: fakeStream((typed) => [`${typed}n | ${typed}n.com | CNN`, `${typed}n live`, `${typed}bc`, "unrelated", `${typed}et`], calls), log: quiet });
  const a = s.start("cn");
  const b = s.lookup("cn"); // arrives while the first is still streaming
  assert.equal(a, b);
  const seen = [];
  for await (const item of s.follow(b)) seen.push(item);
  assert.deepEqual(seen.map((i) => i.q), ["cnn", "cnn live", "cnbc", "cnet"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "meta-llama/llama-3.1-8b-instruct");
  assert.deepEqual(calls[0].provider, { order: ["groq"] });
  assert.equal(calls[0].maxRetries, 0);
  const hit = s.lookup("cn");
  assert.equal(hit.source, "hit");
  assert.equal(hit.items.length, 4);
  assert.equal(s.stats.usd, 0.00002);
});

test("a failed or thin generation isn't cached, and a full server says so", async () => {
  const s = createSuggester({
    stream: async function* (spec) {
      yield `${spec.user}a\n`;
      throw new Error("provider down");
    },
    maxActive: 1,
    log: quiet,
  });
  const entry = s.start("x");
  assert.ok(s.busy());
  assert.equal(s.start("y"), null);
  for await (const _ of s.follow(entry));
  assert.equal(entry.items.length, 1);
  assert.equal(s.lookup("x"), null);
  assert.equal(s.stats.failures, 1);
});

test("trending searches expire; the LRU keeps the most recently used lists", async () => {
  let t = 0;
  const s = createSuggester({ stream: fakeStream((typed) => typed === "Trending now" ? ["moon base weather", "hover scooter recall", "robot chef world cup"] : [`${typed}1`, `${typed}2`, `${typed}3`]), maxEntries: 2, now: () => t, log: quiet });
  await s.warm(["", "a"]);
  assert.equal(s.lookup("").items[0].q, "moon base weather");
  for await (const _ of s.follow(s.start("b")));
  assert.ok(s.lookup("b"));
  assert.equal(s.lookup("a"), null); // evicted: "" and "b" were used since
  t += 31 * 60_000;
  assert.equal(s.lookup(""), null);
});

// ---------- the browser side ----------
// A fetch for /api/suggest that streams NDJSON from `lists` and counts calls.
function fakeFetch(lists, { status = 200, retryAfter } = {}) {
  const asked = [];
  const fetch = async (url, { signal } = {}) => {
    const q = new URL(url, "http://x").searchParams.get("q");
    asked.push(q);
    await tick();
    if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (status !== 200) return new Response(JSON.stringify({ q, suggestions: [] }), { status, headers: retryAfter ? { "Retry-After": String(retryAfter) } : {} });
    return new Response((lists[q] ?? []).map((i) => `${JSON.stringify(i)}\n`).join(""));
  };
  return { fetch, asked };
}

const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };

test("typing is answered from the lists already fetched, filtered, while a new one streams", async () => {
  const lists = {
    c: [{ type: "site", q: "cnn", domain: "cnn.com", title: "CNN" }, ...["cnn live", "cnn live stream", "cnn news", "cnn weather", "costco"].map((q) => ({ type: "search", q }))],
    "cnn l": ["cnn live", "cnn layoffs 2031", "cnn logo"].map((q) => ({ type: "search", q })),
  };
  const { fetch, asked } = fakeFetch(lists);
  const changes = [];
  const engine = createEngine({ fetch, prefetch: false, onChange: (k) => changes.push(k) });
  assert.deepEqual(engine.set("c"), []);
  await settle();
  assert.equal(engine.pool("c").length, 6);
  // "cnn" and "cnn " are served from the "c" list: 5 fit, enough for the dropdown.
  assert.deepEqual(engine.set("cnn").map((i) => i.q), ["cnn", "cnn live", "cnn live stream", "cnn news", "cnn weather"]);
  assert.deepEqual(engine.set("CNN ").map((i) => i.q), ["cnn", "cnn live", "cnn live stream", "cnn news", "cnn weather"]);
  assert.deepEqual(asked, ["c"]);
  // "cnn l" has only two: they show at once, and "cnn l" is fetched.
  assert.deepEqual(engine.set("cnn l").map((i) => i.q), ["cnn live", "cnn live stream"]);
  await settle();
  assert.deepEqual(asked, ["c", "cnn l"]);
  assert.deepEqual(engine.pool("cnn l").map((i) => i.q), ["cnn live", "cnn layoffs 2031", "cnn logo", "cnn live stream"]);
  assert.ok(changes.includes("cnn l"));
  // Backspacing is free: every shorter text's list is still here.
  engine.set("cnn");
  engine.set("c");
  assert.deepEqual(asked, ["c", "cnn l"]);
});

test("requests for edited-away text are cancelled, and a refusal pauses suggestions", async () => {
  const { fetch, asked } = fakeFetch({});
  const engine = createEngine({ fetch, prefetch: false, patience: 5 });
  engine.set("mars");
  engine.set("mars c"); // "mars" may cover "mars c": kept, and waited on
  assert.deepEqual([...engine.pending.keys()], ["mars"]);
  engine.set("moon"); // it doesn't help any more
  assert.equal(engine.counts.aborted, 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(asked, ["mars", "moon"]);

  let t = 0;
  const limited = fakeFetch({}, { status: 429, retryAfter: 60 });
  const paused = createEngine({ fetch: limited.fetch, prefetch: false, now: () => t });
  paused.set("a");
  await settle();
  paused.set("ab");
  assert.deepEqual(limited.asked, ["a"]); // no more requests for a minute
  t += 61_000;
  paused.set("abc");
  assert.deepEqual(limited.asked, ["a", "abc"]);
});

test("a fast typist waits on the list already coming rather than asking for every key", async () => {
  const search = (...qs) => qs.map((q) => ({ type: "search", q }));
  const { fetch, asked } = fakeFetch({
    "weather in": search("weather in tokyo", "weather in tokyo tomorrow", "weather in tokyo today", "weather in tokyo hourly", "weather in toronto", "weather in tokyo next week"),
    "weather in tokyo n": search("weather in tokyo news"),
  });
  const engine = createEngine({ fetch, prefetch: false, patience: 1000 });
  engine.set("weather in");
  engine.set("weather in t"); // waits for "weather in"…
  engine.set("weather in to");
  await settle(); // …which covers it: no more requests
  assert.deepEqual(asked, ["weather in"]);
  assert.equal(engine.set("weather in tok").length, 5);
  // A text the list doesn't cover is asked for as soon as that list is in.
  engine.set("weather in tokyo n");
  await settle();
  assert.deepEqual(asked, ["weather in", "weather in tokyo n"]);
});

test("pausing on a prefix prefetches the top suggestion's next letter", async () => {
  const { fetch, asked } = fakeFetch({ yo: [{ type: "site", q: "youtube", domain: "youtube.com", title: "YouTube" }, { type: "search", q: "yoga" }], you: [{ type: "search", q: "youtube" }] });
  const engine = createEngine({ fetch });
  engine.set("yo");
  await settle();
  assert.deepEqual(asked, ["yo", "you"]);
  assert.equal(engine.counts.prefetches, 1);
});

test("recent searches: newest first, one per search, capped at 50", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  try {
    recordSearch("storm lanterns");
    recordSearch("  Mars   colony jobs ");
    recordSearch("STORM LANTERNS");
    assert.deepEqual(recentSearches(), ["STORM LANTERNS", "Mars colony jobs"]);
    assert.deepEqual(JSON.parse(store.get("foogle.recent")), ["STORM LANTERNS", "Mars colony jobs"]);
    removeRecent("mars colony jobs");
    assert.deepEqual(recentSearches(), ["STORM LANTERNS"]);
    for (let i = 0; i < 60; i++) recordSearch(`query ${i}`);
    assert.equal(recentSearches().length, 50);
    assert.equal(recentSearches()[0], "query 59");
  } finally {
    delete globalThis.localStorage;
  }
});

// ---------- the endpoint ----------
test("GET /api/suggest streams suggestions, charges only fresh ones, and goes quiet over the limit", async (t) => {
  const script = `
    globalThis.fetch = async (url, init) => {
      const p = JSON.parse(init.body);
      if (!/autocomplete|trending searches/.test(p.messages[0].content)) throw new Error("Unexpected request");
      const typed = p.messages[1].content;
      console.log("SUGGEST_CALL=" + JSON.stringify(typed) + " " + p.model);
      const lines = typed === "Trending now" ? ["moon base weather", "hover scooter recall", "robot chef world cup"] : [typed + "n | " + typed + "n.com | CNN", typed + "n live", typed + "bc", typed + "et"];
      const events = lines.map((l) => ({ choices: [{ delta: { content: l + "\\n" }, finish_reason: null }] }));
      events.push({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { cost: 0.00002 } });
      return new Response(events.map((e) => "data: " + JSON.stringify(e) + "\\n\\n").join("") + "data: [DONE]\\n\\n", { headers: { "Content-Type": "text/event-stream" } });
    };
    await import("./scripts/start.js");
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, "--", "--port", "0"], {
    cwd: new URL("..", import.meta.url),
    // Room for exactly two suggestion lists, and no warming, so every call is ours.
    env: { ...process.env, OPENROUTER_API_KEY: "test", SUGGEST_WARM: "0", FOOGLE_DOODLE: "0", RATE_LIMIT_BURST_USD: "0.00006", RATE_LIMIT_USD_PER_HOUR: "0", DAILY_BUDGET_USD: "", TRUST_PROXY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => { child.kill(); await once(child, "exit"); });
  let output = "";
  child.stdout.on("data", (d) => { output += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server did not start")), 5000);
    child.stdout.on("data", (d) => {
      const m = String(d).match(/http:\/\/localhost:(\d+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
  });
  const base = `http://localhost:${port}`;

  const streamed = await fetch(`${base}/api/suggest?q=CN&stream=1`);
  assert.match(streamed.headers.get("content-type"), /^application\/x-ndjson/);
  assert.equal(streamed.headers.get("x-suggest"), "miss");
  const lines = (await streamed.text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines, [{ type: "site", q: "cnn", domain: "cnn.com", title: "CNN" }, { type: "search", q: "cnn live" }, { type: "search", q: "cnbc" }, { type: "search", q: "cnet" }]);
  assert.match(output, /SUGGEST_CALL="cn" meta-llama\/llama-3.1-8b-instruct/);

  // Cached: the same list as JSON, free, and the browser may keep it.
  for (let i = 0; i < 3; i++) {
    const hit = await fetch(`${base}/api/suggest?q=cn`);
    assert.equal(hit.headers.get("x-suggest"), "hit");
    assert.match(hit.headers.get("cache-control"), /max-age=3600/);
    assert.deepEqual((await hit.json()).suggestions.map((s) => s.q), ["cnn", "cnn live", "cnbc", "cnet"]);
  }
  assert.equal(output.match(/SUGGEST_CALL=/g).length, 1);

  // One more fresh list fits the budget; the next is refused with nothing to show.
  assert.equal((await fetch(`${base}/api/suggest?q=yo`)).status, 200);
  const refused = await fetch(`${base}/api/suggest?q=zz&stream=1`);
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get("retry-after")) > 0);
  assert.deepEqual(await refused.json(), { q: "zz", suggestions: [] });
  assert.equal(output.match(/SUGGEST_CALL=/g).length, 2);

  // Both search boxes load the client.
  assert.match(await (await fetch(`${base}/`)).text(), /data-suggest="home"[\s\S]*src="\/suggest.js"/);
  assert.match(await (await fetch(`${base}/suggest.js`)).text(), /export function attachSuggest/);
});
