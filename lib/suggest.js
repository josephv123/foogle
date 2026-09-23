// Search suggestions: the autocomplete under Foogle's search boxes, written
// by a small, fast model and served from GET /api/suggest (see server.js).
//
// Speed is the point, so the work is split between here and the browser
// (public/suggest.js):
// - One model call answers a whole prefix with ~10-16 suggestions, streamed
//   line by line, so the first one shows while the rest are still coming.
// - Every answer goes into an LRU shared by all visitors, and a request for a
//   prefix that is already being generated joins that generation. Popular
//   prefixes are only ever generated once per server.
// - The browser keeps every list it has seen and filters them as the visitor
//   types: the list for "cnn" also answers "cnn " and "cnn l", so most
//   keystrokes never wait for the network at all.
// The model comparison that picked Llama 3.1 8B on Groq, and the latency and
// cost it gets, are in EXPERIMENTS.md.

import { streamText, TruncatedError } from "./llm.js";
import { devModel } from "./fake-llm.js";

const env = process.env;
export const SUGGEST = {
  // Short text goes to the fastest model there is: Llama 3.1 8B on Groq, the
  // first suggestion ~140ms after the request, $0.000016 a list. From
  // `longAt` characters on, the 8B drifts off what was typed ("weather in
  // tokyo tomor" -> "tokyo weather today") and a list has one or two usable
  // lines, so longer text goes to Llama 3.3 70B on Groq: ~220ms, $0.0002 a
  // list, full lists. SUGGEST_MODEL, SUGGEST_MODEL_LONG, SUGGEST_LONG_AT and
  // SUGGEST_PROVIDER (an OpenRouter provider order, comma-separated) override.
  model: devModel(env.SUGGEST_MODEL || "meta-llama/llama-3.1-8b-instruct"),
  longModel: devModel(env.SUGGEST_MODEL_LONG || env.SUGGEST_MODEL || "meta-llama/llama-3.3-70b-instruct"),
  longAt: Number(env.SUGGEST_LONG_AT) || 12,
  modelFor(key) { return key.length >= this.longAt ? this.longModel : this.model; },
  provider: { order: (env.SUGGEST_PROVIDER || "groq").split(",").map((s) => s.trim()).filter(Boolean) },
  temperature: 0.7,
  // A suggestion that arrives after the visitor has moved on is no use to
  // anyone. A generation that runs this long is dropped and nothing is shown.
  timeoutMs: 2500,
  // Short prefixes get longer lists: the browser filters them for the next
  // few keystrokes, so they are worth more.
  count: (key) => (key.length <= 2 ? 16 : 10),
  maxLength: 100,
};

// What the visitor typed, as a cache key: lowercase, runs of whitespace as one
// space, no leading space. A trailing space stays, since "cnn " (a finished
// word) wants different suggestions than "cnn" (maybe "cnnbc"…).
export const normalizeQuery = (text) =>
  String(text ?? "").toLowerCase().replace(/\s+/g, " ").replace(/^ /, "").slice(0, SUGGEST.maxLength);

const SYSTEM = `You are the autocomplete of Foogle, the search engine of a near-future web.
The user message is exactly what someone has typed into the search box so far. It may stop mid-word.
Reply with the COUNT searches they most likely mean, most likely first, one per line, lowercase.
Every line must begin with the typed text exactly, character for character, then continue it. Never reword or reorder what was typed.
If the text could be the start of a real, well-known website's name, put that site first as "query | domain | site name".
Make them specific, like real searches. A few should be things only the near future has.
Output only the lines: no numbering, quotes or commentary.

Example. Typed: yout
youtube | youtube.com | YouTube
youtube music | music.youtube.com | YouTube Music
youtube tv
youtube shorts download
youth soccer near me
youtube hologram mode
youtube premium price 2031
youth climate assembly vote

Example. Typed: how to fix a leaky fa
how to fix a leaky faucet
how to fix a leaky faucet handle
how to fix a leaky faucet without shutting off water
how to fix a leaky faucet in the bathtub
how to fix a leaky fan coil
how to fix a leaky faucet with a smart valve`;

// With nothing typed, the box offers what everyone is searching for.
const TRENDING = `You write the trending searches of Foogle, the search engine of a near-future web.
Reply with COUNT searches many people are making right now, one per line, lowercase, 2 to 6 words each.
Mix news, launches, sport, celebrities, weather and oddities, most of them things only the near future has.
Output only the lines: no numbering, quotes or commentary.`;

export function suggestPrompt(key, count = SUGGEST.count(key)) {
  if (!key.trim()) return { system: TRENDING.replace("COUNT", count), user: "Trending now", temperature: 1 };
  return { system: SYSTEM.replace("COUNT", count), user: key, temperature: SUGGEST.temperature };
}

const compact = (s) => s.replace(/[^a-z0-9]/g, "");

// Whether `domain` is plausibly the site someone typing `q` wants: cnn ->
// cnn.com, best buy -> bestbuy.com, american airlines -> aa.com, youtube
// music -> music.youtube.com. Small models sometimes attach a wrong one
// ("flu | cdc.gov"); the query is then kept as a plain search.
export function siteFits(q, domain) {
  const whole = compact(q);
  const initials = q.split(" ").filter(Boolean).map((w) => w[0]).join("");
  if (!whole) return false;
  return domain.split(".").slice(0, -1).map(compact).some((l) => l && (l.startsWith(whole) || whole.startsWith(l) || l === initials));
}

