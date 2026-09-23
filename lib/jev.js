import { normalizePlan, defaultNav } from "./theme.js";
import { markHue } from "./icons.js";
import { STYLES, pickStyle, siteChooser } from "./styles.js";
import { inventedPageType } from "./design.js";
import { OFFLINE, devJevFetch } from "./fake-llm.js";

// One yes/no question per design style: Jev rates how plausible each look is
// for this site, and pickStyle() draws among the plausible ones by domain. A
// single choice would give every forum the same style; ratings let two
// forums differ while a government form still never looks like a synthwave
// club. All of them go in the one request, so this costs no extra latency.
const STYLE_Q = "style_";
const styleQuestions = Object.fromEntries(Object.entries(STYLES).map(([key, s]) => [`${STYLE_Q}${key}`, {
  type: "noul", instructions: `Could the fictional website in the state plausibly be designed as ${s.about}?`,
}]));

export const questions = {
  kind: {
    type: "choice", instructions: "Which website type best fits this fictional URL and its search result?",
    criteria: { forum: "Community discussions", store: "Products for sale", wiki: "Reference or encyclopedia", blog: "Personal writing or essays", news: "Reporting or journalism", startup: "Company or service landing page", gov: "Public agency or civic service", zine: "Experimental art or independent culture" },
  },
  ...styleQuestions,
  // Asked in the same request, so it costs no latency: a real, well-known
  // site gets its design written by the model and is rendered as itself
  // (lib/sitespec.js, lib/design.js); an invented one keeps its generated design.
  real_site: {
    type: "noul", instructions: "Is the domain in `url` a real, widely known website that people already visit today (a famous brand, publication, service or app), rather than an invented or obscure one?",
  },
};

// Each section of a page names the components it should be built from, so the
// four concurrent writers produce a page with visual rhythm (a chart here, a
// thread there) instead of four look-alike stacks of paragraphs. A slot that
// lists alternatives gets one of them per page, so two pages of one kind are
// not composed identically.
const briefs = {
  forum: [
    "The opening post: one .post asking a specific, detailed question, with username, join date and timestamp",
    "Replies: 3-4 .post blocks from distinct usernames with strong, conflicting, practical answers and vote counts; tag the best one with .tag.hot 'Accepted answer'",
    [
      "A community poll as .bars with vote percentages, then one short follow-up .post from the original poster",
      "One member's test results as a table of measurements, then a short follow-up .post from the original poster saying what worked",
      "A dissenting long-time member's .post, then a table summarising who recommended what and why",
    ],
    [
      "Related threads as a table (thread, replies, last post) and a .callout with a pinned community tip",
      "Related threads as a plain ul list of links with .meta reply counts, then the board's rules as a short ol",
    ],
  ],
  // The first section is written before the fact sheet arrives, so it must not
  // be the one that names the products: the lineup comes second, from the sheet,
  // and every later section refers back to the same products.
  store: [
    "Shop intro: a .lead on what this range is for and who it suits, a .row of .tag category filters, and a .callout with the current promotion. Name no individual products; the next section introduces them",
    [
      "Featured products: a .grid of 3 .card items, each with an emoji .thumb, name, .price, .stars and a .btn. Use the fact sheet's product names and prices",
      "Featured products: a catalogue table (name, key spec, .price, .stars, a .btn to buy) of 4-5 items. Use the fact sheet's product names and prices",
      "Featured products: one hero product in a .split (description, .price, .stars, .btn) and two alternatives as .card items in a .grid. Use the fact sheet's product names and prices",
    ],
    "Comparison table of those same products (specs, price, best for) with the best pick marked by a .tag.hot, then 2-3 short .post reviews with .stars, each naming the product the buyer bought",
    [
      "FAQ as 3-4 details.faq items, then a .callout with shipping and returns terms",
      "Care, sizing or setup guide as ol.steps, then shipping and returns terms as a small table",
    ],
  ],
  wiki: [
    "Lead: an .infobox table of key facts floated beside a .lead summary paragraph",
    [
      "History as a ul.timeline of 4-6 dated milestones",
      "Etymology and classification as a table, then a short history in h3 subsections",
    ],
    "Detailed explanation with h3 subsections and one data table",
    "See also and references: an ordered list of cited (invented) sources with links, and a .row of related-entry .tag links",
  ],
  blog: [
    "Opening: a .lead paragraph with a personal hook and a clear, arguable claim",
    "The core argument with concrete examples and one .quote pull quote",
    "The practical part: ol.steps or a checklist the reader can actually use, with numbers",
    [
      "Conclusion, then 2-3 reader comments as .post blocks and a .grid of 'more essays' .card links",
      "Conclusion, then a 'further reading' ul of links with one-line notes, and 2 reader comments as .post blocks",
    ],
  ],
  news: [
    [
      "The lead: who, what, when, where in a .lead paragraph, then a .grid of 3 .stat key numbers",
      "The lead: who, what, when, where in a .lead paragraph, then 'The key facts' as a ul with the numbers in <b>",
    ],
    "Reporting with named sources, one .quote with attribution, and a .callout 'What this means for you'",
    "How it unfolded: a ul.timeline of 4-6 timestamped developments",
    [
      "Reaction and what's next, then 'Related coverage' as a .grid of .card links with .meta timestamps",
      "Reaction from 3 named people as short paragraphs with quotes, then 'What happens next' as a table of dates",
    ],
  ],
  startup: [
    [
      "Value proposition: a .lead line and a .grid of 3 feature .card items, each with an .icon emoji",
      "Value proposition: a .lead line and a comparison table (task, the old way, with this product)",
    ],
    "How it works: ol.steps with 3-4 steps beside a .thumb in a .split, then a .grid of 3 .stat metrics",
    [
      "Social proof: 2-3 .quote testimonials with names and companies, and .bars comparing results before and after",
      "Customer stories: a .grid of 3 .card case studies, each with the company name, a .stat result and one sentence",
    ],
    "Pricing: a .grid of 3 plan .card items with .price, feature lists and a .btn; tag the popular one .tag.hot; end with a short details.faq",
  ],
  gov: [
    "Service overview: a .lead, eligibility as a checklist, and a .callout with the key deadline",
    "How to apply: ol.steps with required documents and fees",
    [
      "Fees and processing times as a table, plus current wait times as .bars by office",
      "Fees and processing times as a table, then 3 common questions as details.faq",
    ],
    "Contact details and office hours table, and a .row of related-service .btn.ghost links",
  ],
  zine: [
    "Editorial intro: a loud .lead manifesto paragraph and a .row of .tag themes",
    [
      "Featured works: a .grid of .card items with emoji .thumb, titles and contributor names",
      "Featured works as a numbered ol of titles, contributors and one-line descriptions, then one .band spotlighting the best",
    ],
    "An interview excerpt: questions in <b>, candid answers, one .quote",
    "Contributors as .post-style bios, an events ul.timeline, and a .callout calling for submissions",
  ],
};

