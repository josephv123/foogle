import { config, streamText } from "./llm.js";
import { pageSectionPrompt, pageFactsPrompt } from "./prompts.js";
import { themeCSS, themeHeader, themeFooter, artColors, heroFacts } from "./theme.js";
import { jevPlan, planFromAnswers, defaultPlan } from "./jev.js";

// The fact sheet is an optimization, never a dependency. It streams line by
// line; the first section never waits for it (the visitor must see content in
// about a second), and later sections wait at most FACTS_WAIT_MS, taking
// whatever lines have arrived by then.
const FACTS_WAIT_MS = 800;
async function* pageFacts(args) {
  let buf = "";
  for await (const delta of streamText({ ...pageFactsPrompt(args), maxTokens: 220, temperature: config.tempPages })) {
    buf += delta;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = cleanFactLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (line) yield line;
    }
  }
  const last = cleanFactLine(buf);
  if (last) yield last;
}

export function cleanFactLine(line) {
  const l = String(line).replace(/```\w*/g, "").replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
  return l.length > 3 ? l.slice(0, 200) : null;
}

// Collects a fact stream in the background. ready(ms) resolves with the lines
// so far once the stream ends or ms elapse, whichever is first.
function factSheet(lines) {
  const sheet = { lines: [] };
  const done = (async () => {
    try { for await (const line of lines) if (sheet.lines.length < 8) sheet.lines.push(line); }
    catch (err) { console.warn(`[facts] ${err.message}; later sections get the lines so far (${sheet.lines.length})`); }
  })();
  sheet.ready = (ms) => {
    let timer;
    return Promise.race([done, new Promise((resolve) => { timer = setTimeout(resolve, ms); })])
      .then(() => { clearTimeout(timer); return [...sheet.lines]; });
  };
  return sheet;
}

// Section pictures get the same palette query as the hero art, so they are
// drawn in the site's colours. A src is only rewritten once its closing quote
// has arrived; see heldBack().
export function paintPictures(html, plan) {
  const palette = artColors(plan).replaceAll("&", "&amp;");
  return html.replace(/src="\/img\/([^"?]*)"/g, (_, raw) => {
    let prompt = raw;
    try { prompt = decodeURIComponent(raw); } catch { /* keep raw */ }
    return `src="/img/${encodeURIComponent(prompt.trim().slice(0, 300))}?${palette}"`;
  });
}

// How much of a streaming section is safe to send: nothing from the first
// backtick (it may open a closing code fence) or from a picture src whose
// closing quote hasn't arrived (painting will rewrite it).
function heldBack(body, from) {
  const tick = body.indexOf("`", from);
  let end = tick === -1 ? body.length : tick;
  const src = body.lastIndexOf('src="/img/');
  if (src !== -1 && body.indexOf('"', src + 5) === -1) end = Math.min(end, src);
  return end;
}

// Where a streaming section may be cut so that only whole blocks reach the
// page: a paragraph, a table, a forum post, a card in a grid, a row of a
// table, an item of a list. Text still arrives as it is written, but a card
// never appears with half its content or a table with a half-built row.
const VOID_TAGS = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const LIST_TAGS = new Set(["ul", "ol", "dl", "table", "thead", "tbody"]);
const LIST_CLASS = /\b(?:grid|row|bars|split|timeline|steps)\b/;
export function blockEnd(body) {
  const stack = [];
  let end = 0;
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^<>]*)>/g)) {
    const tag = m[2].toLowerCase();
    if (!m[1]) {
      if (!VOID_TAGS.has(tag) && !m[3].endsWith("/")) stack.push({ tag, list: LIST_TAGS.has(tag) || LIST_CLASS.test(m[3].match(/class="([^"]*)"/)?.[1] ?? "") });
      else if (stack.length === 1) end = m.index + m[0].length; // a bare <img>/<hr> in the section
      continue;
    }
    const at = stack.findLastIndex((e) => e.tag === tag);
    if (at === -1) continue;
    stack.length = at;
    // Closed an element directly in the section, or an item of a list-like
    // container that is itself directly in the section (tables count their
    // thead/tbody as part of the table).
    const inner = stack.slice(1);
    if (!stack.length) return m.index + m[0].length; // the section itself closed
    if (inner.every((e) => e.list) && inner.length <= (inner[0]?.tag === "table" ? 2 : 1)) end = m.index + m[0].length;
  }
  return end;
}

// A section ends at its own closing tag. Models occasionally keep going —
// musing about word counts, then writing the section a second time — and
// none of that may reach the page.
export function firstSection(body) {
  const stack = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^<>]*)>/g)) {
    const tag = m[2].toLowerCase();
    if (!m[1]) { if (!VOID_TAGS.has(tag) && !m[3].endsWith("/")) stack.push(tag); continue; }
    const at = stack.lastIndexOf(tag);
    if (at === -1) continue;
    stack.length = at;
    if (!stack.length) return body.slice(0, m.index + m[0].length);
  }
  return body;
}

// Which sections may carry a picture: the middle ones. The first sits under the
// hero art and the last is usually links and small print. At most two a page.
const allowsPicture = (index, total) => index >= 1 && index <= Math.min(2, total - 2);

