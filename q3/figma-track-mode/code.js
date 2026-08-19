// Sunswift Track Mode — one 1440×900 frame plus four component sets.
// Colours sampled from the public sunswift.com page (#0A0C0E) and icon.svg
// (#FFD400). Not claimed as official brand tokens.
//
// Yellow appears on the brand mark and nowhere else, so it can never be read
// as a caution. Amber means estimated, red means over limit, bone means
// measured — colour on a value encodes danger, never data quality.

const C = {
  bg: "#0A0C0E",
  text: "#F3F0E8",
  label: "#E4DFD4",
  muted: "#C9C4B8",
  yellow: "#FFD400",
  amber: "#E39B12",
  red: "#FF5B4F",
  redField: "#43140F",
  grid: "#444A50",
  gridBase: "#5C6269",
  rule: "#2E3236",
};

const W = 1440;
const H = 900;

// Driver-facing wording, matching the strings q1/src/Dashboard.jsx already ships.
const STATE = {
  OK: { label: "", color: C.text, dashes: null },
  Estimated: { label: "ESTIMATED", color: C.amber, dashes: [26, 18] },
  Recovered: { label: "CONFIRMED LATE", color: C.amber, dashes: [10, 8] },
  Unavailable: { label: "NO SIGNAL", color: C.muted, dashes: [4, 10] },
  High: { label: "OVER LIMIT", color: C.red, dashes: [] },
};

let fonts = {
  label: { family: "Inter", style: "Semi Bold" },
  labelMed: { family: "Inter", style: "Medium" },
  labelBold: { family: "Inter", style: "Bold" },
  value: { family: "Inter", style: "Bold" },
  valueMed: { family: "Inter", style: "Medium" },
};

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function solid(hex, opacity) {
  const paint = { type: "SOLID", color: rgb(hex) };
  if (opacity !== undefined) paint.opacity = opacity;
  return [paint];
}

async function tryFont(family, style) {
  try {
    const font = { family, style };
    await figma.loadFontAsync(font);
    return font;
  } catch (e) {
    return null;
  }
}

async function loadFonts() {
  const inter = [
    await tryFont("Inter", "Regular"),
    await tryFont("Inter", "Medium"),
    await tryFont("Inter", "Semi Bold"),
    await tryFont("Inter", "Bold"),
  ];
  if (!inter[3]) throw new Error("Inter Bold is required");
  fonts.label = inter[2] || inter[3];
  fonts.labelMed = inter[1] || inter[3];
  fonts.labelBold = inter[3];

  const monoBold =
    (await tryFont("Roboto Mono", "Bold")) ||
    (await tryFont("IBM Plex Mono", "Bold")) ||
    inter[3];
  const monoMed =
    (await tryFont("Roboto Mono", "Medium")) ||
    (await tryFont("IBM Plex Mono", "Medium")) ||
    fonts.labelMed;
  fonts.value = monoBold;
  fonts.valueMed = monoMed;
}

function textNode(chars, opts) {
  const n = figma.createText();
  n.name = opts.name || chars || "Text";
  n.fontName = opts.font || fonts.label;
  n.characters = chars;
  n.fontSize = opts.size;
  n.fills = solid(opts.color || C.text);
  if (opts.tracking != null) n.letterSpacing = { unit: "PIXELS", value: opts.tracking };
  n.lineHeight = { unit: "PIXELS", value: opts.lineHeight || opts.size };
  if (opts.width) {
    n.textAutoResize = "NONE";
    n.resize(opts.width, opts.lineHeight || opts.size);
    n.textAlignHorizontal = opts.align || "LEFT";
    n.textAlignVertical = opts.valign || "BOTTOM";
  } else {
    n.textAutoResize = "WIDTH_AND_HEIGHT";
  }
  return n;
}

function rect(w, h, hex, name) {
  const r = figma.createRectangle();
  r.name = name || "Rect";
  r.resize(w, h);
  r.fills = hex ? solid(hex) : [];
  return r;
}

function frame(name, w, h, hex) {
  const f = figma.createFrame();
  f.name = name;
  f.resize(w, h);
  f.fills = hex ? solid(hex) : [];
  f.clipsContent = false;
  return f;
}

