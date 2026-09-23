# Foogle model experiments — 2026-09-22

> Since these runs Foogle has been reduced to the winners — GPT-6 Luna, Jev layouts and SVG pictures. The presets, the `single`/`planned` page modes, local providers, other image modes and the benchmark script were removed; they are in git history (`7e5c8f6`).

GPT-6 Luna + Jev is the strongest price/speed candidate in this small screening run. It completed the test page in 5.25 seconds with a $0.0006169 OpenRouter charge. Gemini + Jev was similarly fast (5.46 seconds), at $0.00446025. Free Laguna produced a useful complete page but its search request was rate-limited. The launcher now defaults to Luna + Jev.

## What was built

- Provider presets for MiMo Flash/Pro, DeepSeek Flash, Gemini Flash, GPT-6 Luna and four free endpoints.
- Full-page, text-planned and Jev-planned page modes.
- Isolated model capability fallbacks, usage/latency capture, truncation detection, and rejection of invalid generated sections before caching.
- Repeatable benchmark scripts with raw HTML/text and JSON reports in `.foogle-bench/`.
- Automated tests covering provider fallback isolation, streaming usage, ordering, invalid fragments, Jev failures and the default Luna search-to-page flow.

## Page results

One fixed fictional greenhouse-repair prompt per model/mode. “First content” is server emission of styled HTML with visible content, not browser paint. In templated modes it includes the header before generated sections arrive. Costs below are provider-reported OpenRouter charges and exclude Jev.

| Preset | Mode | First content | Total | OpenRouter cost | Outcome |
|---|---|---:|---:|---:|---|
| mimo-flash | single | 52.21s | 92.96s | $0.0018385 | Model hit the output token limit |
| mimo-flash | jev | 0.55s | 28.36s | $0.0005838 | Complete; basic checks passed |
| mimo-pro | single | 52.78s | 144.63s | $0.0049096 | Complete; basic checks passed |
| mimo-pro | jev | 0.54s | 21.85s | $0.0017078 | Complete; basic checks passed |
| deepseek | single | 23.06s | 64.61s | $0.0017536 | Complete; basic checks passed |
| deepseek | jev | 0.49s | 32.01s | $0.0006495 | Complete; basic checks passed |
| gemini | single | 19.49s | 34.67s | $0.0145627 | Complete; basic checks passed |
| gemini | jev | 0.33s | 5.46s | $0.0044603 | Complete; basic checks passed |
| free-qwen | single | — | 0.73s | unknown | 429 Provider returned error |
| free-qwen | jev | 0.33s | 1.17s | unknown | 429 Provider returned error |
| free-laguna | single | 14.20s | 25.71s | $0.0000000 | Complete; basic checks passed |
| free-laguna | jev | 0.38s | 12.68s | $0.0000000 | Complete; basic checks passed |
| free-nemotron | single | 183.24s | 192.82s | $0.0000000 | Complete; basic checks passed |
| free-nemotron | jev | 0.36s | 84.79s | $0.0000000 | Section generation returned incomplete or invalid HTML |
| free-gemma | single | — | 0.69s | unknown | 429 Provider returned error |
| free-gemma | jev | 0.35s | 1.18s | unknown | 429 Provider returned error |
| gemini | planned | 2.59s | 87.02s | $0.0035467 | Section generation returned incomplete or invalid HTML |
| luna | single | 11.66s | 21.18s | $0.0017335 | Complete; basic checks passed |
| luna | planned | 2.23s | 5.87s | $0.0006982 | Complete; basic checks passed |
| luna | jev | 0.28s | 5.25s | $0.0006169 | Complete; basic checks passed |

## What Jev contributed

Luna is the useful control: full generation took 21.18s; a text-model planner plus templates took 5.87s; Jev plus the same template/parallel-section pipeline took 5.25s. The largest gain comes from reusing CSS and splitting content into bounded parallel calls. Jev reduced the planner-to-header delay from 2.23s to 0.28s in this run. This does not establish a statistically reliable 0.62s completion-time advantage.

The Gemini text-planner control emitted its shell in 2.59s but ultimately failed section validation after 87.02s. It is not a successful completion-time baseline. Some concurrent sections can differ in invented details; a shared outline or source facts would improve consistency.

Browser review of the Gemini full and hybrid outputs showed the expected tradeoff: full generation had a more bespoke article/sidebar design; the hybrid produced a simpler, readable shared layout. Luna passed structural checks; its new output was not visually reviewed because browser control became unavailable.

## Search results

