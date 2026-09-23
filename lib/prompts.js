import { UNITS } from "../public/fw/answers.js";
import { STYLES, SHAPES, NEWS_STYLES } from "./images.js";
import { WIDGET_VOCABULARY, widgetHint } from "./widgets.js";
import { styleVoice } from "./styles.js";
import { brandPrompt } from "./brandtheme.js";

// Later result pages go deeper instead of repeating page 1's obvious picks.
const pageNote = (page) =>
  page > 1 ? `\nThis is results page ${page}: skip the obvious sites a first page would show and go deeper — more niche, older, stranger, more local.` : "";

// One result per line. Beyond title/url/snippet, every field is optional and
// only there to make the results page richer: the SERP renders the site name
// and favicon, a date, a detail line and sitelinks from them.
const SEARCH_LINE = `{"site": "Crumb Forum", "title": "...", "url": "https://domain.tld/path", "snippet": "...", "kind": "forum", "date": "Mar 4, 2026", "meta": "48 answers · Top answer: feed it rye"}`;

const SEARCH_RULES = `Field rules:
- site: the site's own name, 1-3 words.
- snippet: ONE sentence, 14-26 words, with at least one concrete, genuinely useful specific — a number, a step, a price, a verdict, a named trick. Reading the snippets alone should teach the searcher something.
- kind: one of guide, forum, store, tool, video, wiki, news, blog, gov, paper, recipe, event, map, archive.
- date: optional ("Mar 4, 2026", "2 days ago", "Nov 2019"); give it to roughly half the results, spread widely — hours to years old, never two alike.
- meta: optional, under 7 words, the detail a rich result would show — "4.7★ · 1,204 reviews · $18", "12:41 · 88K views", "PDF · 22 pages", "Free · no signup", "48 answers", "Serves 4 · 35 min".
- links: optional, only on an official site or tool — up to 4 sitelink labels, e.g. "links": ["Pricing", "Docs", "Changelog"].

Invent every site — no real, well-known domains (no reddit.com, wikipedia.org, amazon.com, youtube.com, nytimes.com…): make up the forum, the wiki, the store and the video site that would exist instead, with names that feel lived-in. Invent realistic domains (varied TLDs) and URL paths. Titles under 60 chars. Every result must be a distinct site, and no two results should say the same thing.`;

// How a batch treats real sites. A query that names one (cnn, reddit
// sourdough) gets that site as its top result, built in code from
// lib/brands.js; the batches are told it is taken. Otherwise the first batch
// may put a real site first when the query names one the table doesn't know.
const REAL_SITE_RULES = {
  allow: `\nOne exception: if the query itself names or unmistakably navigates to ONE real, well-known website (e.g. "letterboxd", "zillow homes", "bandcamp", "duolingo login"), make your FIRST line that site's real canonical page — its real domain and name, a title like the site's own, 2-4 real sitelinks in "links" — and add "real": true to that line. Only for a query that targets the site itself, never for a topic a site merely covers. Every other result is invented as usual.`,
  taken: (name, host) => `\nThe real site ${name} (${host}) is already shown as the top result; don't list it or any other real domain. Invent sites around it: fan communities, trackers, rivals, guides, archives.`,
};

// The right-hand panel on the All tab: a direct answer and the questions a
// searcher would ask next. Generated alongside the results, never before them.
export function overviewPrompt(query) {
  return {
    system: `You are Foogle's overview writer. Foogle is a search engine for a web that doesn't exist (yet), but its answers are written to be genuinely useful: for a real-world query, give accurate, practical information; for a fictional or futuristic one, answer confidently in-world.

Output ONE compact JSON object and nothing else — no code fences, no commentary:
{"title": "...", "subtitle": "...", "summary": "...", "facts": [["Label", "Value"]], "ask": [{"q": "...", "a": "..."}], "related": ["..."]}

- title: the subject in 1-5 words. subtitle: what it is, under 6 words.
- summary: 2-3 sentences that directly answer the query, with specifics (numbers, names, the actual recommendation).
- facts: 3-5 short label/value pairs a searcher would want at a glance.
- ask: 4 follow-up questions people also ask, each answered in one concrete sentence.
- related: 6 related searches, 2-5 words each, varied — adjacent topics, not rewordings.`,
    user: `Query: ${query}`,
  };
}

