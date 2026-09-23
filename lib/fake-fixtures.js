// The canned output behind FOOGLE_FAKE_LLM (see lib/fake-llm.js). Every
// prompt Foogle sends is recognised by its wording and answered in the format
// that prompt asks for: result lines, overview JSON, fact sheets, page
// sections built from the real component vocabulary (SECTION_CLASSES and the
// interactive widgets), SVG pictures and comment replies. Nothing is random:
// answers are seeded by the prompt, so the same query or URL always gets the
// same answer and different ones differ.
//
// A prompt this file doesn't recognise throws, naming the prompt, so a new
// model call fails loudly in fake mode until it gets a fixture here.

import { createHash } from "node:crypto";
import { STYLES as MEDIA, SHAPES, NEWS_STYLES } from "./images.js";
import { STYLE_KEYS, KIND_STYLES } from "./styles.js";

// ---------- seeded choice ----------
const h32 = (s) => createHash("md5").update(String(s)).digest().readUInt32LE(0);
// A deterministic stream of choices for one seed: r(n) is 0..n-1.
function rng(seed) {
  let x = h32(seed) || 1;
  return (n) => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) % n;
  };
}
const pick = (r, list) => list[r(list.length)];
const shuffled = (r, list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = r(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = (s) => String(s).replace(/^\p{L}/u, (c) => c.toUpperCase());
const titleCase = (s) => String(s).replace(/(^|[\s-])(\p{L})/gu, (_, a, c) => a + c.toUpperCase());
const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const money = (n) => `$${n.toLocaleString("en-US")}`;
const line = (prefix, text) => text.match(new RegExp(`^${prefix}(.*)$`, "m"))?.[1]?.trim() ?? "";

// ---------- word banks ----------
const FIRST = ["Mara", "Theo", "Priya", "Jules", "Nadia", "Sam", "Iris", "Kenji", "Lucía", "Owen", "Ada", "Felix", "Rosa", "Tomás", "Hana", "Wren"];
const LAST = ["Okafor", "Lindqvist", "Raman", "Ferreira", "Brandt", "Achebe", "Novak", "Moreau", "Paredes", "Hart", "Moss", "Calloway", "Ibarra", "Sato", "Venn", "Quill"];
const HANDLES = ["mossbyte", "quietferment", "lina_k", "deltasprocket", "oldharbor", "pixelfern", "tinmouse", "saltmarsh42", "gritandgrain", "nightowl_ops", "fernhollow", "rustbucket9"];
const BRANDS = ["Harbor", "Northwind", "Ember", "Juniper", "Fieldstone", "Copperline", "Tidewater", "Kestrel", "Old Mill", "Lumen", "Driftwood", "Alder"];
const MODELS = ["300", "Mk II", "Mini", "Pro", "S", "Classic", "XL", "Trail", "One", "Duo"];
const TOWNS = ["Wexley", "Harker Point", "Millbrook", "Saltmarsh", "Cinder Hill", "Port Avery", "Greyfield", "Otter Bay"];
const STREETS = ["Wexley St", "Canal Row", "Pine Ave", "Market Sq", "Ferry Rd", "Juniper Ln", "Mill St", "Harbor Walk", "Orchard Way", "Quarry Hill"];
const ROLES = ["founder", "head of workshop", "senior editor", "community moderator", "field researcher", "curator", "lead tester", "archivist"];
const PARTS = ["seal", "wick", "gasket", "hinge", "filter", "battery", "mount", "valve", "strap", "lens"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EMOJI = ["🏮", "🧭", "🪴", "🧰", "📦", "🔭", "🧵", "🕯️", "🛠️", "📐", "🗺️", "🎛️"];
// Filler words, and the model names products get (so "Kestrel Lantern Pro" is about lanterns).
const STOP = new Set(`the and for with from that this your into what when how why are you our about over after near best guide a an of to in on at by is it my new ${MODELS.join(" ").toLowerCase()}`.split(" "));

// What a query or page title is about: "Storm Lanterns — Lanternworks" ->
// { phrase: "storm lanterns", Title: "Storm Lanterns", noun: "lantern", plural: "lanterns" }.
export function topicOf(text) {
  const head = String(text ?? "").split(/\s+[—|–]\s+|\s-\s|[?:!“”"]/)[0].toLowerCase();
  const words = head.match(/\p{L}[\p{L}']*/gu)?.filter((w) => w.length > 2 && !STOP.has(w)).slice(-3) ?? [];
  if (!words.length) words.push("gadgets");
  const last = words.at(-1);
  const noun = /[^s]s$/.test(last) ? last.slice(0, -1) : last;
  const phrase = words.join(" ");
  return { phrase, Title: titleCase(phrase), noun, plural: noun === last && !last.endsWith("s") ? `${noun}s` : last, words };
}

// What a page is about, from its fact-sheet or section prompt. A confirmation
// page is about what was ordered, else its title. Other pages' prompts carry
// the title, the result snippet and the search query; the query (usually the
// shortest) names the subject best.
function pageTopic(user, url) {
  const ordered = user.match(/ordered \d+× ([^(;]+)/)?.[1];
  if (ordered) return topicOf(ordered);
  if (/form the visitor just submitted/.test(user)) return topicOf(line("Page title:", user) || pathTopic(url));
  const candidates = [line("Visitor searched for:", user), user.match(/\. Topic: (.*)$/m)?.[1], line("Page title:", user)]
    .flatMap((c) => String(c ?? "").split(/\.\s+/)).map((c) => c.trim()).filter(Boolean);
  return topicOf(candidates.sort((a, b) => a.length - b.length)[0] || pathTopic(url));
}

// Fills "{noun}"-style slots in a template.
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

// The invented particulars of one page, from its URL: every section of the
// page and its fact sheet derive the same cast from the same seed, so the
// products in the grid are the products in the comparison table.
function canonOf(url, topic) {
  const r = rng(`canon|${url}`);
  const person = () => ({ name: `${pick(r, FIRST)} ${pick(r, LAST)}`, role: pick(r, ROLES) });
  const brands = shuffled(r, BRANDS);
  const models = shuffled(r, MODELS);
  const products = [0, 1, 2, 3].map((i) => ({
    name: `${brands[i]} ${titleCase(topic.noun)} ${models[i]}`,
    price: [19, 24, 38, 49, 64, 89, 120, 145, 210, 340][r(10)] + i * 7,
    spec: `${120 + r(900)} g · ${2 + r(10)}-year warranty`,
    stars: (3.8 + r(12) / 10).toFixed(1),
    best: ["beginners", "travel", "heavy use", "gifts", "small spaces", "all-weather use"][r(6)],
    tags: shuffled(r, ["solo", "ultralight", "family", "budget", "premium", "classic", "compact"]).slice(0, 2).join(" "),
    emoji: pick(r, EMOJI),
  }));
  return {
    people: [person(), person(), person(), person()],
    handles: shuffled(r, HANDLES),
    products,
    town: pick(r, TOWNS),
    street: `${10 + r(190)} ${pick(r, STREETS)}`,
    year: 1996 + r(34),
    part: pick(r, PARTS),
    pct: 12 + r(70),
    years: 3 + r(15),
    count: 6 + r(40),
  };
}

// ---------- search results ----------
const SITE_WORDS = {
  forum: ["Talk", "Forum", "Board", "Circle", "Commons"],
  store: ["Supply", "Works", "Outfitters", "Shop", "Emporium"],
  guide: ["Guide", "Handbook", "Field Notes", "Almanac"],
  tool: ["Calc", "Lab", "Tools", "Planner"],
  video: ["TV", "Clips", "Reel", "Tube"],
  wiki: ["pedia", "Wiki", "Atlas", "Codex"],
  news: ["Ledger", "Dispatch", "Wire", "Gazette", "Times"],
  blog: ["Notes", "Journal", "Diary", "Log"],
  gov: ["Office", "Bureau", "Authority"],
  paper: ["Review", "Quarterly", "Institute"],
  recipe: ["Kitchen", "Table", "Pantry"],
  event: ["Fest", "Fair", "Expo"],
  map: ["Maps", "Wayfinder"],
  archive: ["Archive", "Vault", "Collection"],
};
const TLDS = {
  forum: ["net", "org", "community", "club"], store: ["shop", "com", "co", "store"], gov: ["gov"], news: ["news", "com", "press"],
  wiki: ["org", "wiki"], paper: ["org", "edu"], video: ["tv", "video", "com"], archive: ["org", "museum"],
};
// Which kinds of site each search shard's slice of the web turns up
// (SEARCH_ANGLES in lib/prompts.js, matched by a word from each).
const ANGLE_KINDS = [
  [/official|tools|stores/i, ["store", "tool", "guide", "gov", "store"]],
  [/forums|people/i, ["forum", "blog", "video", "forum"]],
  [/reference|archives|research/i, ["wiki", "archive", "paper", "blog"]],
  [/trade press|newsletters|news/i, ["news", "blog", "paper", "news"]],
];

const TITLES = {
  forum: ["{Title}: anyone else seeing this?", "What finally worked for my {plural}", "{Title} beginner questions megathread", "Are {plural} worth it in 2026?"],
  store: ["{Title} — Shop the Full Range", "Buy {Title} Online | Free Returns", "{Title}: New Season Collection"],
  guide: ["The Complete Guide to {Title}", "How to Choose {Title} (2026 Edition)", "{Title}, Explained in 10 Minutes"],
  tool: ["{Title} Cost Calculator", "{Title} Planner — Free Online Tool", "Compare {Title} Side by Side"],
  video: ["I Tested 9 {Title} So You Don't Have To", "{Title}: A Week-Long Field Test", "Restoring a 1970s {Noun}"],
  wiki: ["{Title}", "{Title} — History and Types", "List of Notable {Title}"],
  news: ["{Title} Prices Jump {pct}% Ahead of Winter", "City Council Votes on {Title} Rules", "Inside the {Title} Supply Crunch"],
  blog: ["Why I Stopped Worrying About {Title}", "{count} Years of {Title}: What I Got Wrong", "A Love Letter to {Title}"],
  gov: ["{Title} Permits and Safety Rules", "Apply for a {Noun} Licence", "{Title}: Public Guidance"],
  paper: ["A Field Study of {Title} in Coastal Towns", "{Title} Under Load: {count} Trials", "Long-Term Wear in {Title}"],
  recipe: ["Smoky {Title} Stew", "Grandma's {Title} Bake", "{Title} in 20 Minutes"],
  event: ["{Title} Fair 2026 — Tickets", "{Title} Night Market, {town}", "The {Title} Expo Returns"],
  map: ["{Title} Near You — Map", "Every {Noun} in {town}, Mapped"],
  archive: ["{Title} Catalogue, 1890–1950", "The {Title} Photo Archive", "Letters About {Title}, 1911"],
};
const SNIPPETS = {
  forum: "{count} members weighed in; the accepted answer says to check the {part} every {years} weeks, which fixed it for {pct}% of posters.",
  store: "Free shipping over $50 and {years}-year warranties; the bestselling {noun} is ${price} and ships within 2 days from {town}.",
  guide: "Start with the {part}: it causes {pct}% of problems. Our step-by-step guide covers sizing, care and the {count} mistakes buyers make.",
  tool: "Enter your numbers and get a cost in seconds — most households spend ${price} a year on {plural}, but {pct}% could pay less.",
  video: "We ran {count} {plural} for {years} weeks straight; the ${price} one beat models costing three times as much on every test.",
  wiki: "{Title} have been made since {year}; the modern design, with a sealed {part}, dates from the {decade}s and is used in {count} countries.",
  news: "Prices rose {pct}% this quarter as {town} suppliers ran short; analysts expect relief by spring, but only for {plural} under ${price}.",
  blog: "After {count} years with {plural} I trust exactly one rule: replace the {part} before it fails, not after. Everything else is taste.",
  gov: "Applications take {years} weeks and cost ${price}; bring proof of address and your {noun} inspection certificate to any office.",
  paper: "Across {count} trials, {plural} with a double {part} lasted {pct}% longer (p < 0.01); we recommend inspection every {years} months.",
  recipe: "Serves 4 in 35 minutes: brown the onions for {years} minutes, add {count} g of stock, and finish with a spoon of butter.",
  event: "{count} makers, live demos every hour and a ${price} family pass; doors open at 10 AM at {street}, {town}.",
  map: "{count} places within 2 km of {town} centre, with opening hours, ratings and which ones are open late tonight.",
  archive: "{count} scanned catalogues and photographs from {year} onward, searchable by maker, town and {part} type.",
};
const METAS = {
  forum: ["{count} answers · Top answer: check the {part}", "{count} replies · Solved"],
  store: ["{stars}★ · {reviews} reviews · ${price}", "In stock · from ${price}"],
  video: ["12:41 · 88K views", "8:05 · 1.2M views"],
  paper: ["PDF · 22 pages", "PDF · {count} pages"],
  tool: ["Free · no signup"],
  recipe: ["Serves 4 · 35 min"],
  guide: ["Updated Sep 2026 · 14 min read"],
  event: ["Sat, Oct 17 · {town}"],
};
const LINKS = { store: ["Shop all", "Bestsellers", "Sale", "Stockists"], tool: ["Pricing", "Docs", "Changelog"], gov: ["Apply", "Fees", "Contact us"] };

function siteFor(r, topic, kind) {
  const word = cap(pick(r, topic.words));
  const suffix = pick(r, SITE_WORDS[kind] ?? SITE_WORDS.blog);
  const name = kind === "gov" ? `${pick(r, TOWNS)} ${word} ${suffix}` : suffix === "pedia" ? `${word}pedia` : r(3) ? `${word} ${suffix}` : `${pick(r, BRANDS)} ${suffix}`;
  const tld = pick(r, TLDS[kind] ?? ["com", "net", "io", "org", "co", "xyz"]);
  return { name, domain: `${slug(name).replace(/-/g, r(2) ? "" : "-")}.${tld}` };
}

function searchLine(query, kind, seed) {
  const r = rng(seed);
  const topic = topicOf(query);
  const site = siteFor(r, topic, kind);
  const vars = {
    ...topic, Noun: titleCase(topic.noun), count: 6 + r(60), pct: 11 + r(70), years: 2 + r(9), price: 12 + r(300), part: pick(r, PARTS),
    town: pick(r, TOWNS), street: `${10 + r(190)} ${pick(r, STREETS)}`, year: 1850 + r(150), decade: 1950 + r(6) * 10,
    stars: (4 + r(10) / 10).toFixed(1), reviews: (100 + r(4000)).toLocaleString("en-US"),
  };
  const title = fill(pick(r, TITLES[kind]), vars);
  const out = {
    site: site.name,
    title: title.slice(0, 60),
    url: `https://${site.domain}/${slug(kind === "store" ? `shop ${topic.phrase}` : kind === "forum" ? `t ${title}` : title).slice(0, 48)}`,
    snippet: fill(SNIPPETS[kind], vars),
    kind,
  };
  if (r(2)) out.date = pick(r, ["3 hours ago", "2 days ago", "Mar 4, 2026", "Nov 2019", "Jul 18, 2025", "1 week ago", "Jan 2024"]);
  if (METAS[kind]) out.meta = fill(pick(r, METAS[kind]), vars);
  if (LINKS[kind] && r(2)) out.links = LINKS[kind].slice(0, 3);
  return out;
}

function searchShard(system, user) {
  const query = line("Search query:", user);
  const count = Number(user.match(/Produce exactly (\d+)/)?.[1]) || 3;
  const angle = line("This batch covers only:", user);
  const page = Number(user.match(/results page (\d+)/)?.[1]) || 1;
  const kinds = (ANGLE_KINDS.find(([re]) => re.test(angle)) ?? ANGLE_KINDS[0])[1];
  return jsonl(Array.from({ length: count }, (_, i) => searchLine(query, kinds[(i + page - 1) % kinds.length], `search|${query}|${angle}|${page}|${i}`)));
}

const jsonl = (items) => `${items.map((o) => JSON.stringify(o)).join("\n")}\n`;

function overview(system, user) {
  const query = line("Query:", user);
  const t = topicOf(query);
  const r = rng(`overview|${query}`);
  const c = canonOf(`overview|${query}`, t);
  return JSON.stringify({
    title: t.Title,
    subtitle: pick(r, [`Care, buying and repair`, `A practical overview`, `What to know in 2026`]),
    summary: `${t.Title} last about ${c.years} years when the ${c.part} is checked every season; most problems (${c.pct}%) start there. Expect to pay ${money(c.products[0].price)}–${money(c.products[3].price)} for a good one, and buy for the conditions you actually have.`,
    facts: [["Typical lifespan", `${c.years} years`], ["Price range", `${money(c.products[0].price)}–${money(c.products[3].price)}`], ["Most common fault", `Worn ${c.part}`], ["Best for beginners", c.products[1].name]],
    ask: [
      { q: `How long do ${t.plural} last?`, a: `About ${c.years} years with yearly care, and twice that if you replace the ${c.part} early.` },
      { q: `Are cheap ${t.plural} worth it?`, a: `For occasional use yes; past ${c.count} uses a year the ${money(c.products[2].price)} tier pays for itself.` },
      { q: `How do I fix a leaking ${t.noun}?`, a: `Replace the ${c.part}; it is a ten-minute job with a flat screwdriver.` },
      { q: `Where are ${t.plural} made?`, a: `Mostly in ${c.town} and two other towns, by ${c.count} small workshops.` },
    ],
    related: [`${t.noun} repair`, `${t.noun} ${c.part} replacement`, `vintage ${t.plural}`, `${t.plural} for beginners`, `${t.noun} safety rules`, `best ${t.plural} 2026`],
  });
}

// ---------- news, images, maps, timelines ----------
const OUTLETS = [
  [/wire services|national/i, ["The Meridian Post", "Continental Wire", "The National Ledger", "Daily Almanac"]],
  [/trade press|specialist/i, ["{Title} Trade Weekly", "Workshop Review", "Supply Line", "The Maker's Gazette"]],
  [/local news|newsletters|opinion/i, ["{town} Courier", "The {town} Bugle", "Harbor Notes", "Porchlight Opinion"]],
  [/broadcast|business|money/i, ["Channel 9 Business", "Market Desk", "Tidewater Business Journal", "Evening Bulletin"]],
];
const HEADLINES = [
  "{Title} Makers Brace for a {pct}% Jump in Orders",
  "{town} Votes to Fund a Public {Noun} Programme",
  "Why Everyone Suddenly Wants a {Noun}",
  "Shortage of {part}s Leaves {plural} Stuck in Warehouses",
  "Inside the Workshop Making {count} {plural} a Week",
  "Opinion: Stop Buying Cheap {plural}",
  "{Title} Prices Ease After Record Quarter",
  "Regulators Draft First Safety Rules for {plural}",
];

function newsShard(system, user) {
  const query = line("News query:", user);
  const count = Number(user.match(/Produce exactly (\d+)/)?.[1]) || 3;
  const angle = line("This batch covers only:", user);
  const page = Number(user.match(/results page (\d+)/)?.[1]) || 1;
  const t = topicOf(query);
  const r = rng(`news|${query}|${angle}|${page}`);
  const outlets = shuffled(r, (OUTLETS.find(([re]) => re.test(angle)) ?? OUTLETS[0])[1]);
  const heads = shuffled(r, HEADLINES);
  return jsonl(Array.from({ length: count }, (_, i) => {
    const vars = { ...t, Noun: titleCase(t.noun), pct: 8 + r(60), count: 20 + r(400), town: pick(r, TOWNS), part: pick(r, PARTS) };
    const outlet = fill(outlets[i % outlets.length], vars);
    const headline = fill(heads[i % heads.length], vars);
    return {
      outlet, domain: `${slug(outlet).replace(/-/g, "")}.${pick(r, ["com", "news", "net"])}`, headline,
      snippet: fill("Orders for {plural} rose {pct}% in {town} this month, and {count} workshops say they cannot hire fast enough to keep up.", vars),
      age: pick(r, ["12 minutes ago", "1 hour ago", "3 hours ago", "Yesterday", "2 days ago", "5 days ago"]),
      path: `/2026/09/${slug(headline).slice(0, 40)}`,
      style: i === 0 ? "photo" : pick(r, NEWS_STYLES),
      image: `${pick(r, ["workers packing", "a crowd inspecting", "a close-up of", "a shop window full of"])} ${t.plural} in ${vars.town}`,
    };
  }));
}

// The media each Images shard draws from (IMAGE_ANGLES in lib/prompts.js).
const IMAGE_MEDIA = [
  [/photographs/i, ["photo", "snapshot", "product", "scan", "photo"]],
  [/explainers|screens/i, ["diagram", "blueprint", "chart", "screenshot", "map", "render3d", "isometric"]],
  [/art|internet culture/i, ["flat", "pixel", "meme", "poster", "watercolor", "sticker", "woodcut", "neon", "collage", "line", "painting"]],
];

function imageShard(system, user) {
  const query = line("Images query:", user);
  const count = Number(user.match(/Produce exactly (\d+)/)?.[1]) || 4;
  const angle = line("This batch covers only:", user);
  const t = topicOf(query);
  const r = rng(`images|${query}|${angle}`);
  const media = shuffled(r, (IMAGE_MEDIA.find(([re]) => re.test(angle)) ?? IMAGE_MEDIA[0])[1].filter((m, i, a) => a.indexOf(m) === i));
  const shapes = Object.keys(SHAPES);
  return jsonl(Array.from({ length: count }, (_, i) => {
    const style = media[i % media.length];
    const site = siteFor(r, t, pick(r, ["blog", "store", "wiki", "forum", "archive"]));
    const what = pick(r, ["on a workbench", "at dusk on a harbour wall", "in a cluttered shop window", "on a kitchen table", "hanging in a garden", "in a museum case"]);
    return {
      caption: `${cap(MEDIA[style].label)}: ${t.Title} ${what}`.slice(0, 60),
      site: site.domain, path: `/gallery/${slug(`${t.noun} ${style}`)}`,
      style, shape: i % 3 === 0 ? MEDIA[style].shape : pick(r, shapes),
      image: `${cap(t.noun)} ${what}, ${pick(r, ["close-up", "overhead view", "wide shot", "off-centre composition", "cutaway"])}, ${pick(r, ["warm light", "cool blue tones", "bold colours", "muted palette"])}`,
    };
  }));
}

function mapsResults(system, user) {
  const query = line("Maps query:", user);
  const t = topicOf(query);
  const r = rng(`maps|${query}`);
  const brands = shuffled(r, BRANDS);
  return jsonl(Array.from({ length: 6 }, (_, i) => {
    const name = `${brands[i]} ${titleCase(t.noun)} ${pick(r, ["House", "Bar", "Works", "Corner", "Depot", "Room"])}`;
    return {
      name, category: `${titleCase(t.noun)} ${pick(r, ["shop", "restaurant", "workshop", "museum", "repair"])}`,
      rating: Number((3.4 + r(16) / 10).toFixed(1)), reviews: 20 + r(1800), address: `${10 + r(190)} ${pick(r, STREETS)}`,
      status: pick(r, ["Open · Closes 7 PM", "Open 24 hours", "Closed · Opens 9 AM Thu", "Open · Closes 11 PM"]),
      blurb: fill(pick(r, ["The {noun} here is worth the queue; ask for the house special.", "Tiny place, huge selection of {plural}, and staff who know everything.", "Go before noon — the best {plural} sell out by lunch."]), t),
      domain: `${slug(name).replace(/-/g, "")}.${pick(r, ["com", "place", "shop"])}`, path: "/visit",
    };
  }));
}

function timeline(system, user) {
  const query = line("Timeline query:", user);
  const t = topicOf(query);
  const r = rng(`timeline|${query}`);
  const years = [1871, 1904, 1938, 1967, 1994, 2019, 2031, 2044, 2058, 2083].map((y) => y + r(5));
  const events = [
    "First patent for a {noun} is filed in {town}", "{Title} go into mass production", "A wartime shortage makes {plural} a luxury",
    "The sealed {part} changes {plural} for good", "An online forum for {noun} fans reaches {count} members", "{Title} become a protected craft",
    "Solar {plural} outsell the classic kind", "{town} opens the first {noun} museum", "Orbital stations standardise on the {noun}", "The last hand-made {noun} is auctioned",
  ];
  return jsonl(years.map((y, i) => {
    const vars = { ...t, Title: t.Title, town: pick(r, TOWNS), part: pick(r, PARTS), count: 1000 + r(90000) };
    return { date: i % 3 === 1 ? `${MONTHS[r(12)]} ${y}` : String(y), headline: fill(events[i], vars), detail: fill("Records from {town} put the change at {count} units in the first year, and critics called it a fad.", vars), source: `${slug(pick(r, ["archive", "gazette", "institute", "forum", "museum"]))}-${y}.org`, path: `/records/${y}` };
  }));
}

// ---------- pages ----------
// The fact sheet is the page's canon, one fact per line.
function factSheet(system, user) {
  const url = line("URL:", user);
  const t = pageTopic(user, url);
  const c = canonOf(url, t);
  const [a, b] = c.people;
  const lines = [
    `${cap(a.role)}: ${a.name}, running things from ${c.street}, ${c.town} since ${c.year}`,
    ...c.products.slice(0, 3).map((p) => `${p.name}: ${money(p.price)}, ${p.spec}, best for ${p.best}`),
    `${b.name}, ${b.role}, tested ${c.count} ${t.plural} over ${c.years} weeks`,
    `Key number: ${c.pct}% of ${t.noun} problems start with the ${c.part}`,
  ];
  const submitted = line("This page answers a form the visitor just submitted:", user);
  if (submitted) lines.unshift(`Reference: ${submitted.match(/reference (\w+)/)?.[1] ?? "on file"}; handled by ${a.name}`);
  return lines.join("\n");
}

// "https://x.shop/field-notes/fog-signals?q=lamps" -> "fog signals lamps"
function pathTopic(url) {
  try {
    const u = new URL(url);
    const words = u.pathname.split("/").filter(Boolean).pop()?.replace(/[-_+]+/g, " ") ?? "";
    return [decodeURIComponent(words), ...u.searchParams.values()].join(" ").trim() || u.hostname.split(".")[0];
  } catch { return String(url); }
}

const PARAS = [
  "Most {plural} fail for the same boring reason: nobody checks the {part} until it is too late. Ours get a ten-minute inspection every {years} weeks, and in {count} years we have replaced exactly {small} of them.",
  "{person} started {site} in {year} with a borrowed workbench on {street}. The workshop still runs from {town}, and still answers every email by hand.",
  "The short version: buy for the conditions you actually have, not the ones in the catalogue photos. A mid-range {noun} is plenty for {pct}% of people, and the rest know who they are.",
  "Numbers matter here. A good {noun} lasts {years} years, costs about {price} a season to keep, and loses roughly {pct}% of its performance when the {part} is neglected.",
  "Regulars argue about this constantly, and {count} member reports are surprisingly clear: the cheap option wins on day one and loses by month {small}.",
  "If you change one thing, change the {part}. It is a {price} part, it takes {small} minutes, and it fixes most of the complaints we hear about {plural}.",
];

// Everything a section renderer needs, parsed from the section prompt.
function sectionContext(system, user) {
  const [, site = "", kind = "blog", domain = "example.com"] = user.match(/^Site: (.*) \((\w+)\) at (\S+)/m) ?? [];
  const url = line("Page:", user);
  const brief = line("Write section \\d+ of \\d+:", user).replace(/\. Topic: [\s\S]*$/, "");
  const index = Number(user.match(/Write section (\d+) of (\d+)/)?.[1] ?? 1) - 1;
  const t = pageTopic(user, url);
  const c = canonOf(url, t);
  const r = rng(`section|${url}|${index}|${brief}`);
  const vars = {
    ...t, site: esc(site || domain), person: c.people[0].name, street: c.street, town: c.town, year: c.year, part: c.part,
    pct: c.pct, years: c.years, count: c.count, small: 2 + r(8), price: money(8 + r(60)),
  };
  return {
    r, kind, site: site || domain, domain, url, brief, index, t, c, vars,
    hint: line("Interactivity:", user),
    picture: /Include exactly ONE picture/.test(system),
    answering: /answer to a form the visitor just submitted/.test(user),
    home: (path) => `/web/${domain}/${slug(path)}`,
    para: () => `<p>${fill(pick(r, PARAS), vars)}</p>`,
  };
}

const who = (name, ago, initials = name.slice(0, 2).toUpperCase()) => `<div class="who"><span class="av">${esc(initials)}</span><b>${esc(name)}</b><span class="meta">${ago}</span></div>`;

// One renderer per component the section briefs name (see briefs in
// lib/jev.js and SECTION_CLASSES in lib/prompts.js).
const R = {
  lead: (x) => `<p class="lead">${fill("{Title}, done properly: {count} years of notes from {site}, the {plural} we would buy again, and the one mistake ({part} first!) that costs people the most.", x.vars)}</p>`,
  tags: (x) => `<div class="row">${[...x.t.words, "repairs", "buying", "history"].slice(0, 5).map((w) => `<a class="tag" href="${x.home(`tags/${w}`)}">${esc(w)}</a>`).join("")}</div>`,
  callout: (x) => `<div class="callout"><b>${x.countdown ? "Autumn sale ends in" : "Tip:"}</b> ${x.countdown ? `<b data-countdown="2d 4h 10m"></b> — members save 15% on every ${esc(x.t.noun)}.` : fill("check the {part} before the first cold night; it is the cause of {pct}% of the questions we get.", x.vars)}</div>`,
  posts: (x) => {
    const n = /opening post|one \.post|follow-up \.post|member's \.post/i.test(x.brief) ? 1 : /2-3|2 reader/.test(x.brief) ? 2 : 3;
    const meta = x.helpful ? (i) => `Helpful ${4 + i * 7}` : (i) => `▲ ${42 - i * 11} · Reply`;
    return x.c.handles.slice(x.index, x.index + n).map((h, i) => `<div class="post">${who(h, `${2 + i * 3}h ago`)}${x.helpful ? `<span class="stars" style="--r:${5 - (i % 2)}">${5 - (i % 2)}</span> <b>${esc(x.c.products[i].name)}</b>` : ""}<p>${i === 0 && n === 1
      ? fill("My {noun} started sputtering after {small} nights and the {part} looks fine. Bought it in {year}, stored it dry. What am I missing before I give up and buy a new one?", x.vars)
      : fill(pick(x.r, ["Replace the {part}, not the whole {noun}. Mine has run {years} years since.", "Honestly? Buy the {price} spare and keep it in the drawer. Saved me twice.", "Everyone says the {part}, but check the mount first — mine was cracked.", "I disagree with the top answer: the cheap ones fail by month {small}, every time."]), x.vars)}</p>${i === 0 && n > 1 && !x.helpful ? '<span class="tag hot">Accepted answer</span>' : ""}<div class="meta">${meta(i)}</div></div>`).join("");
  },
  cards: (x) => {
    if (x.shop || /product|accessor|goes well/i.test(x.brief)) {
      const items = x.c.products.slice(0, /catalogue|4-5/i.test(x.brief) ? 4 : 3);
      return `<div class="grid"${x.filter ? " data-filter" : ""}>${items.map((p) => `<div class="card" data-tags="${p.tags}"><div class="thumb">${p.emoji}</div><h3>${esc(p.name)}</h3><p class="meta">${esc(p.spec)} · best for ${esc(p.best)}</p><p><span class="price">${money(p.price)}</span> <span class="stars" style="--r:${p.stars}">${p.stars}</span></p><button class="btn" data-add-to-cart data-name="${esc(p.name)}" data-price="${p.price}">Add to cart</button></div>`).join("")}</div>`;
    }
    if (/plan \.card/.test(x.brief)) {
      return `<div class="grid">${[["Starter", 0, ["1 workspace", "Community support"]], ["Team", 24, ["10 workspaces", "Priority support", "Audit log"]], ["Scale", 79, ["Unlimited workspaces", "SSO", "Dedicated manager"]]].map(([name, price, perks], i) => `<div class="card"><h3>${name}${i === 1 ? ' <span class="tag hot">Popular</span>' : ""}</h3><p class="price">${price ? `${money(price)}/mo` : "Free"}</p><ul>${perks.map((f) => `<li>${f}</li>`).join("")}</ul><a class="btn${i === 1 ? "" : " ghost"}" href="${x.home(`signup ${name}`)}">Choose ${name}</a></div>`).join("")}</div>`;
    }
    const icons = shuffled(x.r, EMOJI);
    const titles = shuffled(x.r, [`Why ${x.t.plural} fail`, `The ${x.vars.part} question`, `${x.t.Title} on a budget`, `A ${x.vars.town} workshop visit`, `Care calendar`, `Ask ${x.c.people[1].name}`]);
    return `<div class="grid"${x.filter ? " data-filter" : ""}>${[0, 1, 2].map((i) => `<div class="card"${x.filter ? ` data-tags="${["print audio", "print", "audio video"][i]}"` : ""}><span class="icon">${icons[i]}</span><h3><a href="${x.home(titles[i])}">${esc(titles[i])}</a></h3><p>${fill(pick(x.r, ["What {count} owners told us, in one page.", "A {small}-minute read with a checklist at the end.", "Tested over {years} winters in {town}."]), x.vars)}</p><p class="meta">${2 + i * 5} min read</p></div>`).join("")}</div>`;
  },
  table: (x) => {
    if (x.kind === "forum") {
      return `<table><thead><tr><th>Thread</th><th class="num">Replies</th><th>Last post</th></tr></thead><tbody>${x.c.handles.slice(4, 8).map((h, i) => `<tr><td><a href="${x.home(`t/${x.t.noun} ${x.c.products[i].best}`)}">${esc(cap(x.t.noun))} for ${esc(x.c.products[i].best)}?</a></td><td class="num">${12 + i * 17}</td><td>${esc(h)} · ${i + 1}d</td></tr>`).join("")}</tbody></table>`;
    }
    if (/contact|hours/i.test(x.brief)) {
      return `<table><tbody><tr><th>Phone</th><td>${200 + x.c.count}-555-01${10 + x.c.pct}</td></tr><tr><th>Address</th><td>${esc(x.c.street)}, ${esc(x.c.town)}</td></tr><tr><th>Hours</th><td>Mon–Fri 8:00–18:00, Sat 9:00–13:00</td></tr></tbody></table>`;
    }
    if (x.kind === "gov" || /fees/i.test(x.brief)) {
      return `<table><thead><tr><th>Service</th><th class="num">Fee</th><th>Processing time</th></tr></thead><tbody>${["New application", "Renewal", "Replacement", "Priority handling"].map((s, i) => `<tr><td>${s}</td><td class="num">${money(15 + i * 20)}</td><td>${[6, 3, 2, 1][i]} weeks</td></tr>`).join("")}</tbody></table>`;
    }
    const buy = (p) => (x.shop ? `<td><button class="btn" data-add-to-cart data-name="${esc(p.name)}" data-price="${p.price}">Buy</button></td>` : "");
    return `<table><thead><tr><th>${esc(cap(x.t.noun))}</th><th>Specs</th><th class="num">Price</th><th>Best for</th>${x.shop ? "<th></th>" : ""}</tr></thead><tbody>${x.c.products.map((p, i) => `<tr><td>${esc(p.name)}${i === 1 ? ' <span class="tag hot">Best pick</span>' : ""}</td><td>${esc(p.spec)}</td><td class="num">${money(p.price)}</td><td>${esc(p.best)}</td>${buy(p)}</tr>`).join("")}</tbody></table>`;
  },
  bars: (x) => `<div class="bars"${x.poll ? ` data-poll data-votes="${400 + x.c.count * 31}"` : ""}>${[["Replace the " + x.vars.part, 46], ["Buy a new one", 27], ["Live with it", 18], ["Something else", 9]].map(([label, v]) => `<p><span>${esc(label)}</span><i style="--v:${v}%"></i><b>${v}%</b></p>`).join("")}</div>`,
  stats: (x) => `<div class="grid">${[[`${x.c.count}K`, `${x.t.plural} sold since ${x.c.year}`], [`${x.c.pct}%`, `fail at the ${x.vars.part}`], [`${x.c.years} yrs`, "average lifespan"]].map(([b, s]) => `<div class="stat"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join("")}</div>`,
  timeline: (x) => {
    const items = x.answering
      ? [["Today", "Order packed at our {town} workshop"], ["Tomorrow", "Collected by Parcelwise; tracking PW{count}0{small}7"], ["In 2-3 days", "Out for delivery"], ["Within {years}0 days", "Free returns, no questions asked"]]
      : x.kind === "news"
        ? [["6:10 AM", "First reports from {town}"], ["9:45 AM", "{person} confirms the {part} recall"], ["1:30 PM", "Shops pull {count} {plural} from shelves"], ["4:00 PM", "Council schedules an emergency meeting"], ["7:20 PM", "Makers promise free replacements"]]
        : [["{year}", "The first {noun} is made in {town}"], ["{year2}", "{person} redesigns the {part}"], ["{year3}", "{count} workshops adopt the new design"], ["{year4}", "{Title} become a protected craft"], ["Oct 2026", "Next meetup at {street}"]];
    const years = { year2: x.c.year + 7, year3: x.c.year + 15, year4: x.c.year + 22 };
    return `<ul class="timeline">${items.map(([d, e]) => `<li><b>${fill(d, { ...x.vars, ...years })}</b> ${fill(e, { ...x.vars, ...years })}</li>`).join("")}</ul>`;
  },
  steps: (x) => `<ol class="steps">${[["Check the {part}", "Look for cracks or hardening; replace it if in doubt."], ["Clean it properly", "Warm water, no solvents, and {small} minutes to dry."], ["Refit and test", "Run it for an hour before trusting it outdoors."], ["Log it", "Note the date; the next check is in {years} weeks."]].map(([b, p]) => `<li><b>${fill(b, x.vars)}</b> ${fill(p, x.vars)}</li>`).join("")}</ol>`,
  faq: (x) => [["How long does delivery take?", "2-4 working days from {town}; tracked the whole way."], ["Can I return a used {noun}?", "Yes, within 30 days, as long as the {part} is intact."], ["Do you repair old {plural}?", "We do — send it with a note and we quote within {small} days."]].map(([q, a]) => `<details class="faq"><summary>${fill(q, x.vars)}</summary><p>${fill(a, x.vars)}</p></details>`).join(""),
  quote: (x) => `<blockquote class="quote">${fill(pick(x.r, ["Nobody believed a {noun} could last {years} years. Ours are doing it.", "We didn't set out to fix the {part}. It just kept breaking.", "The best {noun} is the one you actually maintain."]), x.vars)}<div class="meta">— ${esc(x.c.people[1].name)}, ${esc(x.c.people[1].role)}</div></blockquote>`,
  infobox: (x) => `<table class="infobox"><tbody><tr><th colspan="2">${esc(x.t.Title)}</th></tr><tr><th>Type</th><td>${esc(cap(x.t.noun))}</td></tr><tr><th>First made</th><td>${x.c.year}, ${esc(x.c.town)}</td></tr><tr><th>Key part</th><td>${esc(x.vars.part)}</td></tr><tr><th>Lifespan</th><td>${x.c.years} years</td></tr></tbody></table>`,
  split: (x) => `<div class="split"><div>${x.para()}<p>${fill("{person} keeps the workshop on {street} open late on Thursdays for walk-in repairs.", x.vars)}</p></div>${x.pictureTag ?? `<div class="thumb ${pick(x.r, ["stripes", "dots", "rings"])}">${x.c.products[0].emoji}</div>`}</div>`,
  band: (x) => `<div class="band"><h3>${fill("Spotlight: {person}", x.vars)}</h3>${x.para()}</div>`,
  buttons: (x) => `<div class="row">${["Renew online", "Report a problem", "Find an office"].map((l) => `<a class="btn ghost" href="${x.home(l)}">${l}</a>`).join("")}</div>`,
  subsections: (x) => `<h3>How it works</h3>${x.para()}<h3>Common variants</h3>${x.para()}`,
  references: (x) => `<ol>${x.c.people.slice(0, 3).map((p, i) => `<li>${esc(p.name.split(" ")[1])}, ${esc(p.name.split(" ")[0][0])}. (${x.c.year + i * 4}). <a href="/web/${slug(`${x.t.noun} review`)}.org/${x.c.year + i * 4}">${fill(pick(x.r, ["Notes on the {noun}", "The {part} problem", "{Title} in {town}"]), x.vars)}</a>. <i>${esc(x.t.Title)} Quarterly</i>.</li>`).join("")}</ol>`,
  links: (x) => `<ul>${[`Restoring a ${x.t.noun}`, `The ${x.vars.part} debate`, `${x.t.Title} in winter`].map((l, i) => `<li><a href="${x.home(l)}">${esc(l)}</a> <span class="meta">${14 + i * 9} replies</span></li>`).join("")}</ul>`,
  numbered: (x) => `<ol>${x.c.products.slice(0, 3).map((p, i) => `<li><b>${esc(p.name)}</b> by ${esc(x.c.people[i].name)} — ${esc(p.best)}.</li>`).join("")}</ol>`,
  keyfacts: (x) => `<ul><li><b>${x.c.count}</b> ${esc(x.t.plural)} affected in ${esc(x.c.town)}</li><li><b>${x.c.pct}%</b> traced to the ${esc(x.vars.part)}</li><li>Replacements from <b>${esc(x.vars.price)}</b></li></ul>`,

  // Interactive components (WIDGET_VOCABULARY in lib/widgets.js).
  quiz: (x) => `<div data-quiz>${[
    [`How long does a well-kept ${x.t.noun} last?`, ["1 year", `${x.c.years} years`, "A lifetime"], 1, `With yearly care, about ${x.c.years} years.`],
    [`What fails first on most ${x.t.plural}?`, [`The ${x.vars.part}`, "The paint", "The handle"], 0, `${x.c.pct}% of faults start at the ${x.vars.part}.`],
    [`Where was the first ${x.t.noun} made?`, ["Nowhere", x.c.town, "On the moon"], 1, `In ${x.c.town}, in ${x.c.year}.`],
  ].map(([q, answers, right, why]) => `<div data-q><p><b>${esc(q)}</b></p>${answers.map((a, i) => `<button${i === right ? " data-correct" : ""}>${esc(a)}</button>`).join("")}<p data-explain>${esc(why)}</p></div>`).join("")}</div>`,
  calc: (x) => {
    const base = x.c.products[0].price;
    return `<form data-calc><label>How many ${esc(x.t.plural)} <input type="range" name="qty" min="1" max="20" step="1" value="4"></label><label>Grade <select name="grade"><option value="1">Standard</option><option value="1.4">Pro</option><option value="2">Heritage</option></select></label><label><input type="checkbox" name="care" value="15"> Care plan (+$15)</label><p>Total: $<output data-formula="round(qty*${base}*grade+care)">0</output></p><output name="upkeep" hidden data-formula="qty*${base}*grade*0.12"></output><p class="meta">About $<output data-formula="round(upkeep)">0</output> a year to maintain</p><div class="progress" data-formula="min(100, qty*5)"></div></form>`;
  },
  comments: () => `<div data-comments></div>`,
  modal: (x) => `<button class="btn ghost" data-open="size-guide">Size guide</button><dialog id="size-guide"><h3>Size guide</h3><table><tbody>${x.c.products.slice(0, 3).map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.spec)}</td></tr>`).join("")}</tbody></table></dialog>`,
  toggle: (x) => `<p><button class="btn ghost" data-toggle="${x.kind === "zine" ? "Saved ♥" : "Following ✓"}">${x.kind === "zine" ? "Save" : "Follow"}</button> <button class="btn" data-toast="We'll email you when it's back">Notify me</button></p>`,
  form: (x) => {
    const [label, path, fields] = /appointment|application|apply/i.test(x.hint) ? ["Book an appointment", "apply", "slots"]
      : /submission|pitch/i.test(x.hint) ? ["Send your pitch", "submit", "pitch"]
      : /booking/i.test(x.hint) ? ["Book now", "book", "slots"]
      : /signup/i.test(x.hint) ? ["Create account", "signup", "password"]
      : ["Send message", "contact", "message"];
    const extra = {
      slots: `<div class="row" data-pick="slot"><button type="button">9:00</button><button type="button">10:30</button><button type="button" disabled>13:00</button><button type="button">15:30</button></div><label>Date <input type="date" name="date"></label>`,
      pitch: `<label>Your pitch <textarea name="pitch" rows="3"></textarea></label>`,
      password: `<label>Password <input type="password" name="password"></label>`,
      message: `<label>Message <textarea name="message" rows="3"></textarea></label>`,
    }[fields];
    return `<form method="post" action="/web/${x.domain}/${path}"><label>Name <input name="name" autocomplete="name"></label><label>Email <input type="email" name="email" autocomplete="email"></label>${extra}<button class="btn" type="submit">${label}</button></form>`;
  },
  tabs: (x) => `<div data-tabs>${["Overview", "Specs", "Care"].map((tab, i) => `<div data-tab="${tab}">${i === 1 ? R.table(x) : x.para()}</div>`).join("")}</div>`,
};

// Components named in a brief, in the order the brief names them.
const BRIEF_BLOCKS = [
  [/\.infobox/, "infobox"],
  [/\.lead\b/, "lead"],
  [/\.post\b|comments as|bios/, "posts"],
  [/\.card\b/, "cards"],
  [/(?<!infobox )\btable\b/, "table"],
  [/\.bars\b/, "bars"],
  [/\.stat\b/, "stats"],
  [/timeline/, "timeline"],
  [/ol\.steps|\bsteps\b|checklist/, "steps"],
  [/details\.faq|\bFAQ\b|common questions/i, "faq"],
  [/\.quote\b|pull quote|testimonials|quotes/, "quote"],
  [/\.callout/, "callout"],
  [/\.tag\b(?!\.hot)/, "tags"],
  [/\.btn\.ghost links/, "buttons"],
  [/\.band\b/, "band"],
  [/subsections/, "subsections"],
  [/cited|references/, "references"],
  [/ul list of links|further reading/, "links"],
  [/numbered ol/, "numbered"],
  [/ul with the numbers/, "keyfacts"],
  [/\.split\b/, "split"],
];

// Interactive components a section's Interactivity hint (widgetHint in
// lib/widgets.js) asks for, added after the brief's own components.
const HINT_BLOCKS = [
  [/data-quiz/, "quiz"],
  [/data-calc/, "calc"],
  [/data-tabs/, "tabs"],
  [/data-open/, "modal"],
  [/data-toggle/, "toggle"],
  [/form method="post"/, "form"],
  [/data-comments/, "comments"],
];

// Section headings in the voice of each kind of site, by section index.
const HEADINGS = {
  forum: ["{Title}: help, it keeps failing", "Replies", "What worked", "Related threads"],
  store: ["Shop {Title}", "Featured {plural}", "Compare and reviews", "Shipping, returns and care"],
  wiki: ["Overview", "History", "Design and operation", "See also"],
  blog: ["Why I care about {plural}", "The argument", "What to actually do", "Wrapping up"],
  news: ["What happened", "The reporting", "How it unfolded", "What's next"],
  startup: ["Why teams switch", "How it works", "Customers", "Pricing"],
  gov: ["Who can apply", "How to apply", "Fees and processing times", "Contact us"],
  zine: ["Manifesto", "Featured works", "In conversation", "Contributors and events"],
};

function section(system, user) {
  const x = sectionContext(system, user);
  const purpose = x.hint.match(/This page is an? (calculator|quiz|booking form|signup form)/)?.[1];
  Object.assign(x, {
    shop: /Add to cart/.test(x.hint), filter: /data-filter/.test(x.hint), poll: /data-poll/.test(x.hint),
    countdown: /data-countdown/.test(x.hint), helpful: /Helpful N/.test(x.hint),
  });
  if (x.picture) {
    const desc = `${x.c.products[x.index % 4].name} ${x.t.noun} ${pick(x.r, ["on a workbench", "in a shop window", "at dusk on a harbour wall"])}, close-up`;
    x.pictureTag = `<img class="pic" src="/img/${encodeURIComponent(desc)}" alt="${esc(x.c.products[x.index % 4].name)}">`;
  }
  let blocks;
  if (purpose) {
    blocks = [{ calculator: "calc", quiz: "quiz", "booking form": "form", "signup form": "form" }[purpose]];
  } else {
    blocks = BRIEF_BLOCKS.map(([re, name]) => [x.brief.search(re), name]).filter(([at]) => at !== -1).sort((a, b) => a[0] - b[0]).map(([, name]) => name);
    if (!blocks.length) blocks = ["lead"];
    if (x.poll && !blocks.includes("bars")) blocks.push("bars");
    if (x.countdown && !blocks.includes("callout")) blocks.push("callout");
    for (const [re, name] of HINT_BLOCKS) if (re.test(x.hint) && !blocks.includes(name)) blocks.splice(name === "quiz" && blocks.includes("references") ? blocks.indexOf("references") : blocks.length, 0, name);
  }
  // The picture goes in a .split beside text when there is one, else in its own.
  if (x.pictureTag && !blocks.includes("split")) blocks.splice(1, 0, "split");
  const heading = fill(HEADINGS[x.kind]?.[x.index] ?? x.brief.split(/[:.]/)[0], { ...x.vars, Title: esc(x.t.Title) });
  const intro = purpose ? `<p>${fill("Plug in your own numbers — {site} uses the same figures in the workshop.", x.vars)}</p>` : blocks[0] === "lead" ? "" : x.para();
  return `<section><h2>${esc(x.answering ? x.brief.split(":")[0] : heading)}</h2>${intro}${blocks.map((b) => R[b](x)).join("\n")}</section>`;
}

// ---------- pictures ----------
// The medium comes from the prompt's own label, the canvas from its viewBox,
// and the colours from the site palette when the picture has one.
const LABEL_TO_STYLE = Object.fromEntries(Object.entries(MEDIA).map(([k, v]) => [v.label, k]));

function svg(system, user) {
  const [w, h] = (system.match(/viewBox="0 0 (\d+) (\d+)"/)?.slice(1) ?? [400, 300]).map(Number);
  const style = LABEL_TO_STYLE[system.match(/Medium — ([^:]+):/)?.[1]] ?? "flat";
  const desc = line("Picture:", user);
  const r = rng(`svg|${style}|${desc}`);
  const hue = h32(desc) % 360;
  const bg = user.match(/background (#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^)]*\))/i)?.[1] ?? `hsl(${hue},40%,88%)`;
  const acc = user.match(/accent (#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^)]*\))/i)?.[1] ?? `hsl(${(hue + 150) % 360},65%,48%)`;
  const label = esc(topicOf(desc).Title.split(" ").slice(0, 2).join(" "));
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">`;
  const cx = Math.round(w / 2), cy = Math.round(h / 2);
  const draw = {
    // Photographic media: a lit scene with a horizon, a subject and grain.
    scene: () => `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,${style === "scan" ? 70 : 62}%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},60%,86%)"/></linearGradient><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2"/><feColorMatrix type="saturate" values="0"/></filter></defs><rect width="${w}" height="${h}" fill="url(#s)"/><circle cx="${Math.round(w * (0.2 + r(6) / 10))}" cy="${Math.round(h * 0.28)}" r="${Math.round(h / 9)}" fill="#fff6d8" opacity=".85"/><path d="M0 ${Math.round(h * 0.7)} Q${cx} ${Math.round(h * 0.55)} ${w} ${Math.round(h * 0.72)} V${h} H0Z" fill="hsl(${(hue + 90) % 360},30%,35%)"/><rect x="${cx - 30}" y="${Math.round(h * 0.42)}" width="60" height="${Math.round(h * 0.34)}" rx="10" fill="${acc}"/><circle cx="${cx}" cy="${Math.round(h * 0.4)}" r="18" fill="#ffd27a"/><rect width="${w}" height="${h}" filter="url(#g)" opacity="${style === "scan" ? 0.18 : 0.1}"/>${style === "scan" ? `<rect width="${w}" height="${h}" fill="#704214" opacity=".25"/>` : ""}`,
    product: () => `<defs><radialGradient id="p" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${bg}"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#p)"/><ellipse cx="${cx}" cy="${Math.round(h * 0.8)}" rx="${Math.round(w / 4)}" ry="14" fill="#000" opacity=".15"/><rect x="${cx - 50}" y="${Math.round(h * 0.25)}" width="100" height="${Math.round(h * 0.5)}" rx="18" fill="${acc}"/><rect x="${cx - 38}" y="${Math.round(h * 0.3)}" width="22" height="${Math.round(h * 0.38)}" rx="8" fill="#fff" opacity=".35"/>`,
    blueprint: () => `<defs><pattern id="b" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#9cc3ff" stroke-width="1" opacity=".35"/></pattern></defs><rect width="${w}" height="${h}" fill="#1b4f9c"/><rect width="${w}" height="${h}" fill="url(#b)"/><g fill="none" stroke="#e8f1ff" stroke-width="2"><rect x="${cx - 80}" y="${cy - 60}" width="160" height="120"/><circle cx="${cx}" cy="${cy}" r="36"/><path d="M${cx - 80} ${cy + 80} H${cx + 80}"/></g><text x="${cx}" y="${cy + 100}" fill="#e8f1ff" font-family="monospace" font-size="12" text-anchor="middle">${label} — 160 mm</text>`,
    diagram: () => `<rect width="${w}" height="${h}" fill="${bg}"/><g fill="none" stroke="#333" stroke-width="2"><rect x="${cx - 90}" y="${cy - 50}" width="180" height="100" rx="12"/><path d="M${cx - 90} ${cy} H${cx - 150} M${cx + 90} ${cy} H${cx + 150}"/></g><circle cx="${cx}" cy="${cy}" r="30" fill="${acc}"/><text x="${cx - 150}" y="${cy - 8}" font-family="sans-serif" font-size="12">Seal</text><text x="${cx + 110}" y="${cy - 8}" font-family="sans-serif" font-size="12">Core</text><text x="${cx}" y="${cy + 80}" font-family="sans-serif" font-size="13" text-anchor="middle">${label}</text>`,
    chart: () => `<rect width="${w}" height="${h}" fill="#fff"/><path d="M40 ${h - 40} H${w - 20} M40 20 V${h - 40}" stroke="#555" stroke-width="2"/>${[0, 1, 2, 3, 4].map((i) => { const bh = 30 + r(Math.round(h * 0.6)); return `<rect x="${60 + i * Math.round((w - 90) / 5)}" y="${h - 40 - bh}" width="${Math.round((w - 90) / 7)}" height="${bh}" fill="${i === 2 ? acc : "#9aa7b8"}"/>`; }).join("")}<text x="${cx}" y="${h - 14}" font-family="sans-serif" font-size="12" text-anchor="middle">${label} by year</text>`,
    screenshot: () => `<rect width="${w}" height="${h}" fill="#f4f5f7"/><rect width="${w}" height="28" fill="#dfe3e8"/><circle cx="16" cy="14" r="5" fill="#ff5f57"/><circle cx="32" cy="14" r="5" fill="#febc2e"/><circle cx="48" cy="14" r="5" fill="#28c840"/><rect x="20" y="44" width="${Math.round(w * 0.4)}" height="18" rx="4" fill="${acc}"/><text x="26" y="57" font-family="sans-serif" font-size="12" fill="#fff">${label}</text>${[0, 1, 2].map((i) => `<rect x="20" y="${80 + i * 34}" width="${w - 40}" height="24" rx="4" fill="#fff" stroke="#d0d5dc"/>`).join("")}`,
    map: () => `<rect width="${w}" height="${h}" fill="#eef1e6"/><path d="M0 ${Math.round(h * 0.65)} C${Math.round(w * 0.3)} ${Math.round(h * 0.5)} ${Math.round(w * 0.6)} ${Math.round(h * 0.9)} ${w} ${Math.round(h * 0.7)}" fill="none" stroke="#8ec5f0" stroke-width="18"/><g stroke="#fff" stroke-width="8"><path d="M0 ${Math.round(h * 0.3)} H${w} M${Math.round(w * 0.35)} 0 V${h} M${Math.round(w * 0.7)} 0 V${h}"/></g><rect x="${Math.round(w * 0.42)}" y="${Math.round(h * 0.1)}" width="${Math.round(w * 0.2)}" height="${Math.round(h * 0.15)}" fill="#bfe0a8"/>${"ABCDEF".split("").map((l, i) => { const px = 30 + ((i * 97 + r(40)) % (w - 60)), py = 30 + ((i * 61 + r(40)) % (h - 60)); return `<circle cx="${px}" cy="${py}" r="11" fill="#ea4335"/><text x="${px}" y="${py + 4}" font-family="sans-serif" font-size="11" fill="#fff" text-anchor="middle">${l}</text>`; }).join("")}`,
    pixel: () => `<rect width="${w}" height="${h}" fill="#2b2d42"/>${Array.from({ length: 48 }, (_, i) => `<rect x="${(i % 8) * Math.round(w / 8)}" y="${Math.round(h * 0.5) + Math.floor(i / 8) * 20}" width="${Math.round(w / 8)}" height="20" fill="${(i + r(3)) % 3 ? "#3d8b37" : "#6ab04c"}"/>`).join("")}<rect x="${cx - 20}" y="${Math.round(h * 0.3)}" width="40" height="40" fill="${acc}"/><rect x="${cx - 8}" y="${Math.round(h * 0.3) + 10}" width="8" height="8" fill="#fff"/>`,
    meme: () => `<rect width="${w}" height="${h}" fill="#333"/><rect x="20" y="50" width="${w - 40}" height="${h - 100}" fill="${bg}"/><circle cx="${cx}" cy="${cy}" r="${Math.round(h / 6)}" fill="${acc}"/><text x="${cx}" y="36" font-family="sans-serif" font-size="22" fill="#fff" text-anchor="middle" font-weight="bold">ME: ONE MORE ${label.toUpperCase()}</text><text x="${cx}" y="${h - 16}" font-family="sans-serif" font-size="22" fill="#fff" text-anchor="middle" font-weight="bold">MY SHELF:</text>`,
    neon: () => `<defs><filter id="n"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="${w}" height="${h}" fill="#0b0620"/><g fill="none" stroke-width="4" filter="url(#n)"><circle cx="${cx}" cy="${cy}" r="${Math.round(h / 4)}" stroke="#ff3fd4"/><path d="M0 ${h - 40} H${w}" stroke="#3ff2ff"/><rect x="${cx - 110}" y="${cy - 40}" width="80" height="80" stroke="${acc}"/></g>`,
    // Everything else: flat shapes in the medium's colours.
    flat: () => `<rect width="${w}" height="${h}" fill="${style === "woodcut" ? "#f1e9d8" : bg}"/><circle cx="${Math.round(w * 0.72)}" cy="${Math.round(h * 0.3)}" r="${Math.round(h / 6)}" fill="${style === "woodcut" ? "#1d1d1d" : acc}"${style === "line" ? ' fill-opacity="0" stroke="#222" stroke-width="3"' : ""}/><path d="M0 ${Math.round(h * 0.75)} L${Math.round(w * 0.3)} ${Math.round(h * 0.45)} L${Math.round(w * 0.55)} ${Math.round(h * 0.7)} L${Math.round(w * 0.8)} ${Math.round(h * 0.5)} L${w} ${Math.round(h * 0.75)} V${h} H0Z" fill="${style === "woodcut" ? "#1d1d1d" : `hsl(${(hue + 200) % 360},45%,40%)`}"${style === "sticker" ? ' stroke="#fff" stroke-width="8"' : ""}/>${style === "poster" ? `<text x="24" y="${h - 24}" font-family="sans-serif" font-size="28" font-weight="bold" fill="#fff">${label}</text>` : ""}`,
  };
  const family = { photo: "scene", snapshot: "scene", scan: "scene", painting: "scene", watercolor: "scene", product: "product", render3d: "product", blueprint: "blueprint", diagram: "diagram", chart: "chart", screenshot: "screenshot", map: "map", pixel: "pixel", meme: "meme", neon: "neon" }[style] ?? "flat";
  return `${open}${draw[family]()}</svg>`;
}

// ---------- comments ----------
function reply(system, user) {
  const said = user.match(/^Their comment \(([^)]*)\): (.*)$/m) ?? [];
  const r = rng(`reply|${user}`);
  const words = topicOf(said[2] ?? "").words;
  return `${pick(r, HANDLES)}: ${fill(pick(r, ["Good question — on {word} we always check the seal first; saved me twice this year.", "Agree about {word}, but try it for a week before you decide. Mine grew on me.", "Welcome! If {word} is the problem, the pinned thread has the fix that worked for most of us."]), { word: words[0] ?? "that" })}`;
}

// ---------- routing ----------
// Each prompt is recognised by a phrase from its system message.
const ROUTES = [
  [/search index of Foogle/, searchShard],
  [/news index of Foogle/, newsShard],
  [/image index of Foogle/, imageShard],
  [/maps index of Foogle/, mapsResults],
  [/timelines index of Foogle/, timeline],
  [/overview writer/, overview],
  [/fact sheet for ONE web page/, factSheet],
  [/You write ONE section/, section],
  [/image maker who draws in SVG/, svg],
  [/replying to a visitor's comment/, reply],
];

export function fakeReply(system = "", user = "") {
  const route = ROUTES.find(([re]) => re.test(system));
  if (!route) throw new Error(`fake-llm has no canned output for this prompt; add one to lib/fake-fixtures.js (system prompt starts: "${system.slice(0, 80)}")`);
  return route[1](system, user);
}

// ---------- Jev ----------
// The site kinds a URL's words suggest, when the clicked result didn't say.
const KIND_WORDS = [
  [/\b(forums?|threads?|t|boards?|community|talk)\b/, "forum"],
  [/\b(shop|store|products?|cart|buy|supply|outfitters)\b/, "store"],
  [/\b(wiki|encyclopedia|\w+pedia)\b/, "wiki"],
  [/\b(news|story|article|ledger|gazette|times|20\d\d)\b/, "news"],
  [/\b(zines?|issues?|manifesto)\b/, "zine"],
  [/\b(gov|permits?|apply|licen[cs]e|services)\b/, "gov"],
  [/\b(pricing|app|platform|product|signup|calculator)\b/, "startup"],
  [/\b(blog|essays?|notes|journal|diary)\b/, "blog"],
];

// Answers the questions Jev is asked (lib/jev.js), in its response format.
// A page kind comes from the clicked result, else the URL's words, else the
// domain. Style ratings favour the kind's usual styles with a seeded spread;
// a URL that names a style ("/web1996/", "retroos.example") gets that style,
// so a fixture can ask for one.
export function fakeJevAnswers({ state = {}, questions = {} } = {}) {
  const url = String(state.url ?? "");
  const site = url.replace(/^\w+:\/\//, "").split("/")[0];
  const words = url.toLowerCase().replace(/^\w+:\/\//, "").split(/[^a-z0-9]+/);
  const answers = {};
  for (const [key, q] of Object.entries(questions)) {
    if (q.type === "choice") {
      const options = Object.keys(q.criteria ?? {});
      const byWords = KIND_WORDS.find(([re]) => re.test(words.join(" ")))?.[1];
      answers[key] = { choice: options.includes(state.resultKind) ? state.resultKind : options.includes(byWords) ? byWords : options[h32(site) % options.length] };
    }
  }
  const kind = answers.kind?.choice ?? "blog";
  const named = STYLE_KEYS.find((k) => words.includes(k));
  for (const [key, q] of Object.entries(questions)) {
    if (q.type !== "noul") continue;
    const style = key.replace(/^style_/, "");
    const spread = (h32(`${site}|${style}`) % 30) / 100;
    answers[key] = { noul: named ? (style === named ? 0.95 : 0.05) : (KIND_STYLES[kind]?.includes(style) ? 0.5 : 0.1) + spread };
  }
  return answers;
}
