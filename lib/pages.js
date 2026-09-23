import { config, streamText, TruncatedError, DroppedError } from "./llm.js";
import { pageSectionPrompt, pageFactsPrompt } from "./prompts.js";
import { themeCSS, themeHeader, themeFooter, artColors, heroFacts } from "./theme.js";
import { jevPlan, planFromAnswers, defaultPlan } from "./jev.js";
import { sanitizeSection, widgetHead } from "./widgets.js";
import { siteSpecs } from "./sitespec.js";
import { designPlan, skeletonHeader, HIDE_SKELETON, lateIcon, lateCSS } from "./design.js";

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
  const palette = artColors(plan, { shape: plan.picShape }).replaceAll("&", "&amp;");
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

// The elements still open at the end of some HTML (outermost first), or, as
// soon as its first element closes, the offset just past that closing tag.
function openTags(html) {
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^<>]*)>/g)) {
    const tag = m[2].toLowerCase();
    if (!m[1]) { if (!VOID_TAGS.has(tag) && !m[3].endsWith("/")) stack.push(tag); continue; }
    const at = stack.lastIndexOf(tag);
    if (at === -1) continue;
    stack.length = at;
    if (!stack.length) return { stack, end: m.index + m[0].length }; // the outermost element closed
  }
  return { stack, end: -1 };
}

// A section ends at its own closing tag. Models occasionally keep going —
// musing about word counts, then writing the section a second time — and
// none of that may reach the page.
export function firstSection(body) {
  const { end } = openTags(body);
  return end === -1 ? body : body.slice(0, end);
}

const sectionClosed = (text) => {
  const at = text.search(/<section[\s>]/i);
  return at !== -1 && openTags(text.slice(at)).end !== -1;
};

// A section cut off by the token limit or a dropped stream keeps its whole
// blocks (see blockEnd) and is closed there. Returns "" if nothing besides its
// heading was whole.
export function salvageSection(body) {
  const cut = body.slice(0, blockEnd(body));
  if (!cut.replace(/<h[1-6][\s\S]*?<\/h[1-6]\s*>/i, "").replace(/<[^>]*>/g, "").trim()) return "";
  return cut + openTags(cut).stack.reverse().map((tag) => `</${tag}>`).join("");
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
const lookOf = ({ kind, style, mood, hue, site, nav, mark }) => ({ kind, style, mood, hue, site, nav, mark });
// The look a site was given, once it has one (the browser bar draws its favicon from it).
export const siteLook = (domain) => siteLooks.get(domain);

// A real, well-known site looks like itself: the model writes its design
// spec once (lib/sitespec.js) and lib/design.js renders it. A spec is asked
// for when a search result said the site is real (it started then) or Jev
// thinks so; invented sites never wait for one. A page whose spec is still
// streaming shows a neutral header at once, starts its writers as soon as the
// spec says what the site is, and swaps in the real header when the look
// arrives, waiting at most SPEC_WAIT_MS before it gives up on the spec.
const REAL_SITE = 0.6;
const SPEC_WAIT_MS = 8000;
// The spec's own CSS usually lands while the sections stream; a page that
// finished first waits this much longer for it, so the cached page has it.
const CSS_WAIT_MS = 2500;
const within = (promise, ms) => { let timer; return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); })]).finally(() => clearTimeout(timer)); };
const DOC_HEAD = (css = "") => `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${css}${widgetHead()}</head><body>`;

