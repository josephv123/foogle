// Design archetypes. A site's *kind* (forum, store, wiki…) decides what is on
// the page: its nav, byline, side rail and section briefs. Its *style* decides
// what the page looks like: palette, type, density, the skin of every
// component and how sections are laid out. The two are independent, so a forum
// can be a 2004 phpBB board, a green-screen terminal or a glossy SaaS community,
// and two stores can look like they had different designers, eras and budgets.
//
// Jev rates how plausible each style is for the site (one yes/no question per
// style, answered in a single ~0.25s request), and pickStyle() draws one of the
// plausible ones per domain, so the same kind of site doesn't always get the
// same answer. Every choice inside a style (font pairing, header, hero, card
// skin, palette variant) is seeded by the domain: every page of one site looks
// the same, and two sites of one style still differ.

const hsl = (h, s, l, a) => (a === undefined ? `hsl(${((h % 360) + 360) % 360},${s}%,${l}%)` : `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`);

// Extra system font stacks the styles use (theme.js has the common ones).
// No web fonts: they would cost a request before the first styled paint.
export const STYLE_FONTS = {
  helvetica: `"Helvetica Neue",Helvetica,Arial,sans-serif`,
  arial: `Arial,"Helvetica Neue",Helvetica,sans-serif`,
  arialblack: `"Arial Black","Helvetica Neue",Impact,sans-serif`,
  impact: `Impact,Haettenschweiler,"Arial Narrow Bold","Arial Black",sans-serif`,
  times: `"Times New Roman",Times,serif`,
  verdana: `Verdana,Geneva,Tahoma,sans-serif`,
  tahoma: `Tahoma,Verdana,Geneva,sans-serif`,
  trebuchet: `"Trebuchet MS","Lucida Grande",Verdana,sans-serif`,
  lucida: `"Lucida Grande","Lucida Sans Unicode","Lucida Sans",Tahoma,Verdana,sans-serif`,
  comic: `"Comic Sans MS","Comic Neue","Chalkboard SE",cursive`,
  marker: `"Marker Felt","Chalkboard SE","Comic Neue","Comic Sans MS",cursive`,
  hand: `Noteworthy,"Bradley Hand","Chalkboard SE","Comic Sans MS",cursive`,
  futura: `Futura,"Century Gothic","Avenir Next","Trebuchet MS",sans-serif`,
  avenir: `"Avenir Next",Avenir,"Segoe UI",-apple-system,sans-serif`,
  segoe: `"Segoe UI","Open Sans","Helvetica Neue",Arial,sans-serif`,
  gill: `"Gill Sans","Gill Sans MT",Calibri,"Trebuchet MS",sans-serif`,
  optima: `Optima,Candara,"Segoe UI",sans-serif`,
  baskerville: `Baskerville,"Baskerville Old Face","Libre Baskerville",Georgia,serif`,
  caslon: `"Big Caslon","Hoefler Text","Book Antiqua",Baskerville,Georgia,serif`,
  copperplate: `Copperplate,"Copperplate Gothic Light","Big Caslon",serif`,
  palatino: `Palatino,"Palatino Linotype","Book Antiqua",Georgia,serif`,
  chunky: `"Cooper Black","Arial Rounded MT Bold","SF Pro Rounded",ui-rounded,sans-serif`,
  arialround: `"Arial Rounded MT Bold","SF Pro Rounded",ui-rounded,"Varela Round",sans-serif`,
  chicago: `ChicagoFLF,Chicago,Charcoal,Geneva,Tahoma,sans-serif`,
  mssans: `"MS Sans Serif","Microsoft Sans Serif",Tahoma,Geneva,sans-serif`,
  menlo: `Menlo,Monaco,"Lucida Console",monospace`,
  courier: `"Courier New",Courier,monospace`,
  georgia: `Georgia,"Times New Roman",serif`,
  superclarendon: `Superclarendon,Rockwell,"Clarendon","Roboto Slab",Georgia,serif`,
};

// Section layouts: how the four streamed <section>s sit on the page. Pure CSS
// over the same markup, so they cost the writers nothing.
export const SECTION_LAYOUTS = {
  stack: () => "",
  // Heading in a left column, content on the right (Swiss, annual reports).
  ledger: () => `@media(min-width:760px){main section{display:grid;grid-template-columns:minmax(120px,24%) minmax(0,1fr);column-gap:40px;align-items:start}
main section>*{grid-column:2}main section>h2{grid-column:1;grid-row:1/span 40;position:sticky;top:24px;font-size:1.1rem;line-height:1.2}main section::after{display:none}}`,
  // A running number above each heading.
  numbered: () => `main{counter-reset:sec}main section>h2::before{counter-increment:sec;content:counter(sec,decimal-leading-zero);display:block;font:600 .78rem/1 var(--mono);letter-spacing:.1em;color:var(--acc);margin-bottom:.7em}`,
  // Each section is a boxed panel whose heading is its title bar.
  window: () => `main section{border:var(--bw) solid var(--line);background:var(--panel);padding:0 16px 14px;border-radius:var(--rad);margin-bottom:22px;overflow:hidden}
main section>h2{margin:0 -16px 14px;padding:7px 16px;font-size:.95rem;letter-spacing:.02em;background:var(--acc);color:var(--on)}`,
  // Sections divided by a heavy rule, headings as small labels.
  rule: () => `main section{border-top:3px solid var(--fg);padding-top:12px}main section>h2{font-size:.9rem;text-transform:uppercase;letter-spacing:.14em}`,
  // Alternating full-bleed bands.
  bands: () => `main section:nth-of-type(even){background:var(--panel);box-shadow:0 0 0 100vmax var(--panel);clip-path:inset(-34px -100vmax);padding:6px 0}main section>h2{text-align:center;margin-bottom:.9em}`,
  // Bento: the sections themselves are tiles of an asymmetric grid.
  tiles: () => `@media(min-width:900px){main{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:16px;align-items:start}
main section:nth-of-type(4n+1){grid-column:span 7}main section:nth-of-type(4n+2){grid-column:span 5}main section:nth-of-type(4n+3){grid-column:span 5}main section:nth-of-type(4n){grid-column:span 7}}
main section{background:var(--panel);border-radius:calc(var(--rad) + 8px);padding:24px 26px;margin:0 0 16px;border:var(--bw) solid var(--line)}main section>h2{font-size:.82rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}`,
  // Centered headings (formal, luxury, letterpress).
  centered: () => `main section>h2{text-align:center}main section{margin-bottom:64px}`,
};

