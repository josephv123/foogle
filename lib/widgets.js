// Interactive components for generated pages.
//
// Every fake site shares Foogle's origin, so model-written JavaScript would run
// with full access to it (other sites' carts and comments, Foogle's own pages).
// Instead the model writes plain HTML with data-* attributes, and one trusted
// runtime served by Foogle (public/fw/widgets.js, styled by public/fw/widgets.css)
// makes it work: carts, filters, tabs, quizzes, calculators, polls, votes,
// comments, modals. Model output is sanitized on the way to the browser and a
// Content-Security-Policy stops anything that slips through from executing.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// What a section writer may use. Kept terse: it goes into all four section
// prompts, and input tokens are cheap but not free.
export const WIDGET_VOCABULARY = `Interactive components (a trusted script makes these work; you write only HTML — never JavaScript, <script> or on* attributes):
- Add to cart: <button class="btn" data-add-to-cart data-name="Exact product name" data-price="349">Add to cart</button>. The header cart, cart drawer and checkout then work.
- Filterable products: <div class="grid" data-filter> whose .card items each carry data-tags="solo ultralight" and a .price/.stars; a filter bar and sorting appear above it.
- Tabs: <div data-tabs><div data-tab="Overview">…</div><div data-tab="Specs">…</div></div>.
- Quiz: <div data-quiz><div data-q><p><b>Question?</b></p><button>Answer</button><button data-correct>Answer</button><button>Answer</button><p data-explain>Why.</p></div>…</div> (2-4 questions; a score appears at the end).
- Calculator or configurator: <form data-calc> with labeled, named inputs (<input type="range" name="bill" min="20" max="400" step="10" value="120">, <input type="number">, <select name="size"> with numeric option values, <input type="checkbox" name="wax" value="15">) and results <output data-formula="bill*12*0.3">0</output>. Formulas use input names, numbers, + - * / ^ ( ), min() max() round() — no < or >; a named <output name="x" hidden data-formula="…"></output> holds an intermediate value later formulas can use; write units as text around each shown output. Add <div class="progress" data-formula="…percent…"></div> for a live bar.
- Poll: add data-poll data-votes="1284" to a .bars block; visitors can vote.
- Votes and replies: a .post .meta reading "▲ 42 · Reply" (or "Helpful 12" on a review) gets working vote and reply buttons. <div data-comments></div> is a box where visitors post their own comment and get answers.
- Pick one: <div class="row" data-pick="size"><button>S</button><button>M</button><button disabled>L</button></div> (sizes, colours, time slots; disabled = sold out). Toggle: <button class="btn ghost" data-toggle="Following ✓">Follow</button>. Toast: <button class="btn" data-toast="We'll email you when it's back">Notify me</button>.
- Modal: <button class="btn ghost" data-open="size-guide">Size guide</button><dialog id="size-guide"><h3>…</h3>…</dialog>. Countdown: <b data-countdown="2d 4h 10m"></b>.
- Forms that do something (sign up, book, apply, RSVP, contact, enter) use <form method="post" action="/web/DOMAIN/PATH"> with <label>s, named inputs and a submit .btn; the site answers with a confirmation page.`;

// The component a page's own title calls for: "Solar Savings Calculator"
// without a calculator is the least interactive page there is. The first
// section builds it (it needs no fact sheet); the others are told it exists.
const PAGE_PURPOSES = [
  [/calculat|estimat|planner|configur|build-your|cost-of|how-much|mortgage|converter/i, "calculator", "a working <form data-calc> with 2-4 labeled inputs and 1-3 outputs that update live", /data-calc/],
  [/quiz|trivia|test-your|which-.*-are-you|personality|flashcards?/i, "quiz", "a working <div data-quiz> with 3-4 questions", /data-quiz/],
  [/\bbook(ing|ings)?\b|appointments?|reserv|schedul|\brsvp\b|\btickets?\b/i, "booking form", "a working <form method=\"post\"> with a data-pick of time slots (a couple disabled), a date or party-size input, name and email", /form method/],
  [/sign-?up|register|\bjoin\b|log-?in|sign-?in|\baccount\b|subscribe|waitlist/i, "signup form", "a working <form method=\"post\"> with labeled fields and a submit .btn", /form method/],
];

