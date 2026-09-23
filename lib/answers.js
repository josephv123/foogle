// Instant answers and "Did you mean" on the All tab.
//
// One Jev request per results page (classifyQuery in lib/jev.js, ~0.3s) runs
// alongside the result shards. It says which card the query calls for, if
// any, whether the query gives that card anything to work on, and how likely
// the query is to hold a typo. Most queries get neither card nor typo and
// cost only that request, which nothing waits on. When a card is coming its
// slot is sized at once, usually long before the first result lands, so the
// results don't move when the card fills in.
//
// Code owns everything it can compute: the calculator, unit and currency
// conversion, clocks and chart series (public/fw/answers.js, shared with the
// browser), and a tool asked for with nothing in it ("calculator", "unit
// converter", "what time is it"), which opens at its defaults. The model only
// fills a small typed JSON object for the rest (weather, scores, stocks,
// definitions, flights, invented currencies), and code checks and completes
// it here before lib/answer-cards.js draws it, so a card always agrees with
// itself: the score is the sum of the quarters, today's high is above the
// current temperature, the chart ends at the price.

import {
  calc, units, exchange, parseConversion, findUnit, convertUnit, CURRENCIES, fxSeries, fxVol, stockSeries,
  tradingDay, rng,
} from "../public/fw/answers.js";
import { SLOTS, ANSWER_CSS, ANSWER_JS, RENDER, fill, clear, placeholder, didYouMean } from "./answer-cards.js";
import { answerPrompt, answerMaxTokens, spellPrompt, WX_CONDS } from "./prompts.js";
import { extractJSON } from "./llm.js";

// Jev's choice needs this probability before a card is shown, its typo
// estimate this much before the spelling is checked, and its "a tool with
// nothing in it" estimate this much before a tool opens at its defaults.
// Measured on a few dozen queries: real cards score ~1.0, lookalikes ("stock
// pot recipes") ~0; misspellings score 0.84-0.99, invented names and terse
// queries under 0.25; bare tools ("calc", "convert units", "time") 0.75-0.98,
// tools given their input ("km to miles", "time in lagos") under 0.15.
export const CARD_P = 0.6;
export const TYPO_P = 0.7;
export const BLANK_P = 0.5;

// ---------- small checks ----------
const str = (v, max = 80) => (typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim().slice(0, max) : "");
function numv(v, lo = -Infinity, hi = Infinity) {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? "").replace(/[,%$\s]/g, ""));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
}
const pct = (v) => Math.round(numv(v, 0, 100) ?? 0);
const cap = (s) => String(s ?? "").replace(/^\p{L}/u, (c) => c.toUpperCase());
const hex = (v, seed) => (/^#[0-9a-f]{6}$|^#[0-9a-f]{3}$/i.test(String(v ?? "").trim()) ? String(v).trim() : `hsl(${Math.floor(rng(seed)() * 360)},55%,38%)`);
const validTz = (tz) => {
  if (typeof tz !== "string" || !tz.includes("/")) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// The wall clock at a place: an IANA zone when there is one, else a fixed
// offset from UTC (a Mars colony keeps its own).
function wallClock(now, tz, utcOffset = 0) {
  const at = tz ? now : new Date(now.getTime() + utcOffset * 3_600_000);
  const zone = tz || "UTC";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  return {
    hour, minute: Number(parts.minute), weekday: WEEKDAYS.indexOf(parts.weekday), iso: `${parts.year}-${parts.month}-${parts.day}`,
    time: at.toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }),
    date: at.toLocaleDateString("en-US", { timeZone: zone, weekday: "long", month: "long", day: "numeric", year: "numeric" }),
  };
}
const hourLabel = (h) => `${h % 12 || 12} ${h % 24 < 12 ? "AM" : "PM"}`;

