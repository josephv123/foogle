export function searchResultsPrompt(query) {
  return {
    system: `You are the search index of Foogle, a search engine for a web that doesn't exist (yet). For any query, you invent plausible, vivid, specific search results — fictional sites that feel completely real. Mix result types: companies, blogs, wikis, forums, news outlets, stores, government or university pages, weird personal sites. Invent realistic domains (varied TLDs) and realistic URL paths. Snippets read like real Google snippets: fragments, dates, ellipses, specifics.

Output format (strict): exactly 9 lines. Each line is one complete JSON object on a single line:
{"title": "...", "url": "https://domain.tld/path", "snippet": "..."}
No array brackets, no commas between lines, no code fences, no commentary — start with the first result object immediately.

Titles under 70 chars. Snippets 1-2 sentences. Every result must be a distinct site.`,
    user: `Search query: ${query}`,
  };
}

export function newsResultsPrompt(query) {
  return {
    system: `You are the news index of Foogle, a search engine for a web that doesn't exist (yet). For any query, you invent vivid, specific, believable news coverage — fictional outlets and stories that feel completely real. Mix outlet types: wire services, national papers, trade press, local news, scrappy newsletters. Stories should disagree, develop, and react to each other like real coverage does.

Output format (strict): exactly 8 lines. Each line is one complete JSON object on a single line:
{"outlet": "The Meridian Post", "domain": "meridianpost.com", "headline": "...", "snippet": "...", "age": "3 hours ago", "path": "/2045/06/some-story-slug", "image": "short photo description for the story thumbnail"}
No array brackets, no commas between lines, no code fences, no commentary — start with the first object immediately.

Headlines under 90 chars, written like real headlines. "age" ranges from minutes to days ago. "image" is a concrete photographic scene (no text in image). Every item from a distinct outlet.`,
    user: `News query: ${query}`,
  };
}

export function imageResultsPrompt(query) {
  return {
    system: `You are the image index of Foogle, a search engine for a web that doesn't exist (yet). For any query, you invent a varied, visually interesting set of image results — as if scraped from across a fictional web. Vary subject, angle, setting, and style (photos, diagrams, product shots, candids, illustrations).

Output format (strict): exactly 12 lines. Each line is one complete JSON object on a single line:
{"caption": "short caption like a real image-result title", "site": "domain.tld", "path": "/gallery/some-page", "image": "detailed image-generation prompt: subject, setting, composition, lighting, style; no text in image"}
No array brackets, no commas between lines, no code fences, no commentary — start with the first object immediately.

Each result from a distinct site. "image" prompts must be concrete and visual, 15-35 words.`,
    user: `Images query: ${query}`,
  };
}

// ---------- sharded results ----------
// A local model decodes one stream at ~21 tok/s no matter what, but four
// streams at once total ~50 tok/s. So a results page is split into shards that
// generate concurrently. Two things make the split pay off:
//   1. The system prompt is byte-identical for every shard, so llama.cpp's
//      prefix cache serves it from the KV cache instead of re-prefilling.
//      Everything that varies per shard lives in the user message.
//   2. Each shard is handed a different slice of the web, which stops shards
//      from inventing the same three sites and gives a *more* varied page than
//      one model call asking for "a mix".
const SHARD_TAIL = `No array brackets, no commas between lines, no code fences, no commentary — start with the first object immediately.`;

export const SEARCH_ANGLES = [
  "companies, products, official sites, shops and services",
  "blogs, forums, personal sites, communities and hobbyists",
  "reference works, wikis, universities, government and archives",
  "trade press, newsletters, reviews and independent analysis",
];

export const NEWS_ANGLES = [
  "wire services and national papers running the main story",
  "trade press and specialist outlets covering the industry angle",
  "local news, scrappy newsletters and opinion reacting to it",
  "broadcast and business desks following the money",
];

export const IMAGE_ANGLES = [
  "documentary photography: people, places, candid moments",
  "product shots, close-ups, studio and macro detail",
  "diagrams, maps, charts, schematics and illustrations",
  "landscapes, architecture, wide establishing shots",
];

export function searchShardPrompt(query, { count, angle }) {
  return {
    system: `You are the search index of Foogle, a search engine for a web that doesn't exist (yet). For any query, you invent plausible, vivid, specific search results — fictional sites that feel completely real. Invent realistic domains (varied TLDs) and realistic URL paths. Snippets read like real Google snippets: fragments, dates, ellipses, specifics.

Output format (strict): one complete JSON object per line:
{"title": "...", "url": "https://domain.tld/path", "snippet": "..."}
${SHARD_TAIL}

Titles under 60 chars. Snippets ONE sentence, 14-24 words — tight, like a real snippet. Every result must be a distinct site.`,
    user: `Search query: ${query}\nProduce exactly ${count} results.\nThis batch covers only: ${angle}`,
  };
}