// Jev picks the layout (kind and mood) of an invented site, or says the site
// is real; code renders the styled shell at once and four concurrent writers
// fill in the sections.
export async function* generatePage(args, { planWithJev = jevPlan, stream = streamText, complete, looks = siteLooks, facts: factsFor = pageFacts, factsWaitMs = FACTS_WAIT_MS, specs = siteSpecs, specWaitMs = SPEC_WAIT_MS, cssWaitMs = CSS_WAIT_MS } = {}) {
  const domain = new URL(args.url).hostname;
  const t0 = Date.now();
  // A spec written before (memory or disk), or started by a search result.
  let entry = await specs.lookup(domain);
  if (entry?.real === false) entry = null;
  const look = entry ? null : looks.get(domain);
  if (!entry && !look && args.real) entry = specs.start(domain, { url: args.url });
  // The fact sheet generates while the layout is planned and the shell streams.
  const sheet = factSheet(factsFor({ ...args, site: entry?.spec?.name, real: Boolean(entry) }));
  const inventedPlan = async () => {
    if (look) return { ...planFromAnswers(args, { kind: { choice: look.kind }, style: { choice: look.style } }), ...look };
    try { return await planWithJev(args); }
    catch (err) {
      console.warn(`[jev] ${err.message}; using the default layout`);
      return defaultPlan(args);
    }
  };
  let plan = null;
  if (!entry) {
    plan = await inventedPlan();
    if (!look && plan.realSite >= REAL_SITE) entry = specs.start(domain, { url: args.url });
  }
  let skeleton = false;
  if (entry) {
    const left = () => Math.max(0, specWaitMs - (Date.now() - t0));
    if (!["look", "header"].every((st) => entry.stage.has(st)) && !entry.stage.has("done")) {
      yield `${DOC_HEAD()}${skeletonHeader(domain)}`;
      skeleton = true;
    }
    await within(entry.at("writers"), left());
    if (entry.real) plan = designPlan(args, entry.spec);
    else {
      entry = null; // not a real site after all, or too slow to say
      plan ??= await inventedPlan();
    }
  }
  if (!entry && !look && !plan.design) {
    if (looks.size >= LOOKS_MAX) looks.delete(looks.keys().next().value);
    looks.set(domain, lookOf(plan));
  }
  // A page answering a form (see lib/interact.js) opens with a code-built
  // confirmation, and its writers get briefs for what comes after it.
  const submission = args.submission;
  if (submission) plan = { ...plan, secs: submission.briefs.map((b) => `${b}. Topic: ${submission.summary}`) };
  // Sections all generate concurrently but appear in document order; each job
  // captures its own failure so a failed later section cannot cause an
  // unhandled rejection.
  const selected = plan.secs;
  // The hero's own byline/counts come first — the writers must agree with what
  // is already on screen, and those lines win any conflict with the sheet. The
  // first section starts at once with just those; the rest wait briefly for
  // the sheet, which is fine because they appear only after the first.
  const header = heroFacts(plan).map((f) => `${f} (shown in the page header)`);
  const later = sheet.ready(factsWaitMs);
  // Sanitizing works tag by tag, so it is stable as a section grows and
  // streamed offsets stay valid (see sanitizeSection).
  const paint = (html) => paintPictures(sanitizeSection(html), plan);
  const write = complete ? completeStream(complete) : stream;
  let jobs = null;
  const startJobs = () => selected.map((brief, index) => {
    const attempt = async function* () {
      const facts = [...header, ...(index === 0 ? [] : await later)].join("\n");
      yield* untilClosed(write({
        ...pageSectionPrompt({ plan, domain, url: args.url, brief, index, total: selected.length, briefs: selected, facts, picture: plan.pics && !submission ? plan.pics[index] ?? 0 : allowsPicture(index, selected.length), submission: submission?.summary }),
        // Sections close by ~1,050 tokens even with a calculator or quiz in
        // them (p50 ~400), so this only binds on a model that has run away.
        maxTokens: 1600, temperature: config.tempPages,
      }));
    };
    // A section whose stream dropped before anything but its heading was
    // whole is written once more (one with whole blocks keeps them instead,
    // below). If its opening is already on the page, the new reply carries on
    // after it.
    const retry = (job) => {
      const body = sectionBody(job.text());
      if (salvageSection(paint(body))) return null;
      const lead = job.shown ? body.match(LEAD)?.[0] ?? "" : "";
      if (!paint(lead).startsWith(job.shown)) return null;
      console.warn(`[page] section ${index + 1} of ${args.url} lost its stream early; writing it again`);
      return lead ? afterLead(lead, attempt()) : attempt();
    };
    return sectionJob(attempt(), retry);
  });
  // The styled header comes first: at once for an invented site or a spec
  // already written. A real site whose look is still on its way starts its
  // writers now, and the header follows when the look and header arrive.
  const late = { icon: true, css: true };
  if (entry) {
    const ready = () => ["look", "header"].every((st) => entry.stage.has(st)) || entry.stage.has("done");
    if (!ready()) jobs = startJobs();
    await within(Promise.all([entry.at("look"), entry.at("header")]), Math.max(0, specWaitMs - (Date.now() - t0)));
    plan = { ...designPlan(args, entry.spec), secs: plan.secs };
    late.icon = entry.spec.icon === null;
    late.css = entry.spec.css === null;
  }
  const css = themeCSS(plan);
  const top = `${themeHeader(plan, domain, { art: true })}${entry && !late.css ? lateCSS(entry.spec) : ""}`;
  yield skeleton ? `${HIDE_SKELETON}${css}${top}` : `${DOC_HEAD(css)}${top}`;
  jobs ??= startJobs();
  // The spec's icon and CSS, once they arrive, restyle the page on screen.
  const adopt = () => {
    let out = "";
    if (entry && late.icon && entry.spec.icon !== null) { late.icon = false; out += lateIcon(entry.spec); }
    if (entry && late.css && entry.spec.css !== null) { late.css = false; out += lateCSS(entry.spec); }
    return out;
  };
  if (submission) yield submission.receipt;
  let firstError;
  for (const [index, job] of jobs.entries()) {
    // The section being written when its turn comes streams live, a whole
    // block at a time (see blockEnd), so the visitor reads it as it arrives.
    // It is validated once it ends; a bad one
    // keeps the page out of the cache. A section that finished while an
    // earlier one was showing is validated whole and skipped if bad.
    let sent = 0;
    while (!job.done) {
      const body = paint(sectionBody(job.text()));
      const end = Math.min(heldBack(body, sent), blockEnd(body));
      // (Noted before the yield: a retry decided meanwhile must see it.)
      if (end > sent) { job.shown = body.slice(0, end); yield body.slice(sent, end) + adopt(); sent = end; }
      await job.next();
    }
    let error = job.error;
    let body = paint(sectionBody(job.text()).replace(/\s*```\s*$/, ""));
    if (error instanceof TruncatedError || error instanceof DroppedError) {
      const kept = salvageSection(body);
      if (kept && kept.length >= sent) {
        console.warn(`[page] section ${index + 1} of ${args.url} ${error instanceof TruncatedError ? "hit the token limit" : "lost its stream"}; kept its whole blocks`);
        [body, error] = [kept, null];
      }
    }
    if (!sent) {
      try { if (error) throw error; yield cleanSection(body || paint(job.text())); } catch (err) { firstError ??= err; }
      continue;
    }
    if (body.length > sent) yield body.slice(sent);
    try { if (error) throw error; cleanSection(body); } catch (err) { firstError ??= err; }
  }
  if (entry && (late.icon || late.css)) await within(entry.at("css"), cssWaitMs);
  yield `${adopt()}${themeFooter(plan, domain)}</body></html>`;
  if (firstError) throw firstError; // partial failures must not enter the page cache
}

// Adapts a whole-text completion function (tests) to the streaming interface.
const completeStream = (complete) => async function* (spec) { yield await complete(spec); };

// A section is finished at its own closing tag. Now and then the model keeps
// going (blank lines, a <style> block, notes to itself, the section again)
// until the token limit, which failed a finished section and held the page
// open for seconds. The page moves on at the tag; the rest of the reply is read
// in the background only so its cost is still counted (see onUsage in
// lib/llm.js), and a token-limit error there means nothing.
async function* untilClosed(deltas) {
  const rest = deltas[Symbol.asyncIterator]();
  let text = "";
  for (;;) {
    const { value, done } = await rest.next();
    if (done) return;
    yield value;
    text += value;
    if (value.includes(">") && sectionClosed(text)) break;
  }
  (async () => { try { while (!(await rest.next()).done); } catch { /* none of it is used */ } })();
}

// Anything a model writes before the <section> tag (a code fence, a
// preamble) never reaches the page.
function sectionBody(text) {
  const at = text.search(/<section[\s>]/i);
  return at === -1 ? "" : firstSection(text.slice(at));
}

// Where a section's opening ends: its tag, then any headings and pictures.
const LEAD = /^<section\b[^>]*>(?:\s*(?:<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]\s*>|<(?:img|hr|br)\b[^>]*>))*/i;

// A second reply for a section whose opening (see LEAD) is already on the
// page: the reply's own opening is swapped for that one, so the page carries
// on after the heading it shows. Nothing comes out until the reply's opening
// is complete.
async function* afterLead(lead, deltas) {
  let text = "";
  for await (const delta of deltas) {
    if (text === null) { yield delta; continue; }
    text += delta;
    const body = sectionBody(text);
    const end = body.match(LEAD)?.[0].length ?? 0;
    if (end && blockEnd(body) > end) { yield lead + body.slice(end); text = null; }
  }
}

// Consume a section stream in the background so every section generates
// concurrently, whichever one the page is currently showing. If the stream
// drops, retry(job) may give, once, a new stream to replace the text so far.
// job.shown is what the page has already shown of it.
function sectionJob(deltas, retry = () => null) {
  const job = { chunks: [], done: false, error: null, waiters: [], shown: "" };
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
    let retried = false;
    for (;;) {
      try { for await (const delta of deltas) { job.chunks.push(delta); wake(); } break; }
      catch (err) {
        const again = !retried && err instanceof DroppedError && retry(job);
        if (!again) { job.error = err; break; }
        [deltas, retried, job.chunks, seen] = [again, true, [], 0];
      }
    }
    job.done = true;
    wake();
  })();
  return job;
}
