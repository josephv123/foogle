// What a picture looks like, apart from what it depicts. Every picture used to
// get the same brief ("bold flat-vector, 4-6 colours, 400x300"), so a whole
// Images grid came back in one house style. Now each picture is drawn in a
// medium (a photo, a blueprint, a meme, a woodcut…) and a shape, both carried
// in its URL: /img/<description>?s=<style>&a=<shape>. URLs without them (old
// links, bare srcs) get a style inferred from the description.

// Canvas sizes. Each is a real aspect ratio the Images grid lays out as-is.
export const SHAPES = {
  square: [400, 400],
  landscape: [400, 300],
  wide: [480, 270],
  portrait: [300, 400],
  tall: [280, 420],
};

// Styles whose medium includes words: they get a few short labels instead of
// the usual "no text" rule.
const LABELS = "Short text is part of this medium: up to 8 brief labels (1-4 words each, font-family sans-serif or monospace, font-size 11 or more), never sentences.";
const GRAIN = `film grain: a full-canvas <rect> with filter="url(#g)", where <filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2"/><feColorMatrix type="saturate" values="0"/></filter>, at opacity .08-.15`;
const ROUGH = `rough edges: <filter id="r"><feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="3"/><feDisplacementMap in="SourceGraphic" scale="6"/></filter> on the main shapes`;