// One line of model output -> a suggestion, or null:
//   { type: "search", q: "cnn live" }
//   { type: "site", q: "cnn", domain: "cnn.com", title: "CNN" }
// `key` is the normalized typed text; every suggestion must extend it (a site
// may also be exactly it, so "cnn " still offers cnn.com).
export function parseSuggestion(line, key) {
  const [rawQ, rawDomain, rawTitle] = String(line ?? "").split("|");
  const q = normalizeQuery(rawQ.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/^\s*["'`]+|["'`]+\s*$/g, "")).trim();
  if (!q || q.length > 80 || /[<>[\]{}\\]/.test(q)) return null;
  const domain = String(rawDomain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
  const site = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,12}$/.test(domain) && siteFits(q, domain);
  if (!(q.startsWith(key) || (site && q === key.trimEnd()))) return null;
  if (!site) return { type: "search", q };
  const title = String(rawTitle ?? "").replace(/[<>"]/g, "").trim().slice(0, 40);
  return { type: "site", q, domain, title: title || domain };
}

// The shared cache and the generations in flight. `stream` is lib/llm.js's
// streamText (a stub in tests).
export function createSuggester({ stream = streamText, maxEntries = 5000, maxActive = 24, trendingTtlMs = 30 * 60_000, now = Date.now, log = console } = {}) {
  const cache = new Map(); // key -> { items, at }; insertion order is last use
  const inflight = new Map(); // key -> entry
  const stats = { hits: 0, joins: 0, misses: 0, failures: 0, usd: 0 };

  function cached(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (key === "" && now() - hit.at > trendingTtlMs) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, hit);
    return hit.items;
  }

  // A finished list ({ items, done: true }), a generation to join, or null.
  function lookup(key) {
    const items = cached(key);
    if (items) return (stats.hits++, { items, done: true, source: "hit" });
    const live = inflight.get(key);
    return live ? (stats.joins++, live) : null;
  }

  const busy = () => inflight.size >= maxActive;

  function start(key, { quiet = false } = {}) {
    if (inflight.has(key)) return inflight.get(key);
    if (busy()) return null;
    stats.misses++;
    const entry = { items: [], done: false, source: "miss", waiters: new Set() };
    const notify = () => { for (const wake of entry.waiters) wake(); entry.waiters.clear(); };
    inflight.set(key, entry);
    const t0 = now();
    let first = null;
    let usd = 0;
    let failed = null;
    const count = SUGGEST.count(key);
    const seen = new Set();
    const add = (line) => {
      const item = key ? parseSuggestion(line, key) : parseTrending(line);
      if (!item || seen.has(item.q) || entry.items.length >= count) return;
      seen.add(item.q);
      entry.items.push(item);
      first ??= now() - t0;
      notify();
    };
    (async () => {
      const { system, user, temperature } = suggestPrompt(key, count);
      let buffer = "";
      for await (const delta of stream({
        system, user, temperature, model: SUGGEST.modelFor(key), provider: SUGGEST.provider,
        maxTokens: count * 14 + 20, maxRetries: 0, signal: AbortSignal.timeout(SUGGEST.timeoutMs),
        onUsage: (u) => { usd += Number.isFinite(u?.cost) ? u.cost : 0; },
      })) {
        buffer += delta;
        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          add(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
        }
      }
      add(buffer);
    })()
      .catch((err) => {
        // Running on past the lines it was asked for is normal; they're all in.
        if (err instanceof TruncatedError) return;
        failed = err;
        stats.failures++;
        log.warn(`[suggest] "${key}" failed after ${now() - t0}ms: ${err.message}`);
      })
      .finally(() => {
        stats.usd += usd;
        // A finished list is kept however short it is: asking again would
        // cost the same for the same answer. One cut short by a failure is
        // kept only if it's worth showing.
        if (!failed || entry.items.length >= 3) {
          cache.set(key, { items: entry.items, at: now() });
          if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
        }
        inflight.delete(key);
        entry.done = true;
        notify();
        if (!quiet) log.log(`[suggest] "${key}" ${entry.items.length} in ${now() - t0}ms (first +${first ?? "-"}ms) $${usd.toFixed(7)}`);
      });
    return entry;
  }

  // The entry's items as they arrive: those already there, then each new one.
  async function* follow(entry) {
    let i = 0;
    for (;;) {
      while (i < entry.items.length) yield entry.items[i++];
      if (entry.done) return;
      await new Promise((wake) => entry.waiters.add(wake));
    }
  }

  // Generate lists ahead of anyone asking (the empty box and single letters,
  // at startup), a few at a time.
  async function warm(keys, concurrency = 4) {
    const queue = keys.filter((k) => !cache.has(k) && !inflight.has(k));
    const t0 = now();
    const before = stats.usd;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const entry = start(queue.shift(), { quiet: true });
        if (entry) for await (const _ of follow(entry));
      }
    }));
    log.log(`[suggest] warmed ${keys.length} prefixes in ${now() - t0}ms, $${(stats.usd - before).toFixed(5)}`);
  }

  return { lookup, start, follow, busy, warm, stats, size: () => cache.size };
}

// A trending line is any short search.
function parseTrending(line) {
  const q = normalizeQuery(String(line ?? "").replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/^\s*["'`]+|["'`]+\s*$/g, "")).trim();
  return q && q.length <= 60 && !/[<>[\]{}\\|]/.test(q) ? { type: "search", q } : null;
}