export function mapsResultsPrompt(query) {
  return {
    system: `You are the maps index of Foogle, a search engine for a world that doesn't exist (yet). For any query, you invent a local-results list: fictional places — shops, venues, offices, landmarks, oddities — that a map search for it would turn up. Places feel real: specific names, plausible street addresses in one invented neighborhood, believable ratings and opening hours.

Output format (strict): exactly 6 lines. Each line is one complete JSON object on a single line:
{"name": "Harbor & Pine Lamp Repair", "category": "Lighting store", "rating": 4.6, "reviews": 318, "address": "41 Wexley St", "status": "Open · Closes 7 PM", "blurb": "one-sentence review-style highlight", "domain": "harborpinelamps.com", "path": "/visit"}
No array brackets, no commas between lines, no code fences, no commentary — start with the first object immediately.

Ratings 3.4-4.9 with one decimal. "status" is like "Open 24 hours", "Closed · Opens 9 AM Thu", "Open · Closes 11 PM". Blurbs under 18 words. Every place on a distinct domain.`,
    user: `Maps query: ${query}`,
  };
}

export function timelineResultsPrompt(query) {
  return {
    system: `You are the timelines index of Foogle, a search engine that indexes every era — past, present and the future that hasn't happened yet. For any query, you invent a chronology of the subject: real-feeling milestones from its origins, through today, into the coming decades (up to about 2090). Future events are written with the same confident, sourced tone as past ones.

Output format (strict): exactly 10 lines, in chronological order, oldest first. Each line is one complete JSON object on a single line:
{"date": "March 2031", "headline": "...", "detail": "one or two specific sentences", "source": "domain.tld", "path": "/archive/some-page"}
No array brackets, no commas between lines, no code fences, no commentary — start with the first object immediately.

"date" is a year, or month and year. Headlines under 70 chars. At least 4 of the 10 events are after 2026. Each event is sourced to a distinct invented site that fits it (archives, papers, labs, forums, agencies).`,
    user: `Timeline query: ${query}`,
  };
}

// ---------- sharded results ----------
// Search, News and Images pages are split into three shards that generate
// concurrently, so the first result lands after one shard's first line rather
// than after a ninth of the whole document. Each shard is handed a different
// slice of the web, which stops shards from inventing the same three sites and
// gives a *more* varied page than one model call asking for "a mix".
const SHARD_TAIL = `No array brackets, no commas between lines, no code fences, no commentary — start with the first object immediately.`;

export const SEARCH_ANGLES = [
  "the most directly useful answers: official sites, tools, calculators, guides, stores",
  "people: forums, Q&A threads, personal blogs, reviews and video",
  "depth and delight: reference works, archives, research, obsessive hobbyist sites, one surprising tangent",
  "trade press, newsletters, news and independent analysis",
];

export const NEWS_ANGLES = [
  "wire services and national papers running the main story",
  "trade press and specialist outlets covering the industry angle",
  "local news, scrappy newsletters and opinion reacting to it",
  "broadcast and business desks following the money",
];

// Each Images shard draws from different media, so one grid mixes photos,
// diagrams, screenshots and memes the way a real image search does.
export const IMAGE_ANGLES = [
  "photographs: documentary and candid photos, phone snapshots, studio product shots, vintage scans, landscapes and close-ups",
  "explainers and screens: diagrams, cutaways, blueprints, charts, maps, app and website screenshots, 3D renders",
  "art and internet culture: illustrations, memes, stickers, pixel art, posters, prints, paintings, collages, sketches",
];

