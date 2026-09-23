// HTML for the instant-answer cards at the top of the All tab, and for the
// "Did you mean" line. Every card is drawn by code from a small, already
// validated object (lib/answers.js normalizes what the model filled in); the
// model never writes markup here. Interactivity comes from the trusted
// runtime public/fw/answers.js, which reads each card's data-ia-data.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { UNITS, CURRENCIES, fmt, num, money, unitValue, unitFormula, chartHTML, rangeLabels, wxChart } from "../public/fw/answers.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = (s) => String(s ?? "").replace(/^\p{L}/u, (c) => c.toUpperCase());

// ---------- the runtime ----------
// Versioned by content, like the widget runtime (lib/widgets.js), since /fw/
// is served as immutable.
const asset = (file) => readFileSync(new URL(`../public/fw/${file}`, import.meta.url));
const version = createHash("sha1").update(asset("answers.js")).update(asset("answers.css")).digest("hex").slice(0, 8);
export const ANSWER_CSS = `<link rel="stylesheet" href="/fw/answers.css?v=${version}">`;
export const ANSWER_JS = `<script type="module" src="/fw/answers.js?v=${version}" async></script>`;

// ---------- slots ----------
// The results page reserves two empty slots above the results. Content
// arrives out of order, as a <template> plus a line of script that moves it
// into its slot (the same trick as the Foogle Overview panel).
export const SLOTS = `<div id="dym" class="dym"></div><div id="ia" class="ia"></div>`;

export function fill(slot, html, cls = "") {
  return `<template id="${slot}-t">${html}</template><script>(()=>{const t=document.getElementById("${slot}-t"),s=document.getElementById("${slot}");s.replaceChildren(t.content);s.className=${JSON.stringify(`${slot} ${cls}`.trim())};t.remove()})()</script>\n`;
}
export const clear = (slot) => `<script>(()=>{const s=document.getElementById("${slot}");s.replaceChildren();s.className="${slot}"})()</script>\n`;

// A placeholder the size of the card that is coming, so the results below
// don't move when it lands.
export const placeholder = (type) =>
  `<div class="ia-card ia-${type} ia-skel" aria-busy="true"><div class="bar" style="width:34%"></div><div class="bar" style="width:58%;height:34px"></div><div class="bar" style="width:86%"></div><div class="bar" style="width:72%"></div></div>`;

const card = (type, inner, data = {}, attrs = "") =>
  `<div class="ia-card ia-${type}" data-ia="${type}" data-ia-data="${esc(JSON.stringify(data))}"${attrs}>${inner}</div>`;

// A link into the fake web, as if the card's data came from a site there.
const webLink = (domain, path, label, query) =>
  `<a href="/web/${domain}${path}?fq=${encodeURIComponent(query)}&amp;ft=${encodeURIComponent(label)}">${esc(label)}</a>`;
const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
const footer = (source) => `<div class="ia-foot">${source}</div>`;

const tabBar = (group, tabs, active) =>
  `<div class="ia-tabs" data-ia-tabs="${group}" role="tablist">${tabs.map(([key, label]) => `<button type="button" role="tab" data-tab="${esc(key)}" aria-selected="${key === active}">${esc(label ?? key)}</button>`).join("")}</div>`;

// ---------- did you mean ----------
// Google's line: "Did you mean: <b><i>receive</i></b> package". Only the
// corrected words are emphasised.
export function didYouMean(original, fixed) {
  const a = original.toLowerCase().split(/\s+/);
  const b = fixed.split(/\s+/);
  const keep = lcsKeep(a, b.map((w) => w.toLowerCase()));
  const words = b.map((w, i) => (keep.has(i) ? esc(w) : `<b><i>${esc(w)}</i></b>`)).join(" ");
  return `<p class="dym-line">Did you mean: <a href="/search?q=${encodeURIComponent(fixed)}">${words}</a></p>`;
}

