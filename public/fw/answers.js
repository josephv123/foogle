// Instant answers on Foogle's results page: the trusted code both sides share.
//
// The server (lib/answers.js) imports this file to detect and compute the
// answers code owns (the calculator's arithmetic, unit and currency
// conversion, chart series) and the results page loads the same file as a
// module to make the cards interactive with the same functions, so a keypad
// sum or a converted amount can never disagree with what the server printed.
// The model never writes code or HTML for a card: it fills a small typed JSON
// object and code renders it (lib/answer-cards.js). The browser part at the
// bottom only runs where there is a document.

// ---------- numbers ----------
// Calculator style: up to 12 significant digits, exponent form when huge or tiny.
export function fmt(n) {
  if (Number.isNaN(n)) return "Error";
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e15 || abs < 1e-9) return n.toExponential(9).replace(/\.?0+e/, "e").replace("e+", "e");
  return String(Number(n.toPrecision(12)));
}

// Grouped for reading ("1,234.57"): at most `dp` decimals, but enough
// significant digits for a small number (0.0000089).
export function num(n, dp = 2) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs && abs < 1 ? Math.min(10, Math.max(dp, 3 - Math.floor(Math.log10(abs)))) : dp;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}
export const money = (n) => (Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");

// ---------- calculator ----------
// A small arithmetic parser: numbers, + − × ÷ ^ mod, parentheses, postfix
// ! % and °, π and e, sqrt/√, sin cos tan and their inverses, ln, log, exp,
// abs, implicit multiplication (2π, 3(4+5)) and "a + b%" meaning a plus b
// percent of a, as on a pocket calculator. It never evaluates code.
const FUNCS = new Set(["asin", "acos", "atan", "sqrt", "sin", "cos", "tan", "exp", "abs", "ln", "log", "√"]);
const TOKEN = /\s*(?:(\d*\.?\d+(?:e[+-]?\d+)?)|(asin|acos|atan|sqrt|sin|cos|tan|exp|abs|ln|log|ans|mod|√|π|e)|([-+*/^()!%°]))/y;

function tokenize(s) {
  const out = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < s.length) {
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(s);
    if (!m) {
      if (/^\s*$/.test(s.slice(at))) break;
      throw new Error(`can't read "${s.slice(at).trim()}"`);
    }
    if (m[1] !== undefined) out.push({ t: "num", v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: FUNCS.has(m[2]) ? "fn" : m[2] === "mod" ? "op" : "const", v: m[2] });
    else out.push({ t: "op", v: m[3] });
  }
  return out;
}