// ---------- answers code gives on its own ----------
// Cities whose clock needs no model: "time in lagos", "tokyo time".
const CITIES = [
  ["new york|nyc|new york city|manhattan|brooklyn", "America/New_York", "New York, NY, USA"],
  ["boston", "America/New_York", "Boston, MA, USA"], ["miami", "America/New_York", "Miami, FL, USA"], ["atlanta", "America/New_York", "Atlanta, GA, USA"],
  ["washington dc|washington d.c.|dc", "America/New_York", "Washington, DC, USA"], ["philadelphia", "America/New_York", "Philadelphia, PA, USA"],
  ["toronto", "America/Toronto", "Toronto, ON, Canada"], ["montreal", "America/Toronto", "Montreal, QC, Canada"],
  ["chicago", "America/Chicago", "Chicago, IL, USA"], ["houston", "America/Chicago", "Houston, TX, USA"], ["dallas", "America/Chicago", "Dallas, TX, USA"], ["austin", "America/Chicago", "Austin, TX, USA"],
  ["denver", "America/Denver", "Denver, CO, USA"], ["phoenix", "America/Phoenix", "Phoenix, AZ, USA"],
  ["los angeles|la|l.a.", "America/Los_Angeles", "Los Angeles, CA, USA"], ["san francisco|sf", "America/Los_Angeles", "San Francisco, CA, USA"],
  ["seattle", "America/Los_Angeles", "Seattle, WA, USA"], ["las vegas|vegas", "America/Los_Angeles", "Las Vegas, NV, USA"], ["san diego", "America/Los_Angeles", "San Diego, CA, USA"],
  ["vancouver", "America/Vancouver", "Vancouver, BC, Canada"], ["anchorage|alaska", "America/Anchorage", "Anchorage, AK, USA"], ["honolulu|hawaii", "Pacific/Honolulu", "Honolulu, HI, USA"],
  ["mexico city", "America/Mexico_City", "Mexico City, Mexico"], ["bogota|bogotá", "America/Bogota", "Bogotá, Colombia"], ["lima", "America/Lima", "Lima, Peru"],
  ["sao paulo|são paulo", "America/Sao_Paulo", "São Paulo, Brazil"], ["rio|rio de janeiro", "America/Sao_Paulo", "Rio de Janeiro, Brazil"],
  ["buenos aires", "America/Argentina/Buenos_Aires", "Buenos Aires, Argentina"], ["santiago", "America/Santiago", "Santiago, Chile"],
  ["reykjavik", "Atlantic/Reykjavik", "Reykjavík, Iceland"], ["london|uk|england", "Europe/London", "London, UK"], ["dublin|ireland", "Europe/Dublin", "Dublin, Ireland"],
  ["lisbon|portugal", "Europe/Lisbon", "Lisbon, Portugal"], ["paris|france", "Europe/Paris", "Paris, France"], ["madrid|spain", "Europe/Madrid", "Madrid, Spain"],
  ["barcelona", "Europe/Madrid", "Barcelona, Spain"], ["berlin|germany", "Europe/Berlin", "Berlin, Germany"], ["rome|italy", "Europe/Rome", "Rome, Italy"],
  ["amsterdam|netherlands", "Europe/Amsterdam", "Amsterdam, Netherlands"], ["brussels", "Europe/Brussels", "Brussels, Belgium"], ["zurich", "Europe/Zurich", "Zürich, Switzerland"],
  ["vienna", "Europe/Vienna", "Vienna, Austria"], ["stockholm|sweden", "Europe/Stockholm", "Stockholm, Sweden"], ["oslo|norway", "Europe/Oslo", "Oslo, Norway"],
  ["copenhagen|denmark", "Europe/Copenhagen", "Copenhagen, Denmark"], ["helsinki|finland", "Europe/Helsinki", "Helsinki, Finland"], ["warsaw|poland", "Europe/Warsaw", "Warsaw, Poland"],
  ["prague", "Europe/Prague", "Prague, Czechia"], ["athens|greece", "Europe/Athens", "Athens, Greece"], ["istanbul|turkey", "Europe/Istanbul", "Istanbul, Türkiye"],
  ["kyiv|kiev|ukraine", "Europe/Kyiv", "Kyiv, Ukraine"], ["moscow", "Europe/Moscow", "Moscow, Russia"],
  ["cairo|egypt", "Africa/Cairo", "Cairo, Egypt"], ["lagos|nigeria", "Africa/Lagos", "Lagos, Nigeria"], ["accra|ghana", "Africa/Accra", "Accra, Ghana"],
  ["nairobi|kenya", "Africa/Nairobi", "Nairobi, Kenya"], ["addis ababa|ethiopia", "Africa/Addis_Ababa", "Addis Ababa, Ethiopia"], ["casablanca|morocco", "Africa/Casablanca", "Casablanca, Morocco"],
  ["johannesburg|south africa", "Africa/Johannesburg", "Johannesburg, South Africa"], ["cape town", "Africa/Johannesburg", "Cape Town, South Africa"],
  ["dubai|uae", "Asia/Dubai", "Dubai, UAE"], ["riyadh|saudi arabia", "Asia/Riyadh", "Riyadh, Saudi Arabia"], ["tehran|iran", "Asia/Tehran", "Tehran, Iran"],
  ["karachi|pakistan", "Asia/Karachi", "Karachi, Pakistan"], ["mumbai|bombay", "Asia/Kolkata", "Mumbai, India"], ["delhi|new delhi|india", "Asia/Kolkata", "New Delhi, India"],
  ["bangalore|bengaluru", "Asia/Kolkata", "Bengaluru, India"], ["dhaka|bangladesh", "Asia/Dhaka", "Dhaka, Bangladesh"], ["kathmandu|nepal", "Asia/Kathmandu", "Kathmandu, Nepal"],
  ["bangkok|thailand", "Asia/Bangkok", "Bangkok, Thailand"], ["jakarta|indonesia", "Asia/Jakarta", "Jakarta, Indonesia"], ["singapore", "Asia/Singapore", "Singapore"],
  ["kuala lumpur|malaysia", "Asia/Kuala_Lumpur", "Kuala Lumpur, Malaysia"], ["manila|philippines", "Asia/Manila", "Manila, Philippines"], ["hong kong", "Asia/Hong_Kong", "Hong Kong"],
  ["shanghai", "Asia/Shanghai", "Shanghai, China"], ["beijing|china", "Asia/Shanghai", "Beijing, China"], ["taipei|taiwan", "Asia/Taipei", "Taipei, Taiwan"],
  ["seoul|south korea|korea", "Asia/Seoul", "Seoul, South Korea"], ["tokyo|japan", "Asia/Tokyo", "Tokyo, Japan"], ["osaka", "Asia/Tokyo", "Osaka, Japan"],
  ["sydney|australia", "Australia/Sydney", "Sydney, Australia"], ["melbourne", "Australia/Melbourne", "Melbourne, Australia"], ["brisbane", "Australia/Brisbane", "Brisbane, Australia"],
  ["perth", "Australia/Perth", "Perth, Australia"], ["auckland|new zealand", "Pacific/Auckland", "Auckland, New Zealand"],
].flatMap(([names, tz, label]) => names.split("|").map((n) => [n, { tz, place: label }]));
const CITY = new Map(CITIES);