// Indexes of b's words that are part of a longest common subsequence with a.
function lcsKeep(a, b) {
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const keep = new Set();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { keep.add(j); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return keep;
}

// ---------- calculator ----------
const KEYPAD = [
  [["rad", "Rad", "fn on"], ["deg", "Deg", "fn"], ["!", "x!", "fn"], ["(", "(", "fn"], [")", ")", "fn"], ["%", "%", "fn"], ["ac", "AC", "fn"]],
  [["inv", "Inv", "fn"], ["sin", "sin", "fn", "sin<sup>−1</sup>"], ["ln", "ln", "fn", "e<sup>x</sup>"], ["7", "7"], ["8", "8"], ["9", "9"], ["/", "÷", "fn"]],
  [["pi", "π", "fn"], ["cos", "cos", "fn", "cos<sup>−1</sup>"], ["log", "log", "fn", "10<sup>x</sup>"], ["4", "4"], ["5", "5"], ["6", "6"], ["*", "×", "fn"]],
  [["e", "e", "fn"], ["tan", "tan", "fn", "tan<sup>−1</sup>"], ["sqrt", "√", "fn", "x<sup>2</sup>"], ["1", "1"], ["2", "2"], ["3", "3"], ["-", "−", "fn"]],
  [["ans", "Ans", "fn"], ["exp", "EXP", "fn"], ["pow", "x<sup>y</sup>", "fn", "<sup>y</sup>√x"], ["0", "0"], [".", "."], ["=", "=", "eq"], ["+", "+", "fn"]],
];
export function calcCard(d) {
  const keys = KEYPAD.flat().map(([k, label, cls = "", inv]) =>
    `<button type="button" data-k="${esc(k)}" class="${cls}"${inv ? ` data-inv="${esc(inv)}"` : ""}>${label}</button>`).join("");
  // An empty calculator ("calculator") has nothing on its top line.
  return card("calculator", `<div class="ia-calc-screen"><div class="ia-calc-top">${d.shown ? `${esc(d.shown)} =` : ""}</div><div class="ia-calc-main">${esc(fmt(d.value))}</div></div><div class="ia-keys">${keys}</div>`, { value: d.value }, ' tabindex="0" aria-label="Calculator"');
}

// ---------- unit converter ----------
const unitOptions = (cat, pick) => UNITS[cat].units.map(([id, label]) => `<option value="${id}"${id === pick ? " selected" : ""}>${esc(label)}</option>`).join("");
export function unitsCard(d) {
  const cats = Object.entries(UNITS).map(([k, u]) => `<option value="${k}"${k === d.cat ? " selected" : ""}>${esc(u.label)}</option>`).join("");
  const side = (value, pick, label) => `<div class="ia-side"><input class="ia-num" inputmode="decimal" aria-label="${label}" value="${esc(value)}"><select class="ia-unit" aria-label="${label} unit">${unitOptions(d.cat, pick)}</select></div>`;
  return card("units", `<select class="ia-cat" aria-label="Unit type">${cats}</select>
<div class="ia-conv">${side(fmt(d.value), d.from, "From")}<div class="ia-eq">=</div>${side(unitValue(d.result), d.to, "To")}</div>
<div class="ia-formula"><b>Formula</b><span class="ia-formula-text">${esc(unitFormula(d.cat, d.from, d.to, d.value))}</span></div>`, {});
}

// ---------- currency ----------
export function currencyCard(d) {
  const list = [...d.extra, ...CURRENCIES];
  const row = (code) => list.find((c) => c[0] === code);
  const options = (pick) => list.map(([code, name]) => `<option value="${code}"${code === pick ? " selected" : ""}>${esc(name)}</option>`).join("");
  const range = d.series[d.range];
  const up = range.pts.at(-1) >= range.pts[0];
  return card("currency", `<div class="ia-fx-head">${esc(num(d.amount, 2))} ${esc(row(d.from)[1])} equals</div>
<div class="ia-fx-big"><span>${esc(num(d.amount * d.rate, 2))}</span> <span>${esc(row(d.to)[1])}</span></div>
<div class="ia-meta">${esc(d.stamp)} · Disclaimer</div>
<div class="ia-conv"><div class="ia-side"><input class="ia-num" inputmode="decimal" aria-label="Amount" value="${esc(d.amount)}"><select class="ia-cur" aria-label="From currency">${options(d.from)}</select></div>
<div class="ia-side"><input class="ia-num" inputmode="decimal" aria-label="Converted amount" value="${esc((d.amount * d.rate).toFixed(2))}"><select class="ia-cur" aria-label="To currency">${options(d.to)}</select></div></div>
${tabBar("r", Object.keys(d.series).map((k) => [k]), d.range)}
<div class="ia-chart"><div class="ia-plot">${chartHTML(range.pts, { color: up ? "#137333" : "#a50e0e", xLabels: rangeLabels(range, d.today), yFmt: (v) => num(v, 3) })}</div></div>`,
  { extra: d.extra, today: d.today, range: d.range });
}

// ---------- stocks ----------
export function stockCard(d, query) {
  const r = d.ranges["1D"];
  const diff = d.price - d.prevClose;
  const up = diff >= 0;
  const cell = (k, v) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`;
  const stats = [
    [["Open", money(d.open)], ["High", money(d.high)], ["Low", money(d.low)]],
    [["Mkt cap", d.mktCap ?? "—"], ["P/E ratio", d.pe == null ? "—" : num(d.pe, 2)], ["Div yield", d.divYield == null ? "—" : `${num(d.divYield, 2)}%`]],
    [["Prev close", money(d.prevClose)], ["52-wk high", money(d.high52)], ["52-wk low", money(d.low52)]],
  ];
  return card("stock", `<div class="ia-label">Market Summary › <b>${esc(d.name)}</b></div>
<div class="ia-stock-price"><span class="big">${esc(money(d.price))}</span> <span class="cur">${esc(d.currency)}</span></div>
<div class="ia-stock-change ${up ? "up" : "down"}">${up ? "+" : "−"}${esc(money(Math.abs(diff)))} (${Math.abs((diff / d.prevClose) * 100).toFixed(2)}%) ${up ? "↑" : "↓"} today</div>
<div class="ia-meta">${esc(d.exchange)}: ${esc(d.ticker)} · ${esc(d.stamp)} · Disclaimer</div>
${tabBar("r", Object.keys(d.ranges).map((k) => [k]), "1D")}
<div class="ia-chart"><div class="ia-plot">${chartHTML(r.pts, { color: up ? "#137333" : "#a50e0e", total: r.total, base: d.prevClose, baseLabel: `Prev close ${money(d.prevClose)}`, xLabels: rangeLabels(r, d.today) })}</div></div>
<div class="ia-stats">${stats.map((col) => `<table>${col.map(([k, v]) => cell(k, v)).join("")}</table>`).join("")}</div>
${footer(webLink("tickerline.finance", `/quote/${slug(d.ticker)}`, "Tickerline", query))}`,
  { series: d.series, today: d.today, currency: d.currency });
}

// ---------- weather ----------
// Icons are drawn in code, one per condition, Google's colours.
const SUN = (cx, cy, r) => `<g stroke="#fbbc04" stroke-width="3.5" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  const p = (d) => `${(cx + Math.cos(a) * d).toFixed(1)} ${(cy + Math.sin(a) * d).toFixed(1)}`;
  return `<path d="M${p(r + 4)}L${p(r + 9)}"/>`;
}).join("")}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#fbbc04"/>`;
const MOON = `<path d="M38 12a20 20 0 1 0 14 30A16 16 0 0 1 38 12z" fill="#aecbfa"/>`;
const CLOUD = (fill, dx = 0, dy = 0, s = 1) => `<g fill="${fill}" transform="translate(${dx} ${dy}) scale(${s})"><circle cx="22" cy="40" r="10"/><circle cx="34" cy="32" r="13"/><circle cx="45" cy="41" r="9"/><rect x="22" y="38" width="23" height="12"/></g>`;
const DROPS = (color = "#4285f4", n = 3) => Array.from({ length: n }, (_, i) => `<path d="M${24 + i * 10} 52l-3 8" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`).join("");
const FLAKES = `<g fill="#8ab4f8">${[24, 34, 44].map((x, i) => `<circle cx="${x}" cy="${54 + (i % 2) * 5}" r="2.6"/>`).join("")}</g>`;
const LINES = (color, ys = [26, 34, 42, 50]) => `<g stroke="${color}" stroke-width="3.5" stroke-linecap="round">${ys.map((y, i) => `<path d="M${10 + (i % 2) * 6} ${y}H${54 - (i % 2) * 8}"/>`).join("")}</g>`;
const WIND = `<g fill="none" stroke="#9aa0a6" stroke-width="3.5" stroke-linecap="round"><path d="M8 26h30a6 6 0 1 0-6-6"/><path d="M8 36h40a6 6 0 1 1-6 6"/><path d="M8 46h22"/></g>`;
const ICONS = {
  sunny: () => SUN(32, 32, 12),
  clear: (night) => (night ? MOON : SUN(32, 32, 12)),
  "partly cloudy": (night) => `${night ? `<g transform="translate(-8 -8) scale(.8)">${MOON}</g>` : SUN(24, 24, 9)}${CLOUD("#dadce0", 6, 6, 0.9)}`,
  cloudy: () => `${CLOUD("#bdc1c6", -4, -8, 0.85)}${CLOUD("#dadce0", 4, 2, 0.95)}`,
  fog: () => `${CLOUD("#e8eaed", 0, -10)}${LINES("#9aa0a6", [38, 46, 54])}`,
  haze: () => `${SUN(32, 26, 10)}${LINES("#bdc1c6", [40, 48, 56])}`,
  drizzle: () => `${CLOUD("#bdc1c6", 0, -8)}${DROPS("#8ab4f8", 3)}`,
  rain: () => `${CLOUD("#9aa0a6", 0, -8)}${DROPS()}`,
  showers: () => `${SUN(22, 20, 8)}${CLOUD("#bdc1c6", 2, -6)}${DROPS("#4285f4", 2)}`,
  thunderstorm: () => `${CLOUD("#80868b", 0, -8)}<path d="M34 42l-7 11h7l-4 10 11-14h-7l4-7z" fill="#fbbc04"/>${DROPS("#4285f4", 1)}`,
  snow: () => `${CLOUD("#dadce0", 0, -8)}${FLAKES}`,
  sleet: () => `${CLOUD("#bdc1c6", 0, -8)}<path d="M26 52l-3 8" stroke="#4285f4" stroke-width="3" stroke-linecap="round"/><circle cx="38" cy="56" r="2.6" fill="#8ab4f8"/>`,
  windy: () => WIND,
  "dust storm": () => `${LINES("#e0b27a", [22, 30, 38, 46])}<g fill="none" stroke="#b5783f" stroke-width="3.5" stroke-linecap="round"><path d="M14 54c8-6 18-6 26 0s14 4 16-2"/></g>`,
};
export const wxIcon = (cond, size = 64, night = false) =>
  `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">${(ICONS[cond] ?? ICONS.cloudy)(night)}</svg>`;