export function searchShardPrompt(query, { count, angle, page = 1, real = null }) {
  const realRule = real?.taken ? REAL_SITE_RULES.taken(real.taken.name, real.taken.host) : real === "allow" ? REAL_SITE_RULES.allow : "";
  return {
    system: `You are the search index of Foogle, a search engine for a web that doesn't exist (yet). For any query, you invent vivid, specific, genuinely useful search results — fictional sites that feel completely real.

Output format (strict): one complete JSON object per line:
${SEARCH_LINE}
${SHARD_TAIL}

${SEARCH_RULES}${realRule}`,
    user: `Search query: ${query}\nProduce exactly ${count} results.\nThis batch covers only: ${angle}${pageNote(page)}`,
  };
}

export function newsShardPrompt(query, { count, angle, page = 1 }) {
  return {
    system: `You are the news index of Foogle, a search engine for a web that doesn't exist (yet). For any query, you invent vivid, specific, believable news coverage — fictional outlets and stories that feel completely real. Stories should disagree, develop, and react to each other like real coverage does.

Output format (strict): one complete JSON object per line:
{"outlet": "The Meridian Post", "domain": "meridianpost.com", "headline": "...", "snippet": "...", "age": "3 hours ago", "path": "/2045/06/some-story-slug", "style": "photo", "image": "short photo description"}
${SHARD_TAIL}

Headlines under 80 chars, written like real headlines. Snippets ONE sentence, 14-24 words. "age" ranges from minutes to days ago. "image" is a concrete scene, under 12 words, no text in image. "style" is the thumbnail's medium: usually photo, sometimes ${NEWS_STYLES.filter((k) => k !== "photo").join(", ")} — whatever that story would really run. Every item from a distinct outlet.`,
    user: `News query: ${query}\nProduce exactly ${count} stories.\nThis batch covers only: ${angle}${pageNote(page)}`,
  };
}

export function imageShardPrompt(query, { count, angle }) {
  return {
    system: `You are the image index of Foogle, a search engine for a web that doesn't exist (yet). For any query, you invent a varied, visually interesting set of image results — as if scraped from across a fictional web: the photos, diagrams, screenshots, memes, product shots, maps, charts and artwork a real image search turns up.

Output format (strict): one complete JSON object per line:
{"caption": "short caption like a real image-result title", "site": "domain.tld", "path": "/gallery/some-page", "style": "photo", "shape": "wide", "image": "picture description: subject, setting, composition, lighting or colours"}
${SHARD_TAIL}

- style: the medium, one of: ${Object.entries(STYLES).map(([k, v]) => `${k} (${v.label})`).join(", ")}. Pick what that page would really show, and never use the same style twice in a batch.
- shape: the aspect ratio, one of ${Object.keys(SHAPES).join(", ")} — whatever suits the picture (a poster is tall, a panorama or screenshot wide, a sticker or meme square); mix them.
- image: concrete and visual, 12-24 words, with a distinct composition (close-up, overhead, wide shot, cutaway, off-centre…). Name any words the picture itself contains (a meme's caption, a chart's axes); otherwise no text.
Each result from a distinct site. Captions under 60 chars.`,
    user: `Images query: ${query}\nProduce exactly ${count} results.\nThis batch covers only: ${angle}`,
  };
}

