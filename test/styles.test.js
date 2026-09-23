import test from "node:test";
import assert from "node:assert/strict";
import { STYLES, STYLE_KEYS, KIND_STYLES, SECTION_LAYOUTS, pickStyle, defaultStyle, styleVoice } from "../lib/styles.js";
import { FONTS, normalizePlan, themeCSS, themeHeader, themeFooter, artColors, siteStyle } from "../lib/theme.js";
import { planFromAnswers, defaultPlan } from "../lib/jev.js";
import { pageSectionPrompt } from "../lib/prompts.js";

const KINDS = Object.keys(KIND_STYLES);
const sites = Array.from({ length: 60 }, (_, i) => `site${i}.example`);
// The /img endpoint only accepts plain colours (see CSS_COLOR in server.js).
const CSS_COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d.,% ]+\))$/i;

test("every style renders complete CSS, header and footer for every kind", () => {
  for (const style of STYLE_KEYS) {
    for (const kind of KINDS) {
      for (const site of sites.slice(0, 4)) {
        const plan = normalizePlan({ kind, style, site, hue: site.length * 53, title: "A page", tag: "A tagline" });
        const css = themeCSS(plan);
        assert.doesNotMatch(css, /undefined|NaN|\[object/, `${style}/${kind}/${site}`);
        assert.equal(css.split("{").length, css.split("}").length, `unbalanced braces in ${style}/${kind}`);
        const header = themeHeader(plan, site, { art: true });
        assert.match(header, new RegExp(`class="hero hero-${siteStyle(plan).hero}"`));
        assert.doesNotMatch(header + themeFooter(plan, site), /undefined/);
        const art = new URLSearchParams(artColors(plan));
        assert.match(art.get("bg"), CSS_COLOR, `${style} picture background`);
        assert.match(art.get("fg"), CSS_COLOR, `${style} picture accent`);
      }
    }
  }
});

test("styles only reference fonts, layouts and variants that exist", () => {
  for (const [key, s] of Object.entries(STYLES)) {
    for (const pair of s.fonts) for (const f of pair) assert.ok(FONTS[f], `${key} uses unknown font ${f}`);
    for (const l of s.sections) assert.ok(SECTION_LAYOUTS[l], `${key} uses unknown section layout ${l}`);
    for (const h of s.header) assert.ok(["stacked", "center", "masthead", "minimal", "pill", "sidebar", "bar"].includes(h), `${key} header ${h}`);
    for (const h of s.hero) assert.ok(["split", "center", "compact", "plain", "poster", "banner"].includes(h), `${key} hero ${h}`);
    assert.ok(["light", "dark", "paper", "neon", "brutal"].includes(s.mood), `${key} mood`);
    assert.ok(s.about && s.voice, `${key} needs an about and a voice`);
  }
  for (const list of Object.values(KIND_STYLES)) for (const k of list) assert.ok(STYLES[k], k);
});

test("a site keeps one look on every page; different styles look different", () => {
  const a = normalizePlan({ kind: "forum", style: "phpbb", site: "gearpit.org", hue: 40, title: "Best tent" });
  const b = normalizePlan({ kind: "forum", style: "phpbb", site: "gearpit.org", hue: 40, title: "Archive", tag: "Older threads" });
  assert.equal(themeCSS(a), themeCSS(b));
  const css = new Set(STYLE_KEYS.map((style) => themeCSS({ ...a, style })));
  assert.equal(css.size, STYLE_KEYS.length);
});

test("Jev's ratings choose a plausible style, seeded by the domain", () => {
  const ratings = { phpbb: 0.82, web2: 0.7, brutalist: 0.6, classifieds: 0.58, luxury: 0.2, civic: 0.15, swiss: 0.1 };
  const picks = sites.map((site) => pickStyle(site, ratings, "forum"));
  // Stable per domain.
  assert.deepEqual(picks, sites.map((site) => pickStyle(site, ratings, "forum")));
  // Only styles near the top rating, and more than one of them across sites.
  assert.ok(picks.every((p) => ["phpbb", "web2", "brutalist", "classifieds"].includes(p)), [...new Set(picks)].join());
  assert.ok(new Set(picks).size >= 3);
  // The likeliest style is the commonest.
  const count = (k) => picks.filter((p) => p === k).length;
  assert.ok(count("phpbb") > count("classifieds"));
  // A style the kind rarely wears is discounted: a wiki is not a phpBB board
  // just because Jev finds it vaguely plausible.
  const wikis = sites.map((site) => pickStyle(site, { phpbb: 0.72, academic: 0.72, minimal: 0.65 }, "wiki"));
  assert.ok(wikis.filter((p) => p === "phpbb").length < wikis.filter((p) => p === "academic").length / 2);
  assert.ok(sites.every((site) => pickStyle(site, { phpbb: 0.6, academic: 0.8 }, "wiki") === "academic"));
  // No ratings (Jev unavailable) falls back to the kind's usual styles.
  assert.equal(pickStyle("x.example", {}, "gov"), defaultStyle("gov", "x.example"));
  assert.ok(KIND_STYLES.gov.includes(defaultStyle("gov", "x.example")));
});

test("plans carry the style: from Jev's ratings, a remembered look, or the kind's defaults", () => {
  const url = "https://gearpit.org/threads/tents";
  const noul = (p) => ({ type: "noul", noul: p });
  const answers = { kind: { choice: "forum" }, ...Object.fromEntries(STYLE_KEYS.map((k) => [`style_${k}`, noul(k === "terminal" ? 0.95 : 0.05)])) };
  const plan = planFromAnswers({ url }, answers);
  assert.equal(plan.style, "terminal");
  assert.equal(plan.mood, STYLES.terminal.mood);
  assert.equal(planFromAnswers({ url }, { kind: { choice: "forum" }, style: { choice: "luxury" } }).style, "luxury");
  // Without Jev, forums on different domains still get different looks.
  const looks = new Set(sites.map((site) => { const p = defaultPlan({ url: `https://${site}/`, resultKind: "forum" }); return `${p.style}|${JSON.stringify(siteStyle(p))}`; }));
  assert.ok(looks.size >= 20, `only ${looks.size} distinct forum looks`);
  // An unknown style is replaced by one the kind suits.
  assert.ok(KIND_STYLES.store.includes(normalizePlan({ kind: "store", style: "nope", site: "a.example" }).style));
});

test("section briefs vary by page but are stable for a page", () => {
  const brief = (url) => planFromAnswers({ url }, { kind: { choice: "store" }, style: { choice: "saas" } }).secs.map((b) => b.replace(/\. Topic: .*/, "")).join("|");
  assert.equal(brief("https://a.example/mugs"), brief("https://a.example/mugs"));
  const seen = new Set(sites.map((s) => brief(`https://${s}/mugs`)));
  assert.ok(seen.size >= 3);
});

test("section writers are told the site's design voice", () => {
  const plan = normalizePlan({ kind: "forum", style: "classifieds", site: "a.example" });
  const { system } = pageSectionPrompt({ plan, domain: "a.example", url: "https://a.example/", brief: "b", index: 0, total: 4 });
  assert.ok(system.includes(styleVoice("classifieds")));
  assert.match(system, /No \.card grids/);
});

test("low-budget styles skip the hero picture", () => {
  const plan = normalizePlan({ kind: "gov", style: "civic", site: "permits.example", title: "Dog licenses" });
  assert.doesNotMatch(themeHeader(plan, "permits.example", { art: true }), /class="art"/);
  assert.match(themeHeader({ ...plan, style: "saas" }, "permits.example", { art: true }), /class="art"/);
});
