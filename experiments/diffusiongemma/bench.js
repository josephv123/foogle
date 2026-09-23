// DiffusionGemma against GPT-6 Luna on Foogle's real prompts: a search results
// page (three shards and the Overview) and generated pages (fact sheet and four
// sections), through Foogle's own prompt builders, JSONL rules and page
// pipeline (generatePage), so every model gets exactly the prompts Luna gets.
// Also DiffusionGemma's Jev-compatible decision API against Jev itself.
// See "Google diffusion models" in EXPERIMENTS.md.
//
//   node experiments/diffusiongemma/bench.js search dgemma luna [--runs 1]
//   node experiments/diffusiongemma/bench.js pages dgemma luna [--runs 2]
//   node experiments/diffusiongemma/bench.js jev
//
// Raw outputs and a JSON report go to .foogle-bench/diffusiongemma/. Luna
// calls are paid (OpenRouter); the run stops once they reach LUNA_BUDGET_USD.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

try { process.loadEnvFile(".env"); } catch (err) { if (err.code !== "ENOENT") throw err; }

const { searchShardPrompt, overviewPrompt, pageFactsPrompt, SEARCH_ANGLES, SECTION_CLASSES } = await import("../../lib/prompts.js");
const { WIDGET_VOCABULARY } = await import("../../lib/widgets.js");
const { generatePage, cleanFactLine } = await import("../../lib/pages.js");
const { planFromAnswers, questions: pageQuestions, searchQuestions } = await import("../../lib/jev.js");
const { config, extractJSON, TruncatedError, DroppedError } = await import("../../lib/llm.js");

const { positionals, values: opts } = parseArgs({ allowPositionals: true, options: { runs: { type: "string" }, only: { type: "string" } } });
const [mode, ...modelNames] = positionals;
const OUT = path.resolve(".foogle-bench/diffusiongemma");
fs.mkdirSync(OUT, { recursive: true });

const DGEMMA = "https://6ab255d535c41fcea4a331db.endpoints.huggingface.cloud";
const MODELS = {
  // The free community endpoint (HF Inference Endpoint, one A100, vLLM + PR 57250).
  // Temperature is dropped by its proxy: the diffusion sampler has its own schedule.
  dgemma: { base: `${DGEMMA}/v1`, key: () => "none", model: "google/diffusiongemma-26B-A4B-it", extra: { chat_template_kwargs: { enable_thinking: false }, stream_options: { include_usage: true } } },
  luna: { base: "https://openrouter.ai/api/v1", key: () => process.env.OPENROUTER_API_KEY, model: "openai/gpt-6-luna", extra: { reasoning: { enabled: false }, usage: { include: true } } },
  // The autoregressive sibling (same Gemma 4 26B-A4B backbone), free on the Gemini API.
  // It thinks unless told "minimal" (no thinking budget or other level is accepted).
  gemma4: { base: "https://generativelanguage.googleapis.com/v1beta/openai", key: () => process.env.GEMINI_API_KEY, model: "gemma-4-26b-a4b-it", extra: { reasoning_effort: "minimal", stream_options: { include_usage: true } } },
};
const LUNA_BUDGET_USD = Number(process.env.LUNA_BUDGET_USD ?? 0.25);
let lunaSpent = 0;

const now = () => performance.now();

// The endpoint's public vLLM metrics: requests finished so far, by anyone. The
// difference over a run, less our own calls, is other people's traffic.
async function endpointFinished() {
  try {
    const t = await (await fetch(`${DGEMMA}/metrics`, { signal: AbortSignal.timeout(5000) })).text();
    return [...t.matchAll(/^vllm:request_success_total\{[^}]*\} (\S+)/gm)].reduce((s, m) => s + Number(m[1]), 0);
  } catch { return null; }
}
const secs = (ms) => Math.round(ms) / 1000;