// key -> { brief: how to draw it in SVG, shape: default canvas, text?, free?: may use a free colour scheme }
export const STYLES = {
  photo: {
    label: "photograph",
    shape: "landscape",
    brief: `Photo-realistic colour photograph of a real, specific scene with a foreground, the subject and a background. Full real-world colour — blue sky, green leaves, skin tones, painted signs, coloured clothing — never a grey, sepia or monochrome palette. Every large shape (sky, walls, ground, skin, surfaces) is filled with a linearGradient or radialGradient to model real light from one clear source; soft cast shadows (dark ellipses with feGaussianBlur stdDeviation 6-12); background slightly blurred for depth of field; a subtle vignette; ${GRAIN}. Natural, believable colours and proportions. No outlines, no cartoon shapes.`,
  },
  snapshot: {
    label: "phone snapshot",
    shape: "square",
    brief: `Casual amateur phone photo. Rendered with gradients like a real photo, but candid: tilted horizon, off-centre subject, harsh flash or flat overcast light, washed-out colours, a blown-out highlight, clutter at the edges; ${GRAIN} at opacity .15. No outlines.`,
  },
  product: {
    label: "studio product shot",
    shape: "square",
    brief: `Studio product photograph. The object alone, large and centred, on a seamless backdrop (a smooth vertical gradient); glossy shading from linearGradients, a crisp specular highlight streak, a soft contact shadow (blurred ellipse) and a faint mirrored reflection beneath at low opacity. Commercial, clean, expensive-looking.`,
  },
  render3d: {
    label: "3D render",
    shape: "square",
    free: true,
    brief: `Soft 3D render, like a clay or plastic toy scene: rounded chunky forms, each shaded for volume with a radialGradient (light top-left, darker bottom-right), ambient-occlusion shadows (blurred dark ellipses) where objects meet the floor, a pastel studio backdrop with a gradient horizon. Friendly and tactile.`,
  },
  flat: {
    label: "flat vector illustration",
    shape: "landscape",
    free: true,
    brief: `Bold flat-vector illustration: a full-bleed background, a clear subject with a strong silhouette, flat fills with no outlines, 4-6 harmonious colours, one gradient at most.`,
  },
  line: {
    label: "ink line drawing",
    shape: "portrait",
    brief: `Ink line drawing on off-white paper (#f6f2e9 or similar): dark ink strokes only (fill="none", stroke-linecap="round"), varied stroke widths like a pen, cross-hatching (groups of short parallel lines) for shadow, at most one pale spot colour wash. Like a sketchbook page or a field guide plate.`,
  },
  woodcut: {
    label: "woodcut print",
    shape: "portrait",
    brief: `Woodcut / linocut print: black ink plus at most one colour on cream paper. Bold carved shapes, rows of parallel gouge lines for texture and shade, strong black-and-white contrast; ${ROUGH}; a thin printed border.`,
  },
  watercolor: {
    label: "watercolour painting",
    shape: "landscape",
    brief: `Watercolour painting on white paper: loose translucent washes (overlapping shapes at fill-opacity .35-.7), wet edges from <filter id="w"><feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="3"/><feDisplacementMap in="SourceGraphic" scale="12"/><feGaussianBlur stdDeviation="1.5"/></filter>, paper left white in places, a few thin dark pencil lines on top.`,
  },
  painting: {
    label: "oil painting",
    shape: "landscape",
    brief: `Oil painting: rich, deep colour, many short thick curved brushstrokes (stroke-width 4-10, stroke-linecap round) layered over broad colour blocks, a painterly texture filter (<feTurbulence baseFrequency=".05" numOctaves="2"/> + feDisplacementMap scale 8) on the strokes only — keep a plain full-canvas background rect unfiltered so no edge is left bare — and dramatic chiaroscuro light. Like a gallery canvas.`,
  },
  isometric: {
    label: "isometric illustration",
    shape: "square",
    free: true,
    brief: `Isometric illustration: every solid drawn on 30° isometric axes, each with its top, left and right faces in light, mid and dark shades of its colour; a small diorama or cutaway floating on a plain backdrop with a soft shadow; crisp, detailed, no perspective.`,
  },
  pixel: {
    label: "pixel art",
    shape: "landscape",
    free: true,
    brief: `Pixel art, like a 16-bit game sprite scene: one big, simple, iconic subject filling most of the canvas, drawn on a coarse grid of 10-unit pixels — every shape is a <rect> or an h/v-only <path> with coordinates in multiples of 10 — shape-rendering="crispEdges", a limited 6-10 colour palette, a dark one-pixel outline around the subject, flat sky and ground bands behind it.`,
  },
  blueprint: {
    label: "blueprint",
    shape: "wide",
    text: true,
    brief: `Blueprint / technical drawing: white and pale-cyan lines on deep blueprint blue with a fine grid (<pattern> of thin lines). An orthographic or cutaway view of the subject, dashed hidden lines, dimension lines with arrowheads, a small title block in a corner, monospace labels.`,
  },
  diagram: {
    label: "labelled diagram",
    shape: "wide",
    text: true,
    free: true,
    brief: `Explainer diagram, like a textbook or infographic figure: the subject cut away or broken into parts on a light background, numbered callouts and leader lines, arrows showing flow or sequence, 2-3 bold colours plus greys, clean and precise.`,
  },
  chart: {
    label: "data chart",
    shape: "landscape",
    text: true,
    free: true,
    brief: `A data chart from a report or dashboard: pick the chart that fits (bar, line, area, pie, scatter or stacked) with axes, light gridlines, tick numbers, a short title and a small legend; plausible, specific data; flat colours on white or a dark dashboard panel.`,
  },
  screenshot: {
    label: "screenshot",
    shape: "wide",
    text: true,
    brief: `Screenshot of an app or web page about the subject: window or phone chrome (title bar with three dots, address bar or status bar), toolbar, sidebar or cards, buttons, a small picture region; body copy drawn as rounded grey bars; crisp pixel-aligned modern UI in a real product's colour scheme. For a phone screen, the canvas is the phone.`,
  },
  map: {
    label: "map",
    shape: "landscape",
    text: true,
    brief: `A map, in whatever form fits the description — city street map, trail map, transit map, satellite-ish terrain or an old parchment chart: land, water, parks, street or route lines, markers, a compass rose or scale bar, a few short place labels.`,
  },
  meme: {
    label: "meme",
    shape: "square",
    text: true,
    brief: `Internet meme: a funny picture (drawn like a candid photo, with gradients) and a caption in bold white capitals — font-family Impact, Arial Black, sans-serif; font-weight 900; black stroke via stroke="#000" stroke-width="3" paint-order="stroke" — along the top and/or bottom edge, centred with text-anchor="middle". The caption is witty, about the subject, at most 8 words per line.`,
  },
  poster: {
    label: "risograph poster",
    shape: "tall",
    free: true,
    brief: `Risograph / screen-print poster: 2-3 bold spot inks (like fluorescent pink, blue and yellow) overprinting with style="mix-blend-mode:multiply", a halftone dot <pattern> for shading, layers slightly misregistered by 2-4 units, big simple graphic shapes on off-white paper; one short title word allowed.`,
  },
  collage: {
    label: "paper collage",
    shape: "portrait",
    free: true,
    brief: `Cut-paper collage: a full-canvas paper background, then pieces with torn or scissor-cut edges (${ROUGH.replace("rough edges: ", "")}), overlapping at slight rotations, each dropping a small shadow; mixed textures — halftone dots, stripes, kraft brown, newsprint grey; a surreal juxtaposition of the subject's parts.`,
  },
  sticker: {
    label: "sticker",
    shape: "square",
    free: true,
    brief: `Die-cut sticker: one cute, chunky, instantly readable subject with a thick white border (a fattened white copy of its silhouette behind it) and a soft drop shadow, glossy highlight, bold outlines, on a plain soft-coloured backdrop. Big and centred.`,
  },
  neon: {
    label: "neon night scene",
    shape: "wide",
    brief: `Neon / synthwave night scene: near-black background with a gradient sunset or skyline, the subject drawn in glowing neon tubes — each stroke duplicated beneath itself with a feGaussianBlur (stdDeviation 4) glow — in magenta, cyan and violet; a perspective grid floor or wet reflections.`,
  },
  scan: {
    label: "vintage scan",
    shape: "square",
    brief: `Scan of an old photograph or printed plate: sepia or faded colour, the subject in soft tonal gradients (no outlines), paper grain via feTurbulence, a vignette, dust specks and a scratch, a yellowed white photo border or a torn corner.`,
  },
};