| Preset | First valid result | Complete | Valid results | Outcome |
|---|---:|---:|---:|---|
| mimo-flash | 16.62s | 33.50s | 9 | OK |
| mimo-pro | 17.78s | 103.46s | 8 | OK |
| deepseek | 7.63s | 87.35s | 9 | OK |
| gemini | 2.27s | 9.39s | 9 | OK |
| free-qwen | — | 0.78s | 0 | 429 Provider returned error |
| free-laguna | — | 0.80s | 0 | 429 Provider returned error |
| free-nemotron | 4.59s | 31.86s | 9 | OK |
| free-gemma | — | 0.93s | 0 | 429 Provider returned error |
| gemini | 3.49s | 9.82s | 9 | OK |
| luna | 1.71s | 7.66s | 9 | OK |

Qwen and Gemma free trials returned 429s. A separate Gemma diagnostic identified an upstream shared-provider-pool rate limit, not insufficient OpenRouter credits. A tiny Gemma greeting succeeded, illustrating the variability. Free Nemotron completed full HTML slowly and its hybrid run returned an invalid section. These observations do not prove those endpoints are generally unusable.

## Reproduce and inspect

```sh
npm start -- --preset luna --mode jev --port 3010 --jev-env /path/to/jev/.env
npm run bench -- --presets luna --modes single,planned,jev --jev-env /path/to/jev/.env
npm test
```

- Primary results: `.foogle-bench/initial-comparison/report.json`
- Luna: `.foogle-bench/luna/report.json`
- Planner control: `.foogle-bench/planner-control/report.json`

## Measurement limits

One prompt and one run per model/mode; models were not sampled in randomized order. Some model suites ran concurrently (at most three); sections ran concurrently within a page. The first serial suite was interrupted during an in-flight MiMo Pro request and resumed without repeating recorded trials. Any charge for that interrupted request is outside the recorded cost totals. Provider load, routing, caches and mandatory reasoning can affect these numbers. Image generation and browser paint time are excluded. Structural checks do not measure aesthetic quality or factual correctness.

Fixed benchmark controls: 6,000 full-page output tokens, 1,200 per section, three sections; temperature requested at 1 for results and 0.7 for pages. Providers may ignore unsupported sampling controls. Reasoning is requested off with compatibility fallbacks; Gemini required low reasoning. This compares usable endpoint behavior, not identical internal computation.

## Images: ASCII vs colored ASCII vs pixel art vs SVG

Same six prompts (a hero, four subjects, the Maps-tab map) through GPT-6 Luna, one call per image. Script and galleries: `.foogle-bench/image-lab/`.

| Technique | Median | Output tokens | $/image | Result |
|---|---:|---:|---:|---|
| ASCII (old default) | 3.2s | ~240 | $0.00013 | Subjects often unreadable |
| ASCII, colored by glyph density | 3.2s | same | same | Barely helps; the drawing is the weak part |
| ASCII + inline color tags / color mask | 4.5s | — | — | Slightly nicer, still crude; masks drift out of alignment |
| 32×24 pixel art | 4.0s | — | — | Colorful, but small subjects unreadable; row widths drift |
| SVG, old brief (800×600, 15-40 elements) | 11s | ~1150 | $0.00060 | Best quality |
| SVG, lean brief (400×300, 10-25 elements) | 6.2s | ~660 | $0.00035 | Near-identical quality at half the time |

Hosted presets now draw lean SVGs (`--images ascii` restores the old art). On generated sites the site's `bg`/`fg` go into the prompt, so pictures are drawn in the page's palette and use its background as their backdrop; tested on neon, paper and light palettes. Single-letter `<text>` is allowed so map pins keep their A–F labels.

## Images: one house style → many media

Every picture used to get the same brief ("bold flat-vector, 4-6 colours, at most one gradient, 400x300, no text"), with no colour guidance off-site, so an Images grid came back as twelve 4:3 flat illustrations in the same warm beiges, and every picture on a site was tints of its accent. Now each picture has a **style** (22 media, each with its own SVG technique: gradients and blur for photos, `feTurbulence` grain and paper, `feDisplacementMap` rough edges for woodcuts, collage and watercolour, halftone `<pattern>`s, neon glow, crisp-edged pixel grids, UI chrome, chart axes) and a **shape** (1:1, 4:3, 16:9, 3:4, 2:3). Image search results name both; the grid lays them out in justified rows. A site picks one style from its kind and mood. News thumbnails are mostly photos, with the odd chart, map or scan. Media made of words (memes, charts, screenshots, blueprints, maps, diagrams) may use a few short labels. Photographic media get a light (golden hour, flash, night streetlights…) and flat-colour media a colour scheme, both picked per description, so a page doesn't converge on one palette. Before/after screenshots: `.foogle-bench/shots/`.

All 22 styles of one subject, GPT-6 Luna, 8 concurrent:

| Brief size target | Median | Mean SVG size | Notes |
|---|---:|---:|---|
| old flat brief (≈ `flat` style) | 5.0-6.4s | ~1300 chars | one look |
| 1600 chars | 7.8s | 2163 chars | |
| 1300 chars (shipped) | 7.0s | 1911 chars | text-heavy screenshots and charts are slowest (~8-11s) |