export function cityTime(query) {
  const q = String(query ?? "").toLowerCase().trim().replace(/[?.!]+$/, "");
  const m = q.match(/^(?:what(?:'s| is) the )?(?:(?:current|local) )*time(?: is it)?(?: right)?(?: now)? in (.+?)(?: right)?(?: now)?$/)
    ?? q.match(/^what time is it in (.+)$/) ?? q.match(/^(.+?) (?:local |current )?time(?: now)?$/);
  const hit = m && CITY.get(m[1].trim());
  return hit ? { ...hit, utcOffset: null } : null;
}

// The card code can give without the model, or null. `strict` says whether
// code alone is sure enough to show it when there is no Jev to ask: "7-11"
// is arithmetic, but more likely a shop.
export function byCode(query) {
  const c = calc(query);
  if (c) return { type: "calculator", raw: { expr: c.expr }, strict: !/^\s*\d+\s*[-/]\s*\d+\s*$/.test(query) };
  const u = units(query);
  if (u) return { type: "units", raw: u, strict: true };
  const x = exchange(query);
  if (x) return { type: "currency", raw: { amount: x.amount, from: { code: x.from }, to: { code: x.to } }, strict: !parseConversion(query)?.loose };
  const t = cityTime(query);
  if (t) return { type: "time", raw: t, strict: true };
  return null;
}

// ---------- checking and completing what the model filled in ----------
const COND_WORDS = [
  ["dust storm", /dust|sand/], ["thunderstorm", /thunder|lightning|storm/], ["sleet", /sleet|freezing|ice|hail/], ["snow", /snow|flurr|blizzard/],
  ["showers", /shower/], ["drizzle", /drizzle/], ["rain", /rain/], ["fog", /fog|mist/], ["haze", /haze|smog|smoke/], ["windy", /wind|gust|breez/],
  ["partly cloudy", /partly|mostly sunny|mostly clear|few clouds|scattered/], ["cloudy", /cloud|overcast|grey|gray/], ["clear", /clear|fair/], ["sunny", /sun|hot/],
];
const condition = (v) => {
  const s = String(v ?? "").toLowerCase();
  return WX_CONDS.includes(s) ? s : COND_WORDS.find(([, re]) => re.test(s))?.[0] ?? "cloudy";
};

// A day's temperature at hour h: coolest around 5 AM, warmest around 3 PM.
function curve(day, h) {
  h = ((h % 24) + 24) % 24;
  const amp = day.hi - day.lo;
  if (h >= 5 && h <= 15) return day.lo + (amp * (1 - Math.cos((Math.PI * (h - 5)) / 10))) / 2;
  return day.hi - (amp * (1 - Math.cos((Math.PI * ((h + 9) % 24)) / 14))) / 2;
}

function weather(raw, { now }) {
  const unit = /^f/i.test(str(raw.unit)) ? "F" : "C";
  const range = unit === "F" ? [-240, 140] : [-150, 60];
  const tz = validTz(raw.tz) ? raw.tz : null;
  const clock = wallClock(now, tz, numv(raw.utcOffset, -14, 14) ?? 0);
  const place = str(raw.place, 60);
  const temp = numv(raw.now?.temp, ...range);
  const days = (Array.isArray(raw.days) ? raw.days : []).slice(0, 8).map((d) => ({
    hi: numv(d?.hi, ...range), lo: numv(d?.lo, ...range), cond: condition(d?.cond), precip: pct(d?.precip), wind: Math.round(numv(d?.wind, 0, 500) ?? 0),
  })).filter((d) => d.hi != null && d.lo != null);
  if (!place || temp == null || days.length < 3) throw new Error("weather card is missing its place or temperatures");
  for (const d of days) if (d.hi < d.lo) [d.hi, d.lo] = [d.lo, d.hi];
  // It can't be warmer now than today's high.
  days[0].hi = Math.max(days[0].hi, temp);
  days[0].lo = Math.min(days[0].lo, temp);
  const nowData = { temp, cond: condition(raw.now?.cond), precip: pct(raw.now?.precip), humidity: pct(raw.now?.humidity), wind: Math.round(numv(raw.now?.wind, 0, 500) ?? days[0].wind) };
  days[0].precip = Math.max(days[0].precip, nowData.precip);
  const r = rng(`${place}|${clock.iso}`);
  const round5 = (v) => Math.min(100, Math.max(0, Math.round(v / 5) * 5));
  const out = days.map((d, i) => {
    // Hourly detail, in three-hour steps: from now for today, from midnight after.
    const start = i ? 0 : clock.hour;
    const slots = Array.from({ length: 8 }, (_, k) => start + k * 3);
    const shift = i ? 0 : temp - curve(d, start);
    const next = days[i + 1] ?? d;
    const hours = {
      time: slots.map((h) => hourLabel(h % 24)),
      temp: slots.map((h) => Number((curve(h < 24 ? d : next, h) + shift * Math.exp(-(h - start) / 5)).toFixed(1))),
      precip: slots.map(() => (d.precip ? round5(d.precip * (0.3 + 0.8 * r())) : 0)),
      wind: slots.map(() => Math.max(0, Math.round(d.wind * (0.7 + 0.6 * r())))),
    };
    // The day's chance of rain is its likeliest hour's; today starts from now.
    const peak = hours.precip.indexOf(Math.max(...hours.precip));
    hours.precip[i ? peak : 0] = i ? d.precip : nowData.precip;
    if (!i) hours.wind[0] = nowData.wind;
    const humidity = i ? pct(nowData.humidity + (d.precip - nowData.precip) * 0.3 + (r() - 0.5) * 10) : nowData.humidity;
    const name = WEEKDAYS[(clock.weekday + i) % 7];
    return { ...d, humidity, name, short: name.slice(0, 3), hours };
  });
  const night = clock.hour < 6 || clock.hour >= 19;
  return {
    place, unit, speed: unit === "F" ? "mph" : "km/h", now: nowData, night, days: out,
    nowLabel: `${WEEKDAYS[clock.weekday]} ${clock.time}`,
  };
}

function calculator(raw, { query }) {
  const c = calc(str(raw.expr, 200));
  if (!c) throw new Error("not arithmetic");
  return { shown: str(query, 120).replace(/[\s=?]+$/, ""), value: c.value };
}

function unitConversion(raw) {
  const value = numv(raw.value);
  const a = UNIT_BY_ID(raw.cat, raw.from) ?? findUnit(raw.from);
  const b = UNIT_BY_ID(raw.cat, raw.to) ?? findUnit(raw.to);
  if (value == null || !a || !b || a[0] !== b[0]) throw new Error("not a unit conversion");
  return { cat: a[0], from: a[1], to: b[1], value, result: convertUnit(value, a[0], a[1], b[1]) };
}
const UNIT_BY_ID = (cat, id) => (cat && id ? [cat, id] : null);

function currency(raw, { now }) {
  const extra = [];
  const side = (x) => {
    const code = str(x?.code, 5).toUpperCase().replace(/[^A-Z]/g, "");
    const known = CURRENCIES.find((c) => c[0] === code);
    if (known) return code;
    const perUSD = numv(x?.perUSD, 1e-9, 1e12);
    const name = str(x?.name, 40);
    if (!code || !perUSD || !name) throw new Error("currency card is missing a rate");
    if (!extra.some((c) => c[0] === code)) extra.push([code, cap(name), code, perUSD, "", true]);
    return code;
  };
  const from = side(raw.from);
  const to = side(raw.to);
  if (from === to) throw new Error("same currency on both sides");
  const list = [...extra, ...CURRENCIES];
  const row = (code) => list.find((c) => c[0] === code);
  const rate = row(to)[3] / row(from)[3];
  const today = now.toISOString().slice(0, 10);
  const stamp = `${now.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}, ${now.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" })} UTC`;
  return {
    amount: numv(raw.amount, 0, 1e15) ?? 1, from, to, rate, extra, today, stamp, range: "1M",
    series: fxSeries({ seed: `${from}>${to}|${today}`, rate, vol: fxVol(row(from), row(to)) }),
  };
}

// New York's clock decides whether the market is open, and which session the
// chart shows.
function session(now) {
  const ny = wallClock(now, "America/New_York");
  const abbr = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "ET";
  const minutes = ny.hour * 60 + ny.minute;
  const weekday = ny.weekday > 0 && ny.weekday < 6;
  const short = (d) => d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  if (weekday && minutes >= 570 && minutes < 960) {
    return { today: ny.iso, progress: (minutes - 570) / 390, stamp: `${short(new Date(`${ny.iso}T12:00:00Z`))}, ${ny.time} ${abbr}` };
  }
  const today = weekday && minutes >= 960 ? ny.iso : tradingDay(ny.iso, 1).toISOString().slice(0, 10);
  return { today, progress: 1, stamp: `At close: ${short(new Date(`${today}T12:00:00Z`))}, 4:00 PM ${abbr}` };
}

function stock(raw, { now }) {
  const price = numv(raw.price, 1e-4, 1e7);
  const name = str(raw.name, 60);
  const ticker = str(raw.ticker, 8).toUpperCase().replace(/[^A-Z0-9.]/g, "");
  if (!price || !name || !ticker) throw new Error("stock card is missing its price or name");
  // A believable day: yesterday's close within 25% of today's price.
  const prevClose = Math.min(price * 1.25, Math.max(price / 1.25, numv(raw.prevClose, 1e-4, 1e7) ?? price));
  const near = (v) => { const n = numv(v, 1e-4, 1e7); return n && n < price * 100 && n > price / 100 ? n : null; };
  const hist = Object.fromEntries(["d5", "m1", "m6", "ytd", "y1", "y5"].map((k) => [k, near(raw.hist?.[k])]));
  const s = session(now);
  const ytdDays = Math.max(1, Math.round(((new Date(`${s.today}T12:00:00Z`) - new Date(`${s.today.slice(0, 4)}-01-01T12:00:00Z`)) / 86_400_000) * (5 / 7)));
  const series = { seed: `${ticker}|${s.today}`, price, prevClose, hist, ytdDays, session: s.progress };
  const { ranges, open, high, low, high52, low52 } = stockSeries(series);
  return {
    name, ticker, exchange: str(raw.exchange, 12) || "NASDAQ", currency: str(raw.currency, 4).toUpperCase() || "USD", price, prevClose,
    mktCap: /^[\d.,]+\s*[KMBT]?$/i.test(str(raw.mktCap, 12)) ? str(raw.mktCap, 12) : null, pe: numv(raw.pe, 0, 1e5), divYield: numv(raw.divYield, 0, 100),
    series, today: s.today, stamp: s.stamp, ranges, open, high, low, high52, low52,
  };
}

function dictionary(raw) {
  const word = str(raw.word, 40);
  const senses = (Array.isArray(raw.senses) ? raw.senses : []).slice(0, 2).map((s) => ({
    pos: str(s?.pos, 20).toLowerCase(),
    defs: (Array.isArray(s?.defs) ? s.defs : []).slice(0, 3).map((d) => ({
      def: str(d?.def, 300), ex: str(d?.ex, 200), syn: (Array.isArray(d?.syn) ? d.syn : []).map((w) => str(w, 30)).filter(Boolean).slice(0, 4),
    })).filter((d) => d.def),
  })).filter((s) => s.pos && s.defs.length);
  if (!word || !senses.length) throw new Error("dictionary card has no definitions");
  return { word, syllables: str(raw.syllables, 60), phonetic: str(raw.phonetic, 60), senses, origin: str(raw.origin, 400) };
}

function time(raw, { now }) {
  const tz = validTz(raw.tz) ? raw.tz : null;
  const utcOffset = numv(raw.utcOffset, -14, 14);
  const place = str(raw.place, 60);
  if (!place || (!tz && utcOffset == null)) throw new Error("time card has no zone");
  const clock = wallClock(now, tz, utcOffset ?? 0);
  const abbr = str(raw.abbr, 8) || (tz ? new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value : "");
  return { place, tz, utcOffset: utcOffset ?? 0, abbr, time: clock.time, date: clock.date };
}

// Box-score columns for each sport.
const PERIODS = { basketball: ["1", "2", "3", "4"], "american football": ["1", "2", "3", "4"], hockey: ["1", "2", "3"], soccer: ["1", "2"], baseball: ["1", "2", "3", "4", "5", "6", "7", "8", "9"] };
const ink = (color) => {
  const m = String(color).match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return "#fff";
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? "#202124" : "#fff";
};
// "Tue, Oct 20" as a date near `now`: this year, or next if that's long past.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function dayOf(text, now) {
  const m = String(text).toLowerCase().match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})\b/);
  const month = m ? MONTHS.indexOf(m[1]) : -1;
  if (month < 0) return null;
  const d = new Date(Date.UTC(now.getUTCFullYear(), month, Number(m[2])));
  if (now - d > 120 * 86_400_000) d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