// The pages of a kind that aren't its usual one (see inventedPageType in
// lib/design.js): a forum's feed of threads rather than a thread, a news
// site's front page rather than a story, a shop's product page rather than a
// category, a wiki's main page rather than an article. Same components, so
// every style can draw them.
const pageBriefs = {
  "forum/feed": [
    "The board's latest threads as a table (thread title link, author, replies, views, last post) of 7-8 rows; tag two titles .tag.hot 'Hot' and one .tag 'Solved'",
    "Pinned threads: 2-3 short .post cards from moderators, each a title link in <b>, one line, and a .meta '📌 Pinned · N replies'; then a .callout with the one board rule people break most",
    [
      "Active members this week as a .grid of 3 .card profiles (.av initials, username, post count, one-line specialty)",
      "Today on the board as a .grid of 3 .stat figures (new threads, posts, members online), then a .row of 6 trending topics as .tag links",
    ],
    "The board's categories as a table (category link, one-line description, threads, posts) of 5 rows",
  ],
  "news/front": [
    "The lead story: a big h2 that is a headline link to the story (an in-site article URL), a 2-sentence summary, and a ul of 3 related headline links with .meta times",
    "Top stories: a ul of 7 short headline links from every section, each with a .meta section label and time; tag one .tag.hot 'Live'",
    [
      "More news as a .grid of 3 .card teasers, each with a section label in .meta, a headline link and one sentence",
      "Analysis and opinion: 3 .post columns, each with the columnist's name in .who, a headline link and one sentence",
    ],
    "Most read as an ol of 5 headline links, then readers' reaction to the lead story as a .bars result of a one-question poll",
  ],
  "store/product": [
    "About this item: a .lead line, a ul of 5 detailed feature bullets each opening with a short phrase in <b>, then a small table of 4 key specs. Use exactly the product name and price in the page header",
    "Choose your option: a data-pick .row of 3-4 variants (sizes, colours or capacities; one disabled as sold out), a .callout with the delivery date and returns window, and an Add to cart .btn with the product's exact data-name and data-price",
    "Customer reviews: the .stars and review count from the page header, .bars for 5 to 1 stars with percentages, and 3 review .post blocks (title in <b>, date, body, .meta 'Helpful N')",
    "Customers also bought: a .grid of 3 product .card items (an emoji .thumb, name, .price, .stars, an Add to cart .btn), then 3 details.faq questions",
  ],
  "wiki/main": [
    "From today's featured article: a .lead paragraph summarising an invented article, beginning with its name in <b> and ending with a '(Full article…)' link, then a .meta 'Recently featured' line of 3 links",
    "In the news: a ul of 5 one-sentence items, each with a bold link",
    "Did you know …: a ul of 6 '… that …?' hooks, each with a bold link",
    "On this day: the date in <b>, then a ul.timeline of 5 dated events with links",
  ],
};