export function newsShardPrompt(query, { count, angle }) {
  return {
    system: `You are the news index of Foogle, a search engine for a web that doesn't exist (yet). For any query, you invent vivid, specific, believable news coverage — fictional outlets and stories that feel completely real. Stories should disagree, develop, and react to each other like real coverage does.

Output format (strict): one complete JSON object per line:
{"outlet": "The Meridian Post", "domain": "meridianpost.com", "headline": "...", "snippet": "...", "age": "3 hours ago", "path": "/2045/06/some-story-slug", "image": "short photo description"}
${SHARD_TAIL}

Headlines under 80 chars, written like real headlines. Snippets ONE sentence, 14-24 words. "age" ranges from minutes to days ago. "image" is a concrete photographic scene, under 12 words, no text in image. Every item from a distinct outlet.`,
    user: `News query: ${query}\nProduce exactly ${count} stories.\nThis batch covers only: ${angle}`,
  };
}

export function imageShardPrompt(query, { count, angle }) {
  return {
    system: `You are the image index of Foogle, a search engine for a web that doesn't exist (yet). For any query, you invent a varied, visually interesting set of image results — as if scraped from across a fictional web.

Output format (strict): one complete JSON object per line:
{"caption": "short caption like a real image-result title", "site": "domain.tld", "path": "/gallery/some-page", "image": "image prompt: subject, setting, composition, lighting"}
${SHARD_TAIL}

Each result from a distinct site. Captions under 60 chars. "image" prompts must be concrete and visual, 12-20 words, no text in image.`,
    user: `Images query: ${query}\nProduce exactly ${count} results.\nThis batch covers only: ${angle}`,
  };
}

// ---------- fast page pipeline ----------
// Step 1 of generating a page: a deliberately tiny brief. The server turns it
// into a complete stylesheet, header and footer with zero further model tokens,
// so the visitor gets a styled, branded, navigable page in ~2s instead of
// waiting on a model to hand-write a stylesheet first. Key order matters — the
// server starts rendering the theme as soon as the first five fields have
// streamed in, before `nav` and `secs` arrive.
export function pagePlanPrompt({ url, query, title, snippet, siteContext }) {
  const arrival = [
    query && `Visitor arrived from a search for "${query}".`,
    title && `They clicked a result titled "${title}".`,
    snippet && `Snippet: "${snippet}".`,
    siteContext && `Earlier on this domain — search: "${siteContext.query ?? "?"}", entry page: "${siteContext.title ?? "?"}". Stay consistent with that.`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    system: `You design a website that doesn't exist. Given a URL, output ONE line of compact JSON describing the site — nothing else. No code fences, no commentary.

{"kind":"...","mood":"...","hue":0,"site":"...","tag":"...","nav":["...","...","...","..."],"secs":["...","...","..."]}

Field rules:
- kind: one of forum, store, wiki, blog, news, startup, gov, zine
- mood: one of dark, light, paper, neon, brutal
- hue: integer 0-359, the site's signature colour
- site: the site's name, 1-3 words
- tag: its tagline, under 8 words
- nav: exactly 4 short nav labels, 1-2 words each
- secs: exactly 3 briefs for the page's main content blocks, each under 10 words, specific to THIS url

Commit to specifics. Pick a kind and mood that genuinely fit the URL — vary them; not everything is a startup.`,
    user: `URL: ${url}\n${arrival}`.trim(),
  };
}

// The class vocabulary the server's generated stylesheet provides. Sections are
// written by separate concurrent workers that never see each other's output, so
// they cannot invent classes and expect them to be styled — but every one of
// these is guaranteed to exist and to match the site's palette.
export const SECTION_CLASSES = `.card (bordered block), .grid (auto-fitting columns; put .card children in it), .lead (larger intro paragraph), .meta (small muted text), .tag (small pill), .btn (button-style link), .row (horizontal flex, wraps), .stat (big number block, put a <b> and a <span> in it), .quote (pull quote), .thumb (decorative gradient panel, needs no image)`;

export function pageSectionPrompt({ plan, domain, url, brief, index, total }) {
  return {
    system: `You write ONE section of the body of a web page that doesn't exist. The page's stylesheet, header and footer already exist and are out of your hands.

Output rules:
- Output ONLY an HTML fragment. No <html>, <head>, <body>, <style>, <script>, no markdown, no commentary.
- Start with a <section> tag and close it. Inside: a heading and real content.
- You may use these pre-styled classes, and only these: ${SECTION_CLASSES}
- Plain tags (h2, h3, p, ul, ol, li, table, blockquote, b, i, code, a) are already styled too. Never write a style="" attribute except on a .thumb.
- Fill it with specific, committed content — names, numbers, dates, prices, opinions, usernames. Never write placeholder text and never mention being generated.
- Every link href must look like /web/<domain>/<path> — this site's own domain for internal links, invented domains for outbound ones. Never use http://, never href="#".
- 70-130 words of content. Tight and real, not padded.`,
    user: `Site: ${plan.site} (${plan.kind}) at ${domain} — "${plan.tag}"
Page: ${url}
Write section ${index + 1} of ${total}: ${brief}`,
  };
}