function factorial(n) {
  if (!Number.isInteger(n) || n < 0 || n > 170) return NaN;
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

// { value, ops } for an expression, where ops counts what was done to the
// numbers; throws on anything it can't read. `deg` makes trig work in
// degrees; `ans` is the previous answer.
export function evaluate(expr, { deg = false, ans = 0 } = {}) {
  const toks = tokenize(String(expr).toLowerCase().replace(/[×✕]/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-"));
  let i = 0;
  let ops = 0;
  const isOp = (v) => toks[i]?.t === "op" && toks[i].v === v;
  const startsPrimary = () => { const t = toks[i]; return t && (t.t !== "op" || t.v === "("); };
  const rad = (x) => (deg ? (x * Math.PI) / 180 : x);
  const unrad = (x) => (deg ? (x * 180) / Math.PI : x);
  const FN = {
    sqrt: Math.sqrt, "√": Math.sqrt, ln: Math.log, log: Math.log10, exp: Math.exp, abs: Math.abs,
    sin: (v) => Math.sin(rad(v)), cos: (v) => Math.cos(rad(v)), tan: (v) => Math.tan(rad(v)),
    asin: (v) => unrad(Math.asin(v)), acos: (v) => unrad(Math.acos(v)), atan: (v) => unrad(Math.atan(v)),
  };

  function sum() {
    let [v] = product();
    while (isOp("+") || isOp("-")) {
      const op = toks[i++].v;
      ops++;
      const [r, pct] = product();
      v = pct ? v * (1 + (op === "+" ? r : -r)) : op === "+" ? v + r : v - r;
    }
    return v;
  }
  // Returns [value, isBarePercent] so the sum above can treat "+ 10%" as
  // ten percent of what came before.
  function product() {
    let [v, pct] = unary();
    for (;;) {
      if (isOp("*") || isOp("/") || isOp("mod")) {
        const op = toks[i++].v;
        ops++;
        const [r] = unary();
        v = op === "*" ? v * r : op === "/" ? v / r : v - r * Math.floor(v / r);
      } else if (startsPrimary()) {
        ops++;
        v *= unary()[0];
      } else return [v, pct];
      pct = false;
    }
  }
  function unary() {
    if (isOp("-")) { i++; const [v, p] = unary(); return [-v, p]; }
    if (isOp("+")) { i++; return unary(); }
    const [b, pct] = postfix();
    if (isOp("^")) { i++; ops++; return [b ** unary()[0], false]; }
    return [b, pct];
  }
  function postfix() {
    let v = primary();
    let pct = false;
    for (;;) {
      if (isOp("!")) { i++; ops++; v = factorial(v); pct = false; }
      else if (isOp("%")) { i++; ops++; v /= 100; pct = true; }
      else if (isOp("°")) { i++; v = deg ? v : (v * Math.PI) / 180; }
      else return [v, pct];
    }
  }
  function primary() {
    const t = toks[i++];
    if (!t) throw new Error("the expression ends early");
    if (t.t === "num") return t.v;
    if (t.t === "const") return t.v === "π" ? Math.PI : t.v === "e" ? Math.E : ans;
    if (t.t === "fn") {
      ops++;
      // sin(30) or sin 30: an argument without parentheses binds tightly.
      return FN[t.v](isOp("(") ? primary() : unary()[0]);
    }
    if (t.v === "(") {
      const v = sum();
      if (isOp(")")) i++; // an unclosed parenthesis closes at the end
      return v;
    }
    throw new Error(`unexpected "${t.v}"`);
  }
  const value = sum();
  if (i < toks.length) throw new Error(`unexpected "${toks[i].v}"`);
  return { value, ops };
}

// The words people type around arithmetic, turned into operators the
// parser reads: "what is 17 percent of 2,340" -> "17%*2340".
function calcExpression(query) {
  return String(query ?? "").toLowerCase().trim()
    .replace(/^(?:what(?:'s|\s+is)|calculate|compute|solve|evaluate|how\s+much\s+is)\s+/, "")
    .replace(/(?:\s*(?:=|equals?|\?))+$/, "")
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .replace(/[×✕]/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-").replace(/\*\*/g, "^")
    .replace(/\b(?:square\s+root|sqrt|root)\s+of\b/g, "sqrt ")
    .replace(/\bmultiplied\s+by\b|\btimes\b/g, "*")
    .replace(/\bdivided\s+by\b|\bover\b/g, "/")
    .replace(/\bplus\b/g, "+").replace(/\bminus\b/g, "-")
    .replace(/\bto\s+the\s+power\s+of\b|\braised\s+to(?:\s+the\s+power\s+of)?\b/g, "^")
    .replace(/\bsquared\b/g, "^2").replace(/\bcubed\b/g, "^3")
    .replace(/\s*\b(?:percent|per\s+cent)\b/g, "%")
    .replace(/%\s*of\b/g, "%*")
    .replace(/\bmodulo\b/g, "mod")
    .replace(/\s*\bdegrees?\b|\s*°/g, "°")
    .replace(/(?<![a-z])pi\b/g, "π")
    .replace(/(\d)\s*x\s*(?=[\d(.])/g, "$1*")
    .replace(/\s+/g, " ")
    .trim();
}

// A query that is arithmetic, with its answer, or null. Something has to
// happen to the numbers: "2048" or "pi" alone is not a sum.
export function calc(query) {
  const expr = calcExpression(query);
  if (!/\d|π/.test(expr)) return null;
  try {
    const { value, ops } = evaluate(expr);
    return ops > 0 && !Number.isNaN(value) ? { expr, value } : null;
  } catch {
    return null;
  }
}

// ---------- units ----------
// Per category, [id, label, factor to the category's base unit, aliases]
// (aliases separated by "|"). Temperature converts through kelvin instead.
export const UNITS = {
  length: { label: "Length", units: [
    ["kilometer", "Kilometer", 1000, "km|kms|kilometre|kilometres|kilometers"],
    ["meter", "Meter", 1, "m|metre|metres|meters"],
    ["centimeter", "Centimeter", 0.01, "cm|cms|centimetre|centimetres|centimeters"],
    ["millimeter", "Millimeter", 0.001, "mm|millimetre|millimetres|millimeters"],
    ["micrometer", "Micrometer", 1e-6, "µm|um|micron|microns|micrometre|micrometers"],
    ["nanometer", "Nanometer", 1e-9, "nm|nanometre|nanometers"],
    ["mile", "Mile", 1609.344, "mi|miles"],
    ["yard", "Yard", 0.9144, "yd|yds|yards"],
    ["foot", "Foot", 0.3048, "ft|feet"],
    ["inch", "Inch", 0.0254, "in|inches"],
    ["nautical-mile", "Nautical mile", 1852, "nmi|nautical miles"],
    ["astronomical-unit", "Astronomical unit", 1.495978707e11, "au|astronomical units"],
    ["light-year", "Light-year", 9.4607304725808e15, "ly|light year|light years|lightyear|lightyears|light-years"],
    ["parsec", "Parsec", 3.0856775814913673e16, "pc|parsecs"],
  ] },
  mass: { label: "Mass", units: [
    ["tonne", "Tonne", 1000, "t|tonnes|metric ton|metric tons"],
    ["kilogram", "Kilogram", 1, "kg|kgs|kilo|kilos|kilograms|kilogramme"],
    ["gram", "Gram", 0.001, "g|grams|gramme|grammes"],
    ["milligram", "Milligram", 1e-6, "mg|milligrams"],
    ["microgram", "Microgram", 1e-9, "µg|mcg|ug|micrograms"],
    ["us-ton", "US ton", 907.18474, "ton|tons|short ton|short tons|us tons"],
    ["imperial-ton", "Imperial ton", 1016.0469088, "long ton|long tons|imperial tons"],
    ["stone", "Stone", 6.35029318, "st|stones"],
    ["pound", "Pound", 0.45359237, "lb|lbs|pounds"],
    ["ounce", "Ounce", 0.028349523125, "oz|ounces"],
  ] },
  temperature: { label: "Temperature", units: [
    ["celsius", "Degree Celsius", null, "c|°c|centigrade|degree celsius|degrees celsius|degrees c"],
    ["fahrenheit", "Fahrenheit", null, "f|°f|degree fahrenheit|degrees fahrenheit|degrees f"],
    ["kelvin", "Kelvin", null, "k|kelvins"],
  ] },
  volume: { label: "Volume", units: [
    ["cubic-meter", "Cubic meter", 1000, "m3|m³|cubic meters|cubic metre|cubic metres"],
    ["liter", "Liter", 1, "l|litre|litres|liters|ltr"],
    ["milliliter", "Milliliter", 0.001, "ml|millilitre|millilitres|milliliters|cc"],
    ["us-gallon", "US gallon", 3.785411784, "gal|gallon|gallons|us gallons"],
    ["us-quart", "US quart", 0.946352946, "qt|quart|quarts"],
    ["us-pint", "US pint", 0.473176473, "pt|pint|pints"],
    ["us-cup", "US cup", 0.2365882365, "cup|cups"],
    ["us-fluid-ounce", "US fluid ounce", 0.0295735295625, "fl oz|floz|fluid ounce|fluid ounces"],
    ["us-tablespoon", "US tablespoon", 0.01478676478125, "tbsp|tbs|tablespoon|tablespoons"],
    ["us-teaspoon", "US teaspoon", 0.00492892159375, "tsp|teaspoon|teaspoons"],
    ["imperial-gallon", "Imperial gallon", 4.54609, "imperial gallons|uk gallon|uk gallons"],
    ["imperial-pint", "Imperial pint", 0.56826125, "imperial pints|uk pint|uk pints"],
    ["cubic-foot", "Cubic foot", 28.316846592, "ft3|cubic feet|cu ft"],
    ["cubic-inch", "Cubic inch", 0.016387064, "in3|cubic inches|cu in"],
  ] },
  speed: { label: "Speed", units: [
    ["mph", "Mile per hour", 0.44704, "miles per hour|mile per hour|mi/h"],
    ["fps", "Foot per second", 0.3048, "ft/s|feet per second|foot per second"],
    ["mps", "Meter per second", 1, "m/s|meters per second|metres per second|meter per second"],
    ["kph", "Kilometer per hour", 1 / 3.6, "km/h|kmh|kmph|kilometers per hour|kilometres per hour|kilometer per hour"],
    ["knot", "Knot", 1852 / 3600, "kn|kt|knots"],
    ["mach", "Mach", 343, "machs"],
    ["lightspeed", "Speed of light", 299792458, "speed of light|light speed"],
  ] },
  area: { label: "Area", units: [
    ["square-kilometer", "Square kilometer", 1e6, "km2|km²|sq km|square kilometers|square kilometres"],
    ["square-meter", "Square meter", 1, "m2|m²|sq m|square meters|square metres"],
    ["square-mile", "Square mile", 2589988.110336, "mi2|mi²|sq mi|square miles"],
    ["square-yard", "Square yard", 0.83612736, "yd2|sq yd|square yards"],
    ["square-foot", "Square foot", 0.09290304, "ft2|ft²|sq ft|sqft|square feet"],
    ["square-inch", "Square inch", 0.00064516, "in2|sq in|square inches"],
    ["hectare", "Hectare", 10000, "ha|hectares"],
    ["acre", "Acre", 4046.8564224, "ac|acres"],
  ] },
  time: { label: "Time", units: [
    ["nanosecond", "Nanosecond", 1e-9, "ns|nanoseconds"],
    ["microsecond", "Microsecond", 1e-6, "µs|microseconds"],
    ["millisecond", "Millisecond", 0.001, "ms|milliseconds"],
    ["second", "Second", 1, "s|sec|secs|seconds"],
    ["minute", "Minute", 60, "min|mins|minutes"],
    ["hour", "Hour", 3600, "h|hr|hrs|hours"],
    ["day", "Day", 86400, "d|days"],
    ["week", "Week", 604800, "wk|wks|weeks"],
    ["month", "Month", 2629746, "mo|months"],
    ["year", "Calendar year", 31556952, "yr|yrs|years"],
    ["decade", "Decade", 315569520, "decades"],
    ["century", "Century", 3155695200, "centuries"],
    ["sol", "Mars sol", 88775.244, "sols|martian day|martian days|mars day|mars days"],
  ] },
  data: { label: "Digital Storage", units: [
    ["bit", "Bit", 0.125, "bits"],
    ["byte", "Byte", 1, "b|bytes"],
    ["kilobit", "Kilobit", 125, "kbit|kilobits"],
    ["kilobyte", "Kilobyte", 1e3, "kb|kilobytes"],
    ["megabit", "Megabit", 125000, "mbit|megabits"],
    ["megabyte", "Megabyte", 1e6, "mb|megabytes|meg|megs"],
    ["gigabit", "Gigabit", 1.25e8, "gbit|gigabits"],
    ["gigabyte", "Gigabyte", 1e9, "gb|gigabytes|gig|gigs"],
    ["terabyte", "Terabyte", 1e12, "tb|terabytes"],
    ["petabyte", "Petabyte", 1e15, "pb|petabytes"],
    ["kibibyte", "Kibibyte", 1024, "kib|kibibytes"],
    ["mebibyte", "Mebibyte", 1048576, "mib|mebibytes"],
    ["gibibyte", "Gibibyte", 1073741824, "gib|gibibytes"],
  ] },
  energy: { label: "Energy", units: [
    ["joule", "Joule", 1, "j|joules"],
    ["kilojoule", "Kilojoule", 1000, "kj|kilojoules"],
    ["calorie", "Gram calorie", 4.184, "cal|calories|gram calories"],
    ["kilocalorie", "Kilocalorie", 4184, "kcal|kilocalories|food calorie|food calories"],
    ["watt-hour", "Watt hour", 3600, "wh|watt hours"],
    ["kilowatt-hour", "Kilowatt hour", 3.6e6, "kwh|kilowatt hours"],
    ["electronvolt", "Electronvolt", 1.602176634e-19, "ev|electronvolts|electron volts"],
    ["btu", "British thermal unit", 1055.05585262, "btus|british thermal units"],
    ["foot-pound", "Foot-pound", 1.3558179483314, "ft lb|ft-lb|foot pounds"],
  ] },
  pressure: { label: "Pressure", units: [
    ["bar", "Bar", 1e5, "bars"],
    ["pascal", "Pascal", 1, "pa|pascals"],
    ["kilopascal", "Kilopascal", 1000, "kpa|kilopascals"],
    ["psi", "Pound per square inch", 6894.757293168, "pounds per square inch"],
    ["atmosphere", "Standard atmosphere", 101325, "atm|atmospheres"],
    ["torr", "Torr", 133.322368421, "mmhg"],
  ] },
};

// Every name for a unit, lowercased -> [category, id].
const UNIT_NAMES = new Map();
for (const [cat, { units }] of Object.entries(UNITS)) {
  for (const [id, label, , aliases] of units) {
    for (const name of [id, id.replace(/-/g, " "), label, `${label}s`, ...aliases.split("|")]) {
      const key = name.toLowerCase();
      if (!UNIT_NAMES.has(key)) UNIT_NAMES.set(key, [cat, id]);
    }
  }
}

export function findUnit(name) {
  const s = String(name ?? "").toLowerCase().trim().replace(/\.$/, "").replace(/^(?:an?|one|the)\s+/, "");
  return UNIT_NAMES.get(s) ?? UNIT_NAMES.get(s.replace(/^degrees?\s+/, "")) ?? UNIT_NAMES.get(s.replace(/^°\s*/, "")) ?? null;
}

const unitRow = (cat, id) => UNITS[cat]?.units.find((u) => u[0] === id);

const TO_K = { celsius: (v) => v + 273.15, fahrenheit: (v) => ((v - 32) * 5) / 9 + 273.15, kelvin: (v) => v };
const FROM_K = { celsius: (k) => k - 273.15, fahrenheit: (k) => ((k - 273.15) * 9) / 5 + 32, kelvin: (k) => k };

export function convertUnit(value, cat, from, to) {
  if (cat === "temperature") return FROM_K[to](TO_K[from](value));
  return (value * unitRow(cat, from)[2]) / unitRow(cat, to)[2];
}

// A converted amount as the converter shows it: 9 significant digits, or 6
// for fractions, trailing zeros dropped.
export const unitValue = (v) => (Number.isFinite(v) ? fmt(Number(v.toPrecision(Math.abs(v) >= 1 ? 9 : 6))) : "");

const sig = (n, d = 4) => String(Number(n.toPrecision(d)));
// Google's formula line: "multiply the length value by 1.609".
export function unitFormula(cat, from, to, value = 1) {
  if (from === to) return "the value stays the same";
  if (cat === "temperature") {
    const s = { celsius: "°C", fahrenheit: "°F", kelvin: "K" };
    const v = `${fmt(value)}${s[from]}`;
    const out = `${sig(convertUnit(value, cat, from, to), 6)}${s[to]}`;
    return {
      "celsius>fahrenheit": `(${v} × 9/5) + 32 = ${out}`, "fahrenheit>celsius": `(${v} − 32) × 5/9 = ${out}`,
      "celsius>kelvin": `${v} + 273.15 = ${out}`, "kelvin>celsius": `${v} − 273.15 = ${out}`,
      "fahrenheit>kelvin": `(${v} − 32) × 5/9 + 273.15 = ${out}`, "kelvin>fahrenheit": `(${v} − 273.15) × 9/5 + 32 = ${out}`,
    }[`${from}>${to}`];
  }
  const k = unitRow(cat, from)[2] / unitRow(cat, to)[2];
  const what = `${UNITS[cat].label.toLowerCase()} value`;
  return k >= 1 ? `multiply the ${what} by ${sig(k)}` : `divide the ${what} by ${sig(1 / k)}`;
}

// ---------- currencies ----------
// [code, name, symbol, units one US dollar buys, aliases]. Invented, like
// everything else on Foogle, but close to the real 2026 rates.
export const CURRENCIES = [
  ["USD", "United States Dollar", "$", 1, "dollar|dollars|us dollar|us dollars|bucks|$"],
  ["EUR", "Euro", "€", 0.852, "euro|euros|€"],
  ["GBP", "Pound sterling", "£", 0.741, "pound|pounds|sterling|british pound|british pounds|quid|£"],
  ["JPY", "Japanese Yen", "¥", 147.6, "yen|japanese yen|¥"],
  ["CNY", "Chinese Yuan", "¥", 7.11, "yuan|renminbi|rmb|chinese yuan"],
  ["INR", "Indian Rupee", "₹", 88.2, "rupee|rupees|indian rupee|indian rupees|₹"],
  ["CAD", "Canadian Dollar", "$", 1.383, "canadian dollar|canadian dollars|loonie"],
  ["AUD", "Australian Dollar", "$", 1.518, "australian dollar|australian dollars"],
  ["NZD", "New Zealand Dollar", "$", 1.712, "new zealand dollar|new zealand dollars"],
  ["CHF", "Swiss Franc", "Fr", 0.797, "franc|francs|swiss franc|swiss francs"],
  ["MXN", "Mexican Peso", "$", 18.41, "peso|pesos|mexican peso|mexican pesos"],
  ["BRL", "Brazilian Real", "R$", 5.34, "real|reais|brazilian real"],
  ["KRW", "South Korean Won", "₩", 1392, "won|korean won|south korean won|₩"],
  ["SGD", "Singapore Dollar", "$", 1.284, "singapore dollar|singapore dollars"],
  ["HKD", "Hong Kong Dollar", "$", 7.78, "hong kong dollar|hong kong dollars"],
  ["SEK", "Swedish Krona", "kr", 9.38, "krona|kronor|swedish krona"],
  ["NOK", "Norwegian Krone", "kr", 9.95, "norwegian krone|norwegian kroner"],
  ["DKK", "Danish Krone", "kr", 6.36, "danish krone|danish kroner"],
  ["PLN", "Polish Zloty", "zł", 3.63, "zloty|zlotys|polish zloty"],
  ["ZAR", "South African Rand", "R", 17.38, "rand|rands|south african rand"],
  ["TRY", "Turkish Lira", "₺", 41.4, "lira|liras|turkish lira"],
  ["RUB", "Russian Ruble", "₽", 83.2, "ruble|rubles|rouble|roubles|russian ruble"],
  ["THB", "Thai Baht", "฿", 32.1, "baht|thai baht"],
  ["IDR", "Indonesian Rupiah", "Rp", 16420, "rupiah|indonesian rupiah"],
  ["PHP", "Philippine Peso", "₱", 57.1, "philippine peso|philippine pesos"],
  ["VND", "Vietnamese Dong", "₫", 26310, "dong|vietnamese dong"],
  ["NGN", "Nigerian Naira", "₦", 1498, "naira|nigerian naira"],
  ["KES", "Kenyan Shilling", "KSh", 129.2, "kenyan shilling|kenyan shillings"],
  ["EGP", "Egyptian Pound", "E£", 48.4, "egyptian pound|egyptian pounds"],
  ["AED", "UAE Dirham", "AED", 3.6725, "dirham|dirhams|uae dirham"],
  ["SAR", "Saudi Riyal", "SAR", 3.75, "riyal|riyals|saudi riyal"],
  ["ILS", "Israeli New Shekel", "₪", 3.34, "shekel|shekels|israeli shekel"],
  ["ARS", "Argentine Peso", "$", 1348, "argentine peso|argentine pesos"],
  ["BTC", "Bitcoin", "₿", 1 / 112400, "bitcoin|bitcoins|₿", true],
  ["ETH", "Ether", "Ξ", 1 / 4310, "ether|ethereum", true],
];
// Crypto and invented currencies (a sixth field of true) swing far more
// than a dollar against a euro.
export const fxVol = (a, b) => (a?.[5] || b?.[5] ? 0.03 : 0.004);
const CURRENCY_NAMES = new Map();
for (const [code, name, , , aliases] of CURRENCIES) {
  for (const a of [code, name, `${name}s`, ...aliases.split("|")]) {
    if (!CURRENCY_NAMES.has(a.toLowerCase())) CURRENCY_NAMES.set(a.toLowerCase(), code);
  }
}
const findCurrency = (name) => CURRENCY_NAMES.get(String(name ?? "").toLowerCase().trim().replace(/^(?:an?|one|the)\s+/, "")) ?? null;

// ---------- conversions in words ----------
// "5 miles in km", "how many cups in a liter", "$100 to eur", "usd eur" ->
// { value, from, to } with the unit or currency names as typed, or null.
const NUMBER = String.raw`-?(?:\d[\d,]*(?:\.\d+)?|\.\d+)(?:\s*\/\s*\d+)?(?:\s*(?:k|thousand|million|billion|bn)\b)?`;
const WORDS = String.raw`an?|one|half(?:\s+an?)?`;
function amount(s) {
  if (!s) return 1;
  s = s.replace(/,/g, "").trim().toLowerCase();
  if (/^(?:an?|one)$/.test(s)) return 1;
  if (/^half/.test(s)) return 0.5;
  const scale = { k: 1e3, thousand: 1e3, million: 1e6, billion: 1e9, bn: 1e9 }[s.match(/[a-z]+$/)?.[0]] ?? 1;
  const [a, b] = s.replace(/[a-z\s]+$/, "").split("/").map(Number);
  return (b ? a / b : a) * scale;
}
export function parseConversion(query) {
  let s = String(query ?? "").trim().replace(/[?!.]+$/, "").replace(/\s+/g, " ")
    .replace(/^(?:convert|how much is|what is|what's)\s+/i, "")
    .replace(/\s+(?:conversion|converter|exchange rate|rate|please)$/i, "");
  s = s.replace(/^([$€£¥₹₩₿])\s*(\d[\d,.]*(?:\s*(?:k|thousand|million|billion|bn)\b)?)/i, "$2 $1");
  const lead = String.raw`(?:(${NUMBER})\s*|(${WORDS})\s+)?`;
  let m = s.match(new RegExp(String.raw`^how many (.+?) (?:are )?in ${lead}(.+)$`, "i"));
  if (m) return { value: amount(m[2] ?? m[3]), from: m[4], to: m[1] };
  m = s.match(new RegExp(String.raw`^${lead}(.+?)\s+(?:to|in|into|as|in to|->|=|equals?)\s+(.+)$`, "i"));
  if (m) return { value: amount(m[1] ?? m[2]), from: m[3].trim(), to: m[4].trim() };
  m = s.match(new RegExp(String.raw`^${lead}([^\d\s]+)\s+([^\d\s]+)$`, "i"));
  if (m) return { value: amount(m[1] ?? m[2]), from: m[3], to: m[4], loose: true };
  return null;
}

// A unit conversion code can do on its own, or null.
export function units(query) {
  const c = parseConversion(query);
  if (!c || c.loose || !Number.isFinite(c.value)) return null;
  const a = findUnit(c.from);
  const b = findUnit(c.to);
  if (!a || !b || a[0] !== b[0]) return null;
  return { value: c.value, cat: a[0], from: a[1], to: b[1] };
}

// A conversion between two currencies code knows, or null.
export function exchange(query) {
  const c = parseConversion(query);
  if (!c || !Number.isFinite(c.value)) return null;
  const from = findCurrency(c.from);
  const to = findCurrency(c.to);
  return from && to && from !== to ? { amount: c.value, from, to } : null;
}

// ---------- seeded series ----------
// Charts come from a seeded random walk that passes exactly through the
// numbers the card states (today's price, the rate, last year's close), so
// the line, the change and the stats agree, and a reload draws the same chart.
export function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

// A walk in log space through `anchors` ([index, value] pairs in increasing
// index order): a Brownian bridge between each pair. One value per index,
// from the first anchor's to the last's.
function walk(seed, anchors, vol) {
  const r = rng(seed);
  const out = [];
  for (let k = 0; k < anchors.length - 1; k++) {
    const [i0, v0] = anchors[k];
    const [i1, v1] = anchors[k + 1];
    const n = Math.max(1, i1 - i0);
    const w = [0];
    for (let j = 1; j <= n; j++) w.push(w[j - 1] + gauss(r) * vol);
    const a = Math.log(v0);
    const b = Math.log(v1);
    for (let j = k ? 1 : 0; j <= n; j++) out.push(Math.exp(a + ((b - a) * j) / n + w[j] - (w[n] * j) / n));
  }
  return out;
}

const every = (list, n) => list.filter((_, i) => i % n === 0 || i === list.length - 1);

// The date `back` weekdays before `today` (an ISO date).
export function tradingDay(today, back) {
  const d = new Date(`${today}T12:00:00Z`);
  while (back > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() % 6) back--;
  }
  return d;
}

// A stock's chart for every range, from the numbers on its card. `session`
// is how much of today's session has passed (1 once the market has closed).
export function stockSeries({ seed, price, prevClose, hist = {}, ytdDays = 180, session = 1 }) {
  const anchors = [[-1260, hist.y5], [-252, hist.y1], [-ytdDays, hist.ytd], [-126, hist.m6], [-21, hist.m1], [-5, hist.d5], [-1, prevClose], [0, price]]
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a[0] - b[0])
    .filter((a, i, all) => !i || a[0] !== all[i - 1][0]);
  const daily = walk(`${seed}|daily`, anchors, 0.017);
  const start = anchors[0][0];
  const close = (i) => daily[i - start];
  const open = prevClose * (1 + gauss(rng(`${seed}|open`)) * 0.004);
  const bars = 78; // five-minute bars, 9:30 to 4:00
  const done = Math.max(1, Math.round(bars * Math.min(1, Math.max(0, session))));
  const day = walk(`${seed}|1d`, [[0, open], [done, price]], 0.0021);
  // Five days: four earlier sessions at half-hour steps, then today's.
  const five = [];
  for (let d = -4; d <= -1; d++) five.push(...walk(`${seed}|5d${d}`, [[0, close(d - 1) ?? prevClose], [13, close(d) ?? prevClose]], 0.004).slice(d === -4 ? 0 : 1));
  five.push(...every(day, 6).slice(1));
  const last = (n) => daily.slice(Math.max(0, daily.length - 1 - n));
  const ranges = {
    "1D": { pts: day, total: bars + 1, kind: "intraday" },
    "5D": { pts: five, total: 4 * 13 + 1 + bars / 6, kind: "5d" },
    "1M": { pts: last(21), kind: "daily", back: 21 },
    "6M": { pts: last(126), kind: "daily", back: 126 },
    YTD: { pts: last(ytdDays), kind: "daily", back: ytdDays },
    "1Y": { pts: last(252), kind: "daily", back: 252 },
    "5Y": { pts: every(last(1260), 5), kind: "weekly", back: 1260 },
  };
  // A young company has no five-year chart (and maybe no one-year one).
  for (const [k, v] of Object.entries(ranges)) if (v.back > -start) delete ranges[k];
  const year = last(252).concat(day);
  return { ranges, open, high: Math.max(...day), low: Math.min(...day), high52: Math.max(...year), low52: Math.min(...year) };
}

// An exchange rate's chart for every range, ending at `rate`.
export function fxSeries({ seed, rate, vol = 0.004 }) {
  const r = rng(`${seed}|fx`);
  const drift = (n) => Math.exp(gauss(r) * vol * Math.sqrt(n));
  const daily = walk(`${seed}|daily`, [[-1260, rate * drift(1260)], [-252, rate * drift(252)], [0, rate]], vol);
  const hourly = walk(`${seed}|hourly`, [[0, daily.at(-6)], [96, daily.at(-2)], [120, rate]], vol / 4);
  return {
    "1D": { pts: hourly.slice(96), kind: "hourly" },
    "5D": { pts: hourly, kind: "hourly5" },
    "1M": { pts: daily.slice(-22), kind: "daily", back: 21 },
    "1Y": { pts: daily.slice(-253), kind: "daily", back: 252 },
    "5Y": { pts: every(daily, 5), kind: "weekly", back: 1260 },
  };
}

// ---------- charts ----------
// An SVG stretched to its box, so the line fills any width, with HTML labels
// over it, so text never stretches. Coordinates are percentages.
function niceTicks(lo, hi, n = 3) {
  if (!(hi - lo > 1e-12)) { const pad = Math.abs(lo) * 0.01 || 1; lo -= pad; hi += pad; }
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let t = Math.floor(lo / step) * step; t <= Math.ceil(hi / step) * step + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  return ticks;
}

const escText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// pts: the values; total: how many slots the x axis has (a live session
// leaves the rest empty); base: a dotted reference line (the previous
// close); xLabels: [[fraction, text]].
export function chartHTML(pts, { color = "#1a73e8", total = pts.length, base = null, baseLabel = "", xLabels = [], yFmt = (v) => num(v, 2) } = {}) {
  const ys = niceTicks(Math.min(...pts, base ?? Infinity), Math.max(...pts, base ?? -Infinity));
  const [lo, hi] = [ys[0], ys.at(-1)];
  const X = (i) => (total > 1 ? (i / (total - 1)) * 100 : 50);
  const Y = (v) => 100 - ((v - lo) / (hi - lo || 1)) * 100;
  const line = pts.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(2)} ${Y(v).toFixed(2)}`).join("");
  const hline = (y, cls) => `<line x1="0" x2="100" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" class="${cls}"/>`;
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="iag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity=".02"/></linearGradient></defs>`
    + ys.map((t) => hline(Y(t), "g")).join("") + (base == null ? "" : hline(Y(base), "b"))
    + `<path d="${line}L${X(pts.length - 1).toFixed(2)} 100L0 100Z" fill="url(#iag)"/><path d="${line}" fill="none" stroke="${color}" class="l"/></svg>`
    + ys.map((t) => `<span class="yl" style="top:${Y(t).toFixed(2)}%">${escText(yFmt(t))}</span>`).join("")
    + xLabels.map(([f, text], i) => `<span class="xl${i % 2 ? " odd" : ""}" style="left:${(f * 100).toFixed(2)}%">${escText(text)}</span>`).join("")
    + (base == null ? "" : `<span class="bl" style="top:${Y(base).toFixed(2)}%">${escText(baseLabel)}</span>`);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// X-axis labels for a range of a stock or currency chart ending `today`:
// weekdays for five days, dates for a month, then month or year starts.
export function rangeLabels(range, today) {
  const end = new Date(`${today}T12:00:00Z`);
  if (range.kind === "intraday") return [[0.077, "10 AM"], [0.385, "12 PM"], [0.692, "2 PM"]];
  if (range.kind === "hourly") return [[0.25, "6 AM"], [0.5, "12 PM"], [0.75, "6 PM"]];
  if (range.kind === "5d" || range.kind === "hourly5") {
    return [4, 3, 2, 1, 0].map((b, i) => {
      const d = range.kind === "5d" ? tradingDay(today, b) : new Date(end.getTime() - b * 86_400_000);
      return [i / 5 + 0.1, DAYS[d.getUTCDay()]];
    });
  }
  if (range.back < 60) {
    return [0.12, 0.37, 0.62, 0.87].map((f) => {
      const d = tradingDay(today, Math.round(range.back * (1 - f)));
      return [f, `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`];
    });
  }
  // Trading days to calendar time: five of them to a week.
  const span = (range.back * 7 * 86_400_000) / 5;
  const start = end.getTime() - span;
  const years = range.back > 300;
  const step = years ? 12 : range.back > 160 ? 3 : 1;
  const out = [];
  const d = new Date(start);
  d.setUTCDate(1);
  d.setUTCHours(12);
  if (years) d.setUTCMonth(0);
  for (;;) {
    d.setUTCMonth(d.getUTCMonth() + (years ? 12 : 1));
    if (d.getTime() >= end.getTime()) break;
    if (!years && d.getUTCMonth() % step) continue;
    const f = (d.getTime() - start) / span;
    if (f > 0.03 && f < 0.97) out.push([f, years ? String(d.getUTCFullYear()) : MONTHS[d.getUTCMonth()]]);
  }
  return out;
}

// Minutes east of UTC in an IANA time zone, now.
function zoneOffset(tz, at = new Date()) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = name.match(/([+-])(\d{1,2})(?::?(\d{2}))?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

// ---------- the browser ----------
// Cards stream into the results page (lib/answer-cards.js); each is a
// [data-ia] element whose data-ia-data holds the numbers the runtime needs.
if (typeof document !== "undefined" && !globalThis.__ia) {
  globalThis.__ia = true;
  const $ = (sel, root) => root.querySelector(sel);
  const $$ = (sel, root) => [...root.querySelectorAll(sel)];
  const data = (card) => { try { return JSON.parse(card.dataset.iaData || "{}"); } catch { return {}; } };

  // Tab bars: [data-ia-tabs] holds buttons with data-tab; panels carry
  // data-panel (and data-group, when a card has more than one bar).
  function tabs(card, onChange) {
    for (const bar of $$("[data-ia-tabs]", card)) {
      bar.addEventListener("click", (e) => {
        const b = e.target.closest("[data-tab]");
        if (!b || !bar.contains(b)) return;
        for (const x of $$("[data-tab]", bar)) x.setAttribute("aria-selected", String(x === b));
        for (const p of $$(`[data-panel][data-group="${bar.dataset.iaTabs}"]`, card)) p.hidden = p.dataset.panel !== b.dataset.tab;
        onChange?.(b.dataset.tab);
      });
    }
  }

  // Hovering or touching a chart shows the value under the pointer.
  function hover(box, current, label) {
    const cursor = Object.assign(document.createElement("div"), { className: "ia-cursor", hidden: true });
    const tip = Object.assign(document.createElement("div"), { className: "ia-tip", hidden: true });
    box.append(cursor, tip);
    const move = (clientX) => {
      const { pts, total = pts.length } = current();
      const rect = box.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const i = Math.min(pts.length - 1, Math.round(f * (total - 1)));
      const x = (i / Math.max(1, total - 1)) * 100;
      cursor.style.left = `${x}%`;
      tip.style.left = `${Math.min(88, Math.max(12, x))}%`;
      tip.textContent = label(pts[i]);
      cursor.hidden = tip.hidden = false;
    };
    box.addEventListener("pointermove", (e) => move(e.clientX));
    box.addEventListener("pointerdown", (e) => move(e.clientX));
    box.addEventListener("pointerleave", () => { cursor.hidden = tip.hidden = true; });
  }

  // ---------- calculator ----------
  const pretty = (s) => s.replace(/\*/g, "×").replace(/\//g, "÷").replace(/-/g, "−").replace(/ans/g, "Ans").replace(/sqrt/g, "√")
    .replace(/asin/g, "sin⁻¹").replace(/acos/g, "cos⁻¹").replace(/atan/g, "tan⁻¹");
  const KEYS = { pow: "^", sq: "^2", sqrt: "sqrt(", sin: "sin(", cos: "cos(", tan: "tan(", ln: "ln(", log: "log(", pi: "π", exp: "E" };
  const INVERSE = { sin: "asin(", cos: "acos(", tan: "atan(", ln: "e^(", log: "10^(", sqrt: "^2", pow: "^(1/" };
  function calculator(card) {
    const top = $(".ia-calc-top", card);
    const main = $(".ia-calc-main", card);
    const ac = $("[data-k=ac]", card);
    let expr = "";
    let ans = Number(data(card).value) || 0;
    let done = true; // the display shows a finished answer
    let deg = false;
    let inv = false;
    const show = () => {
      if (expr || !done) main.textContent = expr ? pretty(expr) : "0";
      ac.textContent = done ? "AC" : "CE";
    };
    function press(k) {
      if (k === "ac") {
        if (done || !expr) { expr = ""; done = false; top.textContent = `Ans = ${fmt(ans)}`; }
        else expr = expr.replace(/(?:asin\(|acos\(|atan\(|sqrt\(|sin\(|cos\(|tan\(|ln\(|log\(|ans|.)$/, "");
        return show();
      }
      if (k === "rad" || k === "deg") {
        deg = k === "deg";
        for (const b of $$("[data-k=rad],[data-k=deg]", card)) b.classList.toggle("on", b.dataset.k === k);
        return;
      }
      if (k === "inv") {
        inv = !inv;
        $("[data-k=inv]", card).classList.toggle("on", inv);
        for (const b of $$("[data-inv]", card)) [b.innerHTML, b.dataset.inv] = [b.dataset.inv, b.innerHTML];
        return;
      }
      if (k === "=") {
        if (!expr) return;
        const open = (expr.match(/\(/g) ?? []).length - (expr.match(/\)/g) ?? []).length;
        const full = expr + ")".repeat(Math.max(0, open));
        let out;
        try { out = evaluate(full, { deg, ans }).value; } catch { out = NaN; }
        top.textContent = `${pretty(full)} =`;
        main.textContent = fmt(out);
        if (!Number.isNaN(out)) ans = out;
        expr = "";
        done = true;
        return show();
      }
      if (done) {
        // An operator carries on from the answer; anything else starts afresh.
        top.textContent = `Ans = ${fmt(ans)}`;
        expr = /^[-+*/^%!]$|^(?:pow|sq)$/.test(k) ? "ans" : "";
        done = false;
      }
      expr += (inv && INVERSE[k]) || KEYS[k] || k;
      show();
    }
    card.addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]");
      if (b && card.contains(b)) press(b.dataset.k);
    });
    // Typing works too while the calculator has focus.
    card.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = { Enter: "=", Backspace: "ac", Escape: "ac", x: "*" }[e.key] ?? e.key;
      if (/^[\d.()+\-*/^%!=]$|^ac$/.test(k)) { e.preventDefault(); press(k); }
    });
  }

  // ---------- unit converter ----------
  function converter(card) {
    const [a, b] = $$("input.ia-num", card);
    const [ua, ub] = $$("select.ia-unit", card);
    const cat = $("select.ia-cat", card);
    const formula = $(".ia-formula-text", card);
    const read = (el) => (el.value.trim() === "" ? NaN : Number(el.value.replace(/,/g, "")));
    const update = (from) => {
      if (from === "a") b.value = unitValue(convertUnit(read(a), cat.value, ua.value, ub.value));
      else a.value = unitValue(convertUnit(read(b), cat.value, ub.value, ua.value));
      formula.textContent = unitFormula(cat.value, ua.value, ub.value, Number.isFinite(read(a)) ? read(a) : 1);
    };
    const options = (sel, pick) => sel.replaceChildren(...UNITS[cat.value].units.map(([id, label]) => new Option(label, id, id === pick, id === pick)));
    cat.addEventListener("change", () => {
      const [first, second] = UNITS[cat.value].units;
      options(ua, first[0]);
      options(ub, second[0]);
      a.value = "1";
      update("a");
    });
    a.addEventListener("input", () => update("a"));
    b.addEventListener("input", () => update("b"));
    ua.addEventListener("change", () => update("a"));
    ub.addEventListener("change", () => update("a"));
  }

  // ---------- currency ----------
  function fx(card) {
    const d = data(card);
    const list = [...(d.extra ?? []), ...CURRENCIES];
    const row = (code) => list.find((c) => c[0] === code);
    const [a, b] = $$("input.ia-num", card);
    const [ca, cb] = $$("select.ia-cur", card);
    const head = $(".ia-fx-head", card);
    const [bigNum, bigName] = $$(".ia-fx-big span", card);
    const plot = $(".ia-plot", card);
    let range = d.range;
    const rate = () => row(cb.value)[3] / row(ca.value)[3];
    const series = () => fxSeries({ seed: `${ca.value}>${cb.value}|${d.today}`, rate: rate(), vol: fxVol(row(ca.value), row(cb.value)) })[range];
    let cur = series();
    const draw = () => {
      cur = series();
      plot.innerHTML = chartHTML(cur.pts, { color: cur.pts.at(-1) >= cur.pts[0] ? "#137333" : "#a50e0e", xLabels: rangeLabels(cur, d.today), yFmt: (v) => num(v, 3) });
    };
    const read = (el) => (el.value.trim() === "" ? NaN : Number(el.value.replace(/,/g, "")));
    const update = (from) => {
      if (from === "a") b.value = Number.isFinite(read(a)) ? (read(a) * rate()).toFixed(2) : "";
      else a.value = Number.isFinite(read(b)) ? (read(b) / rate()).toFixed(2) : "";
      const amt = Number.isFinite(read(a)) ? read(a) : 1;
      head.textContent = `${num(amt, 2)} ${row(ca.value)[1]} equals`;
      bigNum.textContent = num(amt * rate(), 2);
      bigName.textContent = row(cb.value)[1];
    };
    a.addEventListener("input", () => update("a"));
    b.addEventListener("input", () => update("b"));
    for (const sel of [ca, cb]) sel.addEventListener("change", () => { update("a"); draw(); });
    tabs(card, (t) => { range = t; draw(); });
    hover($(".ia-chart", card), () => cur, (v) => num(v, 4));
  }

  // ---------- stocks ----------
  const WHEN = { "1D": "today", "5D": "past 5 days", "1M": "past month", "6M": "past 6 months", YTD: "year to date", "1Y": "past year", "5Y": "past 5 years" };
  function stock(card) {
    const d = data(card);
    const { ranges } = stockSeries(d.series);
    const plot = $(".ia-plot", card);
    const change = $(".ia-stock-change", card);
    let range = "1D";
    tabs(card, (t) => {
      range = t;
      const r = ranges[range];
      const ref = range === "1D" ? d.series.prevClose : r.pts[0];
      const diff = r.pts.at(-1) - ref;
      plot.innerHTML = chartHTML(r.pts, {
        color: diff >= 0 ? "#137333" : "#a50e0e", total: r.total ?? r.pts.length, base: range === "1D" ? ref : null,
        baseLabel: `Prev close ${money(ref)}`, xLabels: rangeLabels(r, d.today),
      });
      change.className = `ia-stock-change ${diff >= 0 ? "up" : "down"}`;
      change.textContent = `${diff >= 0 ? "+" : "−"}${money(Math.abs(diff))} (${Math.abs((diff / ref) * 100).toFixed(2)}%) ${diff >= 0 ? "↑" : "↓"} ${WHEN[range]}`;
    });
    hover($(".ia-chart", card), () => ranges[range], (v) => `${money(v)} ${d.currency}`);
  }

  // ---------- weather ----------
  function weather(card) {
    const d = data(card);
    const icon = $(".ia-wx-icon", card);
    const nowIcon = icon.innerHTML;
    const plot = $(".ia-plot", card);
    const days = $$(".ia-wx-day", card);
    let unit = d.unit;
    let day = 0;
    let metric = "temp";
    const conv = (t) => (unit === d.unit ? t : unit === "F" ? (t * 9) / 5 + 32 : ((t - 32) * 5) / 9);
    const T = (t) => String(Math.round(conv(t)));
    const paint = () => {
      const x = d.days[day];
      const now = day ? x : d.now;
      $(".ia-wx-temp", card).textContent = T(day ? x.hi : d.now.temp);
      for (const u of $$("[data-unit]", card)) u.setAttribute("aria-pressed", String(u.dataset.unit === unit));
      icon.innerHTML = day ? $(".ic", days[day]).innerHTML : nowIcon;
      $(".ia-wx-precip", card).textContent = `${now.precip}%`;
      $(".ia-wx-hum", card).textContent = `${now.humidity}%`;
      $(".ia-wx-wind", card).textContent = `${now.wind} ${d.speed}`;
      $(".ia-wx-when", card).textContent = day ? x.name : d.nowLabel;
      $(".ia-wx-cond", card).textContent = now.cond;
      days.forEach((el, i) => {
        el.setAttribute("aria-selected", String(i === day));
        $(".hi", el).textContent = `${T(d.days[i].hi)}°`;
        $(".lo", el).textContent = `${T(d.days[i].lo)}°`;
      });
      plot.innerHTML = wxChart(x.hours, metric, conv, d.speed);
    };
    card.addEventListener("click", (e) => {
      const u = e.target.closest("[data-unit]");
      if (u) { unit = u.dataset.unit; paint(); }
      const dd = e.target.closest(".ia-wx-day");
      if (dd) { day = days.indexOf(dd); paint(); }
    });
    tabs(card, (t) => { metric = t; paint(); });
  }

  // ---------- clock ----------
  function clock(card) {
    const d = data(card);
    const opts = { timeZone: d.tz || "UTC" };
    const shift = d.tz ? 0 : d.utcOffset * 3_600_000;
    const tick = () => {
      const at = new Date(Date.now() + shift);
      $(".ia-time-big", card).textContent = at.toLocaleTimeString("en-US", { ...opts, hour: "numeric", minute: "2-digit" });
      $(".ia-time-date", card).textContent = `${at.toLocaleDateString("en-US", { ...opts, weekday: "long", month: "long", day: "numeric", year: "numeric" })}${d.abbr ? ` (${d.abbr})` : ""}`;
      // How far ahead of the visitor's own clock it is.
      const diff = ((d.tz ? zoneOffset(d.tz) : d.utcOffset * 60) + new Date().getTimezoneOffset()) / 60;
      const h = Math.abs(diff);
      $(".ia-time-rel", card).textContent = diff === 0 ? "Same time as you" : `${Number(h.toFixed(2))} hour${h === 1 ? "" : "s"} ${diff > 0 ? "ahead of" : "behind"} you`;
    };
    tick();
    setInterval(tick, 5000);
  }

  // ---------- dictionary ----------
  function dictionary(card) {
    const say = $(".ia-say", card);
    if ("speechSynthesis" in globalThis) {
      say?.addEventListener("click", () => {
        speechSynthesis.cancel();
        speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(data(card).word), { rate: 0.85 }));
      });
    } else if (say) say.hidden = true;
    const more = $(".ia-more", card);
    more?.addEventListener("click", () => more.setAttribute("aria-expanded", String(card.classList.toggle("open"))));
  }

  const INIT = { calculator, units: converter, currency: fx, stock, weather, time: clock, dictionary, sports: (card) => tabs(card) };
  const boot = () => {
    for (const card of document.querySelectorAll("[data-ia]:not([data-ia-on])")) {
      card.dataset.iaOn = "";
      try { INIT[card.dataset.ia]?.(card); } catch (err) { console.warn("[answers]", err); }
    }
  };
  boot();
  // A card that streams in after this script (or replaces its placeholder).
  new MutationObserver(boot).observe(document.body, { childList: true, subtree: true });
}

// ---------- weather chart ----------
// Shared so the server draws the first chart exactly as the day switcher
// redraws it. hours: { time, temp, precip, wind } arrays.
export function wxChart(hours, metric = "temp", conv = (t) => t, speed = "km/h") {
  const n = hours.time.length;
  const labels = hours.time.map((t, i) => [(i + 0.5) / n, t]);
  if (metric === "temp") {
    const pts = hours.temp.map(conv);
    const lo = Math.min(...pts);
    const hi = Math.max(...pts);
    const span = hi - lo || 4;
    // Points sit at the middle of each slot, like the bars in the other tabs.
    const at = pts.map((v, i) => ({ v, x: ((i + 0.5) / n) * 100 }));
    const Y = (v) => 100 - ((v - (lo - span * 0.9)) / (span * 2.1)) * 100;
    const line = at.map(({ v, x }, i) => `${i ? "L" : "M"}${x.toFixed(2)} ${Y(v).toFixed(2)}`).join("");
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 ${Y(pts[0]).toFixed(2)}L${line.slice(1)}L100 ${Y(pts.at(-1)).toFixed(2)}L100 100L0 100Z" fill="#fef7e0"/><path d="M0 ${Y(pts[0]).toFixed(2)}L${line.slice(1)}L100 ${Y(pts.at(-1)).toFixed(2)}" fill="none" stroke="#fbbc04" class="l"/></svg>`
      + at.map(({ v, x }) => `<span class="vl" style="left:${x.toFixed(2)}%;top:${Y(v).toFixed(2)}%">${Math.round(v)}</span>`).join("")
      + labels.map(([f, t], i) => `<span class="xl${i % 2 ? " odd" : ""}" style="left:${(f * 100).toFixed(2)}%">${escText(t)}</span>`).join("");
  }
  const vals = metric === "precip" ? hours.precip : hours.wind;
  const max = metric === "precip" ? 100 : Math.max(...vals, 1);
  return vals.map((v, i) => `<span class="ia-bar" style="left:${((i / n) * 100).toFixed(2)}%;width:${(100 / n).toFixed(2)}%"><b>${metric === "precip" ? `${v}%` : `${v} ${speed}`}</b><i class="${metric}" style="height:${Math.max(2, (v / max) * 62).toFixed(1)}%"></i></span>`).join("")
    + labels.map(([f, t], i) => `<span class="xl${i % 2 ? " odd" : ""}" style="left:${(f * 100).toFixed(2)}%">${escText(t)}</span>`).join("");
}
