# Notes for agents

Foogle is a silly project that recreates Google, but all of the results are AI generated.  A model invents the results, and clicking one generates that page on the spot.

The purpose is to push real time AI artifact generation to its limits and see how well we can replicate Google's UX via AI generation. This also mean's Google's speed is important. So is the realism and diversity of its results and webpages.  

README.md explains how it works. The code is plain ESM for Node 20.12+, with no build step. `server.js` holds the routes, `lib/` everything else, `public/fw/` the widget runtime for generated pages, and `test/` the node:test suite.

## Verifying a change

Verify with a fake model first, and use a real one only when you have to.

- **Layout, UI or interactivity changes.** This covers the theme and styles, widgets, the results pages, routes and forms. Run `npm test`, then `npm run shots`. The shots run uses the fake model (`FOOGLE_FAKE_LLM`), so it is free and takes about 15 seconds. Look at `.shots/contact.png`, then the full PNGs for the pages you touched. Read the warnings it prints (page errors, console errors, horizontal overflow, intercepted clicks). Narrow a run with `--only "store|cart"`.
- **Interactive flows.** Don't drive a browser click by click to check one. Add the flow as scripted `steps` on a page in `PAGES` in `scripts/shots.js` (click, fill, select, check, press, wait, url), the way the cart and checkout pages do.
- **Changes to what the model writes** (prompts, briefs, hints, image briefs). Only these need the live model, and even then keep it to a handful of pages: `npm run shots -- --live --only "forum|wiki"`. To iterate on the same pages repeatedly, record them once and replay them for free:
  1. Record: `FOOGLE_LLM_CACHE=record npm start -- --port 0`
  2. Replay: `FOOGLE_LLM_CACHE=replay npm start -- --port 0`
- **New model calls or prompts.** A new call needs a fixture in `lib/fake-fixtures.js`. Until it has one, fake mode throws "no canned output". `test/fake-llm.test.js` checks each prompt's canned format.
- **CI.** CI runs `npm test` on Node 20 and 22, with no API keys and no Playwright browsers. Keep the screenshot script out of `npm test`.

## Sharing the machine

Other agents may be running Foogle servers, tests and browsers on this machine at the same time.

- **Ports.** Start servers on a free port, never the default 3000. `npm start -- --port 0` prints the port it got, and `npm run shots` picks one itself.
- **Processes.** Never stop a process you didn't start: no `pkill`/`killall` by name, and don't kill whatever holds a port. Stop your own servers by their PID when you're done.
- **Scratch files.** Put them in a fresh temp directory (`mktemp -d`), not in shared paths.