export function pagePrompt({ url, query, title, snippet, siteContext }) {
  const arrival = [
    query && `They arrived from a Foogle search for "${query}".`,
    title && `They clicked a result titled "${title}".`,
    snippet && `The result snippet read: "${snippet}".`,
    siteContext &&
      `They are navigating deeper into this site. Earlier context for this domain — search query: "${siteContext.query ?? "unknown"}", entry page title: "${siteContext.title ?? "unknown"}". Stay visually and tonally consistent with what this site would be.`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    system: `You are the web server for a website that doesn't exist. A visitor just requested a URL, and you must generate that page on the spot — convincingly, as if the site has always existed.

Output rules:
- Output ONLY raw HTML. Start with <!DOCTYPE html>. No markdown, no code fences, no commentary.
- The page must be fully self-contained: inline <style> and inline <script> only. No external assets.
- Give the site a distinctive identity: its own palette, typography, layout, voice. A forum looks like a forum, a store like a store, a 2040s startup like a 2040s startup. Avoid generic AI-slop design (no purple gradients on white, no Inter-everywhere).
- Fill it with specific, committed content — names, numbers, dates, opinions. Never write placeholder text or acknowledge being generated.
- Include realistic site navigation and several in-content links so the visitor can keep browsing.

Images:
- You may embed AI-generated photos/illustrations: <img src="/img/<image description>"> where <image description> is a URL-encoded image-generation prompt (subject, setting, composition, lighting, style; use %20 for spaces; no slashes, no quotes, no text in the image).
- Use 0-3 images, only where a real site would have one (hero, product shot, article photo, avatar). Many great pages need none.
- Images generate while the page streams and arrive a little after the text. Make that look intentional: every img gets explicit dimensions or aspect-ratio, a background (color or subtle gradient that fits the palette), and a fade-in — use exactly this pattern: style="opacity:0;transition:opacity .8s" onload="this.style.opacity=1". Add loading="lazy" to below-the-fold imgs.
- For decorative visuals, prefer CSS (gradients, shapes, emoji, inline SVG) — it renders instantly.

Animation (use it — motion makes these sites feel alive):
- Animate where a real site of this kind would: hover states and transitions everywhere, an animated hero (CSS keyframes, animated gradient, drifting shapes, or SMIL-animated inline SVG), entrance reveals done in PURE CSS (keyframes + animation-delay staggering that always settle to the element's final visible state), live-feeling details (a ticking counter, blinking cursor, pulsing "live" dot, marquee).
- NEVER leave an element hidden (opacity:0, visibility:hidden, transform off-screen) waiting for a script or IntersectionObserver to reveal it — during streaming, scripts run long after the content is on screen, so the page would sit broken and then snap. Every element must reach its final visible state through CSS alone.
- For richer motion, a <canvas> with a small requestAnimationFrame loop (particles, starfield, waveform, data viz) is welcome — keep the loop cheap and under ~40 lines.
- Respect the streaming order: ALL CSS animation (keyframes, transitions) lives in the <head> <style> with the rest of the stylesheet; <script>-driven animation goes at the END of <body>. Scripts must be defensive (guard against missing elements) since the visitor sees the page before it finishes streaming.
- Motion should have a purpose and fit the site's character — a brutalist forum might only have a blinking cursor; a 2040s product site might have a full animated hero.

Speed rules (the page streams to the visitor as you write it — they are watching it render):
- Keep it tight: a complete, polished page in roughly 150-250 lines of HTML total. No filler sections. Quality over quantity.
- The <head> <style> is the page's COMPLETE stylesheet — every selector the page uses, so each element renders fully styled the instant it streams in. NEVER defer layout or structural CSS to later in the page: a late stylesheet makes the streaming page look broken, then "snap" into shape at the end.
- Keep that stylesheet compact (terse selectors, one rule per line, no comments, no unused rules — aim for ~40-70 lines) so you still reach <body> quickly.
- Write the body strictly top-to-bottom in visual order (header first, footer last); don't reorder sections with CSS.
- Only <script> goes at the END of <body>. The page must look complete and correct if no script ever runs: scripts may add ongoing life (tick a counter, drive a canvas, update a clock) but must never hide, reveal, move, resize, or restyle content that is already on screen when they execute.

Link rules (critical):
- Every link href must be an absolute path of the form /web/<domain>/<path> — same-site links use this page's domain, links to other (invented) sites use their domain, e.g. href="/web/example-co.io/products/widget".
- Never link to a real external URL, never use http(s):// in hrefs, never use href="#" — every link should lead somewhere browsable.`,
    user: `Generate the page at: ${url}\n${arrival}`.trim(),
  };
}