// ---------- pages ----------
// The class vocabulary the server's generated stylesheet provides. Sections are
// written by separate concurrent workers that never see each other's output, so
// they cannot invent classes and expect them to be styled — but every one of
// these is guaranteed to exist and to match the site's palette.
export const SECTION_CLASSES = `Layout: .grid (auto-fitting columns of .card), .split (two columns: text beside a visual), .row (wrapping horizontal flex), .band (full-width tinted panel for a standout block).
Blocks: .card (bordered block; add .icon inside for a big emoji), .lead (larger intro paragraph), .callout (tinted notice box — tips, warnings, deadlines), .quote (pull quote; put the attribution in a .meta), .infobox (floated fact table), .thumb (decorative art panel; may hold one big emoji; add .stripes, .dots or .rings for a pattern).
Data: .stat (big number: a <b> then a <span> label; put several in a .grid), .bars (bar chart: <div class="bars"><p><span>Label</span><i style="--v:72%"></i><b>72%</b></p>…</div>), .progress (<div class="progress" style="--v:40%"></div>), .stars (rating: <span class="stars" style="--r:4.5">4.5</span>), .price (price text), table (zebra-striped; add class .num to numeric cells).
Sequences: ol.steps (numbered steps; <b> each step's title), ul.timeline (<li><b>date</b> event</li>), details.faq (<details class="faq"><summary>question</summary><p>answer</p></details>).
People: .post (a forum post or comment: <div class="post"><div class="who"><span class="av">JM</span><b>username</b><span class="meta">3h ago</span></div><p>…</p><div class="meta">▲ 42 · Reply</div></div>), .av (initials avatar).
Small: .meta (muted small text), .tag (pill; .tag.hot for an accent pill), .btn (button link; .btn.ghost for a secondary one), mark (highlight), kbd.`;

// The page's sections are written by concurrent writers that never see each
// other, so left alone they each invent their own cast: the store's grid sells
// a "Trenchline 300" while its comparison table lists a "Hadal 900", and a
// keeper is Elias Ward in one section and Elias Venn in the next. One quick
// call streams the canon alongside layout planning; the first section starts
// without it, and the rest take whatever has arrived after a short wait.
export function pageFactsPrompt({ url, query, title, snippet, siteContext, submission, brand }) {
  const arrival = [
    title && `Page title: ${title}`,
    submission && `This page answers a form the visitor just submitted: ${submission.summary}`,
    snippet && `Search snippet: ${snippet}`,
    query && `Visitor searched for: ${query}`,
    siteContext?.query && `Earlier on this site the visitor searched for: ${siteContext.query}`,
  ].filter(Boolean).join("\n");
  return {
    system: `You prepare the fact sheet for ONE web page on ${brand ? `${brand.name} (the real site), as it will look in the 2040s — invented, futuristic content in ${brand.name}'s own style` : "a site that doesn't exist"}. Several writers will write the page's sections in parallel from your sheet, so it must settle everything they would otherwise invent differently.

Output 5-7 terse lines, one fact per line, under 14 words each, nothing else — no headings, no bullets, no commentary. Most important first: the writers may start with only the first few lines. Cover the page's cast: the specific people (full name + role), products or items (exact name + price/specs), places, organizations, dates and key numbers this page would mention. Commit to specifics and make them fit the page title and snippet exactly. Example line: "Keeper: Elias Venn, 78, climbs Harker Point's 112 steps nightly"`,
    user: `URL: ${url}\n${arrival}`.trim(),
  };
}

