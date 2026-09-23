// Spend protection for a public Foogle: every generation is paid for on
// OpenRouter, so each visitor gets a budget in dollars (a token bucket that
// refills over time) and the whole site gets a daily budget.
//
// Routes call `limits.allow(req, res, action)` only when they are about to
// generate something — cached pages, results and pictures, and joining a
// generation already in flight, never reach it, so they are free. It returns
// true, or answers with a friendly page itself and returns false:
//
//   if (!limits.allow(req, res, "web")) return;
//
// `limits.check(req, action)` charges the same way without answering, for a
// route that can do without the model (a comment still posts, unanswered).
// A new route that calls the model adds its action to ACTION_USD (or passes
// a dollar amount) and makes one of those calls. The daily budget needs
// nothing: it counts every call's reported cost through lib/llm.js onUsage().
// Background work that no visitor pays for asks `limits.withinBudget()`.

// What one uncached action costs, in USD, measured on GPT-6 Luna (see "Cost"
// in README.md), rounded up. A search includes its Overview and the prefetch
// of its top two pages; Images and News include their pictures; "web" also
// covers a form's confirmation page (which costs about a third of that).
export const ACTION_USD = {
  search: 0.007,
  images: 0.007,
  news: 0.0045,
  web: 0.0033,
  maps: 0.0008,
  timelines: 0.0004,
  img: 0.0005,
  lucky: 0.0002, // one result; the page it opens is charged as "web"
  comment: 0.00005, // one short reply
  // One list of search suggestions (lib/suggest.js): short text from Llama
  // 3.1 8B, longer text from Llama 3.3 70B. A typed query takes a handful.
  // Only generations are charged: a list the shared cache or an in-flight
  // generation answers is free.
  suggest: 0.00003,
  suggestLong: 0.00025,
};

export const DEFAULTS = {
  burstUsd: 0.10, // ~14 searches or 30 pages at once
  usdPerHour: 0.40, // sustained: a new page every ~30s
  dailyBudgetUsd: 5, // ~250 typical sessions
};

// "off" (or "none") disables a limit; unset or unparseable uses the default.
function num(raw, fallback) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "off" || s === "none") return Infinity;
  const n = Number(s);
  return s !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
}

// OpenRouter reports cost in USD. If a response ever lacks it, price the
// tokens at Luna's list rate ($0.10 in / $0.50 out per million).
export const usageUSD = (u) =>
  Number.isFinite(u?.cost) ? u.cost : ((u?.prompt_tokens ?? 0) * 0.1 + (u?.completion_tokens ?? 0) * 0.5) / 1e6;