function auto(name, opts) {
  const f = frame(name, opts.w || 10, opts.h || 10, opts.fill);
  f.layoutMode = opts.dir || "HORIZONTAL";
  f.primaryAxisAlignItems = opts.align || "MIN";
  f.counterAxisAlignItems = opts.counter || "CENTER";
  f.itemSpacing = opts.gap || 0;
  f.paddingTop = opts.pt || 0;
  f.paddingRight = opts.pr || 0;
  f.paddingBottom = opts.pb || 0;
  f.paddingLeft = opts.pl || 0;
  f.primaryAxisSizingMode = opts.fixedW ? "FIXED" : "AUTO";
  f.counterAxisSizingMode = opts.fixedH ? "FIXED" : "AUTO";
  if (opts.w) f.resize(opts.w, opts.h || f.height);
  if (opts.h && opts.fixedH) f.resize(f.width, opts.h);
  return f;
}

function variantOf(set, props) {
  const node = set.children.find((child) => {
    if (child.type !== "COMPONENT") return false;
    const current = child.variantProperties || {};
    return Object.keys(props).every((key) => current[key] === props[key]);
  });
  if (!node) throw new Error("No variant " + JSON.stringify(props) + " in " + set.name);
  return node;
}

function hLine(length, hex, weight, dashes, name) {
  const line = figma.createLine();
  line.name = name || "Line";
  line.resize(length, 0);
  line.strokes = solid(hex);
  line.strokeWeight = weight;
  line.strokeCap = "NONE";
  line.dashPattern = dashes || [];
  return line;
}

/* --------------------------------------------------------- quality badge */

// A rule under the value plus one word. Both the dash pattern and the word
// carry the state, so nothing here depends on colour being seen.
function makeBadge(state) {
  const spec = STATE[state];

  const c = figma.createComponent();
  c.name = "State=" + state;
  c.layoutMode = "VERTICAL";
  c.primaryAxisAlignItems = "MIN";
  c.counterAxisAlignItems = "MIN";
  c.itemSpacing = 12;
  c.fills = [];
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "FIXED";
  c.resize(296, 40);

  const rule = hLine(296, spec.color, 6, spec.dashes || [], "State Rule");
  rule.layoutAlign = "STRETCH";
  rule.visible = state !== "OK";
  c.appendChild(rule);

  // The OK variant keeps the empty slot at full height so that a channel
  // changing state never moves anything below it.
  const label = textNode(spec.label, {
    name: "State Label",
    font: fonts.label,
    size: 20,
    color: spec.color,
    tracking: 1.6,
  });
  label.visible = state !== "OK";
  c.appendChild(label);
  return c;
}

function makeBadgeSet(parent) {
  const comps = ["OK", "Estimated", "Recovered", "Unavailable", "High"].map(makeBadge);
  comps.forEach((c) => parent.appendChild(c));
  const set = figma.combineAsVariants(comps, parent);
  set.name = "Quality Badge";
  return set;
}

/* ----------------------------------------------------------- chart legend */

function makeLegendItem(kind) {
  const spec = {
    Measured: { label: "Measured", color: C.text, dashes: [], dot: null },
    Estimated: { label: "Estimated", color: C.amber, dashes: [14, 9], dot: "hollow" },
    Recovered: { label: "Confirmed late", color: C.text, dashes: [], dot: "filled" },
    Unavailable: { label: "No signal", color: C.muted, dashes: [], dot: null },
  }[kind];

  const c = figma.createComponent();
  c.name = "Kind=" + kind;
  c.layoutMode = "HORIZONTAL";
  c.counterAxisAlignItems = "CENTER";
  c.itemSpacing = 12;
  c.fills = [];
  c.primaryAxisSizingMode = "AUTO";
  c.counterAxisSizingMode = "AUTO";

  const swatch = frame("Swatch", 52, 24);
  swatch.fills = [];
  if (kind === "Unavailable") {
    const stubL = rect(12, 4, spec.color, "Stub Left");
    stubL.x = 0;
    stubL.y = 10;
    const tickL = rect(3, 24, spec.color, "Gap Tick Left");
    tickL.x = 15;
    tickL.y = 0;
    const tickR = rect(3, 24, spec.color, "Gap Tick Right");
    tickR.x = 33;
    tickR.y = 0;
    const stubR = rect(12, 4, spec.color, "Stub Right");
    stubR.x = 40;
    stubR.y = 10;
    [stubL, tickL, tickR, stubR].forEach((n) => swatch.appendChild(n));
  } else {
    const line = hLine(52, spec.color, 4, spec.dashes, "Sample");
    line.x = 0;
    line.y = 12;
    swatch.appendChild(line);
    if (spec.dot) {
      const dot = figma.createEllipse();
      dot.name = spec.dot === "filled" ? "Filled Point" : "Hollow Point";
      dot.resize(14, 14);
      dot.x = 19;
      dot.y = 5;
      if (spec.dot === "filled") {
        dot.fills = solid(C.amber);
        dot.strokes = [];
      } else {
        dot.fills = solid(C.bg);
        dot.strokes = solid(C.amber);
        dot.strokeWeight = 3;
        dot.strokeAlign = "CENTER";
      }
      swatch.appendChild(dot);
    }
  }
  c.appendChild(swatch);
  c.appendChild(textNode(spec.label, { name: "Label", font: fonts.labelMed, size: 16, color: C.label }));
  return c;
}