// Each style: `about` is what Jev reads; `voice` steers the section writers
// toward compositions that suit the look; the rest is seeded per site.
export const STYLES = {
  swiss: {
    about: "International Typographic Style: Helvetica, strict grid, huge flush-left type, black rules on white",
    voice: "Swiss modernist: rigorous and sparse. Prefer tables, numbered lists, .stat figures and short declarative paragraphs. No emoji, no .icon, no .thumb.",
    mood: "light", art: "full", mark: false,
    fonts: [["helvetica", "helvetica"], ["helvetica", "avenir"], ["arial", "helvetica"]],
    header: ["bar", "minimal", "stacked"], hero: ["poster", "split"], sections: ["ledger", "numbered"],
    tokens: () => ({ fs: 16, lh: 1.45, rad: 0, bw: 1, shadow: "none", h1: "clamp(2.8rem,8vw,6rem)", hw: 700, htrack: "-.035em", pad: "14px 0 6px", gap: "28px", pill: "0" }),
    palette: (h, pick) => {
      const acc = pick("acc", [hsl(4, 88, 48), hsl(h, 90, 42), hsl(214, 90, 42)]);
      const bg = pick("bg", ["#ffffff", "#f1efe9", "#f4f4f4"]);
      return { bg, panel: bg, fg: "#111", muted: "#555", line: "#111", acc, acc2: "#111", heroA: bg, heroB: bg, on: "#fff" };
    },
    css: ({ pick }) => `header.site{background:var(--bg);border-bottom:2px solid var(--fg)}.brand{font-weight:700;letter-spacing:-.02em;text-transform:none}.brand span{color:var(--fg)}nav.top a{color:var(--fg)}
.hero{background:none;animation:none;border-bottom:2px solid var(--fg);padding:44px 0 34px}.hero h1{line-height:.95;max-width:14ch}.hero .art{border:0;box-shadow:none;background:none;filter:grayscale(1) contrast(1.15)}
section>h2{font-size:1.1rem;letter-spacing:-.01em}.card{background:none;border:0;border-top:2px solid var(--fg);border-radius:0}.card:hover{transform:none}
.btn{background:var(--fg);color:var(--bg);border-radius:0}.btn:hover{background:var(--acc);color:#fff}.btn.ghost{background:none;color:var(--fg);border:2px solid var(--fg)}
.tag{border-radius:0;border-color:var(--fg);color:var(--fg);background:none}.tag.hot{background:var(--acc);border-color:var(--acc)}
.stat{background:none;border:0;border-top:2px solid var(--fg);border-radius:0;padding:10px 0}.stat b{font-size:2.8rem;color:var(--fg);letter-spacing:-.04em}
th{color:var(--fg);border-bottom:2px solid var(--fg)}tbody tr:nth-child(even) td{background:none}
.thumb{background:var(--acc);animation:none;border:0}.quote{border-left:0;font-style:normal;font-size:1.5rem;color:var(--fg);font-weight:700;letter-spacing:-.02em}
img.pic{filter:grayscale(1) contrast(1.1);border:0}.av{background:var(--fg);border-radius:0}
${pick("accent-bar", [true, false]) ? `body{border-top:10px solid var(--acc)}` : ""}`,
  },

  brutalist: {
    about: "raw web brutalism: default-looking fonts, thick black borders, hard offset shadows, clashing flat colours",
    voice: "Raw brutalist: blunt, loud, few words. Tables, .stat numbers and big .btn links; short punchy paragraphs.",
    mood: "brutal", art: "full", mark: true,
    fonts: [["arial", "arialblack"], ["mono", "impact"], ["times", "arialblack"], ["helvetica", "mono"], ["courier", "arialblack"]],
    header: ["bar", "stacked", "masthead"], hero: ["banner", "poster", "split"], sections: ["stack", "window"],
    tokens: (pick) => ({ fs: pick("fs", [16, 17, 15]), lh: 1.45, rad: 0, bw: 3, shadow: "6px 6px 0 #000", hcase: pick("case", ["uppercase", "none"]), h1: "clamp(2.4rem,7vw,5rem)", hw: 900, htrack: "-.02em", pad: "16px 18px", gap: "18px", pill: "0" }),
    palette: (h, pick) => {
      const bg = pick("bg", [hsl(h, 90, 78), "#ffffff", "#ffe600", "#e6e6e6", hsl(h + 180, 70, 85)]);
      return { bg, panel: "#fff", fg: "#000", muted: "#222", line: "#000", acc: pick("acc", [hsl(h, 95, 45), "#0000ff", "#ff2e00"]), acc2: "#000", heroA: hsl(h, 90, 62), heroB: hsl(h + 40, 90, 70), on: "#fff" };
    },
    css: ({ pick }) => `header.site{background:var(--bg);border-bottom:3px solid #000}.brand{font-weight:900}.brand span{background:#000;color:var(--bg);padding:0 .15em}nav.top a{color:#000;text-decoration:underline;text-underline-offset:3px}
a{text-decoration:underline;text-decoration-thickness:2px}.hero{background:var(--bg);animation:none;border-bottom:3px solid #000}
section>h2{display:inline-block;background:#000;color:var(--bg);padding:.1em .35em}
.card{box-shadow:6px 6px 0 #000}.card:hover{transform:translate(-3px,-3px);box-shadow:9px 9px 0 #000}
.btn{border:3px solid #000;box-shadow:4px 4px 0 #000;text-transform:uppercase}.btn:hover{transform:translate(2px,2px);box-shadow:2px 2px 0 #000;background:var(--acc)}
table{border:3px solid #000}th,td{border:2px solid #000}th{background:#000;color:var(--bg)}
.thumb{animation:none;background:${pick("thumb", ["var(--acc)", "repeating-linear-gradient(45deg,#000 0 8px,var(--bg) 8px 16px)", "#fff"])}}
.hero .art{box-shadow:10px 10px 0 #000;${pick("tilt", [true, false]) ? "transform:rotate(2deg)" : ""}}.quote{border-left:8px solid #000;color:#000;font-style:normal;font-weight:700}
.av{border-radius:0;background:#000;color:#fff}`,
  },

  web1996: {
    about: "a 1990s personal homepage: Times New Roman, solid coloured or tiled background, blue underlined links, bevelled tables, centered text",
    voice: "A 1996 personal homepage: earnest and a little amateur. Plain paragraphs, bulleted lists of links, simple tables, a 'What's New' list with dates; few cards; .tag.hot may say NEW!",
    mood: "light", art: "small", mark: false,
    fonts: [["times", "times"], ["times", "arial"], ["verdana", "times"], ["comic", "comic"], ["arial", "impact"]],
    header: ["masthead", "minimal"], hero: ["center", "plain"], sections: ["centered", "stack"],
    tokens: () => ({ fs: 16, lh: 1.35, rad: 0, bw: 2, shadow: "none", h1: "clamp(2rem,5vw,2.8rem)", hw: 700, maxw: 800, pad: "10px 12px", gap: "10px", pill: "0" }),
    palette: (h, pick) => {
      const v = pick("scheme", ["white", "black", "teal", "tile", "navy"]);
      if (v === "black") return { bg: "#000", panel: "#111", fg: "#fff", muted: "#ccc", line: "#888", acc: "#ffff00", acc2: "#00ff00", link: "#00ffff", heroA: "#000", heroB: "#222", on: "#000" };
      if (v === "navy") return { bg: "#000033", panel: "#000066", fg: "#fff", muted: "#ccccff", line: "#9999cc", acc: "#ffcc00", acc2: "#ff66cc", link: "#ffcc00", heroA: "#000033", heroB: "#000066", on: "#000" };
      if (v === "teal") return { bg: "#008080", panel: "#ffffff", fg: "#000", muted: "#333", line: "#808080", acc: "#800000", acc2: "#000080", link: "#0000ee", heroA: "#c0c0c0", heroB: "#c0c0c0", on: "#fff", page: "#ffffff" };
      return { bg: v === "tile" ? hsl(h, 60, 88) : "#ffffff", panel: "#ffffcc", fg: "#000", muted: "#333", line: "#808080", acc: hsl(h, 100, 30), acc2: "#ff0000", link: "#0000ee", heroA: "#fff", heroB: "#fff", on: "#fff", tile: v === "tile" };
    },
    css: ({ c, h, pick, plan }) => `body{${c.tile ? `background-image:radial-gradient(${hsl(h, 60, 78)} 20%,transparent 22%),radial-gradient(${hsl(h, 60, 78)} 20%,transparent 22%);background-size:24px 24px;background-position:0 0,12px 12px;` : ""}}
${c.page ? `main.wrap,.layout,.hero .wrap,footer.site .wrap{background:${c.page}}.hero{border:0}header.site .wrap{background:${c.page}}` : ""}
a{color:${c.link};text-decoration:underline}a:visited{color:${c.fg === "#fff" ? "#ff99ff" : "#551a8b"}}header.site{background:none;border:0;position:static}
.brand{font-size:2.4rem;text-transform:none;letter-spacing:0;color:var(--acc)}.brand span{color:var(--acc2)}
nav.top{font-family:inherit}nav.top a{color:${c.link}}nav.top a::before{content:"[ "}nav.top a::after{content:" ]"}header.site nav.top{border:0!important}
.hero{background:none;animation:none;border-bottom:0;text-align:center}.hero h1{color:var(--acc)}.hero .art{border:2px outset #ccc;box-shadow:none}
main.wrap>section,main>section{border-top:0}section>h2{text-align:center;border-bottom:2px groove #ccc;padding-bottom:.2em;color:var(--acc)}
.card,.band,.stat,.post,details.faq,.infobox{border:2px outset #ddd;border-radius:0;box-shadow:none}.card:hover{transform:none}
table{border:2px outset #ccc;border-collapse:separate;border-spacing:2px}th,td{border:1px inset #ccc}th{text-transform:none;letter-spacing:0;font-size:.95rem;color:var(--fg);background:${c.fg === "#fff" ? "#333" : "#c0c0c0"}}tbody tr:nth-child(even) td{background:none}
.btn{background:#c0c0c0;color:#000;border:2px outset #fff;border-radius:0;box-shadow:none;font-family:${STYLE_FONTS.arial};font-weight:400;text-decoration:none}.btn:hover{background:#d4d4d4;border-style:inset}.btn.ghost{background:#c0c0c0;color:#000;border-color:#fff}
.tag{border-radius:0}.tag.hot{background:none;border:0;color:#ff0000;font-weight:700;animation:blink 1s steps(1) infinite}@keyframes blink{50%{visibility:hidden}}
.thumb{animation:none;background:${c.panel};border:2px inset #ccc}.av{border-radius:0}hr{border-top:2px groove #ccc}
footer.site{background:none;border-top:2px groove #ccc;text-align:center}footer.site .wrap{justify-content:center;flex-direction:column;align-items:center}
footer.site .wrap::after{content:"Best viewed in Netscape Navigator 4 at 800×600 · You are visitor no. ${String(1000 + (plan.hue * 37) % 9000).padStart(6, "0")}";font-size:.8rem}
${pick("construction", [true, false]) ? `main::before{content:"🚧 This site is under construction! 🚧";display:block;text-align:center;font-weight:700;color:var(--acc2);margin:0 0 20px}` : ""}`,
  },

  classifieds: {
    about: "a dense utilitarian text site like Craigslist or Hacker News: tiny type, plain lists of links, almost no decoration",
    voice: "Dense and text-first, like Craigslist or Hacker News: plain ul lists of links with small .meta details, compact tables, terse lines. No .card grids, no .thumb, no .icon, no .bars, no emoji, no pictures.",
    mood: "light", art: "none", mark: false,
    fonts: [["verdana", "verdana"], ["arial", "arial"], ["times", "arial"], ["helvetica", "helvetica"]],
    header: ["bar", "minimal"], hero: ["plain"], sections: ["stack"],
    tokens: (pick) => ({ fs: pick("fs", [13, 13.5, 14]), lh: 1.4, rad: 0, bw: 1, shadow: "none", h1: "1.35rem", h2: "1.02rem", hw: 700, maxw: pick("maxw", [980, 1180]), pad: "4px 0", gap: "4px 22px", secgap: "22px", pill: "0" }),
    palette: (h, pick) => {
      const hn = pick("hn", [true, false]);
      return { bg: hn ? "#f6f6ef" : "#ffffff", panel: hn ? "#f6f6ef" : "#ffffff", fg: "#000", muted: "#828282", line: "#dddddd", acc: hn ? hsl(h, 85, 45) : "#0000ee", acc2: "#551a8b", heroA: "#fff", heroB: "#fff", on: "#fff", bar: hn ? hsl(h, 85, 50) : "#ffffff" };
    },
    css: ({ c }) => `header.site{position:static;background:${c.bar};border-bottom:1px solid #ccc}header.site .wrap{padding-top:4px;padding-bottom:4px;gap:10px}
.brand{font-size:1rem;color:#000}.brand span{color:#000}nav.top{font-family:inherit;font-size:1em;gap:0}nav.top a{color:#000}nav.top a+a::before{content:" | ";color:#000;padding:0 4px}
a{color:${c.acc === "#0000ee" ? "#0000ee" : "#000"}}a:visited{color:#551a8b}section a{text-decoration:underline}
.hero{background:none;animation:none;border-bottom:1px solid #ccc;padding:12px 0 10px}.hero .tagline{font-size:1em}.hero .art{display:none}
section>h2{background:#eee;padding:2px 6px;border-bottom:1px solid #ccc;font-size:1.02rem}
.grid{display:block}.grid>.card{border:0;border-bottom:1px dotted #ccc;padding:5px 0;background:none;box-shadow:none;border-radius:0}.card:hover{transform:none}.card h3{font-size:1em;display:inline;margin-right:8px}
.band,.callout,.infobox,.post,.stat,details.faq{background:none;border:0;border-bottom:1px dotted #ccc;border-radius:0;box-shadow:none;padding:6px 0}.callout{border-left:3px solid #999;padding-left:8px}
.stat{display:inline-block;margin-right:18px}.stat b{font-size:1.1rem;color:#000;display:inline}.thumb,.icon{display:none}img.pic{max-width:240px;border:1px solid #ccc}
.btn,.btn.ghost{background:none;border:0;color:#0000ee;padding:0;box-shadow:none;font-weight:400;text-decoration:underline;font-family:inherit;font-size:1em}.btn::before{content:"» "}.btn:hover{background:none}
.tag{background:none;border:0;padding:0 4px 0 0;font-family:inherit;font-size:.85em;letter-spacing:0;text-transform:none;color:${c.muted}}.tag.hot{color:#c00;background:none}
th{background:#eee;color:#000;text-transform:none;letter-spacing:0;font-size:.95em}th,td{padding:3px 6px}tbody tr:nth-child(even) td{background:#fafafa}
.av{display:none}.post .who{margin-bottom:2px;font-size:.9em}.lead{font-size:1.05em;color:#000}.quote{font-style:normal;font-size:1em}
footer.site{background:none;border-top:1px solid #ccc;font-size:.85em;padding:10px 0 24px;margin-top:20px}`,
  },

  editorial: {
    about: "an upscale print magazine: huge serif headlines, drop caps, thin rules, generous whitespace",
    voice: "An upscale print magazine: long-form, confident prose with a strong .lead, pull quotes and one .split with a picture; prefer paragraphs and .quote over .card grids. No emoji, no .icon.",
    mood: "paper", art: "full", mark: false,
    fonts: [["book", "didone"], ["serif", "didone"], ["baskerville", "caslon"], ["palatino", "didone"], ["book", "helvetica"]],
    header: ["masthead", "center", "minimal"], hero: ["poster", "center"], sections: ["stack", "centered"],
    tokens: (pick) => ({ fs: 18, lh: 1.72, rad: 0, bw: 1, shadow: "none", h1: "clamp(2.8rem,7vw,5.4rem)", h2: "clamp(1.6rem,3vw,2.2rem)", hw: pick("hw", [400, 700]), htrack: "-.01em", maxw: 1000, pad: "0", gap: "34px", secgap: "56px" }),
    palette: (h, pick) => {
      const dark = pick("dark", [false, false, true]);
      return dark
        ? { bg: "#141312", panel: "#1c1b19", fg: "#ece6da", muted: "#a39d91", line: "#3b3833", acc: hsl(h, 55, 65), acc2: "#ece6da", heroA: "#141312", heroB: "#141312", on: "#141312" }
        : { bg: pick("bg", ["#faf8f3", "#ffffff", "#f3efe6"]), panel: "#ffffff", fg: "#161616", muted: "#6b665d", line: "#d9d4c7", acc: pick("acc", [hsl(h, 60, 34), hsl(356, 65, 38)]), acc2: "#161616", heroA: "#fff", heroB: "#fff", on: "#fff" };
    },
    css: ({ pick }) => `header.site{background:var(--bg);position:static}.brand{font-style:${pick("italic", ["italic", "normal"])};font-weight:400;text-transform:none}.brand span{color:var(--fg)}
.hero{background:none;animation:none;border-bottom:1px solid var(--line);padding:50px 0 36px}.hero h1{font-style:${pick("h1i", ["italic", "normal"])};line-height:1.02}.hero .tagline{font-size:1.3rem;font-style:italic}
.hero .art{border:0;box-shadow:none;background:none}main section>p{max-width:66ch}
main section:first-of-type>p:first-of-type::first-letter,.lead::first-letter{float:left;font-family:var(--head);font-size:4.4em;line-height:.8;padding:.06em .1em 0 0;color:var(--acc)}
.lead{color:var(--fg);font-size:1.25rem}section>h2{font-weight:400;font-style:italic}
.card{background:none;border:0;border-top:1px solid var(--fg);padding:14px 0 0;border-radius:0}.card:hover{transform:none}.card h3{font-family:var(--head);font-weight:400;font-size:1.35rem}
.quote{border:0;border-top:1px solid var(--fg);border-bottom:1px solid var(--fg);padding:22px 0;text-align:center;font-family:var(--head);font-size:clamp(1.5rem,3vw,2.1rem);color:var(--fg);line-height:1.25;margin:1.4em 0}
.btn{background:none;color:var(--fg);border:1px solid var(--fg);border-radius:0;font-family:var(--body);font-weight:400;text-transform:uppercase;letter-spacing:.14em;font-size:.75rem;padding:.9em 1.6em}.btn:hover{background:var(--fg);color:var(--bg)}
.tag{border:0;background:none;padding:0;color:var(--acc);font-family:var(--body);letter-spacing:.14em}.tag.hot{background:none;color:var(--acc)}
.stat{background:none;border:0;border-left:1px solid var(--line);border-radius:0}.stat b{font-weight:400;color:var(--fg);font-size:2.6rem}
.band,.callout{background:none;border:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);border-radius:0;padding:18px 0}
th{font-family:var(--body)}tbody tr:nth-child(even) td{background:none}.thumb{animation:none;border:0}`,
  },

  saas: {
    about: "a glossy 2020s startup landing page: gradients, rounded cards, soft shadows, big centered hero",
    voice: "A polished modern SaaS page: benefit-led and scannable. .grid of feature .card with .icon, .stat metrics, testimonials as .quote, short sentences.",
    mood: "light", art: "full", mark: true,
    fonts: [["sans", "grot"], ["avenir", "avenir"], ["rounded", "rounded"], ["segoe", "helvetica"], ["humanist", "futura"]],
    header: ["pill", "bar", "center"], hero: ["center", "split"], sections: ["bands", "stack"],
    tokens: (pick) => ({ fs: 16, lh: 1.6, rad: pick("rad", [12, 16, 20]), bw: 1, h1: "clamp(2.5rem,6vw,4.3rem)", hw: 800, htrack: "-.035em", pad: "22px 24px", gap: "18px", secgap: "64px", pill: "999px" }),
    palette: (h, pick) => {
      const dark = pick("dark", [false, false, true]);
      return dark
        ? { bg: "#07080d", panel: "#10121a", fg: "#eef0f7", muted: "#8e93a6", line: "#20243a", acc: hsl(h, 90, 66), acc2: hsl(h + 50, 90, 66), heroA: hsl(h, 60, 14), heroB: hsl(h + 50, 60, 10), on: "#07080d", dark }
        : { bg: "#ffffff", panel: hsl(h, 40, 98), fg: hsl(h, 30, 12), muted: hsl(h, 12, 42), line: hsl(h, 25, 90), acc: hsl(h, 80, 52), acc2: hsl(h + 50, 80, 55), heroA: hsl(h, 90, 94), heroB: hsl(h + 50, 90, 93), on: "#fff" };
    },
    css: ({ c, h }) => `:root{--shadow:0 1px 2px ${hsl(h, 40, 20, 0.06)},0 12px 32px -12px ${hsl(h, 60, 30, c.dark ? 0.6 : 0.22)}}
.hero{background:radial-gradient(60% 80% at 20% 0%,${hsl(h, 90, c.dark ? 30 : 88, 0.7)},transparent 70%),radial-gradient(50% 70% at 90% 20%,${hsl(h + 60, 90, c.dark ? 30 : 88, 0.7)},transparent 70%),var(--bg);animation:none;border:0;padding:80px 0 64px}
.hero h1{background:linear-gradient(120deg,var(--fg) 30%,var(--acc));-webkit-background-clip:text;background-clip:text;color:transparent}.hero .art{border:0}
.btn{background:linear-gradient(135deg,var(--acc),var(--acc2));border-radius:999px;border:0;padding:.75em 1.4em}.btn.ghost{background:var(--panel);color:var(--fg);border:1px solid var(--line)}
.card{border-color:var(--line)}.card:hover{transform:translateY(-4px);box-shadow:0 20px 40px -18px ${hsl(h, 60, 30, 0.35)}}
.icon{display:inline-grid;place-items:center;width:46px;height:46px;border-radius:12px;background:${hsl(h, 80, c.dark ? 20 : 94)};font-size:1.4rem}
.stat b{background:linear-gradient(135deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent;font-size:2.4rem}
section>h2{text-align:inherit}.tag{border-radius:999px;background:${hsl(h, 80, c.dark ? 18 : 95)};border-color:transparent}`,
  },

  scrapbook: {
    about: "a handmade scrapbook or craft-fair site: kraft paper, taped notes, tilted cards, handwritten-feeling type",
    voice: "A handmade scrapbook by an enthusiastic hobbyist: warm, personal, first-person. Notes, lists, little captions and a few .card snapshots; emoji welcome.",
    mood: "paper", art: "full", mark: false,
    fonts: [["book", "marker"], ["typewriter", "marker"], ["hand", "hand"], ["serif", "chunky"], ["typewriter", "hand"]],
    header: ["minimal", "masthead", "center"], hero: ["split", "center"], sections: ["stack"],
    tokens: () => ({ fs: 17, lh: 1.6, rad: 3, bw: 1, shadow: "2px 4px 10px rgba(60,40,10,.25)", h1: "clamp(2.2rem,5.5vw,3.6rem)", hw: 400, pad: "20px 20px 16px", gap: "26px", pill: "4px" }),
    palette: (h, pick) => {
      const bg = pick("paper", [hsl(33, 42, 74), hsl(45, 55, 88), hsl(h, 30, 86), hsl(200, 20, 88)]);
      return { bg, panel: "#fffdf4", fg: "#2b2118", muted: "#5d5044", line: "#b9a88f", acc: hsl(h, 65, 42), acc2: hsl(h + 140, 55, 45), heroA: bg, heroB: bg, on: "#fff" };
    },
    css: ({ h, pick }) => `body{background-image:radial-gradient(rgba(80,50,20,.09) 1px,transparent 1.4px),radial-gradient(rgba(255,255,255,.2) 1px,transparent 1.4px);background-size:7px 7px,11px 11px}
header.site{background:none;border:0;position:static}.brand span{color:var(--acc)}nav.top a{color:var(--fg);text-decoration:underline wavy ${hsl(h, 70, 55)};text-underline-offset:4px}
.hero{background:none;animation:none;border:0}.hero h1{transform:rotate(-1.5deg);color:var(--fg)}.hero .art{background:#fff;border:0;padding:10px 10px 34px;box-shadow:3px 6px 14px rgba(0,0,0,.3);transform:rotate(3deg)}
section>h2{display:inline-block;background:linear-gradient(transparent 55%,${hsl(h, 90, 72, 0.7)} 55%);padding:0 .2em}
.card,.band,.post,.stat,.infobox{position:relative;border:0}.grid>.card:nth-child(odd),.post:nth-of-type(odd){transform:rotate(-1.2deg)}.grid>.card:nth-child(even),.post:nth-of-type(even){transform:rotate(1deg)}.card:hover{transform:rotate(0) scale(1.02)}
.card::before,.band::before,.post::before{content:"";position:absolute;top:-11px;left:50%;width:86px;height:22px;background:${pick("tape", [hsl(50, 90, 80, 0.75), hsl(h, 70, 80, 0.7), "rgba(255,255,255,.6)"])};transform:translateX(-50%) rotate(-3deg);box-shadow:0 1px 2px rgba(0,0,0,.1)}
.band{background:repeating-linear-gradient(#fffdf4 0 27px,${hsl(210, 60, 80)} 27px 28px);padding-top:24px}
.btn{border-radius:4px;transform:rotate(-1deg);box-shadow:2px 3px 0 var(--fg)}.tag{border:1px dashed var(--fg);border-radius:4px;color:var(--fg);background:#fffdf4}
.callout{background:${hsl(55, 95, 82)};border:0;border-radius:0;box-shadow:2px 4px 10px rgba(0,0,0,.2);transform:rotate(-.6deg)}
.thumb{animation:none;border:0}img.pic{background:#fff;padding:8px 8px 26px;border:0;box-shadow:2px 4px 10px rgba(0,0,0,.25)}
footer.site{background:none;border-top:2px dashed var(--line)}`,
  },

  terminal: {
    about: "a hacker terminal: black screen, green or amber monospace text, ASCII borders, command prompts",
    voice: "A terse terminal-style site: lowercase-leaning, technical, dry. Prefer code, kbd, tables, ol.steps and plain lists. No emoji, no .icon, no .thumb.",
    mood: "dark", art: "small", mark: false,
    fonts: [["mono", "mono"], ["menlo", "menlo"], ["courier", "mono"]],
    header: ["bar", "minimal", "sidebar"], hero: ["plain", "split"], sections: ["stack", "rule"],
    tokens: () => ({ fs: 14.5, lh: 1.55, rad: 0, bw: 1, shadow: "none", h1: "clamp(1.5rem,3.5vw,2.2rem)", h2: "1.15rem", hw: 700, maxw: 920, pad: "12px 14px", gap: "14px", pill: "0" }),
    palette: (h, pick) => {
      const fg = pick("phosphor", [hsl(130, 100, 62), hsl(38, 100, 58), hsl(h, 90, 70), hsl(185, 90, 65)]);
      return { bg: pick("bg", ["#050805", "#0c0c0c", "#101014"]), panel: "rgba(255,255,255,.03)", fg, muted: "color-mix(in srgb," + fg + " 60%,#000)", line: "color-mix(in srgb," + fg + " 40%,#000)", acc: fg, acc2: "#ffffff", heroA: "#000", heroB: "#000", on: "#000", art: "#000000" };
    },
    css: () => `body{text-shadow:0 0 6px color-mix(in srgb,var(--fg) 45%,transparent)}body::after{content:"";position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(transparent 0 2px,rgba(0,0,0,.22) 2px 3px);z-index:99}
header.site{background:var(--bg);border-bottom:1px dashed var(--line)}.brand{font-size:1rem;text-transform:lowercase}.brand::before{content:"~/";color:var(--muted)}.brand span{color:var(--fg)}
nav.top a{color:var(--fg)}nav.top a::before{content:"./"}a{color:var(--fg);text-decoration:underline}
.hero{background:none;animation:none;border-bottom:1px dashed var(--line);padding:26px 0 20px}.hero h1::before{content:"$ ";color:var(--muted)}.hero h1::after{content:"█";animation:cur 1s steps(1) infinite;margin-left:.1em}@keyframes cur{50%{opacity:0}}
.hero .art,img.pic{filter:grayscale(1) contrast(1.2);mix-blend-mode:screen;border:1px dashed var(--line);box-shadow:none;background:#000}
section>h2::before{content:"## ";color:var(--muted)}h3::before{content:"### ";color:var(--muted)}
.card,.band,.stat,.post,.callout,.infobox,details.faq{background:none;border:1px dashed var(--line);border-radius:0;box-shadow:none}.card:hover{transform:none;border-style:solid}
.btn,.btn.ghost{background:none;color:var(--fg);border:0;box-shadow:none;padding:0;font-weight:700}.btn::before{content:"[ "}.btn::after{content:" ]"}.btn:hover{background:var(--fg);color:var(--bg)}
.tag{border-radius:0;background:none;border:0;padding:0;color:var(--muted)}.tag::before{content:"#"}.tag.hot{background:var(--fg);color:var(--bg);padding:0 .3em}.tag.hot::before{content:""}
th{color:var(--fg);border-bottom:1px dashed var(--line)}td{border-bottom:1px dashed var(--line)}tbody tr:nth-child(even) td{background:none}
.stat b{color:var(--fg)}.av{background:none;border:1px solid var(--line);border-radius:0;color:var(--fg)}.thumb{display:none}.icon{display:none}
.bars i{border-radius:0;background:none;border:1px solid var(--line)}.bars i::after,.progress::after{background:repeating-linear-gradient(90deg,var(--fg) 0 6px,transparent 6px 8px);border-radius:0}
ul.timeline li::before,ol.steps li::before{border-radius:0}blockquote,.quote{border-left:1px dashed var(--fg);font-style:normal}
footer.site{background:none;border-top:1px dashed var(--line)}footer.site .wrap::before{content:"-- EOF --";width:100%;color:var(--muted)}`,
  },

  luxury: {
    about: "a luxury fashion or jewellery house: ivory and black, thin letter-spaced capitals, Didone serif, vast whitespace",
    voice: "A luxury maison: few, precise, evocative words; lots of space. Prefer .split with a picture, short .card lineups and understated tables. No emoji, no .icon, no exclamation marks.",
    mood: "paper", art: "full", mark: false,
    fonts: [["didone", "didone"], ["optima", "didone"], ["book", "copperplate"], ["helvetica", "didone"], ["baskerville", "baskerville"]],
    header: ["center", "masthead"], hero: ["center", "poster"], sections: ["centered"],
    tokens: () => ({ fs: 16, lh: 1.8, rad: 0, bw: 1, shadow: "none", h1: "clamp(2.2rem,5vw,3.8rem)", h2: "1rem", hw: 400, hcase: "uppercase", htrack: ".2em", maxw: 1080, pad: "8px 0", gap: "40px", secgap: "80px", pill: "0" }),
    palette: (h, pick) => {
      const dark = pick("dark", [false, true, false]);
      const acc = pick("acc", [hsl(40, 45, 48), hsl(h, 25, 40), dark ? "#e8e1d3" : "#111"]);
      return dark
        ? { bg: "#0b0b0b", panel: "#121212", fg: "#e8e1d3", muted: "#8f887b", line: "#2c2a26", acc, acc2: acc, heroA: "#0b0b0b", heroB: "#0b0b0b", on: "#0b0b0b" }
        : { bg: pick("bg", ["#f7f4ee", "#ffffff"]), panel: "#ffffff", fg: "#111", muted: "#7a746a", line: "#ddd6c8", acc, acc2: acc, heroA: "#fff", heroB: "#fff", on: "#fff" };
    },
    css: () => `header.site{background:var(--bg);border-bottom:1px solid var(--line)}.brand{font-weight:400;letter-spacing:.32em;text-transform:uppercase;font-size:1.5rem}.brand span{color:var(--fg)}
nav.top{text-transform:uppercase;letter-spacing:.2em;font-size:.72rem}nav.top a{color:var(--fg)}
.hero{background:none;animation:none;border:0;padding:70px 0 60px}.hero h1{font-weight:300;letter-spacing:.06em;text-transform:none}.hero .tagline{letter-spacing:.04em}.hero .art{border:0;box-shadow:none;background:none}
section>h2{display:flex;align-items:center;gap:18px;font-size:.85rem;font-family:var(--body)}section>h2::before,section>h2::after{content:"";flex:1;border-top:1px solid var(--line)}
.card{background:none;border:0;text-align:center;padding:0}.card:hover{transform:none}.card h3{font-weight:400;text-transform:uppercase;letter-spacing:.14em;font-size:.9rem}
.price{font-weight:400;font-size:1rem;letter-spacing:.1em}.btn{background:none;color:var(--fg);border:1px solid var(--fg);border-radius:0;text-transform:uppercase;letter-spacing:.24em;font-size:.7rem;font-weight:400;padding:1.1em 2.6em;box-shadow:none}.btn:hover{background:var(--fg);color:var(--bg)}
.btn.ghost{border-color:var(--line);color:var(--fg)}.tag{border:0;background:none;color:var(--muted);letter-spacing:.2em}.tag.hot{background:none;color:var(--acc)}
.stat{background:none;border:0;text-align:center}.stat b{font-weight:300;color:var(--fg)}.quote{border:0;text-align:center;font-size:1.4rem}
.band,.callout,.infobox{background:none;border:1px solid var(--line);border-radius:0;box-shadow:none}th{letter-spacing:.2em}tbody tr:nth-child(even) td{background:none}
.thumb{animation:none;border:0;background:var(--panel)}.stars::before{background:linear-gradient(90deg,var(--acc) calc(var(--r,4)*20%),var(--line) 0);-webkit-background-clip:text;background-clip:text}
.announce{background:var(--fg);color:var(--bg);letter-spacing:.2em;text-transform:uppercase;font-weight:400;font-size:.68rem}`,
  },

  web2: {
    about: "mid-2000s Web 2.0: glossy gradient buttons, rounded boxes, reflections, bright aqua and lime, a 'beta' badge",
    voice: "A mid-2000s Web 2.0 site: upbeat and community-minded ('Sign up — it's free!'). Use .card boxes, .tag clouds, .stars and friendly .callout boxes.",
    mood: "light", art: "full", mark: true,
    fonts: [["lucida", "lucida"], ["verdana", "trebuchet"], ["tahoma", "arialround"], ["lucida", "georgia"]],
    header: ["bar", "stacked"], hero: ["banner", "split"], sections: ["window", "stack"],
    tokens: () => ({ fs: 14, lh: 1.5, rad: 8, bw: 1, shadow: "0 2px 6px rgba(0,0,0,.18)", h1: "clamp(1.8rem,4vw,2.6rem)", h2: "1.35rem", hw: 700, htrack: "-.01em", maxw: 960, pad: "14px 16px", gap: "14px", pill: "999px" }),
    palette: (h, pick) => {
      const hh = pick("hue", [h, 195, 95, 25]);
      return { bg: hsl(hh, 55, 86), panel: "#ffffff", fg: "#222", muted: "#666", line: hsl(hh, 30, 78), acc: hsl(hh, 80, 42), acc2: hsl(hh + 90, 75, 45), heroA: hsl(hh, 85, 55), heroB: hsl(hh, 90, 38), on: "#fff", hh };
    },
    css: ({ c }) => `body{background:linear-gradient(${hsl(c.hh, 70, 72)},${c.bg} 380px,${hsl(c.hh, 30, 94)}) no-repeat,${hsl(c.hh, 30, 94)}}
header.site{background:linear-gradient(#fff,#e9eef3);border-bottom:1px solid #b8c4cf;box-shadow:0 1px 4px rgba(0,0,0,.15)}.brand{font-size:1.6rem;letter-spacing:-.04em}.brand-text>div::after{content:"beta";font:italic 700 .6rem/1 ${STYLE_FONTS.arial};color:#fff;background:#f60;border-radius:3px;padding:2px 4px;margin-left:6px;vertical-align:super;letter-spacing:0;text-transform:none}
main.wrap,.layout{background:#fff;border-radius:0 0 12px 12px;box-shadow:0 4px 18px rgba(0,0,0,.18);padding:28px 26px 10px}.layout>main{padding-top:0}
.hero{background:linear-gradient(${c.heroA},${c.heroB});animation:none;border:0;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.35)}.hero .tagline,.hero .byline,.hero .byline b{color:#eef}.hero a:not(.btn){color:#fff}
.hero .art{border:3px solid #fff;border-radius:8px;box-shadow:0 18px 20px -14px rgba(0,0,0,.6)}
.btn{background:linear-gradient(${hsl(c.hh + 90, 80, 60)} 0 50%,${hsl(c.hh + 90, 80, 44)} 50%);color:#fff;border:1px solid ${hsl(c.hh + 90, 80, 30)};border-radius:6px;text-shadow:0 -1px 0 rgba(0,0,0,.3);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 1px 2px rgba(0,0,0,.3)}
.btn.ghost{background:linear-gradient(#fff 0 50%,#eee 50%);color:#333;border:1px solid #bbb;text-shadow:none}
section>h2{color:var(--acc);text-shadow:0 1px 0 #fff}main section>h2{background:linear-gradient(${hsl(c.hh, 70, 60)},${hsl(c.hh, 70, 45)});color:#fff;text-shadow:0 -1px 0 rgba(0,0,0,.3)}
.card{background:linear-gradient(#fff,${hsl(c.hh, 40, 96)})}.tag{background:linear-gradient(#fff,#e6eef5);border:1px solid #b8c4cf;color:var(--acc);text-transform:none;letter-spacing:0;font-size:.8rem}
.tag.hot{background:linear-gradient(#ff8a00,#e65c00);border-color:#c50;color:#fff}.callout{background:#fffbe0;border:1px solid #e6d77a;border-left:1px solid #e6d77a}
.thumb{animation:none}th{background:linear-gradient(#f5f8fb,#dde6ee);color:#333}`,
  },

  phpbb: {
    about: "2000s forum or web-portal software: blue gradient table headers, dense bordered tables, small Verdana text",
    voice: "2000s forum/portal software: functional and dense. Tables with header rows, lists, .post blocks and small .meta details; few decorative cards, no .thumb.",
    mood: "light", art: "small", mark: true,
    fonts: [["verdana", "trebuchet"], ["tahoma", "tahoma"], ["arial", "georgia"], ["lucida", "trebuchet"]],
    header: ["stacked", "bar"], hero: ["compact", "plain"], sections: ["window"],
    tokens: () => ({ fs: 13, lh: 1.45, rad: 4, bw: 1, shadow: "none", h1: "1.6rem", h2: ".95rem", hw: 700, maxw: 1100, pad: "10px 12px", gap: "8px", secgap: "18px", pill: "4px" }),
    palette: (h, pick) => {
      const hh = pick("hue", [h, 210, 210, 150]);
      return { bg: hsl(hh, 22, 88), panel: "#ffffff", fg: "#222", muted: "#555", line: hsl(hh, 25, 72), acc: hsl(hh, 55, 34), acc2: hsl(hh + 30, 70, 38), heroA: "#fff", heroB: "#fff", on: "#fff", hh };
    },
    css: ({ c }) => `header.site{background:linear-gradient(${hsl(c.hh, 55, 28)},${hsl(c.hh, 50, 45)});border:0;position:static}.brand,.brand span{color:#fff}.brand .brand-text small{color:${hsl(c.hh, 40, 85)}}
header.site nav.top{background:${hsl(c.hh, 30, 92)};border-radius:4px;padding:6px 10px!important;border:1px solid ${hsl(c.hh, 30, 75)}!important}header.site nav.top a{color:var(--acc);font-weight:700;font-size:.85rem}
main.wrap,.layout{background:#fff;border:1px solid var(--line);border-top:0;padding-left:14px;padding-right:14px}.hero .wrap{background:#fff;border:1px solid var(--line);border-bottom:0;padding-top:14px}
.hero{background:none;animation:none;border:0;padding:12px 0 0}.hero h1{color:var(--acc)}.hero .art{width:min(140px,22%)}
main section>h2{background:linear-gradient(${hsl(c.hh, 50, 48)},${hsl(c.hh, 55, 32)});color:#fff;text-transform:uppercase;font-size:.78rem;letter-spacing:.06em}
main section{border-radius:6px 6px 0 0;background:${hsl(c.hh, 30, 97)}}
.post{display:grid;grid-template-columns:150px minmax(0,1fr);column-gap:14px;border-radius:0;background:#fff;padding:0}.post>*{grid-column:2;padding-right:10px}.post>:nth-child(2){padding-top:10px}
.post>.who{grid-column:1;grid-row:1/span 20;flex-direction:column;align-items:flex-start;background:${hsl(c.hh, 30, 93)};border-right:1px solid var(--line);padding:10px;margin:0;font-size:.85em}.post .who .meta{margin-left:0}
.av{border-radius:4px;width:48px;height:48px}.card{border-radius:4px}.card:hover{transform:none}
th{background:linear-gradient(${hsl(c.hh, 50, 48)},${hsl(c.hh, 55, 32)});color:#fff;text-transform:none;letter-spacing:0;font-size:.85em}table{border:1px solid var(--line)}td{border-bottom:1px solid ${hsl(c.hh, 25, 85)}}tbody tr:nth-child(even) td{background:${hsl(c.hh, 30, 95)}}
.btn{border-radius:3px;background:linear-gradient(#fff,#dde);color:var(--acc);border:1px solid var(--line);font-size:.8rem;padding:.35em .8em;font-weight:700}.btn.ghost{background:#fff}.tag{border-radius:3px;text-transform:none;letter-spacing:0}.tag.hot{background:#c00;border-color:#900}
.thumb{display:none}.rail .card{border-radius:6px 6px 0 0;padding-top:0}.rail .card h4{margin:0 -20px 10px;padding:6px 12px;background:linear-gradient(${hsl(c.hh, 50, 48)},${hsl(c.hh, 55, 32)});color:#fff}
footer.site{background:none;border:0;text-align:center}footer.site .wrap::after{content:"Powered by ${pickForum(c.hh)} © 2004 Group";width:100%;font-size:.8em}`,
  },

  corporate: {
    about: "a conservative 2010s corporate site: navy header bar, blue buttons, Bootstrap panels, stock-photo jumbotron",
    voice: "A conservative corporate site: professional, reassuring, a bit bland. .grid of .card panels, .stat figures, tables and clear .btn calls to action.",
    mood: "light", art: "full", mark: true,
    fonts: [["helvetica", "helvetica"], ["segoe", "segoe"], ["sans", "gill"], ["arial", "georgia"]],
    header: ["bar", "stacked"], hero: ["banner", "split"], sections: ["stack", "bands"],
    tokens: () => ({ fs: 15, lh: 1.55, rad: 4, bw: 1, shadow: "0 1px 2px rgba(0,0,0,.08)", h1: "clamp(2rem,4.4vw,2.9rem)", hw: 500, maxw: 1140, pad: "18px 20px", gap: "20px", pill: "4px" }),
    palette: (h, pick) => {
      const hh = pick("hue", [h, 212, 205, 160]);
      return { bg: "#ffffff", panel: "#f7f8fa", fg: "#333", muted: "#6c757d", line: "#dee2e6", acc: hsl(hh, 70, 42), acc2: hsl(hh, 70, 32), heroA: hsl(hh, 30, 96), heroB: hsl(hh, 40, 90), on: "#fff", nav: hsl(hh, 50, 20) };
    },
    css: ({ c }) => `header.site{background:${c.nav};border:0}.brand,.brand span{color:#fff}nav.top a{color:rgba(255,255,255,.75)}nav.top a:hover{color:#fff}.brand .brand-text small{color:rgba(255,255,255,.6)}
header.site .search{background:#fff;border-radius:4px}header.site .btn.ghost{color:#fff;border-color:rgba(255,255,255,.5)}header.site nav.top{border-color:rgba(255,255,255,.15)!important}
.card h3:first-child{margin:-18px -20px 14px;padding:10px 20px;background:var(--panel);border-bottom:1px solid var(--line);font-size:1rem;border-radius:4px 4px 0 0}.card{background:#fff}.card:hover{transform:none;box-shadow:0 4px 12px rgba(0,0,0,.08)}
.btn{border-radius:4px;font-weight:400}.tag{border-radius:3px;text-transform:none;letter-spacing:0}section>h2{font-weight:400}
footer.site{background:${c.nav};color:rgba(255,255,255,.7);border:0}footer.site a,footer.fat h4{color:rgba(255,255,255,.85)}.thumb{animation:none}`,
  },

  newsprint: {
    about: "a broadsheet newspaper: dense justified serif columns, black rules, condensed headlines, newsprint grey",
    voice: "A broadsheet newspaper: reported, factual, attributed quotes. Dense paragraphs, tables of figures, a timeline; few boxes. No emoji, no .icon.",
    mood: "paper", art: "full", mark: false,
    fonts: [["book", "cond"], ["times", "times"], ["serif", "superclarendon"], ["book", "didone"], ["times", "impact"]],
    header: ["masthead"], hero: ["poster", "split"], sections: ["rule"],
    tokens: () => ({ fs: 17, lh: 1.5, rad: 0, bw: 1, shadow: "none", h1: "clamp(2.4rem,6vw,4.4rem)", h2: "1.5rem", hw: 700, htrack: "-.01em", maxw: 1080, pad: "0 16px", gap: "0", pill: "0" }),
    palette: (h, pick) => {
      const bg = pick("paper", [hsl(45, 18, 91), "#ffffff", hsl(40, 30, 94)]);
      return { bg, panel: bg, fg: "#111", muted: "#555", line: "#111", acc: pick("acc", ["#111", hsl(h, 60, 32), hsl(0, 70, 38)]), acc2: "#111", heroA: bg, heroB: bg, on: "#fff" };
    },
    css: () => `header.site{background:var(--bg)}header.site .brand{font-family:${STYLE_FONTS.caslon};font-weight:700;text-transform:none;letter-spacing:0;font-size:clamp(2.2rem,7vw,4.2rem)}.brand span{color:var(--fg)}
header.site nav.top{border-top:3px double var(--fg)!important;border-bottom:1px solid var(--fg)!important}nav.top a{color:var(--fg)}
.hero{background:none;animation:none;border-bottom:1px solid var(--fg);padding:24px 0}.hero h1{line-height:1}.hero .art{border:0;box-shadow:none;filter:grayscale(.85) contrast(1.1);background:none}
main section>p,.card p{text-align:justify;hyphens:auto}.lead{color:var(--fg);font-weight:600}.lead::first-letter{float:left;font-size:3.6em;line-height:.85;padding-right:.08em;font-family:var(--head)}
.grid>.card{border:0;border-left:1px solid var(--line);padding:0 16px;background:none;border-radius:0}.grid>.card:first-child{border-left:0;padding-left:0}.card:hover{transform:none}
.stat{background:none;border:0;border-left:1px solid var(--line);border-radius:0}.stat b{color:var(--fg)}.quote{border-left:0;border-top:1px solid;border-bottom:1px solid;font-size:1.4rem;color:var(--fg);padding:14px 0;text-align:center}
.callout,.band{background:none;border:1px solid var(--fg);border-radius:0}.btn{border-radius:0;background:var(--fg)}.tag{border-radius:0;background:none;border:0;padding:0;color:var(--acc);font-weight:700}
th{border-bottom:2px solid var(--fg);color:var(--fg)}tbody tr:nth-child(even) td{background:none}img.pic{filter:grayscale(.85);border:0}.thumb{animation:none;border:0;filter:grayscale(1)}.av{filter:grayscale(1)}`,
  },

  retroos: {
    about: "a 1990s desktop operating system theme: grey bevelled windows with title bars, teal desktop, pixel-era system font",
    voice: "A retro desktop-OS themed site: playful and nostalgic. Content sits in windows and dialogs; lists, tables, .btn buttons and small .icon emoji are welcome.",
    mood: "light", art: "full", mark: true,
    fonts: [["mssans", "mssans"], ["tahoma", "tahoma"], ["chicago", "chicago"], ["verdana", "arialblack"]],
    header: ["bar", "sidebar"], hero: ["split", "plain"], sections: ["window"],
    tokens: () => ({ fs: 14, lh: 1.45, rad: 0, bw: 2, shadow: "none", h1: "clamp(1.6rem,3.5vw,2.2rem)", h2: ".9rem", hw: 700, maxw: 980, pad: "12px 14px", gap: "12px", pill: "0" }),
    palette: (h, pick) => {
      const desk = pick("desk", ["#008080", hsl(h, 45, 38), "#3a6ea5", "#5a5a8a"]);
      return { bg: desk, panel: "#c0c0c0", fg: "#000", muted: "#333", line: "#808080", acc: pick("bar", ["#000080", hsl(h, 80, 28)]), acc2: "#1084d0", heroA: "#c0c0c0", heroB: "#c0c0c0", on: "#fff" };
    },
    css: () => `:root{--bevel:inset -1px -1px #0a0a0a,inset 1px 1px #fff,inset -2px -2px #808080,inset 2px 2px #dfdfdf}
header.site{background:#c0c0c0;box-shadow:var(--bevel);border:0}.brand,.brand span{color:#000}nav.top a{color:#000;padding:2px 8px;box-shadow:var(--bevel);background:#c0c0c0}nav.top a:hover{box-shadow:inset 1px 1px #0a0a0a,inset -1px -1px #fff}
a{color:#0000ee;text-decoration:underline}.hero{background:none;animation:none;border:0}.hero .wrap{background:#c0c0c0;box-shadow:var(--bevel);padding:16px 18px;position:relative}
.hero .wrap::before{content:"";position:absolute;inset:0 0 auto 0;height:22px;background:linear-gradient(90deg,var(--acc),var(--acc2))}.hero .hero-text{padding-top:18px}.hero .tagline,.hero .byline{color:#000}.hero .art{box-shadow:inset 1px 1px #808080,inset -1px -1px #fff;border:0;background:#fff}
main section{background:#c0c0c0;box-shadow:var(--bevel);border:0;padding:3px 12px 12px}main section>h2{margin:0 -9px 12px;padding:3px 8px;background:linear-gradient(90deg,var(--acc),var(--acc2));color:#fff;display:flex;justify-content:space-between;font-size:.85rem}
main section>h2::after{content:"_ □ ×";letter-spacing:.4em;font-weight:400}
.card,.stat,.post,.band,.infobox,details.faq,.callout{background:#fff;box-shadow:inset 1px 1px #808080,inset -1px -1px #fff,inset 2px 2px #0a0a0a;border:0;border-radius:0}.card:hover{transform:none}
.btn,.btn.ghost{background:#c0c0c0;color:#000;box-shadow:var(--bevel);border:0;border-radius:0;font-weight:400;padding:.4em 1.2em}.btn:active{box-shadow:inset 1px 1px #0a0a0a,inset -1px -1px #fff}
.tag{border-radius:0;background:#fff;color:#000;border:1px solid #808080;text-transform:none;letter-spacing:0}.tag.hot{background:var(--acc);color:#fff}
table{background:#fff;box-shadow:inset 1px 1px #808080,inset -1px -1px #fff}th{background:#c0c0c0;color:#000;box-shadow:var(--bevel);text-transform:none;letter-spacing:0}tbody tr:nth-child(even) td{background:none}
.bars i,.progress{border-radius:0;background:#fff;box-shadow:inset 1px 1px #808080}.bars i::after,.progress::after{border-radius:0;background:repeating-linear-gradient(90deg,var(--acc) 0 10px,transparent 10px 12px)}
.thumb{animation:none;background:#fff}.av{border-radius:0}
main.wrap,.layout{padding-bottom:20px}footer.site{background:#c0c0c0;box-shadow:var(--bevel);border:0;color:#000}footer.site a{color:#000}`,
  },

  minimal: {
    about: "quiet personal minimalism: one narrow column of plain text, lots of whitespace, almost no decoration",
    voice: "A quiet personal site with lots of whitespace: plain, honest prose. Paragraphs, simple lists, the occasional table; almost no boxes, no emoji, no .icon.",
    mood: "light", art: "small", mark: false,
    fonts: [["sans", "sans"], ["book", "book"], ["mono", "sans"], ["serif", "serif"], ["humanist", "humanist"], ["avenir", "avenir"]],
    header: ["minimal", "bar"], hero: ["plain"], sections: ["stack"],
    tokens: (pick) => ({ fs: 17, lh: 1.75, rad: 0, bw: 1, shadow: "none", h1: "clamp(1.7rem,3.5vw,2.2rem)", h2: "1.2rem", hw: pick("hw", [600, 400]), maxw: pick("maxw", [640, 700]), pad: "0", gap: "26px", secgap: "48px", pill: "0" }),
    palette: (h, pick) => {
      const dark = pick("dark", [false, false, true]);
      return dark
        ? { bg: "#111", panel: "#111", fg: "#ddd", muted: "#888", line: "#2a2a2a", acc: pick("acc", ["#ddd", hsl(h, 60, 70)]), acc2: "#ddd", heroA: "#111", heroB: "#111", on: "#111" }
        : { bg: pick("bg", ["#ffffff", "#fcfcfa", "#f7f7f5"]), panel: "#ffffff", fg: "#222", muted: "#777", line: "#e6e6e6", acc: pick("acc", ["#222", hsl(h, 60, 40)]), acc2: "#222", heroA: "#fff", heroB: "#fff", on: "#fff" };
    },
    css: () => `header.site{background:none;border:0;position:static}.brand{font-weight:600;font-size:1rem;text-transform:none;letter-spacing:0}.brand span{color:var(--fg)}nav.top a{color:var(--muted)}
a{text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:3px}a:hover{text-decoration-color:var(--acc)}
.hero{background:none;animation:none;border:0;padding:40px 0 0}.hero .art{width:min(160px,28%);border:0;box-shadow:none;background:none}
.card,.band,.stat,.callout,.post,.infobox{background:none;border:0;border-radius:0;box-shadow:none;padding:0}.card:hover{transform:none}.callout{border-left:2px solid var(--line);padding-left:16px}
.btn,.btn.ghost{background:none;color:var(--fg);border:1px solid var(--line);box-shadow:none;border-radius:0;font-weight:400}.tag,.tag.hot{background:none;border:0;padding:0;color:var(--muted);text-transform:none;letter-spacing:0;font-family:inherit}
.stat b{color:var(--fg);font-weight:400}th{text-transform:none;letter-spacing:0;font-family:inherit}tbody tr:nth-child(even) td{background:none}.thumb{display:none}.icon{display:none}
.av{background:var(--line);color:var(--fg)}.quote{font-style:normal;border-left:2px solid var(--line)}footer.site{background:none;border:0}`,
  },

  playful: {
    about: "bubbly and playful, for kids, pets, food or hobby fun: rounded chunky type, candy colours, pill buttons, wobbly shapes",
    voice: "Bubbly and friendly: upbeat, simple words, a few exclamation marks. .grid of colourful .card with .icon emoji, .stars and .tag pills.",
    mood: "light", art: "full", mark: true,
    fonts: [["rounded", "chunky"], ["avenir", "arialround"], ["rounded", "rounded"], ["trebuchet", "chunky"]],
    header: ["pill", "bar", "center"], hero: ["banner", "center", "split"], sections: ["stack", "bands"],
    tokens: () => ({ fs: 17, lh: 1.6, rad: 22, bw: 3, h1: "clamp(2.4rem,6vw,4rem)", hw: 900, htrack: "-.02em", pad: "20px 22px", gap: "20px", pill: "999px" }),
    palette: (h) => ({ bg: hsl(h, 90, 95), panel: "#ffffff", fg: hsl(h, 45, 18), muted: hsl(h, 20, 40), line: hsl(h, 45, 18), acc: hsl(h, 90, 55), acc2: hsl(h + 150, 85, 58), heroA: hsl(h, 95, 70), heroB: hsl(h + 40, 95, 72), on: "#fff" }),
    css: ({ h }) => `:root{--shadow:0 6px 0 ${hsl(h, 45, 18)}}header.site{background:var(--bg);border-bottom:0}.brand{font-weight:900}
.hero{border:0;border-radius:0 0 50% 50% / 0 0 40px 40px;padding-bottom:60px}.hero h1{color:var(--fg)}.hero .art{border:3px solid var(--line);box-shadow:var(--shadow);transform:rotate(-2deg);border-radius:28px}
.btn{border-radius:999px;border:3px solid var(--line);box-shadow:0 5px 0 var(--line);font-weight:800}.btn:hover{transform:translateY(3px);box-shadow:0 2px 0 var(--line)}
.grid>.card:nth-child(3n+1){background:${hsl(h, 95, 92)}}.grid>.card:nth-child(3n+2){background:${hsl(h + 120, 90, 92)}}.grid>.card:nth-child(3n){background:${hsl(h + 240, 90, 93)}}
.card:hover{transform:rotate(-1.5deg) translateY(-3px)}.tag{border-radius:999px;border-width:2px;border-color:var(--line);color:var(--fg);background:${hsl(h + 60, 95, 85)}}
section>h2{display:inline-block;background:var(--acc2);color:#fff;padding:.1em .6em;border-radius:999px;transform:rotate(-1.5deg);border:3px solid var(--line)}
.icon{display:inline-grid;place-items:center;width:60px;height:60px;border-radius:50%;background:#fff;border:3px solid var(--line)}.thumb{border-radius:22px}
footer.site{background:var(--fg);color:#fff;border:0}footer.site a,footer.fat h4{color:#fff}`,
  },

  cyber: {
    about: "a neon cyberpunk or synthwave future: dark, glowing neon edges, grid lines, angled clipped panels",
    voice: "A neon cyberpunk future site: punchy, hype, in-world future jargon. .stat readouts, .bars, tables and .tag chips; emoji sparingly.",
    mood: "neon", art: "full", mark: true,
    fonts: [["mono", "cond"], ["grot", "mono"], ["sans", "impact"], ["menlo", "futura"]],
    header: ["bar", "pill", "sidebar"], hero: ["split", "center", "poster"], sections: ["stack", "numbered"],
    tokens: () => ({ fs: 15.5, lh: 1.6, rad: 0, bw: 1, h1: "clamp(2.2rem,6vw,4.2rem)", hw: 800, hcase: "uppercase", htrack: ".02em", pad: "18px 20px", gap: "16px", pill: "0" }),
    palette: (h) => ({ bg: hsl(h, 45, 5), panel: hsl(h, 40, 9), fg: hsl(h, 20, 94), muted: hsl(h, 20, 64), line: hsl(h, 60, 26), acc: hsl(h, 100, 62), acc2: hsl(h + 155, 100, 60), heroA: hsl(h, 70, 10), heroB: hsl(h + 155, 70, 8), on: "#050505" }),
    css: ({ h }) => `:root{--shadow:0 0 22px ${hsl(h, 100, 50, 0.2)}}body{background-image:linear-gradient(${hsl(h, 100, 60, 0.06)} 1px,transparent 1px),linear-gradient(90deg,${hsl(h, 100, 60, 0.06)} 1px,transparent 1px);background-size:36px 36px}
h1,.brand span{text-shadow:0 0 18px ${hsl(h, 100, 60, 0.6)}}.hero h1{text-shadow:2px 0 var(--acc2),-2px 0 var(--acc),0 0 24px ${hsl(h, 100, 60, 0.5)}}
header.site{background:${hsl(h, 45, 5, 0.85)};backdrop-filter:blur(8px);border-bottom:1px solid var(--acc)}
.hero{border-bottom:1px solid var(--acc);background:linear-gradient(180deg,transparent 60%,${hsl(h, 100, 50, 0.12)}),linear-gradient(115deg,var(--bg),${hsl(h + 155, 70, 8)})}
section>h2::before{content:"// ";color:var(--acc2)}
.card,.band,.stat,.infobox{clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px));border-color:var(--acc)}
.btn{clip-path:polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%);text-transform:uppercase;letter-spacing:.1em;padding:.6em 1.6em}.tag{border-radius:0;border-color:var(--acc2);color:var(--acc2)}
th{color:var(--acc)}.stat b{text-shadow:0 0 14px ${hsl(h, 100, 60, 0.6)}}`,
  },

  bento: {
    about: "a modern bento-grid product or portfolio site: a grid of rounded tiles in soft tints, bold numerals",
    voice: "A modern bento-grid site: crisp and confident. .stat numbers, .bars, compact tables and short cards; each section is a compact tile, so keep it short.",
    mood: "light", art: "full", mark: true,
    fonts: [["grot", "grot"], ["sans", "sans"], ["rounded", "sans"], ["helvetica", "helvetica"], ["avenir", "futura"]],
    header: ["pill", "bar"], hero: ["split", "center"], sections: ["tiles"],
    tokens: (pick) => ({ fs: 15.5, lh: 1.55, rad: pick("rad", [14, 20]), bw: pick("bw", [0, 1]), shadow: "none", h1: "clamp(2.4rem,5.5vw,3.8rem)", hw: 700, htrack: "-.04em", maxw: 1180, pad: "16px 18px", gap: "12px", pill: "999px" }),
    palette: (h, pick) => {
      const dark = pick("dark", [false, true]);
      return dark
        ? { bg: "#0d0d0f", panel: "#18181c", fg: "#f2f2f2", muted: "#8b8b93", line: "#26262c", acc: hsl(h, 85, 65), acc2: hsl(h + 90, 70, 65), heroA: "#18181c", heroB: "#18181c", on: "#0d0d0f", dark }
        : { bg: pick("bg", ["#f3f2ee", "#eef0f4"]), panel: "#ffffff", fg: "#111", muted: "#6d6d6d", line: "#e3e2dc", acc: hsl(h, 75, 48), acc2: hsl(h + 90, 70, 45), heroA: "#fff", heroB: "#fff", on: "#fff" };
    },
    css: ({ h, c }) => `header.site{background:var(--bg);border:0}.hero{background:none;animation:none;border:0;padding:30px 22px 16px}.hero .wrap{background:var(--panel);border-radius:28px;padding:34px 36px;border:var(--bw) solid var(--line)}
.hero .art{border:0;box-shadow:none;border-radius:20px;background:${hsl(h, 60, c.dark ? 16 : 94)}}main.wrap,.layout>main{padding-top:16px}
main section:nth-of-type(4n+2){background:${hsl(h, 70, c.dark ? 14 : 94)}}main section:nth-of-type(4n+3){background:${c.dark ? "#1f1f24" : "#111"};color:${c.dark ? "#f2f2f2" : "#f2f2f2"}}main section:nth-of-type(4n+3) .meta,main section:nth-of-type(4n+3)>h2{color:#aaa}
.card{background:${c.dark ? "#222228" : "#f6f6f3"};border:0}main section:nth-of-type(4n+3) .card,main section:nth-of-type(4n+3) .stat{background:#222}.card:hover{transform:scale(1.02)}
.stat{border:0;background:none;padding:6px 0}.stat b{font-size:3rem;letter-spacing:-.05em;color:inherit}.btn{border-radius:999px}.tag{border-radius:999px;border:0;background:${hsl(h, 60, c.dark ? 20 : 90)}}
footer.site{background:none;border:0}`,
  },

  civic: {
    about: "a plain government design system like GOV.UK: bold black header, large clear sans type, no decoration",
    voice: "A plain-English government service page: clear, direct, second-person, short sentences. Headings, ol.steps, tables and .callout warnings. No emoji, no .icon, no .thumb, no marketing.",
    mood: "light", art: "none", mark: true,
    fonts: [["arial", "arial"], ["helvetica", "helvetica"], ["segoe", "segoe"], ["sans", "sans"]],
    header: ["bar", "stacked"], hero: ["plain", "banner"], sections: ["stack"],
    tokens: () => ({ fs: 19, lh: 1.32, rad: 0, bw: 1, shadow: "none", h1: "clamp(2rem,5vw,3rem)", h2: "1.6rem", hw: 700, maxw: 980, pad: "14px 0", gap: "24px", pill: "0" }),
    palette: (h, pick) => {
      const top = pick("top", ["#0b0c0c", hsl(h, 60, 22), "#1d70b8"]);
      return { bg: "#ffffff", panel: "#f3f2f1", fg: "#0b0c0c", muted: "#505a5f", line: "#b1b4b6", acc: pick("link", ["#1d70b8", hsl(h, 70, 32)]), acc2: "#003078", heroA: "#fff", heroB: "#fff", on: "#fff", top };
    },
    css: ({ c }) => `header.site{background:${c.top};border-bottom:10px solid var(--acc);position:static}.brand,.brand span{color:#fff}nav.top a{color:#fff;text-decoration:underline}header.site .search{border-radius:0;background:#fff}header.site nav.top{border-color:rgba(255,255,255,.3)!important}.brand .brand-text small{color:#ddd}
a{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.15em}a:hover{text-decoration-thickness:3px}a:focus{background:#fd0;color:#0b0c0c;outline:3px solid #fd0;box-shadow:0 4px #0b0c0c}
.hero{background:none;animation:none;border:0;padding:30px 0 0}.hero .wrap::before{content:"BETA";font:700 .8rem/1 ${STYLE_FONTS.arial};background:var(--acc);color:#fff;padding:5px 8px;align-self:flex-start;order:-1}.hero .wrap{flex-direction:column;align-items:flex-start;gap:14px}.hero .art{display:none}
.card{background:none;border:0;border-top:1px solid var(--line);border-radius:0}.card:hover{transform:none}.band{background:var(--panel);border:0}
.callout{background:none;border:0;border-left:10px solid var(--line);border-radius:0;padding:10px 20px}.btn{background:#00703c;color:#fff;border:0;border-radius:0;box-shadow:0 2px 0 #002d18;font-weight:400;font-size:1.1rem}.btn:hover{background:#005a30}
.btn.ghost{background:#f3f2f1;color:#0b0c0c;box-shadow:0 2px 0 #929191}.tag{border-radius:0;border:0;background:#cce2d8;color:#005a30;font-family:inherit;font-weight:700}.tag.hot{background:#1d70b8;color:#fff}
th{text-transform:none;letter-spacing:0;font-size:1rem;color:var(--fg);border-bottom:1px solid var(--line)}tbody tr:nth-child(even) td{background:none}.thumb,.icon{display:none}.stat{border:0;background:var(--panel)}.stat b{color:var(--fg)}
ol.steps li::before{background:var(--fg)}footer.site{background:var(--panel);border-top:1px solid var(--line);color:var(--fg)}footer.site a{color:var(--fg);text-decoration:underline}`,
  },

  academic: {
    about: "an old university department or research-group page: plain Times, a sidebar of links, maroon accents, almost no styling",
    voice: "An old university or research-group page: plain, precise, a bit dry. Paragraphs, citations, ul lists of links and bordered tables. No emoji, no .icon, no .thumb, no marketing.",
    mood: "paper", art: "small", mark: false,
    fonts: [["times", "times"], ["serif", "arial"], ["book", "book"], ["palatino", "palatino"]],
    header: ["sidebar", "minimal", "stacked"], hero: ["plain"], sections: ["stack"],
    tokens: () => ({ fs: 16, lh: 1.45, rad: 0, bw: 1, shadow: "none", h1: "1.9rem", h2: "1.35rem", hw: 700, maxw: 860, pad: "8px 12px", gap: "10px", secgap: "30px", pill: "0" }),
    palette: (h, pick) => {
      const acc = pick("acc", [hsl(350, 60, 28), hsl(h, 55, 28), hsl(215, 60, 28)]);
      return { bg: pick("bg", ["#ffffff", "#fffff8"]), panel: "#f6f6f2", fg: "#111", muted: "#555", line: "#bbb", acc, acc2: "#1a0dab", heroA: "#fff", heroB: "#fff", on: "#fff" };
    },
    css: ({ plan }) => `header.site{background:var(--bg);border-color:var(--acc)}header.site:not(.side){border-top:6px solid var(--acc)}.brand{font-weight:700;text-transform:none;letter-spacing:0}.brand span{color:var(--acc)}
a{color:#1a0dab;text-decoration:underline}a:visited{color:#660099}nav.top a{color:#1a0dab}
.hero{background:none;animation:none;border:0;padding:24px 0 0}.hero h1{font-weight:400}.hero .art{width:min(180px,25%);border:1px solid var(--line);box-shadow:none}
section>h2{font-weight:400;border-bottom:1px solid var(--line);padding-bottom:.15em;color:var(--acc)}
.card,.band,.stat,.post,.infobox,details.faq{background:var(--panel);border:1px solid var(--line);border-radius:0;box-shadow:none}.card:hover{transform:none}
table{border:1px solid var(--line)}th,td{border:1px solid var(--line)}th{background:var(--panel);text-transform:none;letter-spacing:0;color:var(--fg);font-size:.95rem}tbody tr:nth-child(even) td{background:none}
.btn,.btn.ghost{background:none;color:#1a0dab;border:0;box-shadow:none;padding:0;text-decoration:underline;font-weight:400;font-family:inherit}.tag,.tag.hot{background:none;border:0;padding:0;color:var(--muted);text-transform:none;letter-spacing:0;font-family:inherit}
.thumb,.icon{display:none}.stat b{color:var(--fg);font-size:1.4rem}.av{display:none}
footer.site{background:none;border-top:1px solid var(--line)}footer.site .wrap::after{content:"Last modified: ${["March", "June", "October", "January"][plan.hue % 4]} ${3 + (plan.hue % 25)}, 2009 · webmaster@${String(plan.site).replace(/[^a-z0-9.-]/gi, "")}";width:100%;font-style:italic}`,
  },

  vintage: {
    about: "vintage letterpress or old-world establishment: cream paper, ornaments, double rules, slab and Caslon type, sepia",
    voice: "A vintage, letterpress-era establishment: formal, old-fashioned turns of phrase ('Est. 1921', 'purveyors of'). Tables of wares and prices, .card lineups, lists. No emoji.",
    mood: "paper", art: "full", mark: false,
    fonts: [["book", "copperplate"], ["serif", "superclarendon"], ["typewriter", "didone"], ["caslon", "caslon"], ["palatino", "copperplate"]],
    header: ["masthead", "center"], hero: ["center", "split"], sections: ["centered"],
    tokens: () => ({ fs: 17, lh: 1.6, rad: 0, bw: 1, shadow: "none", h1: "clamp(2.2rem,5.5vw,3.8rem)", hw: 700, pad: "18px 20px", gap: "22px", pill: "0" }),
    palette: (h, pick) => {
      const bg = pick("paper", [hsl(40, 45, 88), hsl(35, 35, 84), hsl(48, 40, 90)]);
      return { bg, panel: hsl(42, 50, 93), fg: hsl(20, 35, 15), muted: hsl(25, 20, 35), line: hsl(20, 35, 25), acc: pick("acc", [hsl(h, 45, 32), hsl(5, 60, 36), hsl(150, 35, 25)]), acc2: hsl(20, 35, 15), heroA: bg, heroB: bg, on: hsl(42, 50, 93) };
    },
    css: ({ pick }) => `body{background-image:radial-gradient(hsla(30,40%,30%,.07) 1px,transparent 1.3px);background-size:5px 5px}
header.site{background:var(--bg);border-bottom:4px double var(--line);position:static}.brand{text-transform:uppercase;letter-spacing:.12em}.brand span{color:var(--acc)}.brand .mark{display:none}
.hero{background:none;animation:none;border:0}.hero .wrap{border:4px double var(--line);padding:30px;margin-top:24px}.hero h1{text-transform:uppercase;letter-spacing:.06em}
.hero .art,img.pic{filter:sepia(.7) contrast(1.05);border:1px solid var(--line);box-shadow:none}
section>h2::before{content:"${pick("orn", ["❦ ", "✦ ", "— "])}";color:var(--acc)}section>h2::after{content:"${pick("orn2", [" ❦", " ✦", " —"])}";color:var(--acc)}section>h2{text-transform:uppercase;letter-spacing:.1em}
.card{border:3px double var(--line);text-align:center;background:var(--panel)}.card:hover{transform:none}.band,.callout,.infobox{border:1px solid var(--line);border-radius:0;background:var(--panel)}
.btn{background:var(--fg);color:var(--bg);border-radius:0;text-transform:uppercase;letter-spacing:.14em;font-size:.8rem}.btn.ghost{background:none;color:var(--fg);border:1px solid var(--fg)}
.tag{border-radius:0;border-color:var(--line);color:var(--fg);background:none;font-family:var(--head)}th{border-bottom:3px double var(--line);color:var(--fg)}tbody tr:nth-child(even) td{background:none}
.thumb{animation:none;filter:sepia(.8)}hr{border-top:3px double var(--line)}footer.site{background:none;border-top:4px double var(--line);text-align:center}`,
  },

  devtool: {
    about: "a restrained modern dark developer-tool interface: near-black, hairline borders, small precise type, subtle glow",
    voice: "A crisp developer-tool site: precise and understated. code, kbd, tables, ol.steps, .stat metrics and small feature .card items; emoji sparingly.",
    mood: "dark", art: "full", mark: true,
    fonts: [["sans", "sans"], ["sans", "mono"], ["grot", "grot"], ["helvetica", "helvetica"]],
    header: ["bar", "pill", "sidebar"], hero: ["center", "split"], sections: ["numbered", "stack", "ledger"],
    tokens: (pick) => ({ fs: 15, lh: 1.6, rad: pick("rad", [6, 8, 10]), bw: 1, h1: "clamp(2.2rem,5vw,3.6rem)", hw: 600, htrack: "-.03em", maxw: 1080, pad: "18px 20px", gap: "12px", pill: "999px" }),
    palette: (h) => ({ bg: hsl(h, 12, 5), panel: hsl(h, 10, 8), fg: hsl(h, 10, 93), muted: hsl(h, 8, 58), line: hsl(h, 10, 16), acc: hsl(h, 85, 66), acc2: hsl(h + 40, 80, 62), heroA: hsl(h, 40, 12), heroB: hsl(h + 55, 45, 9), on: "#0b0b0b" }),
    css: ({ h }) => `:root{--shadow:none}body{background-image:radial-gradient(1000px 500px at 50% -10%,${hsl(h, 70, 50, 0.14)},transparent 70%)}
header.site{background:${hsl(h, 12, 5, 0.8)};backdrop-filter:blur(10px)}.hero{background:none;animation:none;border-bottom:1px solid var(--line);padding:70px 0 56px}
.hero h1{background:linear-gradient(180deg,var(--fg),${hsl(h, 10, 55)});-webkit-background-clip:text;background-clip:text;color:transparent}.hero .art{border-color:var(--line);box-shadow:0 0 0 1px var(--line),0 30px 60px -30px ${hsl(h, 80, 50, 0.4)}}
.card{background:linear-gradient(180deg,${hsl(h, 10, 9)},${hsl(h, 10, 7)})}.card:hover{transform:none;border-color:${hsl(h, 20, 30)}}
.btn{background:var(--fg);color:var(--bg);font-weight:500}.btn.ghost{background:none;color:var(--fg);border:1px solid var(--line)}.tag{border-radius:6px;text-transform:none;letter-spacing:0;font-family:var(--mono)}
section>h2{font-weight:600}.stat b{color:var(--fg);font-weight:600}th{font-family:var(--mono);font-weight:400}`,
  },
};