function sports(raw, { now }) {
  const sport = Object.hasOwn(PERIODS, str(raw.sport).toLowerCase()) ? str(raw.sport).toLowerCase() : "other";
  const teamName = str(raw.team, 50);
  const initials = (s) => s.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase();
  const side = (t) => {
    const name = str(t?.name, 40);
    const periods = (Array.isArray(t?.periods) ? t.periods : []).slice(0, 12).map((p) => Math.round(numv(p, 0, 999) ?? 0));
    const color = hex(t?.color, name);
    return { name, abbr: str(t?.abbr, 4).toUpperCase() || initials(name), color, ink: ink(color), record: str(t?.record, 12), periods };
  };
  const g = raw.last ?? {};
  const home = side(g.home);
  const away = side(g.away);
  if (!teamName || !home.name || !away.name) throw new Error("sports card is missing its teams");
  // The score is what the periods add up to; overtime adds columns.
  const n = Math.max(home.periods.length, away.periods.length);
  for (const t of [home, away]) {
    while (t.periods.length < n) t.periods.push(0);
    t.score = t.periods.length ? t.periods.reduce((a, b) => a + b, 0) : Math.round(numv(g[t === home ? "homeScore" : "awayScore"], 0) ?? 0);
  }
  const base = PERIODS[sport] ?? [];
  const labels = Array.from({ length: n }, (_, i) => base[i] ?? (sport === "baseball" ? String(i + 1) : i >= base.length && base.length ? (i === base.length ? "OT" : `${i - base.length + 1}OT`) : String(i + 1)));
  const live = /live|progress/i.test(str(g.status));
  const status = live ? "Live" : n > base.length && base.length && sport !== "baseball" ? "Final/OT" : "Final";
  const mine = [home, away].find((t) => teamName.toLowerCase().includes(t.name.toLowerCase().split(" ").pop())) ?? home;
  const color = hex(raw.color, teamName);
  return {
    team: teamName, abbr: str(raw.abbr, 4).toUpperCase() || mine.abbr, color, ink: ink(color), league: str(raw.league, 40), standing: str(raw.standing, 50), sport,
    last: { date: str(g.date, 20), status, clock: live ? str(g.clock, 16) : null, venue: str(g.venue, 50), home, away, labels },
    // Upcoming games are after today, whatever the model thought.
    next: (Array.isArray(raw.next) ? raw.next : []).map((x) => ({ date: str(x?.date, 20), time: str(x?.time, 12), opp: str(x?.opp, 40), home: x?.home !== false, tv: str(x?.tv, 24) }))
      .filter((x) => x.date && x.opp && !(dayOf(x.date, now) < new Date(now.toISOString().slice(0, 10)))).slice(0, 3),
    standings: (Array.isArray(raw.standings) ? raw.standings : []).slice(0, 6).map((s) => ({ team: str(s?.team, 40), w: Math.round(numv(s?.w, 0, 200) ?? 0), l: Math.round(numv(s?.l, 0, 200) ?? 0) }))
      .filter((s) => s.team).sort((a, b) => b.w / (b.w + b.l || 1) - a.w / (a.w + a.l || 1))
      .map((s) => ({ ...s, me: s.team.toLowerCase().includes(teamName.toLowerCase().split(" ").pop()) })),
  };
}