export function pageSectionPrompt({ plan, domain, url, brief, index, total, briefs = [], facts = "", picture = false, submission = "" }) {
  const hint = widgetHint({ kind: plan.kind, brief, url, title: plan.title, index });
  const others = briefs.filter((_, i) => i !== index).map((b) => `- ${b.replace(/\. Topic: [\s\S]*$/, "")}`).join("\n");
  // A real, known site (lib/brands.js): the writer imitates it.
  const brand = plan.brand && brandPrompt(plan, domain);
  const pictures = Number(picture) > 1 ? `exactly ${Number(picture)} pictures, one for each of the first ${Number(picture)} items the brief lists,` : "exactly ONE picture";
  return {
    system: `${brand ? `${brand.intro} Use the pre-styled components below so it has the site's visual structure.
- ${brand.voice}
- Components this site's stylesheet adds: ${brand.vocab}.` : `You write ONE section of the body of a web page that doesn't exist. The page's stylesheet, header and footer already exist and are out of your hands. Make this section look designed, not like a plain document: use the pre-styled components below so it has visual structure — data, people, sequences, cards — the way a real ${plan.kind} site would.${plan.style && styleVoice(plan.style) ? `
- This site's design: ${styleVoice(plan.style)} Where the brief names a component that doesn't suit this design, use the nearest one that does.` : ""}`}

Output rules:
- Output ONLY an HTML fragment. No <html>, <head>, <body>, <style>, <script>, no markdown, no commentary.
- Start with a <section> tag and close it. Inside: an h2${brand ? " (unless the brief says there is none)" : ""} and real content.
- Pre-styled components (use these; invent no other classes):
${SECTION_CLASSES}
- ${WIDGET_VOCABULARY.replaceAll("DOMAIN", domain)}
- Use an interactive component where a real ${plan.kind} site would let the visitor do something here, usually one per section, and none where it would feel forced.
- Plain tags (h2, h3, p, ul, ol, li, table, blockquote, b, i, code, a, form, label, input, select, button) are already styled too. The only style="" attributes allowed are the --v and --r values shown above.
- Fill it with specific, committed, genuinely useful content — names, numbers, dates, prices, opinions, usernames, real how-to detail. Never write placeholder text and never mention being generated.
- Every link href must look like /web/<domain>/<path> — this site's own domain for internal links, invented domains for outbound ones. Never use http://, never href="#".${brand ? ` ${brand.links}` : ""}
- The page header already shows the page title${plan.title ? ` ("${plan.title}")` : ""} and tagline. Your h2 must not be the title or a paraphrase of it; start with substance.
- Assume the reader has just read the sections before yours: don't re-introduce the topic or retell its central story — add something new.${facts ? `
- The page's shared fact sheet (in the message) is canon: use its exact names and numbers for anything it covers, and only the facts that belong in your section — the other sections use the rest. Lines marked "(shown in the page header)" win over any line that conflicts with them.` : ""}${picture ? `
- Include ${pictures} of something your section is about (a product, place, person, object): <img class="pic" src="/img/<description>" alt="short alt text">, where <description> is a URL-encoded picture description (concrete subject and composition, 8-16 words, %20 for spaces, no slashes or quotes).${brand ? " Put each where the brief says." : " Put it in a .split beside text, or in a .card."}` : ""}
- 80-150 words of visible text, and fewer (60-100) when the section holds a form, calculator, quiz or tabs, since their markup takes time to write. Tight and real, not padded.`,
    user: `Site: ${plan.site} (${plan.kind}) at ${domain}${plan.tag ? ` — "${plan.tag}"` : ""}
Page: ${url}${plan.title ? `\nPage title: ${plan.title}` : ""}
${facts ? `Fact sheet:\n${facts}\n` : ""}${submission ? `This page is the site's answer to a form the visitor just submitted (${submission}). Speak to them as the site; use their details exactly and never ask them to fill it in again. A confirmation box with the reference and their details is already above your section.\n` : ""}Write section ${index + 1} of ${total}: ${brief}${hint ? `\nInteractivity: ${hint}` : ""}${others ? `\nOther writers are covering these sections, so don't repeat them:\n${others}` : ""}`,
  };
}

// ---------- instant answers ----------
// A card at the top of the All tab (lib/answers.js) is one small JSON object
// the model fills in; code checks it, computes what can be computed and draws
// the card (lib/answer-cards.js). The model never writes the card's markup.
export const WX_CONDS = ["sunny", "clear", "partly cloudy", "cloudy", "fog", "haze", "drizzle", "rain", "showers", "thunderstorm", "snow", "sleet", "windy", "dust storm"];