function makeLegendSet(parent) {
  const comps = ["Measured", "Estimated", "Recovered", "Unavailable"].map(makeLegendItem);
  comps.forEach((c) => parent.appendChild(c));
  const set = figma.combineAsVariants(comps, parent);
  set.name = "Chart Legend Item";
  return set;
}

/* ---------------------------------------------------------------- banner */

function warningMark() {
  const g = frame("Mark", 44, 40);
  g.fills = [];
  const triangle = figma.createVector();
  triangle.name = "Triangle";
  triangle.vectorPaths = [{ windingRule: "EVENODD", data: "M 22 0 L 44 40 L 0 40 Z" }];
  triangle.fills = solid(C.red);
  triangle.strokes = [];
  triangle.resize(44, 40);
  g.appendChild(triangle);

  // Knocked out of the triangle rather than drawn over it, so the mark reads
  // as one shape at a glance.
  const stem = rect(4.5, 15, C.redField, "Stem");
  stem.x = 19.75;
  stem.y = 12;
  const dot = rect(4.5, 4.5, C.redField, "Dot");
  dot.x = 19.75;
  dot.y = 31;
  g.appendChild(stem);
  g.appendChild(dot);
  return g;
}

function makeBanner(state) {
  const c = figma.createComponent();
  c.name = "State=" + state;
  c.layoutMode = "HORIZONTAL";
  c.primaryAxisAlignItems = state === "Active" ? "SPACE_BETWEEN" : "MIN";
  c.counterAxisAlignItems = "CENTER";
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "FIXED";
  c.resize(1344, 96);
  c.clipsContent = true;

  // Clear keeps the Active height so clearing a warning never shifts the speed.
  if (state === "Clear") {
    c.fills = [];
    return c;
  }

  c.fills = solid(C.redField);
  const accent = rect(8, 96, C.red, "Accent");
  accent.layoutAlign = "STRETCH";
  c.itemSpacing = 24;
  c.paddingRight = 32;
  c.appendChild(accent);

  const messageRow = auto("Message", { dir: "HORIZONTAL", gap: 22, counter: "CENTER" });
  messageRow.appendChild(warningMark());
  messageRow.appendChild(
    textNode("MOTOR TEMPERATURE HIGH", {
      name: "Message",
      font: fonts.labelBold,
      size: 32,
      color: C.text,
      tracking: 1,
    })
  );
  c.appendChild(messageRow);

  // Repeats the reading the panel below also shows. Deliberate: the red band
  // is what the eye lands on first, and it has to answer "how bad" on its own.
  c.appendChild(
    textNode("91 °C  ·  LIMIT 90", {
      name: "Reading",
      font: fonts.value,
      size: 26,
      color: C.text,
    })
  );
  return c;
}

function makeBannerSet(parent) {
  const comps = ["Active", "Clear"].map(makeBanner);
  comps.forEach((c) => parent.appendChild(c));
  const set = figma.combineAsVariants(comps, parent);
  set.name = "Warning Banner";
  return set;
}

/* ---------------------------------------------------------- value blocks */