// "/field-notes/fog-signals?q=lamps" -> "Fog Signals — lamps". Used when the
// visitor arrived by an in-site link, so there is no search-result title.
export function titleFromURL(url) {
  const u = new URL(url);
  const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
  const words = decodeURIComponent(last).replace(/\.\w+$/, "").replace(/[-_+]+/g, " ").trim();
  const title = words.replace(/\b\w/g, (c) => c.toUpperCase());
  const params = [...u.searchParams.values()].filter(Boolean).join(", ");
  return [title, params && `“${params}”`].filter(Boolean).join(" — ");
}

// Only the design choices need semantic inference. Names/context already exist,
// and code supplies the palette and section responsibilities without more calls.
// answers.kind is Jev's choice; the style is either given outright
// (answers.style.choice: a site's remembered look, or the default layout) or
// drawn from Jev's style_* ratings.
export function planFromAnswers(args, answers) {
  if (!Object.hasOwn(questions.kind.criteria, answers?.kind?.choice)) throw new Error("Invalid Jev kind answer");
  const domain = new URL(args.url).hostname;
  const site = domain.replace(/^www\./, "");
  const kind = answers.kind.choice;
  const ratings = Object.fromEntries(Object.keys(STYLES).map((k) => [k, answers[`${STYLE_Q}${k}`]?.noul]));
  const style = Object.hasOwn(STYLES, answers.style?.choice ?? "") ? answers.style.choice : pickStyle(site, ratings, kind);
  // A search result names one page (a thread, a story), so an index layout
  // is for the site's root, or for a page reached by the site's own links.
  const u = new URL(args.url);
  let page = inventedPageType(kind, args.url);
  if (["feed", "front", "main"].includes(page) && args.title && (u.pathname !== "/" || u.search)) page = null;
  const slots = pageBriefs[`${kind}/${page}`] ?? briefs[kind];
  const title = args.title || titleFromURL(args.url);
  const topic = [title, args.snippet, args.query, args.siteContext?.query].filter(Boolean).join(". ");
  const plan = normalizePlan({
    kind, style,
    // The palette hue is the one the results page used for this domain's logo.
    hue: markHue(domain),
    // The site is named by its domain: the result title the visitor clicked
    // names this page, not the whole site (and it is often a headline).
    site,
    title,
    tag: args.title ? args.snippet || "" : "",
    topic: args.query || args.siteContext?.query,
    nav: defaultNav(kind, domain.replace(/^www\./, "")),
    mark: args.resultKind,
    page,
    secs: slots.map((slot, i) => `${Array.isArray(slot) ? siteChooser(args.url, "briefs")(i, slot) : slot}. Topic: ${topic || args.url}`),
  });
  return plan;
}

