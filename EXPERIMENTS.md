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

## Live references

- [OpenRouter model catalog](https://openrouter.ai/api/v1/models) — exact IDs and prices were checked before trials.
- [GPT-6 Luna official documentation](https://developers.openai.com/api/docs/models/gpt-6-luna) — current API ID and supported reasoning controls.
- [TypeSafe HTTP API](https://docs.typesafe.ai/api) and [Choice primitive](https://docs.typesafe.ai/primitives/choice) — typed layout judgments.