// One streamed chat call, timed chunk by chunk. Yields text deltas like
// lib/llm.js streamText (same errors), and pushes a record of the call.
async function* modelStream(name, spec, role, calls) {
  const m = MODELS[name];
  if (name === "luna" && lunaSpent >= LUNA_BUDGET_USD) throw new Error(`Luna budget of $${LUNA_BUDGET_USD} reached`);
  const rec = { model: name, role, askedPic: spec.system.includes('class="pic"'), t0: now(), ttft: null, done: null, chunks: [], out: null, in: null, cost: null, finish: null, error: null, text: "" };
  calls.push(rec);
  const res = await fetch(`${m.base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${m.key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: m.model, messages: [{ role: "system", content: spec.system }, { role: "user", content: spec.user }], max_tokens: spec.maxTokens, temperature: spec.temperature, stream: true, ...m.extra }),
  });
  if (!res.ok) {
    rec.error = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
    rec.done = now();
    throw new Error(rec.error);
  }
  const dec = new TextDecoder();
  let buf = "";
  try {
    for await (const bytes of res.body) {
      buf += dec.decode(bytes, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        const j = JSON.parse(data);
        if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
        if (j.usage) {
          rec.out = j.usage.completion_tokens;
          rec.in = j.usage.prompt_tokens;
          rec.cost = j.usage.cost ?? null;
          if (name === "luna") lunaSpent += j.usage.cost ?? 0;
        }
        rec.finish = j.choices?.[0]?.finish_reason ?? rec.finish;
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) {
          const t = now();
          rec.ttft ??= t;
          rec.chunks.push([secs(t - rec.t0), delta.length]);
          rec.text += delta;
          yield delta;
        }
      }
    }
  } catch (err) {
    rec.error = err.message;
    rec.done = now();
    throw new DroppedError(err);
  }
  rec.done = now();
  if (rec.finish === "length") throw new TruncatedError();
}

// The call's numbers, relative to its own start.
const callStats = (c) => ({
  model: c.model, role: c.role, ttft: c.ttft && secs(c.ttft - c.t0), done: c.done && secs(c.done - c.t0), chunks: c.chunks.length,
  out: c.out, in: c.in, cost: c.cost, finish: c.finish, error: c.error,
  // Output tokens over the whole call, and over the time after the first chunk.
  tps: c.out && c.done ? Math.round(c.out / ((c.done - c.t0) / 1000)) : null,
  decodeTps: c.out && c.done && c.ttft && c.done > c.ttft ? Math.round(c.out / ((c.done - c.ttft) / 1000)) : null,
});

const pct = (xs, p) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

// ---------- search: three shards and the Overview, as resultsRoute sends them ----------
const QUERIES = ["sourdough starter not rising", "mars colony jobs", "how to fix a leaky faucet", "letterboxd"];
const KINDS = ["guide", "forum", "store", "tool", "video", "wiki", "news", "blog", "gov", "paper", "recipe", "event", "map", "archive"];
const words = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;

// Same tolerance as server.js parseJSONLine.
function parseJSONLine(line) {
  line = line.trim().replace(/,\s*$/, "");
  if (!line.startsWith("{")) return null;
  try { const o = JSON.parse(line); return o && typeof o === "object" ? o : null; } catch { return null; }
}

// The field rules of SEARCH_RULES that code can check.
function lineIssues(r) {
  const issues = [];
  try { new URL(r.url); } catch { issues.push("url"); }
  if (r.real) return issues;
  if (!r.site || words(r.site) > 3) issues.push("site");
  const sw = words(r.snippet);
  if (sw < 14 || sw > 26) issues.push(`snippet ${sw}w`);
  if ((String(r.snippet ?? "").match(/[.!?](?=\s+[A-Z])/g) ?? []).length) issues.push("snippet >1 sentence");
  if (!KINDS.includes(r.kind)) issues.push(`kind ${r.kind}`);
  if (r.meta && words(r.meta) >= 7) issues.push("meta");
  if (String(r.title ?? "").length >= 60) issues.push("title");
  return issues;
}

async function searchPage(name, query) {
  const calls = [];
  const t0 = now();
  let firstResult = null;
  const results = [];
  const shards = [3, 3, 3].map(async (count, i) => {
    const real = i === 0;
    const spec = { ...searchShardPrompt(query, { count, angle: SEARCH_ANGLES[i], page: 1, real }), maxTokens: count * 140 + 150 + (real ? 250 : 0), temperature: config.tempResults };
    let buf = "";
    let raw = "";
    let n = 0;
    const take = (obj) => {
      if (!obj) return;
      n++;
      if (obj.url && obj.title) {
        firstResult ??= now();
        results.push({ shard: i, ...obj, issues: lineIssues(obj) });
      }
    };
    try {
      for await (const d of modelStream(name, spec, `shard${i}`, calls)) {
        buf += d;
        raw += d;
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) { take(parseJSONLine(buf.slice(0, nl))); buf = buf.slice(nl + 1); }
      }
      take(parseJSONLine(buf));
      if (!n) for (const o of [].concat(extractJSON(raw))) take(o);
    } catch (err) {
      console.warn(`  [${name}] shard ${i}: ${err.message}`);
    }
    return { raw, lines: raw.split("\n").filter((l) => l.trim()).length, parsed: n };
  });
  const overview = (async () => {
    let text = "";
    try {
      for await (const d of modelStream(name, { ...overviewPrompt(query), maxTokens: 900, temperature: config.tempPages }, "overview", calls)) text += d;
      const o = extractJSON(text);
      return { ok: Boolean(o?.summary), facts: o?.facts?.length ?? 0, ask: o?.ask?.length ?? 0, related: o?.related?.length ?? 0, text };
    } catch (err) {
      return { ok: false, error: err.message, text };
    }
  })();
  const shardOut = await Promise.all(shards);
  const resultsDone = now();
  const ov = await overview;
  const hosts = results.map((r) => { try { return new URL(r.url).host.replace(/^www\./, ""); } catch { return r.url; } });
  return {
    model: name, query,
    firstResult: firstResult && secs(firstResult - t0), resultsDone: secs(resultsDone - t0), overviewDone: secs((calls.find((c) => c.role === "overview")?.done ?? now()) - t0),
    valid: results.length, ruleOk: results.filter((r) => !r.issues.length).length, distinctHosts: new Set(hosts).size,
    real: results.filter((r) => r.real).map((r) => r.url),
    issues: results.flatMap((r) => r.issues),
    overview: { ok: ov.ok, facts: ov.facts, ask: ov.ask, related: ov.related, error: ov.error },
    calls: calls.map(callStats),
    cost: calls.reduce((s, c) => s + (c.cost ?? 0), 0),
    results: results.map(({ shard, site, title, url, snippet, kind, meta, date, real, issues }) => ({ shard, site, title, url, snippet, kind, meta, date, real, issues })),
    raw: { shards: shardOut.map((s) => s.raw), overview: ov.text },
  };
}

// ---------- pages: the real page pipeline with the model swapped ----------
const PAGES = [
  { kind: "forum", style: "phpbb", args: { url: "https://crumbforum.net/threads/starter-not-rising-after-feeding", title: "Starter not rising after feeding — what am I missing?", snippet: "Day 9 rye starter barely moves after a 1:5:5 feed; regulars suggest 26°C, less water and discarding more.", query: "sourdough starter not rising", resultKind: "forum" } },
  { kind: "store", style: "vintage", args: { url: "https://tidewatchoptics.com/telescopes/brass-refractors", title: "Brass Refractor Telescopes | Tidewatch Optics", snippet: "Hand-finished 60-90mm brass refractors from $389, each collimated and star-tested before shipping, with a 10-year optics warranty.", query: "brass telescope", resultKind: "store" } },
  { kind: "wiki", style: "academic", args: { url: "https://marspedia.org/wiki/Jezero_Settlement", title: "Jezero Settlement — Marspedia", snippet: "Founded in 2041 on the delta of Jezero crater, the settlement of 1,860 residents runs on regolith-shielded habitats and a 40 MW fission plant.", query: "mars colony jobs", resultKind: "wiki" } },
  { kind: "news", style: "newsprint", args: { url: "https://harborlinepost.com/2031/04/tidal-barrier-vote", title: "Council approves $2.1B tidal barrier after 9-hour session", snippet: "The 7-4 vote clears construction of a 3.2 km barrier across the harbor mouth, with the first gates due to close by 2036.", query: "harbor tidal barrier vote", resultKind: "news" } },
  { kind: "blog", style: "minimal", args: { url: "https://slowcommute.blog/why-i-sold-my-ebike", title: "Why I sold my e-bike after 4,000 miles", snippet: "Battery replacement at $640, a 19 kg frame on stairs and a stolen seatpost: one commuter's honest tally of e-bike ownership.", query: "is an e-bike worth it", resultKind: "blog" } },
  { kind: "startup", style: "saas", args: { url: "https://ledgerlyte.io/pricing", title: "Ledgerlyte Pricing — Bookkeeping that closes itself", snippet: "Plans from $29/month reconcile bank feeds nightly and close your books by the 3rd, with a human accountant reviewing every month-end.", query: "automatic bookkeeping software small business", resultKind: "tool" } },
];

// The class names the section prompt offers (and the widgets' own).
const ALLOWED = new Set([...`${SECTION_CLASSES}\n${WIDGET_VOCABULARY}`.matchAll(/\.([a-z][\w-]*)|class="([^"]+)"/g)].flatMap((m) => (m[1] ?? m[2]).split(/\s+/)).concat(["pic"]));

// What a written section did with the prompt's rules, from the model's raw text.
function sectionChecks(text) {
  const at = text.search(/<section[\s>]/i);
  const end = text.search(/<\/section\s*>/i);
  const body = at === -1 ? "" : text.slice(at, end === -1 ? undefined : end + 10);
  const visible = body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ");
  const classes = [...body.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean);
  return {
    closed: at !== -1 && end !== -1,
    preamble: at > 0 ? text.slice(0, at).trim().slice(0, 80) : "",
    afterClose: end !== -1 ? text.slice(end + 10).trim().length : 0,
    words: words(visible),
    pictures: (body.match(/<img\b[^>]*class="pic"/g) ?? []).length,
    invented: [...new Set(classes.filter((c) => !ALLOWED.has(c)))],
    badHrefs: [...body.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).filter((h) => !h.startsWith("/web/")),
    widgets: [...new Set([...body.matchAll(/\sdata-(add-to-cart|filter|tabs|quiz|calc|poll|comments|pick|toggle|toast|open|countdown)\b/g)].map((m) => m[1]))].concat(/<form\b[^>]*method="post"/.test(body) ? ["form"] : []),
  };
}

const noSpecs = { lookup: async () => null, start: () => { throw new Error("no real-site specs in this bench"); } };

async function page(name, { kind, style, args }) {
  const calls = [];
  const plan = planFromAnswers(args, { kind: { choice: kind }, style: { choice: style } });
  // pageFacts in lib/pages.js, with the model swapped.
  async function* facts(a) {
    let buf = "";
    for await (const d of modelStream(name, { ...pageFactsPrompt(a), maxTokens: 220, temperature: config.tempPages }, "facts", calls)) {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) { const l = cleanFactLine(buf.slice(0, nl)); buf = buf.slice(nl + 1); if (l) yield l; }
    }
    const l = cleanFactLine(buf);
    if (l) yield l;
  }
  let n = 0;
  const stream = (spec) => modelStream(name, spec, `section${n++}`, calls);
  const t0 = now();
  let shell = null;
  let firstSection = null;
  let html = "";
  let error = null;
  try {
    for await (const chunk of generatePage(args, { planWithJev: async () => plan, stream, facts, looks: new Map(), specs: noSpecs })) {
      if (shell == null) shell = now();
      else if (firstSection == null && /<section[\s>]|<\/?(p|div|h2|table|ul)\b/i.test(chunk)) firstSection = now();
      html += chunk;
    }
  } catch (err) {
    error = err.message;
  }
  const done = now();
  // Wait for the writers' background reads (untilClosed) so their usage lands.
  const deadline = now() + 30_000;
  while (calls.some((c) => c.done == null) && now() < deadline) await new Promise((r) => setTimeout(r, 100));
  const sections = calls.filter((c) => c.role.startsWith("section"));
  return {
    model: name, kind, style, url: args.url, page: plan.page,
    shell: shell && secs(shell - t0), firstSection: firstSection && secs(firstSection - t0), done: secs(done - t0), error,
    picturesAsked: sections.filter((c) => c.askedPic).length,
    checks: sections.map((c) => ({ role: c.role, askedPic: c.askedPic, ...sectionChecks(c.text) })),
    facts: calls.find((c) => c.role === "facts")?.text ?? "",
    calls: calls.map(callStats),
    cost: calls.reduce((s, c) => s + (c.cost ?? 0), 0),
    html,
    raw: Object.fromEntries(sections.map((c) => [c.role, c.text])),
  };
}

// ---------- Jev: TypeSafe against DiffusionGemma's /v1/systemone ----------
const JEV_URLS = [
  ...PAGES.map((p) => p.args),
  { url: "https://www.cnn.com/", title: "CNN - Breaking News, Latest News and Videos", query: "cnn" },
  { url: "https://www.reddit.com/r/Sourdough/", title: "r/Sourdough", query: "reddit sourdough" },
  { url: "https://en.wikipedia.org/wiki/Lighthouse", title: "Lighthouse - Wikipedia", query: "lighthouse" },
  { url: "https://civicpermits.gov.example/apply/boat-mooring", title: "Apply for a boat mooring permit", snippet: "Annual moorings cost $412; apply by March 1 with proof of insurance and a hull survey.", query: "boat mooring permit", resultKind: "gov" },
  { url: "https://neonriot.zine/issue-44", title: "Issue 44: Static Bloom", snippet: "Collage, noise poetry and a 12-page comic about the last payphone in Detroit.", query: "underground art zine", resultKind: "archive" },
];
// Expected answers, written by hand before either service was asked.
const JEV_QUERIES = [
  ["weather tokyo", "weather", 0, 0], ["17% of 2340", "calculator", 0, 0], ["calculator", "calculator", 1, 0], ["5 miles in km", "units", 0, 0],
  ["currency converter", "currency", 1, 0], ["100 usd to eur", "currency", 0, 0], ["lakers score", "sports", 0, 0], ["NVDA stock", "stock", 0, 0],
  ["define serendipity", "dictionary", 0, 0], ["what time is it", "time", 1, 0], ["time in lagos", "time", 0, 0], ["flight UA 902", "flight", 0, 0],
  ["mortgage calculator", "none", 0, 0], ["weather balloon kits", "none", 0, 0], ["stock pot recipes", "none", 0, 0], ["sourdough starter not rising", "none", 0, 0],
  ["how to recieve a package", "none", 0, 1], ["wether forecast boston", "weather", 0, 1], ["olympus mons colony forecast", "weather", 0, 0], ["how to loose weight fast", "none", 0, 1],
  ["zyntraxis corp stock", "stock", 0, 0], ["tommorow weather paris", "weather", 0, 1],
];

// The endpoint rejects 11 or more questions at once ("label 'no' is not a
// single token", whichever questions they are), so its page questions go as
// parallel requests of 8 and the answers are merged.
async function systemone(which, state, qs) {
  const keys = Object.keys(qs);
  if (which === "dgemma" && keys.length > 8) {
    const t0 = now();
    const parts = await Promise.all(Array.from({ length: Math.ceil(keys.length / 8) }, (_, i) => systemoneOnce(which, state, Object.fromEntries(keys.slice(i * 8, i * 8 + 8).map((k) => [k, qs[k]])))));
    const failed = parts.find((p) => p.error);
    return failed ? { ms: now() - t0, error: failed.error } : { ms: now() - t0, answers: Object.assign({}, ...parts.map((p) => p.answers)) };
  }
  return systemoneOnce(which, state, qs);
}

async function systemoneOnce(which, state, qs) {
  const url = which === "jev" ? "https://api.typesafe.ai/v1/systemone" : `${DGEMMA}/v1/systemone`;
  const headers = { "Content-Type": "application/json", ...(which === "jev" ? { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` } : {}) };
  const t0 = now();
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model: "jev-latest", state, questions: qs }) });
  const ms = now() - t0;
  if (!r.ok) return { ms, error: `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
  return { ms, answers: (await r.json()).answers };
}

const topStyles = (a, n = 3) => Object.entries(a).filter(([k]) => k.startsWith("style_")).sort((x, y) => (y[1].noul ?? 0) - (x[1].noul ?? 0)).slice(0, n).map(([k, v]) => `${k.slice(6)} ${(v.noul ?? 0).toFixed(2)}`);

async function jevBench() {
  const out = { pages: [], queries: [] };
  for (const args of JEV_URLS) {
    const row = { url: args.url };
    for (const which of ["jev", "dgemma"]) {
      const r = await systemone(which, args, pageQuestions);
      row[which] = r.error ? { ms: Math.round(r.ms), error: r.error } : { ms: Math.round(r.ms), kind: r.answers.kind?.choice, kindConf: r.answers.kind?.confidence, real: r.answers.real_site?.noul, top: topStyles(r.answers) };
    }
    console.log(JSON.stringify(row));
    out.pages.push(row);
  }
  for (const [query, type, blank, typo] of JEV_QUERIES) {
    const row = { query, expect: { type, blank, typo } };
    for (const which of ["jev", "dgemma"]) {
      const r = await systemone(which, { query }, searchQuestions);
      row[which] = r.error ? { ms: Math.round(r.ms), error: r.error } : { ms: Math.round(r.ms), type: r.answers.answer?.choice, p: r.answers.answer?.probabilities?.[r.answers.answer?.choice], blank: r.answers.blank?.noul, typo: r.answers.typo?.noul };
    }
    console.log(JSON.stringify(row));
    out.queries.push(row);
  }
  const score = (which) => {
    const q = out.queries.filter((r) => !r[which].error);
    return {
      answered: q.length,
      type: q.filter((r) => r[which].type === r.expect.type).length,
      blank: q.filter((r) => (r[which].blank >= 0.5 ? 1 : 0) === r.expect.blank).length,
      typo: q.filter((r) => (r[which].typo >= 0.5 ? 1 : 0) === r.expect.typo).length,
      msP50: pct(out.queries.map((r) => r[which].ms), 50), msP90: pct(out.queries.map((r) => r[which].ms), 90),
      pageMsP50: pct(out.pages.map((r) => r[which].ms), 50), pageMsP90: pct(out.pages.map((r) => r[which].ms), 90),
    };
  };
  const realOk = (which) => out.pages.filter((r) => !r[which].error && (r[which].real >= 0.6) === /cnn|reddit|wikipedia/.test(r.url)).length;
  const topAgree = out.pages.filter((r) => r.jev.top && r.dgemma.top && r.jev.top[0].split(" ")[0] === r.dgemma.top[0].split(" ")[0]).length;
  out.summary = { jev: { ...score("jev"), realOk: realOk("jev") }, dgemma: { ...score("dgemma"), realOk: realOk("dgemma") }, kindAgree: out.pages.filter((r) => r.jev.kind && r.jev.kind === r.dgemma.kind).length, topStyleAgree: topAgree, pages: out.pages.length };
  console.log(JSON.stringify(out.summary, null, 1));
  fs.writeFileSync(path.join(OUT, "jev.json"), JSON.stringify(out, null, 1));
}

// ---------- main ----------
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const runs = Number(opts.runs ?? 1);
const only = opts.only ? new RegExp(opts.only) : null;

if (mode === "jev") {
  await jevBench();
} else if (mode === "search" || mode === "pages") {
  const report = [];
  for (let run = 0; run < runs; run++) {
    const items = mode === "search" ? QUERIES.filter((q) => !only || only.test(q)) : PAGES.filter((p) => !only || only.test(p.kind));
    for (const item of items) {
      // Alternate which model goes first, so neither always gets the warmer hour.
      const order = (run + items.indexOf(item)) % 2 ? [...modelNames].reverse() : modelNames;
      for (const name of order) {
        const before = name === "dgemma" ? await endpointFinished() : null;
        const r = mode === "search" ? await searchPage(name, item) : await page(name, item);
        const after = name === "dgemma" ? await endpointFinished() : null;
        if (before != null && after != null) r.othersRequests = after - before - r.calls.length;
        r.run = run;
        const slug = `${mode}-${name}-${(mode === "search" ? item : item.kind).replace(/\W+/g, "-")}-r${run}`;
        if (mode === "pages") fs.writeFileSync(path.join(OUT, `${slug}.html`), r.html);
        fs.writeFileSync(path.join(OUT, `${slug}.json`), JSON.stringify(r, null, 1));
        const { html, raw, results, calls, ...brief } = r;
        console.log(JSON.stringify({ ...brief, checks: brief.checks?.map((c) => `${c.role}:${c.closed ? "ok" : "OPEN"} ${c.words}w pic${c.pictures}${c.invented.length ? ` inv[${c.invented}]` : ""}${c.badHrefs.length ? ` href[${c.badHrefs.length}]` : ""}`) }));
        report.push(r);
      }
    }
  }
  const summary = {};
  for (const name of modelNames) {
    const rs = report.filter((r) => r.model === name);
    const cs = rs.flatMap((r) => r.calls);
    summary[name] = mode === "search"
      ? { pages: rs.length, firstResultP50: pct(rs.map((r) => r.firstResult), 50), resultsDoneP50: pct(rs.map((r) => r.resultsDone), 50), resultsDoneP90: pct(rs.map((r) => r.resultsDone), 90), overviewP50: pct(rs.map((r) => r.overviewDone), 50), valid: rs.reduce((s, r) => s + r.valid, 0), ruleOk: rs.reduce((s, r) => s + r.ruleOk, 0), overviewOk: rs.filter((r) => r.overview.ok).length, cost: rs.reduce((s, r) => s + r.cost, 0) }
      : { pages: rs.length, failed: rs.filter((r) => r.error).length, firstSectionP50: pct(rs.map((r) => r.firstSection), 50), doneP50: pct(rs.map((r) => r.done), 50), doneP90: pct(rs.map((r) => r.done), 90), sections: rs.flatMap((r) => r.checks).length, closed: rs.flatMap((r) => r.checks).filter((c) => c.closed).length, wordsP50: pct(rs.flatMap((r) => r.checks.map((c) => c.words)), 50), pictures: rs.flatMap((r) => r.checks).filter((c) => c.askedPic && c.pictures).length, picturesAsked: rs.reduce((s, r) => s + r.picturesAsked, 0), withInvented: rs.flatMap((r) => r.checks).filter((c) => c.invented.length).length, badHrefs: rs.flatMap((r) => r.checks).reduce((s, c) => s + c.badHrefs.length, 0), cost: rs.reduce((s, r) => s + r.cost, 0) };
    Object.assign(summary[name], { ttftP50: pct(cs.map((c) => c.ttft), 50), ttftP90: pct(cs.map((c) => c.ttft), 90), tpsP50: pct(cs.map((c) => c.tps), 50), decodeTpsP50: pct(cs.map((c) => c.decodeTps), 50), chunksP50: pct(cs.map((c) => c.chunks), 50), outP50: pct(cs.map((c) => c.out), 50), errors: cs.filter((c) => c.error).map((c) => c.error.slice(0, 80)) });
  }
  console.log(JSON.stringify(summary, null, 1));
  console.log(`Luna spend this run: $${lunaSpent.toFixed(4)}`);
  fs.writeFileSync(path.join(OUT, `${mode}-${stamp}.json`), JSON.stringify({ summary, report: report.map(({ html, ...r }) => r) }, null, 1));
} else {
  console.log("usage: bench.js search|pages <model…> [--runs N] [--only re] | bench.js jev");
}