// Which components suit which part of which kind of site. Matched against the
// section's brief, so it keeps working when the briefs are reworded; the first
// match wins. One suggestion per section keeps pages from becoming dashboards.
const HINTS = {
  store: [
    [/intro|promotion|category/i, "Put a <b data-countdown=\"…\"></b> on the promotion so it ticks down."],
    [/review|\.post/i, "Give each review a .meta reading \"Helpful N\" so shoppers can mark it helpful, and end with <div data-comments></div> so they can add their own review."],
    [/faq|shipping|returns/i, "If it fits, put a size or care guide behind a modal (data-open + <dialog>)."],
    [/product|\.price|lineup|featured/i, "Make it shoppable: every product .card gets an Add to cart button with its exact data-name and data-price; with 3+ products make the grid data-filter and give each card data-tags."],
  ],
  forum: [
    [/poll/i, "Make the .bars a data-poll with data-votes so members can vote."],
    [/related|pinned|tip/i, "After the table, add <div data-comments></div> so visitors can reply to the thread."],
    [/repl|answer/i, "Each .post .meta reads \"▲ N · Reply\" so visitors can vote and reply."],
    [/opening|question|post/i, "The opening post's .meta reads \"▲ N · Reply\"; add a Follow data-toggle for the thread."],
  ],
  blog: [
    [/comment|conclusion/i, "Give comment .post blocks a .meta \"▲ N · Reply\" and end with <div data-comments></div>."],
    [/practical|steps|checklist/i, "If there are numbers the reader would plug in their own values for, make a small <form data-calc>; otherwise leave the steps as they are."],
  ],
  news: [
    [/reaction|next/i, "Ask readers a question as a data-poll .bars block with data-votes."],
    [/timeline|unfolded/i, "If it fits, end with a 3-question data-quiz: \"How closely have you followed this?\""],
  ],
  startup: [
    [/pricing|plan/i, "Make pricing interactive: a <form data-calc> with a seats/usage slider and a monthly/annual select whose outputs give the live price; keep the plan cards."],
    [/how it works|steps/i, "Show the product in a data-tabs block (one tab per step or feature) or a small live demo as a <form data-calc>."],
    [/social proof|testimonial/i, "Turn the before/after .bars into a small <form data-calc> ROI estimate if it fits."],
  ],
  gov: [
    [/apply|how to/i, "End with a working <form method=\"post\"> application or appointment form: labeled fields, a data-pick of appointment slots, a submit .btn."],
    [/overview|eligib/i, "Turn eligibility into a quick data-quiz style checker (2-3 yes/no questions, data-correct on the eligible answer, data-explain saying what that means)."],
    [/fees|wait/i, "Add a <form data-calc> fee estimator next to the table."],
    [/contact/i, "Add a short <form method=\"post\"> contact form (name, email, message) beside the contact details."],
  ],
  wiki: [
    [/detail|explanation/i, "Split the subsections into data-tabs."],
    [/see also|references/i, "Before the references, add a 3-question data-quiz: \"Test yourself\"."],
  ],
  zine: [
    [/featured|works/i, "Make the grid data-filter with data-tags per work, and a data-toggle \"Saved ♥\" on each card."],
    [/contributor|submission|events/i, "End with a <form method=\"post\"> submission form (name, email, pitch) and an RSVP data-toggle on the next event."],
  ],
};

export function widgetHint({ kind, brief = "", url = "", title = "", index = 0 }) {
  const hints = [];
  const page = `${url} ${title}`.replace(/\s+/g, "-");
  const purpose = PAGE_PURPOSES.find(([re]) => re.test(page));
  if (purpose && index === 0) return `This page is a ${purpose[1]}, so this section must be ${purpose[2]}, with a short intro — it replaces the brief's own components.`;
  if (purpose) hints.push(`The page's ${purpose[1]} is already in the first section; don't build another.`);
  const pick = (HINTS[kind] ?? []).find(([re]) => re.test(brief.replace(/\. Topic: [\s\S]*$/, "")));
  if (pick && !(purpose && purpose[3].test(pick[1]))) hints.push(pick[1]);
  return hints.join(" ");
}