// What a news story's thumbnail can be.
export const NEWS_STYLES = ["photo", "snapshot", "chart", "map", "scan", "screenshot", "diagram"];

// Themes for the "free" styles when a picture has no site palette, so a grid
// of flat or isometric pictures isn't all the same warm beige.
export const COLOR_SCHEMES = [
  "teal, coral and cream", "navy, mustard and off-white", "forest green, peach and ivory", "violet, lime and charcoal",
  "tomato red, sky blue and sand", "black, hot pink and white", "ochre, olive and rust", "cobalt, orange and pale grey",
  "mint, plum and butter yellow", "slate, gold and blush", "emerald, magenta and cream", "sepia browns with one turquoise",
];

// Light for the photographic media, so a page of photos isn't all the same
// dim teal dusk. The description's own lighting wins.
const LIGHTS = [
  "bright midday sun, crisp shadows, saturated colour", "warm golden-hour side light", "soft overcast daylight, muted colour",
  "blue-hour dusk with glowing windows", "night under orange streetlights", "harsh on-camera flash", "cool fluorescent indoor light",
  "hazy backlight with a bright rim", "clear morning light, fresh and airy", "warm tungsten lamps indoors",
];
const LIT = new Set(["photo", "snapshot", "painting", "watercolor", "scan"]);

// What a site's pictures are drawn as. The kind of site decides what's
// plausible (stores show product shots, news shows photos), its mood narrows
// it to what matches the page, and the domain picks one for good.
const KIND_STYLES = {
  news: ["photo", "photo", "scan", "map", "chart"],
  store: ["product", "render3d", "photo", "sticker", "isometric", "product"],
  wiki: ["photo", "line", "scan", "woodcut", "diagram", "watercolor"],
  forum: ["snapshot", "photo", "screenshot", "snapshot"],
  blog: ["photo", "watercolor", "line", "painting", "collage", "flat", "snapshot"],
  startup: ["isometric", "render3d", "flat", "screenshot", "photo", "neon"],
  gov: ["flat", "line", "photo", "isometric", "diagram"],
  zine: ["collage", "poster", "pixel", "woodcut", "painting", "sticker", "neon"],
};
const MOOD_STYLES = {
  dark: ["photo", "blueprint", "isometric", "render3d", "painting", "scan", "screenshot", "snapshot", "neon"],
  light: ["photo", "flat", "watercolor", "isometric", "sticker", "render3d", "line", "product", "snapshot", "diagram", "screenshot", "collage"],
  paper: ["woodcut", "line", "watercolor", "scan", "painting", "collage", "photo", "map"],
  neon: ["neon", "pixel", "isometric", "render3d", "screenshot", "poster"],
  brutal: ["poster", "collage", "flat", "woodcut", "pixel", "snapshot", "sticker", "diagram"],
};

export function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}
const pick = (list, seed) => list[hash(seed) % list.length];

export function siteImageStyle({ kind, mood, site }) {
  const byKind = KIND_STYLES[kind];
  const byMood = MOOD_STYLES[mood];
  const both = byKind?.filter((s) => byMood?.includes(s));
  const list = both?.length ? both : byKind ?? byMood ?? ["photo", "flat", "watercolor", "isometric", "line"];
  return pick(list, site ?? "");
}