export function weatherCard(d, query) {
  const today = d.days[0];
  const days = d.days.map((x, i) => `<button type="button" class="ia-wx-day" aria-selected="${i === 0}" aria-label="${esc(x.name)}"><span class="nm">${esc(x.short)}</span><span class="ic">${wxIcon(x.cond, 36)}</span><span class="t"><span class="hi">${Math.round(x.hi)}°</span> <span class="lo">${Math.round(x.lo)}°</span></span></button>`).join("");
  const other = d.unit === "C" ? "F" : "C";
  // What the runtime needs to switch days, units and charts.
  const data = {
    unit: d.unit, speed: d.speed, nowLabel: d.nowLabel,
    now: { ...d.now, cond: cap(d.now.cond) },
    days: d.days.map((x) => ({ name: x.name, hi: x.hi, lo: x.lo, cond: cap(x.cond), precip: x.precip, humidity: x.humidity, wind: x.wind, hours: x.hours })),
  };
  return card("weather", `<div class="ia-where">Results for <b>${esc(d.place)}</b></div>
<div class="ia-wx-top"><div class="ia-wx-now"><span class="ia-wx-icon">${wxIcon(d.now.cond, 64, d.night)}</span><span class="ia-wx-temp">${Math.round(d.now.temp)}</span><span class="ia-wx-units"><button type="button" data-unit="${d.unit}" aria-pressed="true">°${d.unit}</button><span>|</span><button type="button" data-unit="${other}" aria-pressed="false">°${other}</button></span>
<div class="ia-wx-stats"><div>Precipitation: <span class="ia-wx-precip">${d.now.precip}%</span></div><div>Humidity: <span class="ia-wx-hum">${d.now.humidity}%</span></div><div>Wind: <span class="ia-wx-wind">${d.now.wind} ${d.speed}</span></div></div></div>
<div class="ia-wx-side"><div class="ia-wx-title">Weather</div><div class="ia-wx-when">${esc(d.nowLabel)}</div><div class="ia-wx-cond">${esc(cap(d.now.cond))}</div></div></div>
${tabBar("m", [["temp", "Temperature"], ["precip", "Precipitation"], ["wind", "Wind"]], "temp")}
<div class="ia-chart ia-wx-chart"><div class="ia-plot">${wxChart(today.hours, "temp", undefined, d.speed)}</div></div>
<div class="ia-wx-days">${days}</div>
${footer(webLink("skyledger.net", `/forecast/${slug(d.place)}`, "SkyLedger", query))}`, data);
}

