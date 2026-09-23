import test from "node:test";
import assert from "node:assert/strict";
import { displayURL, omniboxTarget, tabTitle, browserBar } from "../lib/browserbar.js";

test("the bar shows a fake site's own URL, not Foogle's /web/ path", () => {
  const cases = [
    ["/web/crumbforum.net/threads/starter-smells", "https://crumbforum.net/threads/starter-smells"],
    // Foogle's result context rides along in the query string; it isn't the site's.
    ["/web/crumbforum.net/threads/starter-smells?fq=sourdough&ft=Starter%20smells&fs=Why&fk=forum", "https://crumbforum.net/threads/starter-smells"],
    ["/web/crumbforum.net", "https://crumbforum.net/"],
    ["/web/crumbforum.net/", "https://crumbforum.net/"],
    ["/web/Shop.Example/search?q=red+lamps&fq=lamps", "https://shop.example/search?q=red+lamps"],
    // A confirmation page after a form, and a GET form's own query.
    ["/web/garden.example/checkout?order=4821", "https://garden.example/checkout?order=4821"],
    ["/web/garden.example/search?fq=x&q=glass+panes&sort=new", "https://garden.example/search?q=glass+panes&sort=new"],
    // UTF-8 reads as text; escaped ASCII keeps its meaning.
    ["/web/caf%C3%A9.example/men%C3%BC?x=a%26b%20c", "https://café.example/menü?x=a%26b%20c"],
    ["/web/x.example/a%2Fb", "https://x.example/a%2Fb"],
    ["/web/localhost:8080/admin", "https://localhost:8080/admin"],
    // Foogle's own pages are on www.foogle.com.
    ["/", "https://www.foogle.com/"],
    ["/search?q=starter+smells", "https://www.foogle.com/search?q=starter+smells"],
    ["/search?q=starter+smells&page=2", "https://www.foogle.com/search?q=starter+smells&page=2"],
    ["/images?q=caf%C3%A9", "https://www.foogle.com/images?q=café"],
    ["/timelines?q=moon", "https://www.foogle.com/timelines?q=moon"],
  ];
  for (const [path, url] of cases) assert.equal(displayURL(path), url, path);
});

test("typing a URL goes to that site; anything else is a Foogle search", () => {
  const go = (text, here) => omniboxTarget(text, { here });
  // URLs, with or without a scheme.
  assert.equal(go("example.com/foo"), "/web/example.com/foo");
  assert.equal(go("https://example.com/foo"), "/web/example.com/foo");
  assert.equal(go("http://Example.COM/Foo?x=1#top"), "/web/example.com/Foo?x=1#top");
  assert.equal(go("  crumbforum.net/threads/starter-smells  "), "/web/crumbforum.net/threads/starter-smells");
  assert.equal(go("crumbforum.net/"), "/web/crumbforum.net");
  assert.equal(go("www.moon-base.jobs"), "/web/www.moon-base.jobs");
  assert.equal(go("shop.example?q=lamps"), "/web/shop.example?q=lamps");
  assert.equal(go("localhost:8080/admin"), "/web/localhost:8080/admin");
  assert.equal(go("192.168.1.20"), "/web/192.168.1.20");
  assert.equal(go("https://intranet"), "/web/intranet");
  assert.equal(go("readme.md/install"), "/web/readme.md/install");
  // What the bar itself shows goes back to the same page.
  assert.equal(go(displayURL("/web/crumbforum.net/threads/starter-smells?fq=a")), "/web/crumbforum.net/threads/starter-smells");
  // Foogle's own addresses, and links copied from this Foogle, stay on Foogle.
  assert.equal(go("https://www.foogle.com/search?q=bread"), "/search?q=bread");
  assert.equal(go("foogle.com"), "/");
  assert.equal(go("http://192.168.1.5:3020/web/crumbforum.net/x?fq=a", "192.168.1.5:3020"), "/web/crumbforum.net/x?fq=a");
  assert.equal(go("localhost:3000/images?q=cats", "localhost:3000"), "/images?q=cats");
  assert.equal(go("/web/crumbforum.net/threads"), "/web/crumbforum.net/threads");
  // Searches.
  assert.equal(go("starter smells"), "/search?q=starter+smells");
  assert.equal(go("sourdough"), "/search?q=sourdough");
  assert.equal(go("what is 2+2?"), "/search?q=what+is+2%2B2%3F");
  assert.equal(go("3.14"), "/search?q=3.14");
  assert.equal(go("node.js"), "/search?q=node.js");
  assert.equal(go("notes.TXT"), "/search?q=notes.TXT");
  assert.equal(go("e.g."), "/search?q=e.g.");
  assert.equal(go("ada@garden.example"), "/search?q=ada%40garden.example");
  assert.equal(go("example.com/a b"), "/search?q=example.com%2Fa+b");
  assert.equal(go("? example.com"), "/search?q=example.com");
  assert.equal(go("javascript:alert(1)"), "/search?q=javascript%3Aalert%281%29");
  assert.equal(go("ftp://files.example"), "/search?q=ftp%3A%2F%2Ffiles.example");
  assert.equal(go("   "), "/");
  assert.equal(go(undefined), "/");
});