// ---------- sanitizing model HTML ----------
// Applied to each streamed section before it reaches the browser. It works one
// complete tag at a time, so it is stable as a section grows: the sanitized
// prefix of a longer section equals the sanitized shorter one, which is what
// lets the page stream sanitized bytes by offset (see generatePage).
//
// Tags that could run code or change the document's behaviour become inert
// <template>s (their content is never rendered or run); event-handler and
// srcdoc attributes are dropped; URLs must be relative or http(s)/mailto/tel,
// and absolute http(s) links and form actions are routed through /web/ so the
// fake web stays browsable.
const INERT_TAGS = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "applet", "base", "meta", "link", "style", "noscript", "svg", "math", "portal", "xmp", "plaintext", "noembed", "noframes"]);
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "xlink:href", "poster", "data", "background", "cite", "ping", "srcset", "manifest"]);
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

const decodeEntities = (s) => s
  .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32))
  .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d) || 32))
  .replace(/&colon;/gi, ":").replace(/&tab;|&newline;/gi, "").replace(/&amp;/gi, "&");

// Returns the attribute value to keep, or null to drop the attribute.
function safeURL(name, value) {
  const plain = decodeEntities(value).replace(/[\u0000- \u007f-\u009f]/g, "");
  const scheme = plain.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme) return value;
  if (scheme === "mailto" || scheme === "tel") return name === "href" ? value : null;
  if (scheme !== "http" && scheme !== "https") return null;
  if (name !== "href" && name !== "action" && name !== "formaction") return null; // no off-site pictures
  try {
    const u = new URL(plain);
    return `/web/${u.host}${u.pathname === "/" ? "" : u.pathname}${u.search}`.replace(/"/g, "%22");
  } catch { return null; }
}

function sanitizeTag(whole, close, name, attrs) {
  const tag = name.toLowerCase();
  if (INERT_TAGS.has(tag)) return close ? "</template>" : "<template>";
  if (close) return whole;
  let out = "";
  let changed = false;
  for (const m of attrs.matchAll(ATTR)) {
    const attr = m[1].toLowerCase();
    let raw = m[2];
    if (/^on/.test(attr) || attr === "srcdoc" || attr === "is") { changed = true; continue; }
    if (raw !== undefined && URL_ATTRS.has(attr)) {
      const quoted = /^["']/.test(raw);
      const value = quoted ? raw.slice(1, -1) : raw;
      const safe = safeURL(attr, value);
      if (safe === null) { changed = true; continue; }
      if (safe !== value) { raw = `"${safe}"`; changed = true; }
    }
    out += raw === undefined ? ` ${m[1]}` : ` ${m[1]}=${raw}`;
  }
  if (!changed) return whole;
  return `<${name}${out}${/\/\s*$/.test(attrs) ? " /" : ""}>`;
}

// A slip the model makes with valueless data-* flags: the tag's ">" goes
// missing, as in <button data-correct Sound the fog signal</button>, and the
// rest of the block ends up inside the tag. Put it back when the text runs
// straight into the element's own closing tag.
const UNCLOSED = /<(button|a|span|b|label|li|p|div)((?:\s+(?:data-[\w-]+|disabled|hidden|type|class|name|value|href|id|title)(?:="[^"]*")?)*)\s+([^<>="\s][^<>="]*?)<\/\1>/g;

export function sanitizeSection(html) {
  return html.replace(UNCLOSED, "<$1$2>$3</$1>").replace(TAG, sanitizeTag);
}

// ---------- serving the runtime ----------
const asset = (file) => readFileSync(new URL(`../public/fw/${file}`, import.meta.url));
const version = createHash("sha1").update(asset("widgets.js")).update(asset("widgets.css")).digest("hex").slice(0, 8);

// Goes in the page's <head>. The script is async and wires up components as
// they stream in, so neither tag delays the first styled content.
export const widgetHead = () =>
  `<link rel="stylesheet" href="/fw/widgets.css?v=${version}"><script src="/fw/widgets.js?v=${version}" async></script>`;

// Inline event handlers the theme itself writes (the hero art fades in on
// load). Anything else inline is blocked, so a handler that slips past the
// sanitizer never runs. Add a theme handler's exact source here if it needs one.
export const THEME_INLINE_HANDLERS = ["this.style.opacity=1"];
const hash = (s) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;

export const PAGE_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-hashes' ${THEME_INLINE_HANDLERS.map(hash).join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");