const ANSWER_CARDS = {
  weather: {
    maxTokens: 480,
    json: `{"place": "City, Country", "tz": "Area/City or null", "utcOffset": hours, "unit": "C or F", "now": {"temp": n, "cond": "…", "precip": percent, "humidity": percent, "wind": n}, "days": [{"hi": n, "lo": n, "cond": "…", "precip": percent, "wind": n}]}`,
    rules: `- place: how a weather service labels it ("Tokyo, Japan", "Olympus Mons Colony, Mars").
- tz: the IANA time zone of a real place on Earth, else null. utcOffset: its offset from UTC in hours; an off-world or fictional place gets the offset of the clock it keeps.
- unit: F for places in the United States, C everywhere else. Every temperature in that unit; wind in km/h, or in mph with F.
- days: exactly 8, starting today. Weather that fits the place's climate and season on this date. An off-world or futuristic place gets physically plausible weather (Mars is cold, dry and dusty).
- cond: one of ${WX_CONDS.join(", ")}.
- now.temp is between today's lo and hi; precipitation and humidity fit the conditions.`,
  },
  calculator: {
    maxTokens: 60,
    json: `{"expr": "…"}`,
    rules: `- expr: the arithmetic the query asks for, written with numbers, + - * / ^ ( ), %, sqrt(), sin() cos() tan() ln() log(), pi and e ("seventeen percent of 2340" -> "17% * 2340"). {"expr": null} if the query isn't arithmetic.`,
  },
  units: {
    maxTokens: 60,
    json: `{"value": n, "from": "unit", "to": "unit"}`,
    rules: `- from and to: two units of the same kind, from this list: ${Object.values(UNITS).flatMap((c) => c.units.map((u) => u[0])).join(", ")}.
- value: the amount to convert (1 if none is given). {"value": null} if the query isn't a unit conversion.`,
  },
  currency: {
    maxTokens: 150,
    json: `{"amount": n, "from": {"code": "ABC", "name": "…", "perUSD": n}, "to": {"code": "ABC", "name": "…", "perUSD": n}}`,
    rules: `- amount: how much of "from" the query asks about (1 if it doesn't say).
- perUSD: how many units of the currency one US dollar buys. A real currency gets a realistic 2026 rate; an invented or future one (lunar credits, the Martian dollar) gets a plausible invented rate, a three-letter code and its full name.`,
  },
  sports: {
    maxTokens: 650,
    json: `{"team": "Full Team Name", "abbr": "ABC", "color": "#hex", "league": "short league name", "sport": "basketball, american football, soccer, baseball, hockey or other", "standing": "3rd in Western Conference", "last": {"date": "Sun, May 3", "status": "Final", "clock": null, "venue": "…", "home": {"name": "Team", "abbr": "ABC", "color": "#hex", "record": "W-L", "periods": [n]}, "away": {"name": "…", "abbr": "…", "color": "#hex", "record": "…", "periods": [n]}}, "next": [{"date": "Tue, Oct 20", "time": "7:30 PM", "opp": "Opponent Name", "abbr": "ABC", "home": true, "tv": "…"}], "standings": [{"team": "Team", "w": n, "l": n}]}`,
    rules: `- The team the query names: a real one, or one from a fictional or future league, invented in-world. color: its primary color; abbr: its 2-4 letter abbreviation.
- last: its most recent game given the league's calendar on this date (in the offseason, the last game of last season). status is "Final" (or "Final/OT"), or "Live" with a clock like "Q3 4:12" if a game is on right now.
- periods: each side's points per quarter, half, period or inning; the score is their sum.
- next: its next 3 games. standings: 5 teams around it in its conference or division, best first, including it.`,
  },
  stock: {
    maxTokens: 260,
    json: `{"name": "Company Name Inc", "ticker": "TICK", "exchange": "NASDAQ", "currency": "USD", "price": n, "prevClose": n, "mktCap": "4.61T", "pe": n or null, "divYield": percent or null, "hist": {"d5": n, "m1": n, "m6": n, "ytd": n, "y1": n or null, "y5": n or null}}`,
    rules: `- A real company gets a plausible 2026 price in its trading currency; a company that doesn't exist gets an in-world listing (a futuristic company may have listed recently).
- prevClose: yesterday's close, within a few percent of price.
- hist: closing prices 5 trading days, 1 month, 6 months, 1 year and 5 years ago, and on the first trading day of this year, tracing a believable trajectory. null for dates before the company listed.`,
  },
  dictionary: {
    maxTokens: 520,
    json: `{"word": "…", "syllables": "ser·en·dip·i·ty", "phonetic": "/ˌserənˈdipədē/", "senses": [{"pos": "noun", "defs": [{"def": "…", "ex": "…", "syn": ["…"]}]}], "origin": "…"}`,
    rules: `- word: the dictionary form of the word asked about, spelled correctly.
- senses: 1-2 parts of speech, 1-3 definitions each, the most common first. ex: a short example sentence using the word. syn: up to 4 synonyms (may be empty).
- origin: one or two sentences of etymology.
- An invented or futuristic word gets a confident definition from Foogle's future and a plausible coinage.`,
  },
  time: {
    maxTokens: 80,
    json: `{"place": "City, Country", "tz": "Area/City or null", "utcOffset": hours, "abbr": "…"}`,
    rules: `- tz: the IANA time zone of a real place on Earth, else null. utcOffset: hours from UTC; a fictional or off-world place gets the clock it would plausibly keep.
- abbr: the zone's short name ("WAT", "PDT"); invent one for a fictional place.`,
  },
  flight: {
    maxTokens: 300,
    json: `{"airline": "…", "number": "UA 902", "date": "Wed, Sep 23", "status": "Scheduled, Boarding, Departed, In flight, Delayed, Landed or Cancelled", "from": {"code": "SFO", "city": "…", "sched": "10:35 AM", "actual": "10:48 AM", "terminal": "3", "gate": "F12"}, "to": {"code": "…", "city": "…", "sched": "…", "actual": "…", "terminal": "…", "gate": "…"}, "aircraft": "…", "duration": "11h 5m", "progress": 0 to 1}`,
    rules: `- A plausible route and schedule for this airline and flight number (the real route where there is one; a future or off-world flight gets an in-world one). Times are local at each airport; actual is the actual or estimated time, or null.
- status and progress fit the current time.`,
  },
};

