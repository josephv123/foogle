// A browser around Foogle's pages, so the fake web reads like the real one:
// tabs, back / forward / reload, and an address bar showing the URL a real
// browser would (https://crumbforum.net/threads/starter-smells for
// /web/crumbforum.net/threads/starter-smells, https://www.foogle.com/search?q=…
// for Foogle's own pages).
//
// Every top-level visit to a Foogle page gets this browser, a small shell
// page sent at once; each tab is an iframe showing the page itself, which the
// server serves exactly as it would without the browser. A background tab
// keeps what it loaded, and no page can cover the bar. The shell's script is
// public/fw/browserbar.js; the address logic it shares with the server is
// public/fw/browsing.js. FOOGLE_BROWSER_BAR=0 turns the whole thing off.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Router } from "express";
import { siteMark } from "./icons.js";
import { siteLook } from "./pages.js";
import { knownSite, learnedSite, siteForQuery, sitesStartingWith } from "./brands.js";
import { brandFaviconSVG, siteResult } from "./brandtheme.js";
import { addressOf, displayURL, isHome, tabTitle, classify, omniboxTarget, svgImage, FOOGLE_ICON } from "../public/fw/browsing.js";

export { addressOf, displayURL, isHome, tabTitle, omniboxTarget, classify, primaryRows } from "../public/fw/browsing.js";
export const barEnabled = () => process.env.FOOGLE_BROWSER_BAR !== "0";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A site's favicon is its logo mark (lib/icons.js), the one its search result
// and its own header show. Once the site has a look, that fixes the mark;
// before, the result kind the visitor clicked usually does. The script asks
// again (/api/favicon) once a tab's page has loaded.
function faviconSVG(url) {
  const { host } = addressOf(url);
  const domain = host.replace(/:\d+$/, "");
  // A real, known site shows its own mark (lib/brandtheme.js).
  const known = knownSite(domain) ?? learnedSite(domain);
  if (known) return brandFaviconSVG(known);
  const look = siteLook(domain);
  const kind = new URL(url, "http://foogle.invalid").searchParams.get("fk");
  return siteMark(domain, look ? { kind: look.mark || look.kind, hue: look.hue } : { kind });
}
const favicon = (url) => (addressOf(url).site ? svgImage(faviconSVG(url)) : FOOGLE_ICON);

// Known sites (lib/brands.js) that what's typed in the address bar names, as
// suggestion rows (see public/fw/browsing.js): "cnn" -> cnn.com, "reddit
// sourdough" -> its subreddit, and as the text grows, "red" -> reddit.com. A
// URL goes where it says, and "apple pie" is about pie.
export function siteSuggestions(input) {
  const text = String(input ?? "").trim();
  if (classify(text).kind !== "search") return [];
  const named = siteForQuery(text);
  const pages = [
    ...(named ? [siteResult(named).url] : []),
    ...sitesStartingWith(text).map((site) => `https://${site.host}/`),
  ];
  return [...new Set(pages)].slice(0, 3).map((href) => {
    const u = new URL(href);
    const path = `${u.pathname === "/" ? "" : u.pathname}${u.search}`;
    const label = `${u.host.replace(/^www\./, "")}${path.replace(/\/$/, "")}`;
    return { kind: "site", label, detail: knownSite(u.host)?.name ?? "", fill: label, target: `/web/${u.host}${path}` };
  });
}

// ---------- markup ----------
const icon = (d, cls = "") => `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ICONS = {
  back: icon("M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"),
  forward: icon("M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"),
  reload: icon("M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z", "go"),
  stop: icon("M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z", "stop"),
  lock: icon("M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 0 1 6 0v2H9V6zm3 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4z", "l"),
  search: icon("M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z", "q"),
  close: icon("M18.3 5.71 16.89 4.3 12 9.17 7.11 4.3 5.7 5.71 10.59 10.6 5.7 15.49l1.41 1.41L12 12.01l4.89 4.89 1.41-1.41-4.89-4.89z"),
  plus: icon("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"),
};

// The address, split so the host can stand out (and stand alone on a phone).
// The homepage is the new-tab page, whose address bar is empty.
function addressParts({ host, path }, home) {
  if (home) return `<span class="s"></span><span class="w"></span><span class="h"></span><span class="p"></span>`;
  const www = host.startsWith("www.") ? "www." : "";
  return `<span class="s">https://</span><span class="w">${www}</span><span class="h">${esc(host.slice(www.length))}</span><span class="p">${path === "/" ? "" : esc(path)}</span>`;
}