const STATUSES = [["Cancelled", /cancel/], ["Diverted", /divert/], ["Landed", /land|arriv/], ["Delayed", /delay/], ["In flight", /flight|air|route|cruis/], ["Departed", /depart|took off/], ["Boarding", /board/], ["Scheduled", /./]];
const minutesOf = (t) => {
  const m = String(t ?? "").match(/(\d{1,2}):(\d{2})\s*([ap])?/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3]?.toLowerCase() === "p" || (!m[3] && Number(m[1]) >= 12)) h += 12;
  return h * 60 + Number(m[2]);
};
function flight(raw) {
  const leg = (x) => ({
    code: str(x?.code, 4).toUpperCase(), city: str(x?.city, 40), sched: str(x?.sched, 10), actual: str(x?.actual, 10) || null,
    terminal: str(x?.terminal, 6) || null, gate: str(x?.gate, 6) || null,
  });
  const from = leg(raw.from);
  const to = leg(raw.to);
  const number = str(raw.number, 10).toUpperCase();
  if (!number || !from.code || !to.code || !from.sched) throw new Error("flight card is missing its route");
  let status = STATUSES.find(([, re]) => re.test(str(raw.status).toLowerCase()))[0];
  // Late by the card's own times, whatever the status says.
  const late = (x) => {
    const a = minutesOf(x.actual);
    const s = minutesOf(x.sched);
    if (a == null || s == null) return 0;
    return ((a - s + 720 + 1440) % 1440) - 720;
  };
  const dep = late(from);
  const arr = late(to);
  const flying = ["Departed", "In flight", "Landed", "Diverted"].includes(status);
  if (status === "Scheduled" && dep >= 15) status = "Delayed";
  from.late = dep >= 15;
  to.late = arr >= 15;
  const tone = ["Cancelled", "Diverted"].includes(status) ? "bad" : status === "Delayed" || (flying ? arr >= 15 : dep >= 15) ? "late" : "ok";
  const progress = status === "Landed" ? 1 : flying ? Math.min(0.95, Math.max(0.05, numv(raw.progress, 0, 1) ?? 0.5)) : 0;
  const note = status === "Landed" && arr >= 15 ? `Arrived ${arr} min late`
    : status === "Landed" && arr <= -10 ? `Arrived ${-arr} min early`
    : flying && dep >= 15 ? `Departed ${dep} min late`
    : status === "Delayed" && dep > 0 ? `Departure delayed ${dep} min` : "";
  return {
    airline: str(raw.airline, 40), number, date: str(raw.date, 20), aircraft: str(raw.aircraft, 30), duration: str(raw.duration, 10),
    status: status === "Scheduled" ? "On time" : status, tone, progress, from, to, note,
    verbs: [flying ? "Departed" : "Departs", status === "Landed" ? "Arrived" : "Arrives"],
  };
}