// FOOGLE_FAKE_LLM and FOOGLE_LLM_CACHE (lib/fake-llm.js) swap in their own fetch.
export async function jevPlan(args, { apiKey = process.env.TYPESAFE_API_KEY || (OFFLINE ? "offline" : undefined), fetchImpl = devJevFetch ?? fetch, timeoutMs = 1800 } = {}) {
  if (!apiKey) throw new Error("Set TYPESAFE_API_KEY to use Jev page planning.");
  const r = await fetchImpl("https://api.typesafe.ai/v1/systemone", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-latest", state: args, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`Jev HTTP ${r.status}`);
  const answers = (await r.json()).answers;
  const plan = planFromAnswers(args, answers);
  if (Number.isFinite(answers?.real_site?.noul)) plan.realSite = answers.real_site.noul;
  return plan;
}

// Without Jev (no key, a timeout, an outage) the page still gets a layout: the
// kind of result the visitor clicked when it names a page kind, else a blog,
// in one of the styles that kind usually suits (see KIND_STYLES).
export const defaultPlan = (args) => planFromAnswers(args, {
  kind: { choice: Object.hasOwn(questions.kind.criteria, args.resultKind) ? args.resultKind : "blog" },
});

// ---------- search queries ----------
// One request per results page, sent alongside the result shards: which
// instant-answer card the query calls for (if any), whether it asks for a
// tool with nothing to put in it, and how likely it is to hold a typo worth
// a "Did you mean". ~0.3s, so it lands before the first result;
// lib/answers.js decides what to do with it.
export const searchQuestions = {
  answer: {
    type: "choice",
    instructions: "A search engine can show an instant answer card above the web results. Which card, if any, does this search query ask for? Places, teams, companies, words, currencies and flights may be real or fictional and futuristic (a Mars colony, a company that doesn't exist yet): judge only what the searcher wants.",
    criteria: {
      weather: "Current weather or a forecast for a place: 'weather tokyo', 'is it raining in paris', 'olympus mons colony forecast'",
      calculator: "Arithmetic or math to compute, or a general calculator itself: '17% of 2340', '(4+5)*3', 'sqrt 2', '15 times 3', 'calculator'",
      units: "Converting an amount between units of measurement (length, weight, temperature, volume, speed, area, time, data), or a unit converter itself: '5 miles in km', '350 f to c', 'unit converter'",
      currency: "Converting money between currencies, an exchange rate, or a currency converter itself: '100 usd to eur', 'dollar to yen', '50 lunar credits in dollars', 'currency converter'",
      sports: "A sports team's latest score, result or upcoming games: 'lakers score', 'arsenal next match', 'yankees game'",
      stock: "A company's stock or share price, ticker or market cap: 'NVDA stock', 'apple share price', 'tesla stock'",
      dictionary: "The definition, meaning or pronunciation of a word: 'define serendipity', 'serendipity meaning', 'what does ubiquitous mean'",
      time: "The current time where the searcher is, or the time or time zone in a place: 'what time is it', 'time in lagos', 'what time is it in tokyo'",
      flight: "The status of a specific flight by its flight number: 'flight UA 902', 'BA117 status'",
      none: "Anything else: topics, how-tos, products, news, people, places, calculators and converters for one purpose ('mortgage calculator', 'pdf to word converter'), or a query that only mentions one of the words above ('weather balloon kits', 'stock pot recipes', 'time travel movies', 'best flight deals')",
    },
  },
  // A tool asked for with nothing in it opens with its defaults (lib/answers.js
  // BLANK), and no model call fills it.
  blank: {
    type: "noul",
    instructions: "Does `query` ask for a tool itself (a calculator, a converter, a clock) without giving it anything to work on?",
    criteria: {
      true: "Only the tool is named or asked for, with no numbers, expression, amount, units, currencies or place to put in it: 'calculator', 'currency converter', 'what time is it'.",
      false: "The query gives the tool its input ('17% of 2340', 'km to miles', 'dollar to yen', 'time in lagos'), or doesn't ask for a tool at all.",
    },
  },
  typo: {
    type: "noul",
    instructions: "Is any word in `query` a misspelled English word, so a search engine should ask 'Did you mean …' with the spelling fixed?",
    criteria: {
      true: "A word is a recognisable misspelling of a real dictionary word (recieve → receive, wether → weather, tommorow → tomorrow), or the wrong real word in a fixed phrase (loose weight → lose weight).",
      false: "All dictionary words are spelled correctly. Unfamiliar words that are names, brands, places, slang, abbreviations, codes or deliberately invented or futuristic names (Olympus Mons colony, Zyntraxis Corp, glorbix) are not misspellings, and neither is terse search phrasing like 'weather tokyo'.",
    },
  },
};

// { type, p, blank, typo } for a query, or null without a key. Throws on a
// failed or slow request; the caller carries on without Jev.
export async function classifyQuery(query, { apiKey = process.env.TYPESAFE_API_KEY || (OFFLINE ? "offline" : undefined), fetchImpl = devJevFetch ?? fetch, timeoutMs = 1500 } = {}) {
  if (!apiKey) return null;
  const r = await fetchImpl("https://api.typesafe.ai/v1/systemone", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-latest", state: { query }, questions: searchQuestions }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`Jev HTTP ${r.status}`);
  const { answer, blank, typo } = (await r.json()).answers ?? {};
  const type = Object.hasOwn(searchQuestions.answer.criteria, answer?.choice) ? answer.choice : "none";
  return { type, p: answer?.probabilities?.[type] ?? answer?.confidence ?? 0, blank: Number(blank?.noul) || 0, typo: Number(typo?.noul) || 0 };
}