A whole Images page (12 pictures) finishes in about the same time as before; six Images pages at once (72 pictures through the 12 image slots) took 42-48s against 39-43s. Page generation doesn't change: on three fresh sites the styled header arrived after 0.22-0.29s and the page finished in 4.4-6.0s.

Things that broke and are now guarded: a model repeats an attribute (`fill="#333" … fill="none"`), or writes a bare `&` in a label, and the whole SVG renders blank (the sanitizer now dedupes attributes and escapes `&`); a frame drawn as a `<path>` without `fill="none"` blacks out the picture (the brief now says so); displacement filters leave ragged bare edges unless the background stays unfiltered.

## Pages: "Model hit the output token limit"

About 1 page in 16 lost a section to this error, and the visitor got the "collapsed mid-construction" toast. Measured on 47 fresh pages built from 56 real search results for 14 varied queries (every site kind, Jev picking the styles), with each section call's finish reason, usage and raw text recorded:

- Sections are not too long for their budget. By the time they close, sections take p50 ~400 output tokens and at most ~1,050, even with a calculator, quiz, form or tabs in them (interactive p50 ~510, plain p50 ~330), against `max_tokens` 1600. No reasoning tokens are spent (`reasoning: {enabled: false}` holds), and no section drew an inline SVG.
- Every truncated section had already closed. 8 of 188 sections (4%) kept writing after `</section>`: a thousand tokens of blank lines, a `<style>` block, or notes to itself ("But word count 134? fine…") followed by the whole section again. None of that reached the page, but the page waited for it (those sections took 6-13s instead of ~4s), and the 3 that ran to 1600 tokens failed the page.

Now a section is finished at its own closing tag: the page moves on, and the rest of the reply is read in the background only so its cost still reaches the daily budget (`onUsage`), with a token-limit error there ignored. A section that the limit still cuts off before it closes keeps its whole blocks and is closed there. That never happened naturally; with a forced 300-token limit, all 8 truncated sections were kept.

| Same 47 inputs, 4 pages at a time | Token-limit failures | Shell p50 | First section p50 | Page p50 | Page p90 | Page max |
|---|---:|---:|---:|---:|---:|---:|
| before | 3 (6.4%) | 0.22s | 1.01s | 6.7s | 8.7s | 14.3s |
| after | 0 | 0.19s | 1.00s | 6.3s | 7.9s | 10.5s |

In the "after" run, 10 sections ran on and 5 of them reached the limit, which would have failed 5 pages before. Page times are for pages that completed. The runs turned up one unrelated failure: twice in a row, the provider's stream died mid-section ("Stream ended before a terminal response event").

## Search suggestions: which model, and how fast — 2026-09-23

Suggestions under the search boxes (`lib/suggest.js`, `public/suggest.js`) had to feel instant: the target was suggestions for what's typed on screen within ~150ms of a pause, at p50. Measured from a laptop on home broadband; each "list" is one streamed call asking for 10 suggestions (16 for 1-2 characters), at a cost of ~350 tokens in and ~100 out.

**Models.** Ten prefixes ("cn", "how to m", "best ", "weather in", "am", "is it safe to", "mars colony j", "yout", "fl", "reddit "), same prompt, one call each, four models at a time. The times are from sending the request:

| Model (provider) | First token p50 / p90 | First line p50 | 8 lines p50 | All p50 | $ per list | Lines that continue the text |
|---|---:|---:|---:|---:|---:|---:|
| Llama 3.1 8B (Groq) | 143 / 169ms | 164ms | 214ms | 243ms | $0.000016 | 82% (27% on long text) |
| Llama 3.3 70B (Groq) | 180 / 207ms | 202ms | 419ms | 476ms | $0.000176 | 100% (80% on long text) |
| gpt-oss-120b, low reasoning (Cerebras) | 217 / 1616ms | 298ms | 309ms | 314ms | $0.000219 | 99%; one 429 in ten |
| gpt-oss-20b, low reasoning (Groq) | 324 / 523ms | 326ms | 426ms | 454ms | $0.000057 | 100%, but offers the typed text itself as a site ("cn \| cnn.com") |
| Ministral 3B | 353 / 1267ms | 374ms | 699ms | 904ms | $0.000020 | 96% |
| Gemini 3.1 Flash Lite | 561 / 841ms | 561ms | 787ms | 868ms | $0.000143 | 100% |
| GPT-6 Luna, fast tier | 538 / 677ms | 568ms | 817ms | 971ms | $0.000099 | 100% |
| GPT-6 Luna | 591 / 791ms | 641ms | 1022ms | 1224ms | $0.000050 | 100%, the best lists |
| Mercury 2.5 | 620 / 5757ms | 620ms | 620ms | 632ms | $0.000017 | 100%, but copied the prompt's example |
| Llama 3.1 8B (any provider) | 449 / 5757ms | 513ms | 1247ms | 1342ms | $0.000008 | 87% |
| Gemma 4 26B, Qwen 3.7 Flash, Ling 3.0 Flash, DeepSeek V4 Flash | 594–962ms | 773–1280ms | | 992–3169ms | $0.000005–0.000033 | 94–100% |

