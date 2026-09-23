import { normalizePlan, defaultNav } from "./theme.js";
import { markHue } from "./icons.js";

export const questions = {
  kind: {
    type: "choice", instructions: "Which website type best fits this fictional URL and its search result?",
    criteria: { forum: "Community discussions", store: "Products for sale", wiki: "Reference or encyclopedia", blog: "Personal writing or essays", news: "Reporting or journalism", startup: "Company or service landing page", gov: "Public agency or civic service", zine: "Experimental art or independent culture" },
  },
  mood: {
    type: "choice", instructions: "Which visual style best fits the fictional website described in the state?",
    criteria: { dark: "Restrained dark interface", light: "Clean bright interface", paper: "Warm print or archival aesthetic", neon: "Luminous futuristic aesthetic", brutal: "Bold stark graphic aesthetic" },
  },
};

// Each section of a page names the components it should be built from, so the
// four concurrent writers produce a page with visual rhythm (a chart here, a
// thread there) instead of four look-alike stacks of paragraphs.
const briefs = {
  forum: [
    "The opening post: one .post asking a specific, detailed question, with username, join date and timestamp",
    "Replies: 3-4 .post blocks from distinct usernames with strong, conflicting, practical answers and vote counts; tag the best one with .tag.hot 'Accepted answer'",
    "A community poll as .bars with vote percentages, then one short follow-up .post from the original poster",
    "Related threads as a table (thread, replies, last post) and a .callout with a pinned community tip",
  ],
  // The first section is written before the fact sheet arrives, so it must not
  // be the one that names the products: the lineup comes second, from the sheet,
  // and every later section refers back to the same products.
  store: [
    "Shop intro: a .lead on what this range is for and who it suits, a .row of .tag category filters, and a .callout with the current promotion. Name no individual products; the next section introduces them",
    "Featured products: a .grid of 3 .card items, each with an emoji .thumb, name, .price, .stars and a .btn. Use the fact sheet's product names and prices",
    "Comparison table of those same products (specs, price, best for) with the best pick marked by a .tag.hot, then 2-3 short .post reviews with .stars, each naming the product the buyer bought",
    "FAQ as 3-4 details.faq items, then a .callout with shipping and returns terms",
  ],
  wiki: [
    "Lead: an .infobox table of key facts floated beside a .lead summary paragraph",
    "History as a ul.timeline of 4-6 dated milestones",
    "Detailed explanation with h3 subsections and one data table",
    "See also and references: an ordered list of cited (invented) sources with links, and a .row of related-entry .tag links",
  ],
  blog: [
    "Opening: a .lead paragraph with a personal hook and a clear, arguable claim",
    "The core argument with concrete examples and one .quote pull quote",
    "The practical part: ol.steps or a checklist the reader can actually use, with numbers",
    "Conclusion, then 2-3 reader comments as .post blocks and a .grid of 'more essays' .card links",
  ],
  news: [
    "The lead: who, what, when, where in a .lead paragraph, then a .grid of 3 .stat key numbers",
    "Reporting with named sources, one .quote with attribution, and a .callout 'What this means for you'",
    "How it unfolded: a ul.timeline of 4-6 timestamped developments",
    "Reaction and what's next, then 'Related coverage' as a .grid of .card links with .meta timestamps",
  ],
  startup: [
    "Value proposition: a .lead line and a .grid of 3 feature .card items, each with an .icon emoji",
    "How it works: ol.steps with 3-4 steps beside a .thumb in a .split, then a .grid of 3 .stat metrics",
    "Social proof: 2-3 .quote testimonials with names and companies, and .bars comparing results before and after",
    "Pricing: a .grid of 3 plan .card items with .price, feature lists and a .btn; tag the popular one .tag.hot; end with a short details.faq",
  ],
  gov: [
    "Service overview: a .lead, eligibility as a checklist, and a .callout with the key deadline",
    "How to apply: ol.steps with required documents and fees",
    "Fees and processing times as a table, plus current wait times as .bars by office",
    "Contact details and office hours table, and a .row of related-service .btn.ghost links",
  ],
  zine: [
    "Editorial intro: a loud .lead manifesto paragraph and a .row of .tag themes",
    "Featured works: a .grid of .card items with emoji .thumb, titles and contributor names",
    "An interview excerpt: questions in <b>, candid answers, one .quote",
    "Contributors as .post-style bios, an events ul.timeline, and a .callout calling for submissions",
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
export function planFromAnswers(args, answers) {
  for (const [id, question] of Object.entries(questions)) {
    if (!Object.hasOwn(question.criteria, answers?.[id]?.choice)) throw new Error(`Invalid Jev ${id} answer`);
  }
  const domain = new URL(args.url).hostname;
  const kind = answers.kind.choice;
  const title = args.title || titleFromURL(args.url);
  const topic = [title, args.snippet, args.query, args.siteContext?.query].filter(Boolean).join(". ");
  const plan = normalizePlan({
    kind, mood: answers.mood.choice,
    // The palette hue is the one the results page used for this domain's logo.
    hue: markHue(domain),
    // The site is named by its domain: the result title the visitor clicked
    // names this page, not the whole site (and it is often a headline).
    site: domain.replace(/^www\./, ""),
    title,
    tag: args.title ? args.snippet || "" : "",
    topic: args.query || args.siteContext?.query,
    nav: defaultNav(kind, domain.replace(/^www\./, "")),
    mark: args.resultKind,
    secs: briefs[kind].map(brief => `${brief}. Topic: ${topic || args.url}`),
  });
  return plan;
}

export async function jevPlan(args, { apiKey = process.env.TYPESAFE_API_KEY, fetchImpl = fetch, timeoutMs = 1800 } = {}) {
  if (!apiKey) throw new Error("Set TYPESAFE_API_KEY to use Jev page planning.");
  const r = await fetchImpl("https://api.typesafe.ai/v1/systemone", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-latest", state: args, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`Jev HTTP ${r.status}`);
  return planFromAnswers(args, (await r.json()).answers);
}

// Without Jev (no key, a timeout, an outage) the page still gets a layout: the
// kind of result the visitor clicked when it names a page kind, else a blog.
export const defaultPlan = (args) => planFromAnswers(args, {
  kind: { choice: Object.hasOwn(questions.kind.criteria, args.resultKind) ? args.resultKind : "blog" },
  mood: { choice: "light" },
});