export function cleanSection(text) {
  const fragment = text.trim().replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "");
  if (!/^<section(?:\s|>)/i.test(fragment) || !/<\/section>\s*$/i.test(fragment) || /<(?:html|head|body|style|script)\b/i.test(fragment)) {
    throw new Error("Section generation returned incomplete or invalid HTML");
  }
  return fragment;
}

// domain -> the look its first page was given. Every later page on the site
// reuses it, so a site doesn't turn from a forum into a zine between clicks
// (and skips the planning call).
const siteLooks = new Map();
const LOOKS_MAX = 500;
const lookOf = ({ kind, mood, hue, site, nav, mark }) => ({ kind, mood, hue, site, nav, mark });

// Jev picks the layout (kind and mood); code renders the styled shell at once
// and four concurrent writers fill in the sections.
export async function* generatePage(args, { planWithJev = jevPlan, stream = streamText, complete, looks = siteLooks, facts: factsFor = pageFacts, factsWaitMs = FACTS_WAIT_MS } = {}) {
  // The fact sheet generates while the layout is planned and the shell streams.
  const sheet = factSheet(factsFor(args));
  const domain = new URL(args.url).hostname;
  const look = looks.get(domain);
  let plan;
  if (look) plan = { ...planFromAnswers(args, { kind: { choice: look.kind }, mood: { choice: look.mood } }), ...look };
  else {
    try { plan = await planWithJev(args); }
    catch (err) {
      console.warn(`[jev] ${err.message}; using the default layout`);
      plan = defaultPlan(args);
    }
  }
  if (!look) {
    if (looks.size >= LOOKS_MAX) looks.delete(looks.keys().next().value);
    looks.set(domain, lookOf(plan));
  }
  // Complete CSS/header arrives before any section generation. Sections all
  // generate concurrently but appear in document order; each job captures its
  // own failure so a failed later section cannot cause an unhandled rejection.
  yield `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${themeCSS(plan)}</head><body>${themeHeader(plan, domain, { art: true })}`;
  const selected = plan.secs;
  // The hero's own byline/counts come first — the writers must agree with what
  // is already on screen, and those lines win any conflict with the sheet. The
  // first section starts at once with just those; the rest wait briefly for
  // the sheet, which is fine because they appear only after the first.
  const header = heroFacts(plan).map((f) => `${f} (shown in the page header)`);
  const later = sheet.ready(factsWaitMs);
  const paint = (html) => paintPictures(html, plan);
  const write = complete ? completeStream(complete) : stream;
  const jobs = selected.map((brief, index) => sectionJob((async function* () {
    const facts = [...header, ...(index === 0 ? [] : await later)].join("\n");
    yield* write({
      ...pageSectionPrompt({ plan, domain, url: args.url, brief, index, total: selected.length, briefs: selected, facts, picture: allowsPicture(index, selected.length) }),
      maxTokens: 1600, temperature: config.tempPages,
    });
  })()));
  let firstError;
  for (const job of jobs) {
    // The section being written when its turn comes streams live, a whole
    // block at a time (see blockEnd), so the visitor reads it as it arrives.
    // It is validated once it ends; a bad one
    // keeps the page out of the cache. A section that finished while an
    // earlier one was showing is validated whole and skipped if bad.
    let sent = 0;
    while (!job.done) {
      const body = paint(sectionBody(job.text()));
      const end = Math.min(heldBack(body, sent), blockEnd(body));
      if (end > sent) { yield body.slice(sent, end); sent = end; }
      await job.next();
    }
    if (!sent) {
      try { if (job.error) throw job.error; yield paint(cleanSection(sectionBody(job.text()) || job.text())); } catch (err) { firstError ??= err; }
      continue;
    }
    const body = paint(sectionBody(job.text()).replace(/\s*```\s*$/, ""));
    if (body.length > sent) yield body.slice(sent);
    try { if (job.error) throw job.error; cleanSection(body); } catch (err) { firstError ??= err; }
  }
  yield `${themeFooter(plan, domain)}</body></html>`;
  if (firstError) throw firstError; // partial failures must not enter the page cache
}

// Adapts a whole-text completion function (tests) to the streaming interface.
const completeStream = (complete) => async function* (spec) { yield await complete(spec); };

// Anything a model writes before the <section> tag (a code fence, a
// preamble) never reaches the page.
function sectionBody(text) {
  const at = text.search(/<section[\s>]/i);
  return at === -1 ? "" : firstSection(text.slice(at));
}

// Consume a section stream in the background so every section generates
// concurrently, whichever one the page is currently showing.
function sectionJob(iterable) {
  const job = { chunks: [], done: false, error: null, waiters: [] };
  const wake = () => { for (const w of job.waiters.splice(0)) w(); };
  job.text = () => job.chunks.join("");
  let seen = 0;
  // Resolves on new text or completion — immediately if either already
  // happened while the page generator was suspended in a yield.
  job.next = () => {
    if (job.done || job.chunks.length > seen) { seen = job.chunks.length; return Promise.resolve(); }
    return new Promise((resolve) => job.waiters.push(() => { seen = job.chunks.length; resolve(); }));
  };
  (async () => {
    try { for await (const delta of iterable) { job.chunks.push(delta); wake(); } }
    catch (err) { job.error = err; }
    job.done = true;
    wake();
  })();
  return job;
}
