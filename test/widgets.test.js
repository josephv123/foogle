import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sanitizeSection, widgetHint, widgetHead, PAGE_CSP, THEME_INLINE_HANDLERS } from "../lib/widgets.js";
import { pageSectionPrompt } from "../lib/prompts.js";
import { generatePage } from "../lib/pages.js";
import { planFromAnswers, questions } from "../lib/jev.js";
import { themeCSS, themeHeader, themeFooter } from "../lib/theme.js";
import { STYLE_KEYS } from "../lib/styles.js";

test("model HTML cannot run code: scripts go inert, handlers and script URLs are dropped", () => {
  const out = sanitizeSection(`<section><script>steal()</script><img src="/img/x" onerror="steal()"><a href="javascript:steal()">a</a><a href=" jav&#x61;script:steal()">b</a><iframe srcdoc="<b>"></iframe><style>body{}</style><button onclick='x()' data-add-to-cart data-price="4">Add</button><form action="data:text/html,x"><input formaction="javascript:x"></form></section>`);
  assert.doesNotMatch(out, /<script|<iframe|<style|onerror|onclick|javascript|srcdoc|data:text/i);
  assert.match(out, /<template>steal\(\)<\/template>/);
  assert.match(out, /<img src="\/img\/x">/);
  assert.match(out, /<button data-add-to-cart data-price="4">Add<\/button>/);
});

test("absolute links stay on the fake web; pictures never load off-site", () => {
  assert.equal(sanitizeSection('<a href="https://tentworks.example/guides/pitching?x=1">g</a>'), '<a href="/web/tentworks.example/guides/pitching?x=1">g</a>');
  assert.equal(sanitizeSection('<form action="https://shop.example/checkout" method="post">'), '<form action="/web/shop.example/checkout" method="post">');
  assert.equal(sanitizeSection('<img src="https://cdn.example/a.png" alt="a">'), '<img alt="a">');
  assert.equal(sanitizeSection('<a href="mailto:hi@shop.example">m</a>'), '<a href="mailto:hi@shop.example">m</a>');
  // untouched markup is returned byte for byte
  const plain = '<div class="grid" data-filter><div class="card" data-tags="solo light"><output data-formula="a>b?1:0">0</output></div></div>';
  assert.equal(sanitizeSection(plain), plain);
});

test("a data-* tag missing its '>' is repaired", () => {
  assert.equal(sanitizeSection("<div data-q><button data-correct Sound the fog signal</button></div>"), "<div data-q><button data-correct>Sound the fog signal</button></div>");
  assert.equal(sanitizeSection('<a href="/web/x/y" class="btn">Buy</a>'), '<a href="/web/x/y" class="btn">Buy</a>');
});

test("sanitizing is stable as a section streams in, so sent offsets stay valid", () => {
  const html = `<section><h2 onclick="x()">Tents</h2><div class="grid" data-filter><div class="card"><a href="https://a.example/p">p</a><script>bad()</script><button data-add-to-cart data-name="Ridge 1" data-price="349">Add to cart</button></div></div><p>done</p></section>`;
  const full = sanitizeSection(html);
  for (let i = 1; i <= html.length; i++) {
    if (html[i - 1] !== ">") continue; // streamed text is only ever cut after a whole tag
    assert.ok(full.startsWith(sanitizeSection(html.slice(0, i))), `prefix ${i}`);
  }
});

test("every inline handler the theme writes is allowed by the page CSP, and nothing else is", () => {
  const allowed = new Set(THEME_INLINE_HANDLERS.map((h) => `'sha256-${createHash("sha256").update(h).digest("base64")}'`));
  for (const kind of Object.keys(questions.kind.criteria)) {
    for (const style of STYLE_KEYS) {
      const plan = planFromAnswers({ url: `https://${kind}-${style}.example/page`, title: "A page", snippet: "About it" }, { kind: { choice: kind }, style: { choice: style } });
      const html = themeCSS(plan) + themeHeader(plan, "x.example", { art: true }) + themeFooter(plan, "x.example");
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i, "the theme writes no inline scripts");
      for (const [, , code] of html.matchAll(/\son(\w+)="([^"]*)"/g)) {
        const h = `'sha256-${createHash("sha256").update(code.replaceAll("&quot;", '"').replaceAll("&amp;", "&")).digest("base64")}'`;
        assert.ok(allowed.has(h) && PAGE_CSP.includes(h), `theme handler not in THEME_INLINE_HANDLERS: ${code}`);
      }
    }
  }
  assert.match(PAGE_CSP, /script-src 'self'/);
  assert.doesNotMatch(PAGE_CSP, /unsafe-inline'[^;]*;.*script|script-src[^;]*unsafe-inline|unsafe-eval/);
});

test("a page's purpose is built once, in the first section; kind hints follow the brief", () => {
  const url = "https://sunledger.io/savings-calculator";
  assert.match(widgetHint({ kind: "startup", url, title: "Solar Savings Calculator", index: 0 }), /this section must be a working <form data-calc>/);
  const later = widgetHint({ kind: "startup", url, title: "Solar Savings Calculator", index: 3, brief: "Pricing: a .grid of 3 plan .card items" });
  assert.match(later, /already in the first section/);
  assert.doesNotMatch(later, /data-calc/); // no second calculator from the pricing hint
  assert.match(widgetHint({ kind: "store", brief: "Featured products: a .grid of 3 .card items with .price" }), /Add to cart/);
  assert.match(widgetHint({ kind: "forum", brief: "Related threads as a table (thread, replies, last post)" }), /data-comments/);
  assert.equal(widgetHint({ kind: "store", url: "https://x.example/notebook-covers", brief: "Something else" }), "");
});

test("section writers get the component vocabulary for their own domain", () => {
  const plan = planFromAnswers({ url: "https://tentworks.example/tents", title: "Tents" }, { kind: { choice: "store" }, mood: { choice: "light" } });
  const spec = pageSectionPrompt({ plan, domain: "tentworks.example", url: "https://tentworks.example/tents", brief: plan.secs[1], index: 1, total: 4 });
  assert.match(spec.system, /data-add-to-cart/);
  assert.match(spec.system, /action="\/web\/tentworks\.example\/PATH"/);
  assert.match(spec.system, /never JavaScript/);
  assert.match(spec.user, /Interactivity: Make it shoppable/);
});

test("pages load the runtime and stream sanitized sections", async () => {
  const plan = planFromAnswers({ url: "https://garden.example/repairs", title: "Repairs" }, { kind: { choice: "forum" }, mood: { choice: "light" } });
  const chunks = [];
  for await (const c of generatePage({ url: "https://garden.example/repairs" }, { looks: new Map(), facts: async function* () {}, planWithJev: async () => ({ ...plan, secs: plan.secs.slice(0, 1) }), complete: async () => '<section><h2>Hi</h2><p onmouseover="x()">ok</p><script>x()</script></section>' })) chunks.push(c);
  const html = chunks.join("");
  assert.ok(chunks[0].includes(widgetHead()));
  assert.match(widgetHead(), /<script src="\/fw\/widgets\.js\?v=\w+" async><\/script>/);
  assert.match(html, /<p>ok<\/p><template>x\(\)<\/template>/);
  assert.doesNotMatch(html, /onmouseover/);
});