// A forum package name for phpbb-style footers (seeded by hue, so stable).
function pickForum(h) { return ["phpBB®", "vBulletin®", "Invision Board", "SMF 1.1"][h % 4]; }

// The styles each kind usually suits: the fallback when Jev is unavailable,
// and a prior on Jev's ratings (a wiki *could* be a phpBB board, but rarely is).
export const KIND_STYLES = {
  forum: ["phpbb", "web2", "classifieds", "devtool", "minimal", "cyber", "retroos", "terminal", "brutalist", "web1996"],
  store: ["saas", "luxury", "vintage", "playful", "brutalist", "web2", "minimal", "bento", "scrapbook", "swiss", "corporate"],
  wiki: ["academic", "minimal", "web1996", "terminal", "vintage", "editorial", "swiss", "classifieds", "retroos"],
  blog: ["minimal", "editorial", "scrapbook", "web1996", "terminal", "swiss", "brutalist", "vintage", "playful", "devtool"],
  news: ["newsprint", "editorial", "swiss", "classifieds", "corporate", "brutalist", "minimal", "web2"],
  startup: ["saas", "devtool", "bento", "brutalist", "swiss", "playful", "corporate", "cyber", "web2", "retroos"],
  gov: ["civic", "corporate", "web1996", "academic", "swiss", "minimal", "classifieds"],
  zine: ["brutalist", "scrapbook", "retroos", "cyber", "web1996", "terminal", "swiss", "editorial", "playful"],
};
const OFF_KIND = 0.7;