// IPv6 visitors usually hold a whole /64, so they share one bucket.
function visitorKey(ip) {
  ip = String(ip ?? "").trim().replace(/^::ffff:(?=\d+\.)/i, "");
  if (!ip.includes(":")) return ip || "unknown";
  const [head, tail = ""] = ip.split("%")[0].split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// The visitor's address. Forwarded headers are only believed when TRUST_PROXY
// says a proxy sets them; otherwise anyone could pick their own bucket.
//   TRUST_PROXY unset        the socket address
//   TRUST_PROXY=1 (or N)     X-Forwarded-For, N proxy hops from the right
//   TRUST_PROXY=true         the leftmost X-Forwarded-For entry
//   TRUST_PROXY=<header>     that header, e.g. fly-client-ip, cf-connecting-ip
export function clientIP(req, trustProxy) {
  const socket = req.socket?.remoteAddress ?? "";
  const trust = String(trustProxy ?? "").trim().toLowerCase();
  if (!trust || trust === "false" || trust === "0") return socket;
  const xff = String(req.headers?.["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (trust === "true") return xff[0] ?? socket;
  if (/^\d+$/.test(trust)) {
    const hops = [socket, ...xff.reverse()];
    return hops[Math.min(Number(trust), hops.length - 1)];
  }
  const header = req.headers?.[trust];
  return String(Array.isArray(header) ? header[0] : header ?? "").split(",")[0].trim() || socket;
}

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const untilMidnightUTC = (ms) => Math.ceil((86_400_000 - (ms % 86_400_000)) / 1000);

export function createLimits({ env = process.env, now = Date.now, maxVisitors = 50_000 } = {}) {
  const burst = num(env.RATE_LIMIT_BURST_USD, DEFAULTS.burstUsd);
  const perHour = num(env.RATE_LIMIT_USD_PER_HOUR, DEFAULTS.usdPerHour);
  const daily = num(env.DAILY_BUDGET_USD, DEFAULTS.dailyBudgetUsd);
  const trustProxy = env.TRUST_PROXY;
  const perVisitor = Number.isFinite(perHour) && Number.isFinite(burst);

  const buckets = new Map(); // visitor -> { usd, at }; insertion order is last use
  let day = utcDay(now());
  let spent = 0;
  let warned = false;

  const rollover = () => {
    if (utcDay(now()) === day) return;
    day = utcDay(now());
    spent = 0;
    warned = false;
  };

  // Tops the visitor's bucket up for the time since their last visit and
  // takes `usd` out of it. Returns the seconds to wait if it can't afford it.
  function take(key, usd) {
    const t = now();
    const b = buckets.get(key) ?? { usd: burst, at: t };
    b.usd = Math.min(burst, b.usd + ((t - b.at) / 3_600_000) * perHour);
    b.at = t;
    buckets.delete(key);
    buckets.set(key, b);
    if (buckets.size > maxVisitors) buckets.delete(buckets.keys().next().value);
    // (A nano-dollar of slack absorbs floating-point error.)
    if (b.usd >= usd - 1e-9) {
      b.usd = Math.max(0, b.usd - usd);
      return 0;
    }
    return perHour > 0 ? Math.max(1, Math.ceil(((usd - b.usd) / perHour) * 3600 - 1e-6)) : 86_400;
  }

  // Record a model call's usage (lib/llm.js onUsage listener).
  function record(usage) {
    rollover();
    spent += usageUSD(usage);
    if (spent >= daily && !warned) {
      warned = true;
      console.warn(`[limits] daily budget of $${daily} reached ($${spent.toFixed(4)} spent); new generations are paused until 00:00 UTC`);
    }
  }

  // Charges the visitor for `action` if the day's budget and their bucket
  // allow it. Returns { ok } or, refused, the status and seconds to wait.
  function check(req, action) {
    const usd = typeof action === "number" ? action : ACTION_USD[action] ?? ACTION_USD.web;
    rollover();
    if (spent >= daily) return { ok: false, status: 503, wait: untilMidnightUTC(now()) };
    if (!perVisitor) return { ok: true };
    const wait = take(visitorKey(clientIP(req, trustProxy)), usd);
    return wait ? { ok: false, status: 429, wait } : { ok: true };
  }

  // check(), answering a refusal with a friendly page.
  function allow(req, res, action) {
    const { ok, status, wait } = check(req, action);
    if (ok) return true;
    res.status(status).setHeader("Retry-After", String(wait));
    refuse(res, action === "img", status === 503 ? outOfJuicePage(wait) : slowDownPage(wait));
    return false;
  }

  // For work no visitor asked for (the daily doodle, lib/doodle.js): whether
  // the day's budget has room. Its calls are counted like any other.
  const withinBudget = () => (rollover(), spent < daily);

  const status = () => (rollover(), { day, spentUsd: spent, dailyBudgetUsd: daily, visitors: buckets.size });
  return { allow, check, record, withinBudget, status, config: { burstUsd: burst, usdPerHour: perHour, dailyBudgetUsd: daily } };
}

// Pictures are shown by <img> tags, which can't show a page: they get a soft
// placeholder instead, and are not cached so they are retried later.
function refuse(res, image, html) {
  res.setHeader("Cache-Control", "no-store");
  if (image) return res.type("image/svg+xml").send(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#f1f3f4"/></svg>`);
  res.type("html").send(html);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function duration(seconds) {
  if (seconds < 90) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const m = Math.round(seconds / 60);
  if (m < 90) return `${m} minutes`;
  const h = Math.floor(m / 60);
  return `${h} hour${h === 1 ? "" : "s"}${m % 60 ? ` ${m % 60} min` : ""}`;
}

// Foogle's homepage look: the logo, one line of news, a way home. No scripts:
// /web responses forbid them (PAGE_CSP).
function page({ title, logo, heading, body, refresh }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ""}
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:arial,sans-serif;color:#202124;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 20px 12vh;text-align:center}
.logo{font-size:72px;font-weight:500;letter-spacing:-3px;user-select:none;margin-bottom:26px;text-decoration:none}
.b1{color:#4285f4}.r{color:#ea4335}.y{color:#fbbc05}.g{color:#34a853}.dim{color:#dadce0}
h1{font-size:22px;font-weight:400;margin-bottom:12px}
p{font-size:14px;line-height:1.6;color:#4d5156;max-width:480px}
.back{margin-top:28px;display:inline-block;background:#f8f9fa;border:1px solid #f8f9fa;border-radius:4px;color:#3c4043;font-size:14px;padding:9px 16px;text-decoration:none}
.back:hover{border-color:#dadce0;box-shadow:0 1px 1px rgba(0,0,0,.1)}
</style></head><body>
<a class="logo" href="/">${logo}</a>
<h1>${heading}</h1>
<p>${body}</p>
<a class="back" href="/">Back to Foogle</a>
</body></html>`;
}

const LOGO = `<span class="b1">F</span><span class="r">o</span><span class="y">o</span><span class="b1">g</span><span class="g">l</span><span class="r">e</span>`;
// The logo's colours drain out, like a battery running flat.
const DRAINED = `<span class="b1">F</span><span class="r">o</span><span class="dim">o</span><span class="dim">g</span><span class="dim">l</span><span class="dim">e</span>`;

export const slowDownPage = (wait) => page({
  title: "Slow down - Foogle",
  logo: LOGO,
  heading: "Whoa, you're browsing faster than the future can be written",
  body: `Every page here is invented on the spot, and you've been busy. Give the fake web ${duration(wait)} to catch its breath; pages you've already seen still load instantly.`,
  refresh: wait <= 120 ? wait : 0,
});

export const outOfJuicePage = (wait) => page({
  title: "Out of juice - Foogle",
  logo: DRAINED,
  heading: "Foogle is out of juice for today",
  body: `The future web has used up today's budget for inventing things. It recharges at midnight UTC, in about ${duration(wait)}. Pages and pictures someone has already visited still load.`,
});