function makeValueBlock(size, quality, alert, badgeSet) {
  // The numeric field is wide enough for the largest reading the channel can
  // produce and the digits are right-aligned inside it, so the ones digit and
  // the unit never move.
  const sizes = {
    Hero: { field: 432, value: 240, unit: 36, gap: 32 },
    Primary: { field: 296, value: 112, unit: 30, gap: 20 },
    Secondary: { field: 296, value: 96, unit: 30, gap: 20 },
  }[size];

  const sample = {
    Hero: { label: "SPEED", value: quality === "Unavailable" ? "—" : "84", unit: "km/h" },
    Primary: { label: "MOTOR TEMP", value: "91", unit: "°C" },
    Secondary:
      quality === "Unavailable"
        ? { label: "GPS", value: "—", unit: "" }
        : { label: "BATTERY", value: "72", unit: "%" },
  }[size];

  const c = figma.createComponent();
  c.name = "Size=" + size + ", Quality=" + quality + ", Alert=" + (alert ? "On" : "Off");
  c.layoutMode = "VERTICAL";
  c.primaryAxisAlignItems = "MIN";
  c.counterAxisAlignItems = "MIN";
  c.itemSpacing = size === "Hero" ? 24 : 18;
  c.fills = [];
  c.primaryAxisSizingMode = "AUTO";
  c.counterAxisSizingMode = "AUTO";

  c.appendChild(
    textNode(sample.label, {
      name: "Channel",
      font: fonts.label,
      size: 20,
      color: C.label,
      tracking: 1.6,
    })
  );

  const valueRow = auto("Value Row", { dir: "HORIZONTAL", gap: sizes.gap, counter: "BASELINE" });
  try {
    valueRow.counterAxisAlignItems = "BASELINE";
  } catch (e) {
    valueRow.counterAxisAlignItems = "MAX";
  }
  valueRow.appendChild(
    textNode(sample.value, {
      name: "Value",
      // Bone at every quality. Dimming the number to signal uncertainty
      // punishes the read the driver most needs; the rule below carries it.
      color: alert ? C.red : C.text,
      font: fonts.value,
      size: sizes.value,
      width: sizes.field,
      align: "RIGHT",
      lineHeight: sizes.value,
      valign: "BOTTOM",
    })
  );
  if (sample.unit) {
    valueRow.appendChild(
      textNode(sample.unit, {
        name: "Unit",
        font: fonts.value,
        size: sizes.unit,
        color: C.muted,
      })
    );
  }
  c.appendChild(valueRow);

  const badge = variantOf(badgeSet, { State: alert ? "High" : quality }).createInstance();
  badge.name = "State";
  badge.resize(sizes.field, badge.height);
  c.appendChild(badge);
  return c;
}

function makeValueSet(parent, badgeSet) {
  const specs = [
    ["Hero", "OK", false],
    ["Hero", "Estimated", false],
    ["Hero", "Recovered", false],
    ["Hero", "Unavailable", false],
    ["Primary", "OK", true],
    ["Primary", "OK", false],
    ["Primary", "Estimated", false],
    ["Secondary", "OK", false],
    ["Secondary", "Estimated", false],
    ["Secondary", "Unavailable", false],
  ];
  const comps = specs.map(([size, quality, alert]) => makeValueBlock(size, quality, alert, badgeSet));
  comps.forEach((c) => parent.appendChild(c));
  const set = figma.combineAsVariants(comps, parent);
  set.name = "Telemetry Value Block";
  return set;
}

/* ----------------------------------------------------------------- chart */

const PLOT = { x: 108, w: 1236, top: 698, h: 116, vMin: 50, vMax: 100 };
const cx = (t) => PLOT.x + (t / 19) * PLOT.w;
const cy = (v) => PLOT.top + PLOT.h - ((v - PLOT.vMin) / (PLOT.vMax - PLOT.vMin)) * PLOT.h;

const samples = [
  { t: 0, v: 58.0 },
  { t: 1, v: 61.2 },
  { t: 2, v: 65.0 },
  { t: 3, v: 69.4 },
  { t: 4, v: 73.8 },
  { t: 5, v: 78.0 },
  { t: 6, v: 81.6 },
  { t: 7, v: 84.2 },
  { t: 8, v: 84.4 },
  { t: 9, v: 83.8 },
  { t: 10, v: null },
  { t: 11, v: null },
  { t: 12, v: 75.6 },
  { t: 13, v: 77.8 },
  { t: 14, v: 80.4 },
  { t: 15, v: 82.2 },
  { t: 16, v: 83.4 },
  { t: 17, v: 83.8 },
  { t: 18, v: 84.0 },
  { t: 19, v: 84.0 },
];

function tracePoint(i) {
  return { x: cx(samples[i].t), y: cy(samples[i].v) };
}