Only Groq's Llamas get under ~200ms. Jev (TypeSafe) answers in 180-270ms, but it returns typed judgments over options it's given (a choice among candidate completions, say); it can't write suggestions, so it would only add a second hop. Luna writes the best lists but its first token takes ~600ms. The 8B is fastest and cheapest, and fine on short text, but on long text it rewords what was typed ("weather in tokyo tomor" → "tokyo weather today"), leaving one or two usable lines; a second example in the prompt took it from 48% to 60% overall. So short text (under 12 characters) goes to the 8B and longer text to the 70B.

**End to end.** `scripts/suggest-latency.js` types 10 queries per round into the browser's own suggestion engine against a real server: 90-220ms a key (~75 wpm), a pause to read after a third of the words and at the end. "After a pause" is the time from the last key before the pause until suggestions for that text were there to show (a frame of rendering not included); "full list" until the dropdown had 5 rows or everything there was. Cold is the first visitor on a fresh server (which then writes the empty box and the 26 first letters for everyone, $0.0007 once), warm is different queries after that, and repeat the first queries again as a new visitor.

| Setup | Round | After a pause p50 / p90 | Full list p50 / p90 | Answered in the browser | Model calls per query | $ per query |
|---|---|---:|---:|---:|---:|---:|
| **Shipped: 8B under 12 characters, 70B from 12** | cold | **0 / 158ms** | 0 / 236ms | 75% of keys | 10.4 | $0.0014 |
| | warm | **0 / 102ms** | 0 / 233ms | 76% | 9.2 | $0.0009 |
| | repeat | 0 / 1ms | 0 / 1ms | 80% | 1.2 | $0.0002 |
| 8B only | cold | 0 / 63ms | 0 / 284ms | 80% | 11.1 | $0.0002 |
| | warm | 0 / 0ms | 0 / 183ms | 76% | 8.2 | $0.00013 |
| 70B only | cold | 0 / 149ms | 26 / 277ms | 74% | 12.8 | $0.0025 |
| | warm | 0 / 0ms | 0 / 392ms | 80% | 11.0 | $0.0021 |
| Shipped models, waiting up to 150ms for a shorter prefix's list in flight | cold | 0 / 190ms | 3 / 415ms | 66% | 7.9 | $0.0010 |
| 8B only, the same waiting | warm | 0 / 283ms | 0 / 336ms | 67% | 6.8 | $0.00014 |

What makes it fast is not the model so much as the browser: every list it fetches is kept, and the lists of shorter prefixes are filtered for the current text, so three keys in four have suggestions at once (a list for "cnn" answers "cnn " and "cnn l" while "cnn l"'s own list streams in). A request goes out only when those can't fill 5 rows, streams line by line, and is cancelled only if the text is edited so it no longer fits. On the server, lists go into an LRU shared by all visitors, and a request joins a generation already running for the same text. After a pause on a prefix the browser also prefetches the top suggestion's next letter (about one request in ten). Waiting on a list already in flight instead of asking for every key saved a quarter of the calls but made suggestions visibly slower, so it's off (`patience` in `createEngine`). The 70B makes long queries' lists full instead of one or two lines, at ~6 times the cost per query; `SUGGEST_LONG_AT=1000` runs the 8B everywhere.

**Cost and limits.** A typed query costs ~$0.001 of model calls, about a seventh of a search ($0.007), and nothing when someone has typed it before. Each generated list is charged to the visitor as `suggest` ($0.00003) or `suggestLong` ($0.00025) in `lib/limits.js`, so the default $0.10 burst covers ~70 typed queries on top of searching; lists from the cache are free. Over a limit, or over the day's budget, `/api/suggest` answers with no suggestions (429/503 and `Retry-After`) and the browser asks for nothing until then: the box just has no dropdown. A model that fails or takes over 2.5s gives no suggestions either.

## Live references

- [OpenRouter model catalog](https://openrouter.ai/api/v1/models) — exact IDs and prices were checked before trials.
- [GPT-6 Luna official documentation](https://developers.openai.com/api/docs/models/gpt-6-luna) — current API ID and supported reasoning controls.
- [TypeSafe HTTP API](https://docs.typesafe.ai/api) and [Choice primitive](https://docs.typesafe.ai/primitives/choice) — typed layout judgments.