const asset = (file) => readFileSync(new URL(`../public/fw/${file}`, import.meta.url), "utf8");
// Inlined rather than linked, so the browser is styled in the same bytes
// that draw it. Comments and runs of whitespace aren't worth sending.
const CSS = asset("browserbar.css").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
const version = createHash("sha1").update(asset("browserbar.js")).update(asset("browsing.js")).digest("hex").slice(0, 8);

export const SHELL_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "frame-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// The browser for a top-level visit to `req`'s page: one tab, showing that
// page. The script restores any other tabs this browser tab had open.
export function browserShell(req) {
  const url = req.originalUrl ?? req.url;
  const address = addressOf(url);
  const title = tabTitle(url);
  const fav = esc(favicon(url));
  const home = isHome(url);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><link rel="icon" href="${fav}"><style>${CSS}</style><script type="module" src="/fw/browserbar.js?v=${version}"></script></head>
<body><div class="browser loading${home ? " home" : ""}">
<div class="tabs" role="tablist"><div class="tab on loading" role="tab" aria-selected="true" title="${esc(title)}"><span class="ico"><img class="fav" src="${fav}" alt=""><i class="spin"></i></span><span class="title">${esc(title)}</span><button class="x" type="button" aria-label="Close tab" title="Close tab">${ICONS.close}</button></div><button class="new" type="button" aria-label="New tab" title="New tab">${ICONS.plus}</button></div>
<div class="tool"><button class="btn back" type="button" aria-label="Back" title="Back" disabled>${ICONS.back}</button><button class="btn fwd" type="button" aria-label="Forward" title="Forward" disabled>${ICONS.forward}</button><button class="btn reload" type="button" aria-label="Reload" title="Reload this page">${ICONS.reload}${ICONS.stop}</button>
<form class="omni" action="/go" method="get"><button class="lock" type="button" popovertarget="site-info" aria-label="View site information" title="View site information">${ICONS.lock}${ICONS.search}</button><label class="field"><input name="q" value="${home ? "" : esc(displayURL(url))}" placeholder="Search Foogle or type a URL" aria-label="Address and search bar" aria-autocomplete="list" aria-controls="suggestions" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go"><span class="url" aria-hidden="true">${addressParts(address, home)}</span></label><div class="drop" id="suggestions" role="listbox" hidden></div></form>
<button class="btn count" type="button" aria-label="Show tabs (1)" title="Show tabs"><span>1</span></button></div>
<div class="switcher" hidden><div class="sw-head"><b>Tabs</b><button class="sw-new" type="button">${ICONS.plus}New tab</button><button class="sw-done" type="button">Done</button></div><div class="sw-grid"></div></div>
<div class="pop" id="site-info" popover><div class="pop-h">${ICONS.lock}<b>Connection is secure</b></div><p>Your information (for example, passwords or credit card numbers) is private when it is sent to this site.</p><p class="cert">Certificate issued to <b class="cert-host">${esc(address.host)}</b> by Foogle Trust Services · valid until 2089</p></div>
</div>
<main class="views"><iframe class="on" src="${esc(url)}" title="${esc(title)}"></iframe></main>
</body></html>`;
}

// ---------- routes ----------
// Foogle's pages, as a browser's address bar would visit them.
const PAGES = ["/", "/search", "/images", "/news", "/maps", "/timelines", /^\/web\//];

export function browserBarRoutes() {
  const router = Router();
  const one = (v) => String([].concat(v ?? "")[0]);
  // The address field without the script: a GET form.
  router.get("/go", (req, res) => res.redirect(omniboxTarget(one(req.query.q), { here: req.headers.host })));
  // For the script: known sites the typed text names, and a tab's favicon.
  router.get("/api/sites", (req, res) => res.json({ rows: siteSuggestions(one(req.query.q).slice(0, 200)) }));
  router.get("/api/favicon", (req, res) => {
    const url = one(req.query.url || "/");
    res.set({ "Content-Type": "image/svg+xml", "Cache-Control": "no-cache", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
    res.send(addressOf(url).site ? faviconSVG(url).replace(/^<svg (?!xmlns)/, '<svg xmlns="http://www.w3.org/2000/svg" ') : decodeURIComponent(FOOGLE_ICON.split(",")[1]));
  });
  // A top-level visit gets the browser; its tab's frame, fetches and anything
  // else get the page itself. The same URL answers both, so caches must keep
  // them apart.
  router.get(PAGES, (req, res, next) => {
    if (!barEnabled()) return next();
    res.vary("Sec-Fetch-Dest");
    if (req.get("sec-fetch-dest") !== "document") return next();
    res.set({ "Content-Security-Policy": SHELL_CSP, "Cache-Control": "no-cache" });
    res.type("html").send(browserShell(req));
  });
  return router;
}