export const NORMALIZE = { weather, calculator, units: unitConversion, currency, stock, dictionary, time, sports, flight };

// ---------- tools with nothing in them ----------
// What a tool shows when the query asks only for the tool ("calculator",
// "currency converter", "what time is it"), as Google's do: the calculator at
// 0, a meter in centimeters, a dollar in euros, and the visitor's own clock,
// which only their browser knows. Code draws these without the model; cards
// that need data (weather, stocks…) have none.
export const BLANK = {
  calculator: () => ({ shown: "", value: 0 }),
  units: () => unitConversion({ value: 1, cat: "length", from: "meter", to: "centimeter" }),
  currency: (ctx) => currency({ amount: 1, from: { code: "USD" }, to: { code: "EUR" } }, ctx),
  time: () => ({ local: true, place: "", tz: null, utcOffset: 0, abbr: "", time: "", date: "" }),
};

// ---------- did you mean ----------
// Damerau-Levenshtein distance (with adjacent swaps: recieve/receive is 1).
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// The correction, if it is one worth offering: the same query with at most
// two words respelled, each only slightly ("wether" -> "weather", "alot" ->
// "a lot"). A rewrite, an added word or a changed name is refused.
export function checkFix(query, fixed) {
  if (typeof fixed !== "string") return null;
  const clean = fixed.replace(/\s+/g, " ").trim();
  const a = query.toLowerCase().trim().split(/\s+/);
  const b = clean.toLowerCase().split(" ");
  if (!clean || a.join(" ") === b.join(" ") || Math.abs(a.length - b.length) > 1 || clean.length > query.length + 12) return null;
  // Strip the shared start and end; what's left in the middle is the change.
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const from = a.slice(s, a.length - e);
  const to = b.slice(s, b.length - e);
  if (!from.length || !to.length || from.length > 2 || to.length > 2) return null;
  for (let k = 0; k < Math.max(from.length, to.length); k++) {
    const x = from.length === to.length ? from[k] : from.join("");
    const y = from.length === to.length ? to[k] : to.join("");
    if (from.length !== to.length && k) break;
    const limit = Math.max(1, Math.min(3, Math.floor(Math.max(x.length, y.length) / 3)));
    if (x !== y && distance(x, y) > limit) return null;
  }
  return clean;
}