export const answerMaxTokens = (type) => ANSWER_CARDS[type].maxTokens;

export function answerPrompt(type, query, { now = new Date() } = {}) {
  const { json, rules } = ANSWER_CARDS[type];
  const today = now.toLocaleString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });
  // To the hour: close enough for a flight's status, and the prompt (so a
  // recording of it, see lib/llm-cache.js) stays the same for an hour.
  const time = `${now.toLocaleString("en-US", { timeZone: "UTC", hour: "2-digit", hourCycle: "h23" })}:00`;
  return {
    system: `You fill in the ${type} answer card on Foogle, a search engine for a web that doesn't exist (yet). The data is invented but plausible and internally consistent: realistic for real places, teams, companies and words; confident and in-world for fictional or futuristic ones. Today is ${today}; it is about ${time} UTC.

Output ONE compact JSON object and nothing else — no code fences, no commentary. The shape (field types, not values to copy):
${json}

${rules}`,
    user: `Query: ${query}`,
  };
}

// "Did you mean": the query with only its misspellings fixed.
export function spellPrompt(query) {
  return {
    system: `You fix spelling in search queries for Foogle, a search engine. Correct only clear misspellings of ordinary words (recieve -> receive), or the wrong real word in a fixed phrase (loose weight -> lose weight). Keep every other word exactly as typed, in the same order. Never change names, brands, places, slang, abbreviations, codes, or invented or futuristic names.
Output JSON only: {"fixed": "the corrected query"}, or {"fixed": null} if nothing needs fixing.`,
    user: `Query: ${query}`,
  };
}