// ---------- dictionary ----------
// Two definitions show (one on a phone); the rest, and the origin, wait
// behind "more", so the card is about the size its placeholder reserved.
export function dictionaryCard(d, query) {
  let n = 0;
  const senses = d.senses.map((s) => {
    const items = s.defs.map((x) => {
      n++;
      const syn = x.syn.length ? `<div class="ia-syn"><span>Similar:</span>${x.syn.map((w) => `<a href="/search?q=${encodeURIComponent(`define ${w}`)}">${esc(w)}</a>`).join("")}</div>` : "";
      return { cls: n > 2 ? "ia-extra" : n === 2 ? "ia-second" : "", html: `<div>${esc(x.def)}</div>${x.ex ? `<div class="ia-ex">“${esc(x.ex)}”</div>` : ""}${syn}` };
    });
    // A part of speech whose definitions are all hidden hides with them.
    const cls = items.every((i) => i.cls === "ia-extra") ? "ia-extra" : items.every((i) => i.cls) ? "ia-second" : "";
    return `<div class="ia-sense${cls ? ` ${cls}` : ""}"><div class="ia-pos">${esc(s.pos)}</div><ol>${items.map((i) => `<li${i.cls ? ` class="${i.cls}"` : ""}>${i.html}</li>`).join("")}</ol></div>`;
  }).join("");
  const more = n > 1 || d.origin;
  return card("dictionary", `<div class="ia-label">Dictionary</div><div class="ia-meta">Definitions from Foogle Lexicon</div>
<div class="ia-word">${esc(d.syllables || d.word)}</div>
<div class="ia-phon"><button type="button" class="ia-say" aria-label="Listen"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/></svg></button><span>${esc(d.phonetic)}</span></div>
${senses}${d.origin ? `<div class="ia-extra ia-origin"><b>Origin</b><p>${esc(d.origin)}</p></div>` : ""}
${more ? `<button type="button" class="ia-more" aria-expanded="false"><span class="closed">Translations, word origin and more definitions</span><span class="opened">Fewer definitions</span></button>` : ""}
${footer(webLink("foogle-lexicon.org", `/word/${slug(d.word)}`, "Foogle Lexicon", query))}`, { word: d.word });
}