function polyline(name, from, to, hex, dashes) {
  const v = figma.createVector();
  v.name = name;
  const points = [];
  for (let i = from; i <= to; i++) points.push(tracePoint(i));
  v.vectorPaths = [
    {
      windingRule: "NONE",
      data: points.map((p, i) => (i === 0 ? "M " : "L ") + p.x + " " + p.y).join(" "),
    },
  ];
  v.fills = [];
  v.strokes = solid(hex);
  v.strokeWeight = 4;
  v.strokeCap = "ROUND";
  v.strokeJoin = "ROUND";
  v.dashPattern = dashes || [];
  return v;
}

function point(i, filled) {
  const p = tracePoint(i);
  const e = figma.createEllipse();
  e.name = filled ? "Confirmed Late Point" : "Estimated Point";
  e.resize(14, 14);
  e.x = p.x - 7;
  e.y = p.y - 7;
  if (filled) {
    e.fills = solid(C.amber);
    e.strokes = [];
  } else {
    e.fills = solid(C.bg);
    e.strokes = solid(C.amber);
    e.strokeWeight = 3;
    e.strokeAlign = "CENTER";
  }
  return e;
}

function buildChart(screen) {
  const group = frame("Speed History", W, H);
  group.x = 0;
  group.y = 0;
  group.fills = [];
  screen.appendChild(group);

  const rule = rect(1344, 1, C.rule, "Chart Rule");
  rule.x = 48;
  rule.y = 644;
  group.appendChild(rule);

  const title = textNode("SPEED HISTORY", {
    name: "Chart Title",
    font: fonts.label,
    size: 18,
    color: C.label,
    tracking: 1.4,
  });
  title.x = 48;
  title.y = 660;
  group.appendChild(title);

  const meta = textNode("km/h  ·  LAST 20 s", {
    name: "Chart Meta",
    font: fonts.labelMed,
    size: 18,
    color: C.muted,
    width: 300,
    align: "RIGHT",
    lineHeight: 22,
  });
  meta.x = 1092;
  meta.y = 658;
  group.appendChild(meta);

  const grid = frame("Chart Grid", W, H);
  grid.fills = [];
  [100, 75, 50].forEach((tick) => {
    const y = cy(tick);
    const line = rect(PLOT.w, 1, tick === PLOT.vMin ? C.gridBase : C.grid, "Grid " + tick);
    line.x = PLOT.x;
    line.y = y;
    grid.appendChild(line);
    const label = textNode(String(tick), {
      name: "Y " + tick,
      font: fonts.valueMed,
      size: 16,
      color: C.muted,
      width: 48,
      align: "RIGHT",
      lineHeight: 20,
    });
    label.x = 48;
    label.y = y - 10;
    grid.appendChild(label);
  });
  [
    { t: 0, label: "-20 s", align: "LEFT" },
    { t: 9.5, label: "-10 s", align: "CENTER" },
    { t: 19, label: "NOW", align: "RIGHT" },
  ].forEach((tick) => {
    const label = textNode(tick.label, {
      name: "X " + tick.label,
      font: tick.label === "NOW" ? fonts.label : fonts.labelMed,
      size: 16,
      color: tick.label === "NOW" ? C.label : C.muted,
      width: 96,
      align: tick.align,
      lineHeight: 20,
    });
    const x = cx(tick.t);
    label.x = tick.align === "LEFT" ? x : tick.align === "RIGHT" ? x - 96 : x - 48;
    label.y = 830;
    grid.appendChild(label);
  });
  group.appendChild(grid);

  const trace = frame("Chart Trace", W, H);
  trace.fills = [];
  trace.appendChild(polyline("Measured Segment A", 0, 7, C.text));
  trace.appendChild(polyline("Estimated Segment A", 7, 9, C.amber, [14, 10]));
  [8, 9].forEach((i) => trace.appendChild(point(i, false)));

  // The trace stops rather than bridging the gap: drawing through samples we
  // do not have is the one lie the whole quality contract exists to prevent.
  const gapL = tracePoint(9);
  const gapR = tracePoint(12);
  const tickL = rect(3, 40, C.muted, "Gap Tick Left");
  tickL.x = gapL.x - 1.5;
  tickL.y = gapL.y - 20;
  const tickR = rect(3, 40, C.muted, "Gap Tick Right");
  tickR.x = gapR.x - 1.5;
  tickR.y = gapR.y - 20;
  trace.appendChild(tickL);
  trace.appendChild(tickR);

  trace.appendChild(point(12, true));
  trace.appendChild(polyline("Measured Segment B", 12, 16, C.text));
  trace.appendChild(polyline("Estimated Segment B", 16, 19, C.amber, [14, 10]));
  [17, 18, 19].forEach((i) => trace.appendChild(point(i, false)));
  group.appendChild(trace);
  return group;
}