// Bare descriptions (old /img links, pictures written without a style) are
// matched to the medium they name, else drawn in a general-purpose style the
// description picks, so the same URL always gets the same kind of picture.
// Named media first ("isometric cutaway…" is isometric), then kinds of
// picture, then photographic words.
const INFER = [
  [/pixel art|8-bit|16-bit|retro game/i, "pixel"],
  [/watercolou?r/i, "watercolor"],
  [/woodcut|linocut|engraving|etching|block print/i, "woodcut"],
  [/isometric/i, "isometric"],
  [/\bblueprints?\b|\bschematic|technical drawing/i, "blueprint"],
  [/\bmemes?\b/i, "meme"],
  [/\bposter\b|risograph|screen ?print/i, "poster"],
  [/collage/i, "collage"],
  [/\bstickers?\b|emoji|mascot/i, "sticker"],
  [/\bneon\b|synthwave|cyberpunk/i, "neon"],
  [/oil painting|\bpainting\b|on canvas/i, "painting"],
  [/sketch|line art|pen and ink|\bink drawing|pencil drawing/i, "line"],
  [/\b3d\b|claymation|\bclay\b/i, "render3d"],
  [/screenshot|web ?page|homepage|\bui\b|app screen|user interface/i, "screenshot"],
  [/\bcharts?\b|\bgraph\b|\bplot\b|dashboard|statistics/i, "chart"],
  [/\bdiagram|cutaway|cross[- ]section|infographic|exploded view/i, "diagram"],
  [/\bmaps?\b|\btop-down\b|street plan/i, "map"],
  [/vintage photo|archival|sepia|old photo|\b1[89]\d0s\b/i, "scan"],
  [/product shot|studio shot|packshot|\bon white\b|seamless backdrop/i, "product"],
  [/phone snapshot|selfie|candid/i, "snapshot"],
  [/\bphoto|close-up|portrait of|macro|golden hour/i, "photo"],
];
const GENERAL = ["photo", "photo", "flat", "watercolor", "isometric", "line", "render3d", "painting"];

export function inferStyle(description) {
  for (const [re, style] of INFER) if (re.test(description)) return style;
  return pick(GENERAL, description);
}

const CSS_COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d.,% ]+\))$/i;

// Everything that decides a picture, from its description and URL query.
// Unknown styles/shapes fall back rather than fail, so any /img URL draws.
export function imageSpec(description, query = {}) {
  const [s, a, bg, fg] = ["s", "a", "bg", "fg"].map((k) => (typeof query[k] === "string" ? query[k] : ""));
  const style = Object.hasOwn(STYLES, s) ? s : inferStyle(description);
  const shape = Object.hasOwn(SHAPES, a) ? a : STYLES[style].shape;
  const palette = CSS_COLOR.test(bg) && CSS_COLOR.test(fg) ? { bg, fg } : null;
  return { description, style, shape, palette };
}

// The cache key: one per distinct picture.
export const imageKey = ({ description, style, shape, palette }) =>
  [style, shape, palette ? `${palette.bg} ${palette.fg}` : "", description].join("|");

export const imageQuery = ({ style, shape }) => `s=${style}&a=${shape}`;

// A site's palette is part of the prompt, so its pictures are drawn for the
// page. Media with their own colours (a blueprint, a neon sign) keep them and
// work the accent in; the backdrop blends where the picture is letterboxed.
export const withPalette = (prompt, { bg, fg }) =>
  `${prompt}\nPalette: the image sits on a page with background ${bg} and accent ${fg}. Make it belong there: use the accent as one of its key colours, and where the medium has a plain backdrop or paper, use ${bg} or a close tint of it so the picture blends into the page wherever it is letterboxed. Otherwise keep the medium's own colours (a photo stays natural, a blueprint stays blue).`;

export function imageMessages({ description, style, shape, palette }) {
  const st = STYLES[style];
  const [w, h] = SHAPES[shape];
  const scheme = !palette && st.free ? `\nColour scheme: ${pick(COLOR_SCHEMES, `${style} ${description}`)} (the subject may keep its natural colours).` : "";
  const light = LIT.has(style) ? `\nLight (unless the picture says otherwise): ${pick(LIGHTS, description)}.` : "";
  const user = `Picture: ${description}\nMedium: ${st.label}.${scheme}${light}`;
  return {
    system: `You are an image maker who draws in SVG. Given a picture description and a medium, output ONLY a standalone SVG starting with <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"> — no markdown fences, no commentary, no <script>, no <foreignObject>, no <image>, no external references.

Medium — ${st.label}: ${st.brief}

Fill the whole ${w}x${h} canvas; compose for that shape. Integer coordinates, compact paths (short d strings, no decimals), reuse <defs> for gradients, patterns and filters; frames, borders and strokes-only shapes need fill="none". Keep it under 1300 characters: few, well-chosen elements, and let gradients, patterns and filters do the work. ${st.text ? LABELS : "No words or captions; only use <text> for single letters or numbers the description explicitly asks for (like lettered map pins)."} The subject must be instantly recognizable.`,
    user: palette ? withPalette(user, palette) : user,
  };
}