// ---------- time ----------
// The visitor's own clock ("what time is it") is in a zone only their
// browser knows, so the runtime writes its time and date.
export function timeCard(d) {
  return card("time", `<div class="ia-time-big">${esc(d.time)}</div><div class="ia-time-date">${esc(d.date)}${d.abbr ? ` (${esc(d.abbr)})` : ""}</div>
<div class="ia-time-where">${d.local ? "Your local time" : `Time in ${esc(d.place)}`}</div><div class="ia-time-rel"></div>`, d.local ? { local: true } : { tz: d.tz, utcOffset: d.utcOffset, abbr: d.abbr });
}

// ---------- sports ----------
const badge = (t, size = 40) =>
  `<span class="ia-badge" style="--c:${esc(t.color)};--t:${esc(t.ink ?? "#fff")};width:${size}px;height:${size}px;font-size:${Math.round(size * (t.abbr.length > 3 ? 0.26 : 0.32))}px">${esc(t.abbr)}</span>`;
// "Everton FC" -> "Everton", "Los Angeles Lakers" -> "Lakers".
const GENERIC = /^(?:united|city|town|county|rovers|wanderers|athletic|albion|fc)$/i;
function shortName(name) {
  const words = name.replace(/\b(?:A?F\.?C\.?|CF|SC)\b/g, "").trim().split(/\s+/);
  if (words.join(" ").length <= 12) return words.join(" ");
  return GENERIC.test(words.at(-1)) ? words[0] : words.at(-1);
}
export function sportsCard(d, query) {
  const g = d.last;
  const win = g.home.score === g.away.score ? null : g.home.score > g.away.score ? "home" : "away";
  // Phones stack the badge over a short name ("Lakers"), as Google's mobile card does.
  const side = (t, k) => `<div class="ia-team ${k}${win === k ? " win" : ""}"><div class="who">${badge(t)}<div class="nm"><span class="full">${esc(t.name)}</span><span class="short">${esc(shortName(t.name))}</span><span class="ia-meta">${esc(t.record ?? "")}</span></div></div><div class="sc">${t.score}</div></div>`;
  // One column (a model that only gave the final score) is no box score.
  const box = g.labels.length > 1 ? `<table class="ia-box"><tr><th></th>${g.labels.map((l) => `<th>${esc(l)}</th>`).join("")}<th>T</th></tr>${[g.away, g.home].map((t) => `<tr><td>${esc(t.abbr)}</td>${g.labels.map((_, i) => `<td>${t.periods[i] ?? "–"}</td>`).join("")}<td><b>${t.score}</b></td></tr>`).join("")}</table>` : "";
  const next = d.next.length ? `<div class="ia-sub">Upcoming</div><ul class="ia-next">${d.next.map((x) => `<li><span class="when">${esc(x.date)}</span><span class="vs">${x.home ? "vs" : "@"} ${esc(x.opp)}</span><span class="ia-meta">${esc([x.time, x.tv].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul>` : "";
  const table = d.standings.length ? `<table class="ia-standings"><tr><th>Team</th><th>W</th><th>L</th><th>PCT</th></tr>${d.standings.map((s) => `<tr${s.me ? ' class="me"' : ""}><td>${esc(s.team)}</td><td>${s.w}</td><td>${s.l}</td><td>${s.w + s.l ? (s.w / (s.w + s.l)).toFixed(3).replace(/^0/, "") : "—"}</td></tr>`).join("")}</table>` : `<p class="ia-meta">No standings yet this season.</p>`;
  return card("sports", `<div class="ia-sp-head">${badge(d, 44)}<div><div class="ia-sp-team">${esc(d.team)}</div><div class="ia-meta">${esc([d.league, d.standing].filter(Boolean).join(" · "))}</div></div></div>
${tabBar("s", [["games", "Games"], ["standings", "Standings"]], "games")}
<div data-panel="games" data-group="s"><div class="ia-game"><div class="ia-meta ia-game-meta">${esc([g.status === "Live" ? `Live · ${g.clock ?? ""}` : g.status, g.date, g.venue].filter(Boolean).join(" · "))}</div>
<div class="ia-match">${side(g.away, "away")}<div class="ia-at">${g.status === "Live" ? '<span class="live">LIVE</span>' : d.sport === "soccer" ? "Full-time" : "Final"}</div>${side(g.home, "home")}</div>${box}</div>${next}</div>
<div data-panel="standings" data-group="s" hidden>${table}</div>
${footer(webLink("scoreline.live", `/${slug(d.league)}/${slug(d.team)}`, "Scoreline", query))}`, {});
}

// ---------- flight ----------
const PLANE = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" transform="rotate(90 12 12)" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;
export function flightCard(d, query) {
  const leg = (x, verb) => `<div class="leg"><div class="city">${esc(x.city)} <span class="ia-meta">${esc(x.code)}</span></div>
<div class="when">${esc(verb)} <b class="${x.late ? "late" : ""}">${esc(x.actual ?? x.sched)}</b></div>${x.actual && x.actual !== x.sched ? `<div class="ia-meta">Scheduled ${esc(x.sched)}</div>` : '<div class="ia-meta">&nbsp;</div>'}
<div class="gate">Terminal <b>${esc(x.terminal ?? "—")}</b> · Gate <b>${esc(x.gate ?? "—")}</b></div></div>`;
  const pct = (d.progress * 100).toFixed(1);
  return card("flight", `<div class="ia-fl-head"><div><div class="ia-fl-title">${esc(d.number)} · ${esc(d.airline)}</div><div class="ia-meta">${esc([d.date, d.aircraft, d.duration].filter(Boolean).join(" · "))}</div></div><span class="ia-pill ${d.tone}">${esc(d.status)}</span></div>
<div class="ia-fl-route"><b>${esc(d.from.code)}</b><div class="track"><i style="width:${pct}%"></i><span class="plane" style="left:${pct}%">${PLANE}</span></div><b>${esc(d.to.code)}</b></div>
<div class="ia-fl-legs">${leg(d.from, d.verbs[0])}${leg(d.to, d.verbs[1])}</div>${d.note ? `<div class="ia-fl-note ${d.tone}">${esc(d.note)}</div>` : ""}
${footer(webLink("flightpath.aero", `/status/${slug(d.number)}`, "Flightpath", query))}`, {});
}

export const RENDER = {
  calculator: calcCard, units: unitsCard, currency: currencyCard, stock: stockCard, weather: weatherCard,
  dictionary: dictionaryCard, time: timeCard, sports: sportsCard, flight: flightCard,
};