/* ---------------------------------------------------------------- screen */

function buildScreen(sets) {
  const screen = frame("Track Mode", W, H, C.bg);
  screen.clipsContent = true;
  screen.x = 0;
  screen.y = 0;

  const mark = rect(6, 26, C.yellow, "Brand Mark");
  mark.x = 48;
  mark.y = 34;
  screen.appendChild(mark);

  const word = textNode("SUNSWIFT", { name: "Wordmark", font: fonts.label, size: 18, color: C.label, tracking: 1.2 });
  word.x = 68;
  word.y = 38;
  screen.appendChild(word);

  const mode = textNode("TRACK MODE", { name: "Mode Label", font: fonts.label, size: 18, color: C.muted, tracking: 1.2 });
  mode.x = 222;
  mode.y = 38;
  screen.appendChild(mode);

  // GPS is the least consequential channel here, so it gets the smallest type
  // on the screen rather than a full-size block.
  const gps = auto("GPS", { dir: "HORIZONTAL", gap: 26, counter: "CENTER" });
  gps.appendChild(textNode("GPS", { name: "Channel", font: fonts.label, size: 16, color: C.label, tracking: 1.2 }));
  gps.appendChild(textNode("—", { name: "Value", font: fonts.value, size: 22, color: C.muted }));
  gps.appendChild(textNode("NO SIGNAL", { name: "State", font: fonts.label, size: 16, color: C.muted, tracking: 0.8 }));
  screen.appendChild(gps);
  gps.x = 1392 - gps.width;
  gps.y = 36;

  const banner = variantOf(sets.banner, { State: "Active" }).createInstance();
  banner.name = "Warning Banner";
  banner.x = 48;
  banner.y = 86;
  screen.appendChild(banner);

  const speed = variantOf(sets.value, { Size: "Hero", Quality: "Estimated", Alert: "Off" }).createInstance();
  speed.name = "Speed";
  speed.x = 48;
  speed.y = 214;
  screen.appendChild(speed);

  // No divider between the columns; the gutter is wide enough to do the job.
  const motor = variantOf(sets.value, { Size: "Primary", Quality: "OK", Alert: "On" }).createInstance();
  motor.name = "Motor Temperature";
  motor.x = 1040;
  motor.y = 214;
  screen.appendChild(motor);

  const battery = variantOf(sets.value, { Size: "Secondary", Quality: "OK", Alert: "Off" }).createInstance();
  battery.name = "Battery";
  battery.x = 1040;
  battery.y = 444;
  screen.appendChild(battery);

  buildChart(screen);

  const legend = auto("Chart Legend", { dir: "HORIZONTAL", gap: 44, counter: "CENTER" });
  ["Measured", "Estimated", "Recovered", "Unavailable"].forEach((kind) => {
    const item = variantOf(sets.legend, { Kind: kind }).createInstance();
    item.name = kind;
    legend.appendChild(item);
  });
  legend.x = 48;
  legend.y = 862;
  screen.appendChild(legend);

  return screen;
}

async function main() {
  await loadFonts();

  const page = figma.createPage();
  page.name = "Sunswift Track Mode";
  page.backgrounds = solid("#16181A");
  if (figma.setCurrentPageAsync) await figma.setCurrentPageAsync(page);
  else figma.currentPage = page;

  const library = frame("Component library — not a screen", 1600, 900);
  library.x = 0;
  library.y = 1000;
  library.fills = [];
  library.layoutMode = "HORIZONTAL";
  library.itemSpacing = 48;
  library.paddingTop = 24;
  library.paddingLeft = 24;
  library.counterAxisAlignItems = "MIN";
  library.primaryAxisSizingMode = "AUTO";
  library.counterAxisSizingMode = "AUTO";
  page.appendChild(library);

  const badge = makeBadgeSet(library);
  const legend = makeLegendSet(library);
  const banner = makeBannerSet(library);
  const value = makeValueSet(library, badge);

  const screen = buildScreen({ badge, legend, banner, value });
  page.appendChild(screen);
  figma.viewport.scrollAndZoomIntoView([screen]);
}

main()
  .then(() => figma.closePlugin("Created Track Mode (1440×900)"))
  .catch((err) => figma.closePlugin("Track Mode failed: " + err.message));