test("the address bar only ever sends the visitor somewhere on Foogle", () => {
  for (const text of ["//evil.example/x", "/\\evil.example", "https://localhost:3000//evil.example", "https://evil.example", "\\\\evil.example", "/x\r\nSet-Cookie: a=b"]) {
    const target = omniboxTarget(text, { here: "localhost:3000" });
    assert.match(target, /^\/(?![/\\])/, text);
    assert.doesNotMatch(target, /[\s\\]/, text);
  }
});

test("the tab reads like a browser's until the page's title arrives", () => {
  assert.equal(tabTitle("/web/crumbforum.net/threads/x?fq=bread&ft=Starter%20smells"), "Starter smells");
  assert.equal(tabTitle("/web/crumbforum.net/threads/x"), "crumbforum.net/threads/x");
  assert.equal(tabTitle("/web/crumbforum.net"), "crumbforum.net");
  assert.equal(tabTitle("/search?q=starter+smells"), "starter smells - Foogle Search");
  assert.equal(tabTitle("/images?q=cats"), "cats - Foogle Images");
  assert.equal(tabTitle("/"), "Foogle");
});

test("the bar is drawn in a page's first bytes, safe under the pages' CSP, and can be turned off", (t) => {
  const req = { originalUrl: '/web/crumbforum.net/threads/x?fq=a&ft=%3Cb%3E"hi"&fk=forum' };
  const html = browserBar(req, { loading: true });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<foogle-bar loading data-site><template shadowrootmode="open"><style>/);
  assert.match(html, /<input name="q" value="https:\/\/crumbforum\.net\/threads\/x"/);
  assert.match(html, /<span class="h">crumbforum\.net<\/span><span class="p" data-path="\/threads\/x">\/threads\/x<\/span>/);
  assert.match(html, /<span class="title">&lt;b&gt;&quot;hi&quot;<\/span>/); // the result title, escaped
  assert.match(html, /<form class="omni" action="\/go" method="get">/);
  assert.match(html, /<img class="fav" src="data:image\/svg\+xml,/);
  // /web/ pages only run Foogle's own script files: nothing inline.
  assert.match(html, /<script src="\/fw\/browserbar\.js\?v=\w{8}" async><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  // The page's own <title> must be the document's first.
  assert.doesNotMatch(html, /<title/);
  assert.match(browserBar({ originalUrl: "/" }), /<foogle-bar><template/);

  const was = process.env.FOOGLE_BROWSER_BAR;
  t.after(() => { if (was === undefined) delete process.env.FOOGLE_BROWSER_BAR; else process.env.FOOGLE_BROWSER_BAR = was; });
  process.env.FOOGLE_BROWSER_BAR = "0";
  assert.equal(browserBar(req), "");
});