// ---------- the flow ----------
const withTimeout = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took over ${ms / 1000}s`)), ms).unref?.())]);

// Which card to show: Jev's choice when it's confident, with code settling
// units against currency ("10 pounds to euros"); without Jev, only what code
// is sure of on its own.
export function decide(jev, code) {
  if (!jev) return code?.strict ? code.type : null;
  if (jev.type === "none" || jev.p < CARD_P) return null;
  const convert = ["units", "currency"];
  if (code && convert.includes(jev.type) && convert.includes(code.type)) return code.type;
  return jev.type;
}

// complete: lib/llm.js completeText. classify: lib/jev.js classifyQuery.
// charge(req, action): whether this visitor may spend on it (lib/limits.js).
export function createAnswers({ complete, classify, charge = () => true, now = () => new Date(), fillTimeoutMs = 12_000, spellTimeoutMs = 6000, log = console } = {}) {
  async function model(spec, maxTokens, ms, what) {
    return extractJSON(await withTimeout(complete({ ...spec, maxTokens, temperature: 0.7 }), ms, what));
  }

  return {
    // Two empty slots above the results; they only take space once something
    // is coming.
    slots: SLOTS,
    // Hides whatever is still waiting when the results page ends.
    abandon: `<style>#ia.wait,#dym.wait{display:none}</style>`,

    // Runs alongside the results. emit writes to the page (it ignores writes
    // after the page has ended); shown says whether results are on screen yet.
    async start(query, { req, emit, shown = () => false }) {
      const t0 = Date.now();
      const at = now();
      let styled = false;
      const send = (html) => {
        emit(styled ? html : ANSWER_CSS + html);
        styled = true;
      };
      const code = byCode(query);
      let jev = null;
      try {
        jev = await classify(query);
      } catch (err) {
        log.warn(`[answers] classifier unavailable (${err.message}); code answers only`);
      }
      const type = decide(jev, code);
      // Code can't read an input from the query, and Jev says it gave none.
      const blank = type && code?.type !== type && Object.hasOwn(BLANK, type) && jev?.blank >= BLANK_P;
      if (jev || type) log.log(`[answers] "${query}" → ${type ?? "no card"}${blank ? " (blank)" : ""}${jev ? ` (${jev.type} ${jev.p.toFixed(2)}, blank ${(jev.blank ?? 0).toFixed(2)}, typo ${jev.typo.toFixed(2)})` : " (code)"} +${((Date.now() - t0) / 1000).toFixed(2)}s`);

      const spell = async () => {
        send(`<script>document.getElementById("dym").className="dym wait"</script>\n`);
        let fixed = null;
        try {
          fixed = checkFix(query, (await model(spellPrompt(query), 60, spellTimeoutMs, "spelling"))?.fixed);
        } catch (err) {
          log.warn(`[answers] spelling: ${err.message}`);
        }
        emit(fixed ? fill("dym", didYouMean(query, fixed), "ld") : clear("dym"));
        if (fixed) log.log(`[answers] did you mean "${fixed}" +${((Date.now() - t0) / 1000).toFixed(2)}s`);
      };

      const card = async () => {
        const own = code?.type === type ? code.raw : null;
        // Code alone draws it: from the query's own input, or at its defaults.
        const free = own || blank;
        // Arriving after the results have appeared, the card slides open
        // instead of jumping in.
        const grow = shown() ? " grow" : "";
        if (!free) {
          if (!charge(req, "answer")) return;
          send(fill("ia", placeholder(type), `wait${grow}`));
        }
        try {
          const ctx = { query, now: at };
          const data = blank ? BLANK[type](ctx)
            : NORMALIZE[type](own ?? await model(answerPrompt(type, query, { now: at }), answerMaxTokens(type), fillTimeoutMs, `${type} card`), ctx);
          send(fill("ia", RENDER[type](data, query), `ld${free ? grow : ""}`) + ANSWER_JS);
          log.log(`[answers] ${type} card +${((Date.now() - t0) / 1000).toFixed(2)}s`);
        } catch (err) {
          log.warn(`[answers] ${type} card: ${err.message}`);
          if (!free) emit(clear("ia"));
        }
      };

      await Promise.all([
        jev && jev.typo >= TYPO_P && charge(req, "spell") ? spell() : null,
        type ? card() : null,
      ]);
    },
  };
}