export const STYLE_KEYS = Object.keys(STYLES);

// FNV-1a with a murmur3 finaliser: similar domains (shop1, shop2) must not
// land on neighbouring choices.
function fnv(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// A seeded chooser for one site: pick(salt, options) always returns the same
// option for the same site and salt.
export const siteChooser = (site, style) => (salt, options) => options[fnv(`${site}|${style}|${salt}`) % options.length];

// Choose a style from Jev's plausibility ratings, discounted for styles the
// kind rarely wears. Anything close to the best score is a candidate,
// weighted towards the likelier ones, and the domain decides — so the same
// site always gets the same style, but forums don't all become phpBB boards.
export function pickStyle(site, ratings = {}, kind = "blog") {
  const usual = new Set(KIND_STYLES[kind] ?? KIND_STYLES.blog);
  const rated = STYLE_KEYS.map((k) => [k, Number(ratings[k]) * (usual.has(k) ? 1 : OFF_KIND)]).filter(([, p]) => Number.isFinite(p));
  if (!rated.length) return defaultStyle(kind, site);
  const top = Math.max(...rated.map(([, p]) => p));
  const pool = rated.filter(([, p]) => p >= top - 0.3).map(([k, p]) => [k, p ** 2]);
  const total = pool.reduce((sum, [, w]) => sum + w, 0);
  let x = (fnv(`${site}|style`) / 2 ** 32) * total;
  for (const [k, w] of pool) if ((x -= w) < 0) return k;
  return pool[pool.length - 1][0];
}

export function defaultStyle(kind, site) {
  const pool = KIND_STYLES[kind] ?? KIND_STYLES.blog;
  return pool[fnv(`${site}|style`) % pool.length];
}

// What the section writers are told about the site's look.
export function styleVoice(style) {
  const s = STYLES[style];
  return s ? `${s.about}. ${s.voice}` : "";
}
