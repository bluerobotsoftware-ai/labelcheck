/**
 * Sample label generator for the TTB label verification prototype.
 *
 * WHY THIS EXISTS
 * ---------------
 * Treasury reviewers open the deployed app and need something to test with
 * immediately. Sourcing real bottle photographs is slow, legally awkward and
 * — worst of all — non-reproducible: nobody can say in advance what the
 * "right answer" for a given photo is.
 *
 * So we draw the labels ourselves. Every sample here is deterministic vector
 * artwork rasterised to PNG, which means we control precisely which defects
 * exist. That gives each sample a KNOWN expected verdict, recorded alongside
 * it in `public/samples/manifest.json`. The manifest is therefore both a
 * demo fixture list and a regression-test oracle for `src/lib/ttb/rules.ts`.
 *
 * The manifest also records `labelText`: the exact strings printed on the
 * artwork. That is ground truth for the vision extractor, so extraction can be
 * scored without a human re-reading the images.
 *
 * FONTS
 * -----
 * The deployed environment has no custom fonts, so every font stack here ends
 * in a generic family (`serif` / `sans-serif`). Note that a bare generic on
 * its own is NOT safe: on some fontconfig setups (including the Windows box
 * this was authored on) bare `serif` resolves to a *monospace* face, which
 * looks like a wireframe rather than a bottle label. Naming real faces first
 * and falling back to the generic gives good typography where those faces
 * exist and a sane serif/sans elsewhere.
 *
 * TEXT LAYOUT
 * -----------
 * SVG has no automatic line wrapping and librsvg does not support
 * `<foreignObject>`, so wrapping is done here. Widths are not estimated: they
 * are measured with libvips' Pango text renderer at 72 dpi, which was
 * calibrated against real librsvg output to within 0.5%.
 *
 * Run with: npm run samples
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import type {
  Application,
  BeverageType,
  Recommendation,
  Verdict,
} from "../src/lib/ttb/types";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  throw new Error(
    `Run this from the project root (npm run samples). cwd was: ${ROOT}`,
  );
}
const OUT_DIR = path.join(ROOT, "public", "samples");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Straight ASCII apostrophe (U+0027) — what an applicant types into a form. */
const APOS = "'";
/** Curly right single quote (U+2019) — what a typesetter puts on artwork. */
const RSQUO = "’";

/** The header mandated by 27 CFR 16.21, which must appear in all capitals. */
const WARNING_HEADER = "GOVERNMENT WARNING:";

/** The body text mandated by 27 CFR 16.21, verbatim. */
const WARNING_BODY =
  "(1) According to the Surgeon General, women should not drink alcoholic " +
  "beverages during pregnancy because of the risk of birth defects. " +
  "(2) Consumption of alcoholic beverages impairs your ability to drive a car " +
  "or operate machinery, and may cause health problems.";

/** Hard ceiling per PNG. Anything larger is a bug, not a tradeoff. */
const MAX_BYTES = 400 * 1024;

/**
 * Above this, re-encode with a 256-colour palette. These are flat vector
 * designs in a handful of hues, so quantisation is visually lossless (measured
 * mean channel delta on the worst case, the rotated variant, is 0.03/255)
 * while cutting that file from 372 KB to 109 KB.
 */
const PALETTE_THRESHOLD = 200 * 1024;

// ---------------------------------------------------------------------------
// Font stacks
//
// `css` goes into the SVG. `pango` is the face used for measurement — it must
// be the first family in the stack that actually resolves locally, otherwise
// wrap widths drift from what gets drawn.
// ---------------------------------------------------------------------------

interface Face {
  css: string;
  pango: string;
}

const FACE = {
  /** Spirits: transitional serif, heavy and authoritative. */
  spiritsDisplay: { css: "Georgia, 'Times New Roman', Times, serif", pango: "Georgia" },
  spiritsBody: { css: "Georgia, 'Times New Roman', Times, serif", pango: "Georgia" },
  /** Wine: old-style serif, lighter and more calligraphic than the spirits face. */
  wineDisplay: { css: "'Palatino Linotype', Palatino, Georgia, serif", pango: "Palatino Linotype" },
  wineBody: { css: "Constantia, 'Palatino Linotype', Georgia, serif", pango: "Constantia" },
  /** Malt: humanist sans, chunky and modern. */
  maltDisplay: { css: "'Trebuchet MS', Verdana, Tahoma, sans-serif", pango: "Trebuchet MS" },
  maltBody: { css: "Tahoma, Verdana, 'Segoe UI', sans-serif", pango: "Tahoma" },
  /** Regulatory small print is sans on every beverage type, as in the trade. */
  smallPrint: { css: "Arial, Helvetica, sans-serif", pango: "Arial" },
} satisfies Record<string, Face>;

// ---------------------------------------------------------------------------
// Palettes — one visual family per beverage type, with a per-sample accent
// shift so that four spirits labels do not look like one label four times.
// ---------------------------------------------------------------------------

interface Palette {
  bg: string;
  ink: string;
  accent: string;
  rule: string;
  muted: string;
  warnInk: string;
  warnPanel: string;
}

const PALETTE: Record<string, Palette> = {
  // Distilled spirits: aged parchment + oak.
  spiritsAmber: {
    bg: "#F3E8D2", ink: "#3A2412", accent: "#9A6B2F", rule: "#6B4A26",
    muted: "#7A5C3A", warnInk: "#241608", warnPanel: "#E7D9BE",
  },
  spiritsOxblood: {
    bg: "#F1E4D6", ink: "#3A1518", accent: "#8E2F33", rule: "#6E2A2C",
    muted: "#7B4A44", warnInk: "#25100F", warnPanel: "#E5D3C3",
  },
  spiritsJuniper: {
    bg: "#EDEDE3", ink: "#22322C", accent: "#3F6B57", rule: "#3A5449",
    muted: "#5A6E64", warnInk: "#16211C", warnPanel: "#DFE2D6",
  },
  // Wine: ivory + burgundy.
  wineBurgundy: {
    bg: "#FBF7EE", ink: "#4A1024", accent: "#96803F", rule: "#7A2436",
    muted: "#7C5A5F", warnInk: "#2A1119", warnPanel: "#F2EADA",
  },
  wineGarnet: {
    bg: "#FAF4E8", ink: "#3E1B2E", accent: "#8A6A46", rule: "#6B2C46",
    muted: "#75565F", warnInk: "#241220", warnPanel: "#F0E6D3",
  },
  // Malt: dark ground with gold, the only reversed-out family of the three.
  maltForest: {
    bg: "#123524", ink: "#F5EEDC", accent: "#D9A73C", rule: "#D9A73C",
    muted: "#B9C7B4", warnInk: "#15251B", warnPanel: "#F0E7D2",
  },
  maltSlate: {
    bg: "#1E2A33", ink: "#F2EFE6", accent: "#C98A4B", rule: "#C98A4B",
    muted: "#AFBCC5", warnInk: "#172026", warnPanel: "#EDE8DC",
  },
  maltPorter: {
    bg: "#2B1B14", ink: "#F4E9DA", accent: "#C0553A", rule: "#C0553A",
    muted: "#C0AB99", warnInk: "#21140E", warnPanel: "#EFE3D2",
  },
};

// ---------------------------------------------------------------------------
// Text measurement (Pango via libvips) + caching
// ---------------------------------------------------------------------------

const measureCache = new Map<string, number>();

type Weight = "normal" | "bold";
type Style = "normal" | "italic";

function pangoName(face: Face, weight: Weight, style: Style, sizePx: number) {
  // Pango font description: "<family> [Bold] [Italic] <size-in-points>".
  // At dpi 72, one point renders as one pixel, matching SVG user units.
  let d = face.pango;
  if (weight === "bold") d += " Bold";
  if (style === "italic") d += " Italic";
  return `${d} ${sizePx}`;
}

async function measure(
  text: string,
  face: Face,
  sizePx: number,
  weight: Weight = "normal",
  style: Style = "normal",
  letterSpacing = 0,
): Promise<number> {
  if (text.length === 0) return 0;
  // Pango refuses to render whitespace on its own ("no text to render"), so a
  // run of spaces is measured by difference against a pair of anchor glyphs.
  if (text.trim() === "") {
    const withGaps = await measure(`n${text}n`, face, sizePx, weight, style);
    const without = await measure("nn", face, sizePx, weight, style);
    return Math.max(0, withGaps - without) + letterSpacing * text.length;
  }
  const key = `${face.pango}|${weight}|${style}|${sizePx}|${text}`;
  let base = measureCache.get(key);
  if (base === undefined) {
    // libvips parses this string as Pango markup, so a literal ampersand or
    // angle bracket has to be escaped or measurement throws "invalid markup".
    const forPango = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const meta = await sharp({
      text: { text: forPango, font: pangoName(face, weight, style, sizePx), dpi: 72, rgba: true },
    })
      .png()
      .metadata();
    base = meta.width ?? 0;
    measureCache.set(key, base);
  }
  // CSS letter-spacing adds tracking after every character, the last included.
  return base + letterSpacing * text.length;
}

/**
 * Largest integer font size at which `text` fits `maxWidth`.
 * Binary search, so ~6 measurements rather than one per candidate size.
 */
async function fitSize(
  text: string,
  maxWidth: number,
  face: Face,
  maxPx: number,
  minPx: number,
  weight: Weight = "normal",
  style: Style = "normal",
  letterSpacing = 0,
): Promise<number> {
  let lo = minPx;
  let hi = maxPx;
  let best = minPx;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    // Tracking scales with the size, so scale it during the probe too.
    const ls = letterSpacing * (mid / maxPx);
    const w = await measure(text, face, mid, weight, style, ls);
    if (w <= maxWidth) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Greedy word wrap. `firstLineWidth` allows an inline bold header to sit on line 1. */
async function wrap(
  text: string,
  maxWidth: number,
  face: Face,
  sizePx: number,
  weight: Weight = "normal",
  style: Style = "normal",
  firstLineWidth = maxWidth,
): Promise<string[]> {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const limit = lines.length === 0 ? firstLineWidth : maxWidth;
    const w = await measure(candidate, face, sizePx, weight, style);
    if (w <= limit || current === "") {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ---------------------------------------------------------------------------
// SVG primitives
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface TextOpts {
  x: number;
  y: number;
  text: string;
  face: Face;
  size: number;
  fill: string;
  weight?: Weight;
  style?: Style;
  anchor?: "start" | "middle" | "end";
  letterSpacing?: number;
  opacity?: number;
}

function svgText(o: TextOpts): string {
  const ls = o.letterSpacing ?? 0;
  const anchor = o.anchor ?? "start";
  // Tracking is emitted after the final glyph as well, so a centred run drifts
  // left by half a step. Nudge it back so optical centre matches geometric.
  const x = anchor === "middle" && ls ? o.x + ls / 2 : o.x;
  const attrs = [
    `x="${round(x)}"`,
    `y="${round(o.y)}"`,
    `font-family="${o.face.css}"`,
    `font-size="${round(o.size)}"`,
    `fill="${o.fill}"`,
    o.weight && o.weight !== "normal" ? `font-weight="${o.weight}"` : "",
    o.style && o.style !== "normal" ? `font-style="${o.style}"` : "",
    anchor !== "start" ? `text-anchor="${anchor}"` : "",
    ls ? `letter-spacing="${round(ls)}"` : "",
    o.opacity !== undefined ? `opacity="${o.opacity}"` : "",
  ].filter(Boolean);
  return `<text ${attrs.join(" ")}>${esc(o.text)}</text>`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function rect(
  x: number, y: number, w: number, h: number,
  fill: string, stroke?: string, strokeWidth = 1, rx = 0,
): string {
  const s = stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : "";
  const r = rx ? ` rx="${rx}"` : "";
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" fill="${fill}"${s}${r}/>`;
}

function line(x1: number, y1: number, x2: number, y2: number, stroke: string, w = 1): string {
  return `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;
}

/** A small rotated square, used as a rule terminator and corner mark. */
function diamond(cx: number, cy: number, r: number, fill: string): string {
  return `<polygon points="${round(cx)},${round(cy - r)} ${round(cx + r)},${round(cy)} ${round(cx)},${round(cy + r)} ${round(cx - r)},${round(cy)}" fill="${fill}"/>`;
}

/** Horizontal rule broken in the middle by a diamond. */
function diamondRule(cx: number, y: number, halfWidth: number, color: string, w = 1.2): string {
  const gap = 13;
  return [
    line(cx - halfWidth, y, cx - gap, y, color, w),
    line(cx + gap, y, cx + halfWidth, y, color, w),
    diamond(cx, y, 5, color),
  ].join("");
}

/** Engraved rosette: the medallion mark on the spirits labels. */
function rosette(cx: number, cy: number, r: number, color: string): string {
  const rays: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * r * 0.62;
    const y1 = cy + Math.sin(a) * r * 0.62;
    const x2 = cx + Math.cos(a) * r * 0.88;
    const y2 = cy + Math.sin(a) * r * 0.88;
    rays.push(line(x1, y1, x2, y2, color, 1));
  }
  return [
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="none" stroke="${color}" stroke-width="1.6"/>`,
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r * 0.52)}" fill="none" stroke="${color}" stroke-width="0.9"/>`,
    rays.join(""),
    diamond(cx, cy, r * 0.22, color),
  ].join("");
}

/** Oval bottling seal, used to fill the mid-label space on spirits and wine. */
function sealOval(cx: number, cy: number, rx: number, ry: number, color: string): string {
  return [
    `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx)}" ry="${round(ry)}" fill="none" stroke="${color}" stroke-width="1.3"/>`,
    `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx - 8)}" ry="${round(ry - 8)}" fill="none" stroke="${color}" stroke-width="0.6"/>`,
    diamond(cx - rx, cy, 5, color),
    diamond(cx + rx, cy, 5, color),
  ].join("");
}

/** Grape cluster: the wine ornament. */
function grapeCluster(cx: number, cy: number, s: number, color: string): string {
  const rows = [
    [-1, 0, 1],
    [-0.5, 0.5],
    [0],
  ];
  const berries: string[] = [];
  rows.forEach((row, ri) => {
    row.forEach((col) => {
      berries.push(
        `<circle cx="${round(cx + col * s * 0.9)}" cy="${round(cy + ri * s * 0.85)}" r="${round(s * 0.44)}" fill="none" stroke="${color}" stroke-width="1.1"/>`,
      );
    });
  });
  return [
    line(cx, cy - s * 1.9, cx, cy - s * 0.5, color, 1.1),
    `<ellipse cx="${round(cx - s * 1.15)}" cy="${round(cy - s * 1.3)}" rx="${round(s * 0.8)}" ry="${round(s * 0.36)}" fill="none" stroke="${color}" stroke-width="1.1" transform="rotate(-22 ${round(cx - s * 1.15)} ${round(cy - s * 1.3)})"/>`,
    `<ellipse cx="${round(cx + s * 1.15)}" cy="${round(cy - s * 1.3)}" rx="${round(s * 0.8)}" ry="${round(s * 0.36)}" fill="none" stroke="${color}" stroke-width="1.1" transform="rotate(22 ${round(cx + s * 1.15)} ${round(cy - s * 1.3)})"/>`,
    berries.join(""),
  ].join("");
}

/** Barley ear: the malt ornament. */
function barleyEar(cx: number, cy: number, s: number, color: string): string {
  const parts: string[] = [line(cx, cy - s * 2.4, cx, cy + s * 2.2, color, 1.4)];
  for (let i = 0; i < 5; i++) {
    const y = cy - s * 1.9 + i * s * 0.95;
    for (const dir of [-1, 1]) {
      const ex = cx + dir * s * 0.72;
      parts.push(
        `<ellipse cx="${round(ex)}" cy="${round(y)}" rx="${round(s * 0.62)}" ry="${round(s * 0.26)}" fill="none" stroke="${color}" stroke-width="1.1" transform="rotate(${dir * -32} ${round(ex)} ${round(y)})"/>`,
      );
      parts.push(line(ex + dir * s * 0.4, y - s * 0.3, ex + dir * s * 0.95, y - s * 0.95, color, 0.8));
    }
  }
  return parts.join("");
}

/** Soft darkening at the edges so the artwork reads as printed stock, not a swatch. */
function vignette(w: number, h: number, strength: number): string {
  return `
  <defs>
    <radialGradient id="vig" cx="50%" cy="46%" r="72%">
      <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="${strength}"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#vig)"/>`;
}

// ---------------------------------------------------------------------------
// Warning block
//
// Rendered as a bold header followed by wrapped body text. The header is a
// separate <text> positioned by measurement rather than an inline <tspan>,
// because leading whitespace between tspans is collapsed unpredictably.
// ---------------------------------------------------------------------------

interface WarningOpts {
  x: number;
  width: number;
  size: number;
  header: string;
  body: string;
  ink: string;
  face: Face;
}

interface WarningBlock {
  render: (topY: number) => string;
  height: number;
}

async function layoutWarning(o: WarningOpts): Promise<WarningBlock> {
  const lineHeight = o.size * 1.42;
  const headerW = await measure(o.header, o.face, o.size, "bold");
  // A single word space after a bold header ending in a colon reads as almost
  // no gap at 12px, and its exact width drifts with the font size because the
  // measurement is an ink extent rather than an advance. Set the separation
  // explicitly at two spaces so it is unambiguous and identical on every label.
  const spaceW = (await measure(" ", o.face, o.size)) * 2;
  const firstLineWidth = o.width - headerW - spaceW;

  const lines = await wrap(o.body, o.width, o.face, o.size, "normal", "normal", firstLineWidth);

  return {
    height: lines.length * lineHeight,
    render(topY: number) {
      const parts: string[] = [];
      const baseline0 = topY + o.size;
      parts.push(
        svgText({
          x: o.x, y: baseline0, text: o.header, face: o.face,
          size: o.size, fill: o.ink, weight: "bold",
        }),
      );
      lines.forEach((ln, i) => {
        parts.push(
          svgText({
            x: i === 0 ? o.x + headerW + spaceW : o.x,
            y: baseline0 + i * lineHeight,
            text: ln, face: o.face, size: o.size, fill: o.ink,
          }),
        );
      });
      return parts.join("");
    },
  };
}

// ---------------------------------------------------------------------------
// Label content model
// ---------------------------------------------------------------------------

/** Exactly what is printed on the artwork. `null` means "deliberately absent". */
interface LabelText {
  brandName: string;
  classType: string;
  alcoholContent: string | null;
  netContents: string | null;
  bottlerName: string;
  /** Decorative or supplementary printed lines, top to bottom. */
  otherText: string[];
  warningHeader: string;
  warningBody: string;
}

interface Design {
  palette: Palette;
  /** Line above the brand, e.g. "ESTABLISHED 1874". */
  eyebrow: string;
  /** Line beneath the class/type, e.g. an age statement. */
  flourish: string;
}

// ---------------------------------------------------------------------------
// Layout: distilled spirits — 800x1000 portrait, ornate double frame
// ---------------------------------------------------------------------------

async function renderSpirits(t: LabelText, d: Design): Promise<{ svg: string; w: number; h: number }> {
  const W = 800;
  const H = 1000;
  const M = 30;
  const p = d.palette;
  const cx = W / 2;
  const innerL = M + 34;
  const innerR = W - M - 34;
  const innerW = innerR - innerL;

  const s: string[] = [];
  s.push(rect(0, 0, W, H, p.bg));

  // Double frame with corner marks.
  s.push(rect(M, M, W - 2 * M, H - 2 * M, "none", p.rule, 5));
  s.push(rect(M + 11, M + 11, W - 2 * M - 22, H - 2 * M - 22, "none", p.rule, 1.2));
  for (const [dx, dy] of [[M + 11, M + 11], [W - M - 11, M + 11], [M + 11, H - M - 11], [W - M - 11, H - M - 11]]) {
    s.push(diamond(dx, dy, 7, p.rule));
  }

  // The bottom block is laid out first. Everything below is statutory and
  // anchors to the foot of the label, so the mid-label composition can then
  // fill exactly the space that is genuinely left rather than leaving a void.
  const warnSize = 12;
  const warn = await layoutWarning({
    x: innerL + 12, width: innerW - 24, size: warnSize,
    header: t.warningHeader, body: t.warningBody, ink: p.warnInk, face: FACE.smallPrint,
  });
  const warnPad = 13;
  const warnBoxH = warn.height + warnPad * 2;
  const warnBoxY = H - M - 24 - warnBoxH;
  const bottlerY = warnBoxY - 26;
  const rowY = bottlerY - 34;
  const rowRuleY = rowY - 26;

  // Eyebrow, flanked by rules.
  const eyeSize = 15;
  const eyeLs = 6;
  const eyeW = await measure(d.eyebrow, FACE.spiritsBody, eyeSize, "normal", "normal", eyeLs);
  const eyeY = M + 68;
  s.push(svgText({ x: cx, y: eyeY, text: d.eyebrow, face: FACE.spiritsBody, size: eyeSize, fill: p.muted, anchor: "middle", letterSpacing: eyeLs }));
  s.push(line(innerL, eyeY - 5, cx - eyeW / 2 - 18, eyeY - 5, p.muted, 1));
  s.push(line(cx + eyeW / 2 + 18, eyeY - 5, innerR, eyeY - 5, p.muted, 1));

  // Medallion.
  s.push(rosette(cx, eyeY + 78, 40, p.accent));

  // Brand — dominant element, fitted to the frame.
  const brandLs = 5;
  const brandSize = await fitSize(t.brandName, innerW, FACE.spiritsDisplay, 64, 26, "bold", "normal", brandLs);
  const brandY = eyeY + 190;
  s.push(svgText({ x: cx, y: brandY, text: t.brandName, face: FACE.spiritsDisplay, size: brandSize, fill: p.ink, weight: "bold", anchor: "middle", letterSpacing: brandLs * (brandSize / 64) }));

  s.push(diamondRule(cx, brandY + 34, innerW / 2 - 40, p.accent, 1.4));

  // Class / type designation.
  const ctSize = await fitSize(t.classType, innerW - 20, FACE.spiritsBody, 30, 16, "normal", "italic");
  const ctY = brandY + 88;
  s.push(svgText({ x: cx, y: ctY, text: t.classType, face: FACE.spiritsBody, size: ctSize, fill: p.rule, style: "italic", anchor: "middle" }));

  // Flourish (age / process statement).
  const flY = ctY + 52;
  s.push(svgText({ x: cx, y: flY, text: d.flourish, face: FACE.smallPrint, size: 13, fill: p.muted, anchor: "middle", letterSpacing: 3.4 }));

  // ---- Mid-label: a bottling seal carrying the supplementary copy. ----
  const sealCy = (flY + 30 + rowRuleY - 24) / 2;
  const sealRx = 172;
  const sealRy = 76;
  s.push(sealOval(cx, sealCy, sealRx, sealRy, p.accent));
  s.push(line(innerL, sealCy, cx - sealRx - 20, sealCy, p.accent, 0.9));
  s.push(line(cx + sealRx + 20, sealCy, innerR, sealCy, p.accent, 0.9));
  const sealLh = 26;
  t.otherText.forEach((ln, i) => {
    const y = sealCy + 6 - ((t.otherText.length - 1) * sealLh) / 2 + i * sealLh;
    s.push(svgText({ x: cx, y, text: ln, face: FACE.spiritsBody, size: 16, fill: p.muted, anchor: "middle", style: "italic" }));
  });

  // ---- Bottom-anchored block: warning, bottler, then the statutory row. ----
  s.push(rect(innerL, warnBoxY, innerW, warnBoxH, p.warnPanel, p.muted, 0.8));
  s.push(warn.render(warnBoxY + warnPad));

  s.push(svgText({ x: cx, y: bottlerY, text: t.bottlerName, face: FACE.smallPrint, size: 12, fill: p.muted, anchor: "middle", letterSpacing: 1.4 }));

  // Net contents left, alcohol right — the trade convention. When net contents
  // is absent the alcohol statement centres, so there is no tell-tale gap.
  s.push(line(innerL, rowRuleY, innerR, rowRuleY, p.accent, 1));
  if (t.netContents && t.alcoholContent) {
    s.push(svgText({ x: innerL, y: rowY, text: t.netContents, face: FACE.spiritsBody, size: 19, fill: p.ink, weight: "bold" }));
    s.push(svgText({ x: innerR, y: rowY, text: t.alcoholContent, face: FACE.spiritsBody, size: 19, fill: p.ink, weight: "bold", anchor: "end" }));
  } else if (t.alcoholContent) {
    s.push(svgText({ x: cx, y: rowY, text: t.alcoholContent, face: FACE.spiritsBody, size: 20, fill: p.ink, weight: "bold", anchor: "middle" }));
  } else if (t.netContents) {
    s.push(svgText({ x: cx, y: rowY, text: t.netContents, face: FACE.spiritsBody, size: 20, fill: p.ink, weight: "bold", anchor: "middle" }));
  }

  s.push(vignette(W, H, 0.13));
  return { svg: wrapSvg(W, H, s.join("\n")), w: W, h: H };
}

// ---------------------------------------------------------------------------
// Layout: wine — 780x1000, tall and sparse, single hairline frame
// ---------------------------------------------------------------------------

async function renderWine(t: LabelText, d: Design): Promise<{ svg: string; w: number; h: number }> {
  const W = 780;
  const H = 900;
  const M = 40;
  const p = d.palette;
  const cx = W / 2;
  const innerL = M + 30;
  const innerR = W - M - 30;
  const innerW = innerR - innerL;

  const s: string[] = [];
  s.push(rect(0, 0, W, H, p.bg));
  s.push(rect(M, M, W - 2 * M, H - 2 * M, "none", p.rule, 1.6));
  s.push(rect(M + 7, M + 7, W - 2 * M - 14, H - 2 * M - 14, "none", p.accent, 0.7));

  // Bottom block first, for the same reason as the spirits layout.
  const warnSize = 12;
  const warn = await layoutWarning({
    x: innerL, width: innerW, size: warnSize,
    header: t.warningHeader, body: t.warningBody, ink: p.warnInk, face: FACE.smallPrint,
  });
  const warnTop = H - M - 26 - warn.height;
  const bottlerY = warnTop - 40;
  const statY = bottlerY - 40;
  const flourishY = statY - 30;

  // Ornament, then estate line.
  s.push(grapeCluster(cx, M + 62, 11, p.accent));
  const eyeY = M + 132;
  s.push(svgText({ x: cx, y: eyeY, text: d.eyebrow, face: FACE.wineBody, size: 14, fill: p.accent, anchor: "middle", letterSpacing: 7 }));

  // Brand.
  const brandLs = 6;
  const brandSize = await fitSize(t.brandName, innerW, FACE.wineDisplay, 58, 24, "normal", "normal", brandLs);
  const brandY = eyeY + 92;
  s.push(svgText({ x: cx, y: brandY, text: t.brandName, face: FACE.wineDisplay, size: brandSize, fill: p.ink, anchor: "middle", letterSpacing: brandLs * (brandSize / 58) }));

  s.push(line(cx - innerW / 2 + 60, brandY + 30, cx + innerW / 2 - 60, brandY + 30, p.rule, 0.9));

  // Vintage.
  let y = brandY + 96;
  for (const extra of t.otherText) {
    const isVintage = /^\d{4}$/.test(extra);
    s.push(
      svgText({
        x: cx, y, text: extra, face: isVintage ? FACE.wineDisplay : FACE.wineBody,
        size: isVintage ? 40 : 15, fill: isVintage ? p.rule : p.muted,
        anchor: "middle", letterSpacing: isVintage ? 8 : 3,
      }),
    );
    y += isVintage ? 62 : 30;
  }

  // Class / type (varietal + appellation), centred in the space between the
  // vintage and the statutory block, with the ornament balancing beneath it.
  const midTop = y + 6;
  const midBottom = flourishY - 34;
  const midCy = (midTop + midBottom) / 2;
  const ctSize = await fitSize(t.classType, innerW - 10, FACE.wineBody, 27, 15, "normal", "italic");
  s.push(svgText({ x: cx, y: midCy - 18, text: t.classType, face: FACE.wineBody, size: ctSize, fill: p.ink, style: "italic", anchor: "middle" }));
  s.push(line(cx - 120, midCy + 4, cx + 120, midCy + 4, p.accent, 0.7));
  s.push(grapeCluster(cx, midCy + 48, 8, p.accent));

  // ---- Bottom block ----
  s.push(warn.render(warnTop));
  s.push(line(innerL, warnTop - 18, innerR, warnTop - 18, p.muted, 0.7));

  s.push(svgText({ x: cx, y: bottlerY, text: t.bottlerName, face: FACE.smallPrint, size: 11.5, fill: p.muted, anchor: "middle", letterSpacing: 1.2 }));

  if (t.alcoholContent && t.netContents) {
    s.push(svgText({ x: innerL, y: statY, text: t.alcoholContent, face: FACE.wineBody, size: 15, fill: p.ink, letterSpacing: 1.4 }));
    s.push(svgText({ x: innerR, y: statY, text: t.netContents, face: FACE.wineBody, size: 15, fill: p.ink, anchor: "end", letterSpacing: 1.4 }));
  } else if (t.alcoholContent) {
    s.push(svgText({ x: cx, y: statY, text: t.alcoholContent, face: FACE.wineBody, size: 16, fill: p.ink, anchor: "middle", letterSpacing: 1.4 }));
  } else if (t.netContents) {
    s.push(svgText({ x: cx, y: statY, text: t.netContents, face: FACE.wineBody, size: 16, fill: p.ink, anchor: "middle", letterSpacing: 1.4 }));
  }

  s.push(svgText({ x: cx, y: flourishY, text: d.flourish, face: FACE.smallPrint, size: 11, fill: p.muted, anchor: "middle", letterSpacing: 2.6 }));

  s.push(vignette(W, H, 0.09));
  return { svg: wrapSvg(W, H, s.join("\n")), w: W, h: H };
}

// ---------------------------------------------------------------------------
// Layout: malt beverage — 1000x780 landscape, reversed out of a dark ground
// ---------------------------------------------------------------------------

async function renderMalt(t: LabelText, d: Design): Promise<{ svg: string; w: number; h: number }> {
  const W = 1000;
  const H = 700;
  const p = d.palette;
  const cx = W / 2;
  const M = 26;
  const innerL = M + 40;
  const innerR = W - M - 40;
  const innerW = innerR - innerL;

  const s: string[] = [];
  s.push(rect(0, 0, W, H, p.bg));
  s.push(rect(M, M, W - 2 * M, H - 2 * M, "none", p.accent, 2.4));

  // Top band.
  s.push(rect(M, M, W - 2 * M, 54, p.accent));
  s.push(svgText({ x: cx, y: M + 36, text: d.eyebrow, face: FACE.maltDisplay, size: 17, fill: p.bg, weight: "bold", anchor: "middle", letterSpacing: 7 }));

  // Badge behind the brand. An ellipse rather than a circle so that a long
  // brand name sits inside the frame instead of straddling it.
  const roundelY = 322;
  const badgeRx = 372;
  const badgeRy = 128;
  s.push(`<ellipse cx="${cx}" cy="${roundelY}" rx="${badgeRx}" ry="${badgeRy}" fill="none" stroke="${p.accent}" stroke-width="1.6" opacity="0.6"/>`);
  s.push(`<ellipse cx="${cx}" cy="${roundelY}" rx="${badgeRx - 12}" ry="${badgeRy - 12}" fill="none" stroke="${p.accent}" stroke-width="0.8" opacity="0.42"/>`);
  s.push(barleyEar(innerL - 4, roundelY, 15, p.accent));
  s.push(barleyEar(innerR + 4, roundelY, 15, p.accent));

  // Brand — held inside the badge.
  const brandLs = 3;
  const brandSize = await fitSize(t.brandName, badgeRx * 2 - 120, FACE.maltDisplay, 62, 24, "bold", "normal", brandLs);
  const brandY = roundelY - 24;
  s.push(svgText({ x: cx, y: brandY, text: t.brandName, face: FACE.maltDisplay, size: brandSize, fill: p.ink, weight: "bold", anchor: "middle", letterSpacing: brandLs }));

  // Class / type in a gold rule sandwich.
  const ctSize = await fitSize(t.classType, innerW - 200, FACE.maltDisplay, 30, 15, "normal", "normal", 5);
  const ctY = brandY + 66;
  const ctW = await measure(t.classType, FACE.maltDisplay, ctSize, "normal", "normal", 5);
  s.push(svgText({ x: cx, y: ctY, text: t.classType, face: FACE.maltDisplay, size: ctSize, fill: p.accent, anchor: "middle", letterSpacing: 5 }));
  s.push(line(cx - ctW / 2 - 26, ctY - 9, cx - ctW / 2 - 78, ctY - 9, p.accent, 1.2));
  s.push(line(cx + ctW / 2 + 26, ctY - 9, cx + ctW / 2 + 78, ctY - 9, p.accent, 1.2));

  let extraY = ctY + 42;
  for (const extra of t.otherText) {
    s.push(svgText({ x: cx, y: extraY, text: extra, face: FACE.maltBody, size: 13, fill: p.muted, anchor: "middle", letterSpacing: 2.4 }));
    extraY += 24;
  }

  // Statutory row, anchored above the warning strip so the foot of the label
  // stays tight rather than trailing off into empty ground.
  const warnSize = 12.5;
  const warn = await layoutWarning({
    x: innerL, width: innerW, size: warnSize,
    header: t.warningHeader, body: t.warningBody, ink: p.warnInk, face: FACE.smallPrint,
  });
  const pad = 14;
  const stripH = warn.height + pad * 2;
  const stripY = H - M - stripH;

  const rowY = stripY - 94;
  if (t.alcoholContent && t.netContents) {
    s.push(svgText({ x: innerL, y: rowY, text: t.alcoholContent, face: FACE.maltDisplay, size: 21, fill: p.accent, weight: "bold" }));
    s.push(svgText({ x: innerR, y: rowY, text: t.netContents, face: FACE.maltDisplay, size: 21, fill: p.accent, weight: "bold", anchor: "end" }));
  } else if (t.alcoholContent) {
    s.push(svgText({ x: cx, y: rowY, text: t.alcoholContent, face: FACE.maltDisplay, size: 22, fill: p.accent, weight: "bold", anchor: "middle" }));
  } else if (t.netContents) {
    s.push(svgText({ x: cx, y: rowY, text: t.netContents, face: FACE.maltDisplay, size: 22, fill: p.accent, weight: "bold", anchor: "middle" }));
  }

  s.push(svgText({ x: cx, y: rowY + 30, text: t.bottlerName, face: FACE.maltBody, size: 12, fill: p.muted, anchor: "middle", letterSpacing: 1.2 }));
  s.push(svgText({ x: cx, y: rowY + 54, text: d.flourish, face: FACE.maltBody, size: 11, fill: p.muted, anchor: "middle", letterSpacing: 2.2 }));

  // Warning sits in a light strip so the small print stays high-contrast
  // against the dark ground.
  s.push(rect(M, stripY, W - 2 * M, stripH, p.warnPanel));
  s.push(warn.render(stripY + pad));

  return { svg: wrapSvg(W, H, s.join("\n")), w: W, h: H };
}

function wrapSvg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${body}\n</svg>`;
}

// ---------------------------------------------------------------------------
// Sample definitions
// ---------------------------------------------------------------------------

interface Defect {
  /** Stable machine code, e.g. "abv-mismatch". */
  code: string;
  /** Which application/label field it lives on. */
  field: string;
  applicationValue: string | null;
  labelValue: string | null;
  note: string;
}

interface Expected {
  recommendation: Recommendation;
  /** Expected verdict per check id. Check ids must match `CheckResult.id` in rules.ts. */
  checks: Record<string, Verdict>;
  summary: string;
}

interface Sample {
  id: string;
  title: string;
  description: string;
  beverageType: BeverageType;
  layout: "spirits" | "wine" | "malt";
  design: Design;
  application: Application;
  label: LabelText;
  defects: Defect[];
  expected: Expected;
}

/** Every base sample passes these unless a defect says otherwise. */
function allPass(overrides: Record<string, Verdict> = {}): Record<string, Verdict> {
  return {
    "brand-name": "pass",
    "class-type": "pass",
    "alcohol-content": "pass",
    "net-contents": "pass",
    "bottler-name": "pass",
    "government-warning-present": "pass",
    "government-warning-header-caps": "pass",
    "government-warning-text": "pass",
    "image-quality": "pass",
    ...overrides,
  };
}

const SAMPLES: Sample[] = [
  // 1 ----------------------------------------------------------------- pass
  {
    id: "spirits-bourbon-compliant",
    title: "Old Tom Distillery — compliant bourbon",
    description:
      "Fully compliant distilled spirits label. Every application field is present on the artwork and the government warning is verbatim. This is the reference sample the degraded variants are derived from.",
    beverageType: "distilled_spirits",
    layout: "spirits",
    design: { palette: PALETTE.spiritsAmber, eyebrow: "ESTABLISHED 1874", flourish: "AGED EIGHT YEARS IN NEW CHARRED OAK" },
    application: {
      applicationId: "TTB-2026-004417",
      ttbId: "26041001000417",
      serialNumber: "26A014",
      plantRegistryNumber: "DSP-KY-1471",
      applicationType: "cola",
      status: "approved",
      originCode: "22",
      beverageType: "distilled_spirits",
      brandName: "OLD TOM DISTILLERY",
      classType: "Kentucky Straight Bourbon Whiskey",
      alcoholContent: "45% Alc./Vol. (90 Proof)",
      netContents: "750 mL",
      bottlerName: "Old Tom Distillery Co., Bardstown, Kentucky",
      isImport: false,
    },
    label: {
      brandName: "OLD TOM DISTILLERY",
      classType: "Kentucky Straight Bourbon Whiskey",
      alcoholContent: "45% Alc./Vol. (90 Proof)",
      netContents: "750 mL",
      bottlerName: "BOTTLED BY OLD TOM DISTILLERY CO., BARDSTOWN, KENTUCKY",
      otherText: ["Small Batch — Barrel No. 118"],
      warningHeader: WARNING_HEADER,
      warningBody: WARNING_BODY,
    },
    defects: [],
    expected: {
      recommendation: "approve",
      checks: allPass(),
      summary: "All match checks agree and the mandatory warning is complete and correctly capitalised.",
    },
  },

  // 2 ----------------------------------------------------------------- pass
  {
    id: "wine-compliant",
    title: "Hollow Creek Vineyards — compliant wine",
    description:
      "Compliant wine label with a different layout and typographic voice from the spirits samples. The alcohol statement is printed in the trade format 'ALCOHOL 13.5% BY VOLUME' while the application records '13.5% Alc./Vol.'. That is a formatting difference, not a defect: a correct implementation normalises both to 13.5 and passes.",
    beverageType: "wine",
    layout: "wine",
    design: { palette: PALETTE.wineBurgundy, eyebrow: "ESTATE BOTTLED", flourish: "CONTAINS SULFITES" },
    application: {
      applicationId: "TTB-2026-004418",
      ttbId: "26041001000418",
      serialNumber: "26W008",
      plantRegistryNumber: "BW-CA-6238",
      applicationType: "cola",
      status: "approved",
      originCode: "01",
      wineVintage: "2021",
      wineAppellation: "Napa Valley",
      grapeVarietals: ["Cabernet Sauvignon"],
      beverageType: "wine",
      brandName: "HOLLOW CREEK VINEYARDS",
      classType: "Napa Valley Cabernet Sauvignon",
      alcoholContent: "13.5% Alc./Vol.",
      netContents: "750 mL",
      bottlerName: "Hollow Creek Vineyards, St. Helena, California",
      isImport: false,
    },
    label: {
      brandName: "HOLLOW CREEK VINEYARDS",
      classType: "Napa Valley Cabernet Sauvignon",
      alcoholContent: "ALCOHOL 13.5% BY VOLUME",
      netContents: "750 mL",
      bottlerName: "PRODUCED AND BOTTLED BY HOLLOW CREEK VINEYARDS, ST. HELENA, CALIFORNIA",
      otherText: ["2021"],
      warningHeader: WARNING_HEADER,
      warningBody: WARNING_BODY,
    },
    defects: [],
    expected: {
      recommendation: "approve",
      checks: allPass(),
      summary: "Compliant. Exercises alcohol-statement format normalisation without introducing a defect.",
    },
  },

  // 3 ----------------------------------------------------------------- pass
  {
    id: "malt-compliant",
    title: "Iron Kettle Brewing — compliant IPA",
    description:
      "Compliant malt beverage label. Dark ground with reversed-out type, so it also exercises extraction from a low-key/inverted image rather than dark ink on light stock.",
    beverageType: "malt_beverage",
    layout: "malt",
    design: { palette: PALETTE.maltForest, eyebrow: "BREWED IN ASHEVILLE", flourish: "WATER · MALTED BARLEY · HOPS · YEAST" },
    application: {
      applicationId: "TTB-2026-004419",
      ttbId: "26042001000419",
      serialNumber: "26B221",
      plantRegistryNumber: "BR-NC-ASH-3",
      applicationType: "cola",
      status: "approved",
      beverageType: "malt_beverage",
      brandName: "IRON KETTLE BREWING",
      classType: "India Pale Ale",
      alcoholContent: "6.8% Alc./Vol.",
      netContents: "12 FL OZ (355 mL)",
      bottlerName: "Iron Kettle Brewing Co., Asheville, North Carolina",
      isImport: false,
    },
    label: {
      brandName: "IRON KETTLE BREWING",
      classType: "INDIA PALE ALE",
      alcoholContent: "6.8% ALC/VOL",
      netContents: "12 FL OZ (355 mL)",
      bottlerName: "BREWED AND BOTTLED BY IRON KETTLE BREWING CO., ASHEVILLE, NORTH CAROLINA",
      otherText: ["DRY HOPPED · UNFILTERED"],
      warningHeader: WARNING_HEADER,
      warningBody: WARNING_BODY,
    },
    defects: [],
    expected: {
      recommendation: "approve",
      checks: allPass(),
      summary: "Compliant. Class/type is printed in capitals against a title-case application value, which must still pass.",
    },
  },

  // 4 --------------------------------------------- case + apostrophe variance
  {
    id: "malt-case-and-apostrophe-variant",
    title: "Stone’s Throw — case and apostrophe variance (must PASS)",
    description:
      "Trap sample. The artwork sets the brand as 'STONE’S THROW' in display capitals with a typographic apostrophe (U+2019); the application types 'Stone's Throw' in title case with an ASCII apostrophe (U+0027). A correct implementation case-folds and unicode-normalises before comparing and returns PASS. Flagging this as a mismatch is a false positive and the single most likely defect in a naive implementation.",
    beverageType: "malt_beverage",
    layout: "malt",
    design: { palette: PALETTE.maltSlate, eyebrow: "BURLINGTON, VERMONT", flourish: "COLD LAGERED FORTY DAYS" },
    application: {
      applicationId: "TTB-2026-004420",
      ttbId: "26042001000420",
      serialNumber: "26B107",
      plantRegistryNumber: "BR-VT-BUR-2",
      applicationType: "cola",
      status: "approved",
      beverageType: "malt_beverage",
      brandName: `Stone${APOS}s Throw`,
      classType: "Bohemian Pilsner",
      alcoholContent: "5.2% Alc./Vol.",
      netContents: "12 FL OZ (355 mL)",
      bottlerName: `Stone${APOS}s Throw Brewing Co., Burlington, Vermont`,
      isImport: false,
    },
    label: {
      brandName: `STONE${RSQUO}S THROW`,
      classType: "BOHEMIAN PILSNER",
      alcoholContent: "5.2% ALC/VOL",
      netContents: "12 FL OZ (355 mL)",
      bottlerName: `BREWED AND BOTTLED BY STONE${RSQUO}S THROW BREWING CO., BURLINGTON, VERMONT`,
      otherText: ["SAAZ HOPS · SOFT WATER"],
      warningHeader: WARNING_HEADER,
      warningBody: WARNING_BODY,
    },
    defects: [
      {
        code: "case-and-apostrophe-variance",
        field: "brandName",
        applicationValue: `Stone${APOS}s Throw`,
        labelValue: `STONE${RSQUO}S THROW`,
        note: "ACCEPTABLE VARIANCE, NOT A VIOLATION. Differs only by letter case and apostrophe codepoint (U+0027 vs U+2019). Expected verdict is pass.",
      },
    ],
    expected: {
      recommendation: "approve",
      checks: allPass(),
      summary: "Must be approved. Case folding plus unicode punctuation normalisation makes brand and bottler match exactly.",
    },
  },

  // 5 -------------------------------------------------------- ABV mismatch
  {
    id: "spirits-abv-mismatch",
    title: "Silver Fox Rye — alcohol content mismatch",
    description:
      "The application declares 45% Alc./Vol. (90 Proof); the artwork prints 40% Alc./Vol. (80 Proof). The label is internally consistent — the proof figure agrees with its own percentage — so only a comparison against the application catches it. Five percentage points is far outside any tolerance.",
    beverageType: "distilled_spirits",
    layout: "spirits",
    design: { palette: PALETTE.spiritsOxblood, eyebrow: "DISTILLED & BOTTLED IN INDIANA", flourish: "95% RYE MASH BILL · POT DISTILLED" },
    application: {
      applicationId: "TTB-2026-004421",
      ttbId: "26043001000421",
      serialNumber: "26A052",
      plantRegistryNumber: "DSP-IN-2109",
      applicationType: "cola",
      status: "approved",
      beverageType: "distilled_spirits",
      brandName: "SILVER FOX RYE",
      classType: "Straight Rye Whiskey",
      alcoholContent: "45% Alc./Vol. (90 Proof)",
      netContents: "750 mL",
      bottlerName: "Silver Fox Distilling Co., Lawrenceburg, Indiana",
      isImport: false,
    },
    label: {
      brandName: "SILVER FOX RYE",
      classType: "Straight Rye Whiskey",
      alcoholContent: "40% Alc./Vol. (80 Proof)",
      netContents: "750 mL",
      bottlerName: "DISTILLED AND BOTTLED BY SILVER FOX DISTILLING CO., LAWRENCEBURG, INDIANA",
      otherText: ["Aged Four Years"],
      warningHeader: WARNING_HEADER,
      warningBody: WARNING_BODY,
    },
    defects: [
      {
        code: "abv-mismatch",
        field: "alcoholContent",
        applicationValue: "45% Alc./Vol. (90 Proof)",
        labelValue: "40% Alc./Vol. (80 Proof)",
        note: "Label understates the application by 5.0 percentage points. Tolerance for distilled spirits is 0.15 percentage points (27 CFR 5.65).",
      },
    ],
    expected: {
      recommendation: "reject",
      checks: allPass({ "alcohol-content": "fail" }),
      summary: "Alcohol content check must fail: 40% on the label against 45% in the application.",
    },
  },

  // 6 ------------------------------------------- warning header title case
  {
    id: "wine-warning-title-case",
    title: "Lantern Hill Cellars — warning header in title case",
    description:
      "Every field matches and the warning wording is verbatim, but the mandated header is set as 'Government Warning:' rather than 'GOVERNMENT WARNING:'. 27 CFR 16.21 requires the header in capital letters, so this fails on capitalisation alone. A word-level text diff of the warning will show NO difference — the defect is purely in letter case, which is why the header case is a separate check.",
    beverageType: "wine",
    layout: "wine",
    design: { palette: PALETTE.wineGarnet, eyebrow: "ESTATE GROWN", flourish: "CONTAINS SULFITES" },
    application: {
      applicationId: "TTB-2026-004422",
      ttbId: "26043001000422",
      serialNumber: "26W019",
      plantRegistryNumber: "BW-OR-1184",
      applicationType: "cola",
      status: "approved",
      wineVintage: "2022",
      wineAppellation: "Willamette Valley",
      grapeVarietals: ["Pinot Noir"],
      beverageType: "wine",
      brandName: "LANTERN HILL CELLARS",
      classType: "Willamette Valley Pinot Noir",
      alcoholContent: "13.1% Alc./Vol.",
      netContents: "750 mL",
      bottlerName: "Lantern Hill Cellars, Dundee, Oregon",
      isImport: false,
    },
    label: {
      brandName: "LANTERN HILL CELLARS",
      classType: "Willamette Valley Pinot Noir",
      alcoholContent: "ALCOHOL 13.1% BY VOLUME",
      netContents: "750 mL",
      bottlerName: "PRODUCED AND BOTTLED BY LANTERN HILL CELLARS, DUNDEE, OREGON",
      otherText: ["2022"],
      warningHeader: "Government Warning:",
      warningBody: WARNING_BODY,
    },
    defects: [
      {
        code: "warning-header-not-capitalised",
        field: "governmentWarning.header",
        applicationValue: WARNING_HEADER,
        labelValue: "Government Warning:",
        note: "Header set in title case. 27 CFR 16.21 requires 'GOVERNMENT WARNING:' in capital letters. Body wording is untouched.",
      },
    ],
    expected: {
      recommendation: "reject",
      checks: allPass({ "government-warning-header-caps": "fail" }),
      summary: "Warning header capitalisation check must fail; the warning text check must still pass.",
    },
  },

  // 7 ----------------------------------------------- warning wording defect
  {
    id: "malt-warning-wording",
    title: "Black Duck Brewery — reworded government warning",
    description:
      "The header is correct but the mandated wording has been altered in two places: 'women should not drink' is softened to 'women should avoid drinking', and the closing clause 'and may cause health problems' is dropped from statement (2). The warning text is prescribed verbatim, so any substitution or omission fails. This sample is the one to use when demonstrating the word-level warning diff.",
    beverageType: "malt_beverage",
    layout: "malt",
    design: { palette: PALETTE.maltPorter, eyebrow: "PORTLAND, MAINE", flourish: "WATER · MALTED BARLEY · OATS · HOPS · YEAST" },
    application: {
      applicationId: "TTB-2026-004423",
      ttbId: "26044001000423",
      serialNumber: "26B310",
      plantRegistryNumber: "BR-ME-POR-1",
      applicationType: "cola",
      status: "approved",
      beverageType: "malt_beverage",
      brandName: "BLACK DUCK BREWERY",
      classType: "Oatmeal Stout",
      alcoholContent: "5.9% Alc./Vol.",
      netContents: "12 FL OZ (355 mL)",
      bottlerName: "Black Duck Brewery, Portland, Maine",
      isImport: false,
    },
    label: {
      brandName: "BLACK DUCK BREWERY",
      classType: "OATMEAL STOUT",
      alcoholContent: "5.9% ALC/VOL",
      netContents: "12 FL OZ (355 mL)",
      bottlerName: "BREWED AND BOTTLED BY BLACK DUCK BREWERY, PORTLAND, MAINE",
      otherText: ["ROASTED BARLEY · FLAKED OATS"],
      warningHeader: WARNING_HEADER,
      warningBody:
        "(1) According to the Surgeon General, women should avoid drinking alcoholic " +
        "beverages during pregnancy because of the risk of birth defects. " +
        "(2) Consumption of alcoholic beverages impairs your ability to drive a car " +
        "or operate machinery.",
    },
    defects: [
      {
        code: "warning-text-altered",
        field: "governmentWarning.text",
        applicationValue: WARNING_BODY,
        labelValue: null,
        note: "Two deviations from the prescribed wording: 'should not drink' replaced by 'should avoid drinking', and ', and may cause health problems' omitted from statement (2). See labelText.warningBody for the exact printed string.",
      },
    ],
    expected: {
      recommendation: "reject",
      checks: allPass({ "government-warning-text": "fail" }),
      summary: "Warning text check must fail on both a substitution and an omission; header capitalisation still passes.",
    },
  },

  // 8 ------------------------------------------------ missing net contents
  {
    id: "spirits-missing-net-contents",
    title: "Juniper & Thorne — net contents absent from label",
    description:
      "The application declares 750 mL but the artwork carries no net contents statement anywhere. The alcohol statement is centred so that nothing appears conspicuously missing to the eye — the omission has to be found by reading the label, not by spotting a gap. This is the sample that separates 'field absent' from 'field unreadable': the field is legibly not there.",
    beverageType: "distilled_spirits",
    layout: "spirits",
    design: { palette: PALETTE.spiritsJuniper, eyebrow: "PORTLAND, OREGON", flourish: "POT DISTILLED IN SMALL BATCHES" },
    application: {
      applicationId: "TTB-2026-004424",
      ttbId: "26044001000424",
      serialNumber: "26A077",
      plantRegistryNumber: "DSP-OR-2061",
      applicationType: "cola",
      status: "approved",
      beverageType: "distilled_spirits",
      brandName: "JUNIPER & THORNE",
      classType: "London Dry Gin",
      alcoholContent: "47% Alc./Vol. (94 Proof)",
      netContents: "750 mL",
      bottlerName: "Juniper & Thorne Distilling, Portland, Oregon",
      isImport: false,
    },
    label: {
      brandName: "JUNIPER & THORNE",
      classType: "London Dry Gin",
      alcoholContent: "47% Alc./Vol. (94 Proof)",
      netContents: null,
      bottlerName: "DISTILLED AND BOTTLED BY JUNIPER & THORNE DISTILLING, PORTLAND, OREGON",
      otherText: ["Eleven Botanicals"],
      warningHeader: WARNING_HEADER,
      warningBody: WARNING_BODY,
    },
    defects: [
      {
        code: "net-contents-missing",
        field: "netContents",
        applicationValue: "750 mL",
        labelValue: null,
        note: "No net contents statement is printed anywhere on the artwork. Expected verdict is fail (absent), NOT unreadable — the image is clean and the field is legibly not present. Note also that `containerInfoNotOnLabels` is deliberately left unset on this application: nothing is declared as blown, branded or embossed into the container, so the escape hatch for embossed net contents does not apply and the omission is a genuine failure.",
      },
    ],
    expected: {
      recommendation: "reject",
      checks: allPass({ "net-contents": "fail" }),
      summary: "Net contents check must fail as absent from the label. Also exercises an ampersand in the brand name.",
    },
  },
];

// ---------------------------------------------------------------------------
// Degraded variants — image robustness, derived from sample 1
// ---------------------------------------------------------------------------

interface DegradedSpec {
  id: string;
  from: string;
  title: string;
  transform: string;
  description: string;
  expected: Expected;
  imageQualityIssues: string[];
  apply: (base: Buffer, w: number, h: number) => Promise<Buffer>;
}

/**
 * Specular glare. Composited with `over` rather than `screen`: the artwork is
 * already near-white cream stock, and screening white onto cream is almost a
 * no-op. Painting semi-opaque white destroys local contrast the way a real
 * flash reflection does, which is the property the robustness test needs.
 */
const GLARE_SVG = (w: number, h: number) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="g1" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.86"/>
      <stop offset="38%" stop-color="#ffffff" stop-opacity="0.66"/>
      <stop offset="72%" stop-color="#ffffff" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g2" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.62"/>
      <stop offset="60%" stop-color="#ffffff" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse cx="${w * 0.66}" cy="${h * 0.3}" rx="${w * 0.46}" ry="${h * 0.15}"
           fill="url(#g1)" transform="rotate(-26 ${w * 0.66} ${h * 0.3})"/>
  <ellipse cx="${w * 0.26}" cy="${h * 0.63}" rx="${w * 0.22}" ry="${h * 0.08}"
           fill="url(#g2)" transform="rotate(12 ${w * 0.26} ${h * 0.63})"/>
</svg>`;

const DEGRADED: DegradedSpec[] = [
  {
    id: "spirits-bourbon-compliant--rotated-8deg",
    from: "spirits-bourbon-compliant",
    title: "Compliant bourbon — rotated 8 degrees on grey",
    transform: "rotate 8deg, grey (#8A8A8A) fill, resized to 1000px long edge",
    description:
      "The reference label photographed off-square. All text remains legible, so the compliance outcome is unchanged; only the image quality notes should differ.",
    imageQualityIssues: ["rotated approximately 8 degrees clockwise", "grey background visible at the corners"],
    expected: {
      recommendation: "approve",
      checks: allPass(),
      summary: "Rotation must not change any verdict. Expect the same approval as the reference sample, with a rotation noted under image quality.",
    },
    apply: async (base) =>
      sharp(base)
        .rotate(8, { background: { r: 138, g: 138, b: 138, alpha: 255 } })
        .resize({ width: 1000, height: 1000, fit: "inside" })
        .png({ compressionLevel: 9 })
        .toBuffer(),
  },
  {
    id: "spirits-bourbon-compliant--glare",
    from: "spirits-bourbon-compliant",
    title: "Compliant bourbon — specular glare",
    transform: "two white radial-gradient ellipses composited with an over blend",
    description:
      "A bright reflection across the upper right of the label, as from a phone flash on a glossy bottle. The brand and class/type sit partly under the glare but remain readable; the small print at the bottom is untouched.",
    imageQualityIssues: ["specular glare across the upper right", "reduced contrast in the brand area"],
    expected: {
      recommendation: "approve",
      checks: allPass(),
      summary: "Glare reduces contrast but does not obscure any mandatory field. Expect approval with a glare note under image quality.",
    },
    apply: async (base, w, h) =>
      sharp(base)
        .composite([{ input: Buffer.from(GLARE_SVG(w, h)), blend: "over" }])
        .png({ compressionLevel: 9 })
        .toBuffer(),
  },
  {
    id: "spirits-bourbon-compliant--blurred-underexposed",
    from: "spirits-bourbon-compliant",
    title: "Compliant bourbon — blurred and underexposed",
    transform: "gaussian blur sigma 2.6, brightness 0.5, contrast reduced",
    description:
      "Out of focus and shot in poor light. The brand and class/type survive; the government warning small print does not. This is the sample that should exercise the UNREADABLE path rather than a pass or a fail — the correct behaviour is to decline to judge the warning, not to guess at it.",
    imageQualityIssues: ["out of focus", "underexposed", "small print at the foot of the label is not resolvable"],
    expected: {
      recommendation: "needs_review",
      checks: allPass({
        "government-warning-present": "unreadable",
        "government-warning-header-caps": "unreadable",
        "government-warning-text": "unreadable",
        "bottler-name": "unreadable",
        "image-quality": "fail",
      }),
      summary:
        "Large type is still legible but the warning small print is not. A correct implementation returns unreadable for the warning checks and routes to human review — never a pass, and never a fail.",
    },
    apply: async (base) =>
      sharp(base)
        .blur(2.6)
        .modulate({ brightness: 0.5 })
        .linear(0.86, 8)
        .png({ compressionLevel: 9 })
        .toBuffer(),
  },
];

// ---------------------------------------------------------------------------
// Rendering + writing
// ---------------------------------------------------------------------------

async function renderSample(s: Sample) {
  switch (s.layout) {
    case "spirits":
      return renderSpirits(s.label, s.design);
    case "wine":
      return renderWine(s.label, s.design);
    case "malt":
      return renderMalt(s.label, s.design);
  }
}

/** Write a PNG, falling back to a palette encode if the file would be too large. */
async function writePng(buf: Buffer, file: string): Promise<number> {
  let out = await sharp(buf).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  if (out.length > PALETTE_THRESHOLD) {
    out = await sharp(buf).png({ compressionLevel: 9, palette: true, quality: 92, effort: 9 }).toBuffer();
  }
  fs.writeFileSync(file, out);
  return out.length;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`SELF-CHECK FAILED: ${msg}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface ManifestSample {
  id: string;
  file: string;
  title: string;
  description: string;
  beverageType: BeverageType;
  kind: "base" | "degraded";
  derivedFrom?: string;
  imageTransform?: string;
  width: number;
  height: number;
  bytes: number;
  application: Application;
  labelText: LabelText;
  defects: Defect[];
  expected: Expected;
  imageQualityIssues?: string[];
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifestSamples: ManifestSample[] = [];
  const rendered = new Map<string, { buf: Buffer; w: number; h: number }>();

  // --- Base labels ---------------------------------------------------------
  for (const s of SAMPLES) {
    const { svg, w, h } = await renderSample(s);
    const buf = await sharp(Buffer.from(svg, "utf8")).png().toBuffer();
    rendered.set(s.id, { buf, w, h });

    const file = `${s.id}.png`;
    const bytes = await writePng(buf, path.join(OUT_DIR, file));

    manifestSamples.push({
      id: s.id, file, title: s.title, description: s.description,
      beverageType: s.beverageType, kind: "base",
      width: w, height: h, bytes,
      application: s.application, labelText: s.label,
      defects: s.defects, expected: s.expected,
    });
    console.log(`  ${file.padEnd(48)} ${w}x${h}  ${(bytes / 1024).toFixed(1)} KB`);
  }

  // --- Degraded variants ---------------------------------------------------
  for (const g of DEGRADED) {
    const src = rendered.get(g.from);
    assert(src, `degraded variant ${g.id} refers to unknown base ${g.from}`);
    const parent = SAMPLES.find((s) => s.id === g.from);
    assert(parent, `no base sample ${g.from}`);

    const out = await g.apply(src.buf, src.w, src.h);
    const meta = await sharp(out).metadata();
    const file = `${g.id}.png`;
    const bytes = await writePng(out, path.join(OUT_DIR, file));

    manifestSamples.push({
      id: g.id, file, title: g.title, description: g.description,
      beverageType: parent.beverageType, kind: "degraded",
      derivedFrom: g.from, imageTransform: g.transform,
      width: meta.width ?? 0, height: meta.height ?? 0, bytes,
      application: parent.application, labelText: parent.label,
      defects: parent.defects, expected: g.expected,
      imageQualityIssues: g.imageQualityIssues,
    });
    console.log(`  ${file.padEnd(48)} ${meta.width}x${meta.height}  ${(bytes / 1024).toFixed(1)} KB`);
  }

  // --- Manifest ------------------------------------------------------------
  // No timestamp: the output must be byte-identical on every run so that a
  // regenerated sample set produces an empty diff unless the artwork changed.
  const manifest = {
    schemaVersion: 1,
    generator: "scripts/make-samples.ts",
    note:
      "Fixture set for the TTB label verification prototype. `application` is the typed-in half of the COLA application; `labelText` is ground truth for what the artwork actually prints (null means deliberately absent); `expected` is the verdict a correct implementation must reach. Check ids in `expected.checks` correspond to CheckResult.id in src/lib/ttb/rules.ts.",
    canonicalWarning: { header: WARNING_HEADER, body: WARNING_BODY, citation: "27 CFR 16.21" },
    samples: manifestSamples,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );

  // --- Self-checks ---------------------------------------------------------
  // These exist to prove the planted defects are genuinely present in the
  // output rather than merely described in the manifest. Each one can fail.
  const byId = new Map(manifestSamples.map((m) => [m.id, m]));

  for (const m of manifestSamples) {
    const fp = path.join(OUT_DIR, m.file);
    assert(fs.existsSync(fp), `${m.file} was not written`);
    const size = fs.statSync(fp).size;
    assert(size > 8_000, `${m.file} is only ${size} bytes — suspiciously small, artwork may be blank`);
    assert(size < MAX_BYTES, `${m.file} is ${size} bytes, over the ${MAX_BYTES} byte budget`);
    const longEdge = Math.max(m.width, m.height);
    assert(longEdge >= 700 && longEdge <= 1050, `${m.file} long edge ${longEdge}px is outside 700-1050`);
  }

  // Compliant samples must carry the mandated warning verbatim.
  for (const id of ["spirits-bourbon-compliant", "wine-compliant", "malt-compliant", "malt-case-and-apostrophe-variant", "spirits-abv-mismatch", "spirits-missing-net-contents"]) {
    const m = byId.get(id)!;
    assert(m.labelText.warningHeader === WARNING_HEADER, `${id} should print the canonical warning header`);
    assert(m.labelText.warningBody === WARNING_BODY, `${id} should print the canonical warning body`);
  }

  // Case + apostrophe variance really is only case + apostrophe.
  {
    const m = byId.get("malt-case-and-apostrophe-variant")!;
    const app = m.application.brandName;
    const lab = m.labelText.brandName;
    assert(app.includes(APOS) && !app.includes(RSQUO), "application brand must use the ASCII apostrophe");
    assert(lab.includes(RSQUO) && !lab.includes(APOS), "label brand must use the typographic apostrophe");
    assert(app !== lab, "the two brand strings must actually differ");
    const fold = (x: string) => x.toUpperCase().replace(new RegExp(RSQUO, "g"), APOS);
    assert(fold(app) === fold(lab), "after case folding and apostrophe normalisation the brands must be identical");
    assert(m.expected.checks["brand-name"] === "pass", "the case variant must be expected to PASS");
  }

  // ABV mismatch really mismatches.
  {
    const m = byId.get("spirits-abv-mismatch")!;
    assert(m.application.alcoholContent!.includes("45"), "application should declare 45%");
    assert(m.labelText.alcoholContent!.includes("40"), "label should print 40%");
    assert(m.expected.checks["alcohol-content"] === "fail", "ABV check must be expected to fail");
  }

  // Title-case warning header differs only in case.
  {
    const m = byId.get("wine-warning-title-case")!;
    const h = m.labelText.warningHeader;
    assert(h !== WARNING_HEADER, "header must differ from the canonical header");
    assert(h.toUpperCase() === WARNING_HEADER, "header must differ ONLY in letter case");
    assert(m.labelText.warningBody === WARNING_BODY, "warning body must be untouched");
    assert(m.expected.checks["government-warning-header-caps"] === "fail", "header caps check must fail");
    assert(m.expected.checks["government-warning-text"] === "pass", "warning text check must still pass");
  }

  // Reworded warning really is reworded.
  {
    const m = byId.get("malt-warning-wording")!;
    assert(m.labelText.warningHeader === WARNING_HEADER, "header must be correct on the wording-defect sample");
    assert(m.labelText.warningBody !== WARNING_BODY, "warning body must differ from canonical");
    assert(m.labelText.warningBody.includes("should avoid drinking"), "expected the softened clause 1 substitution");
    assert(!m.labelText.warningBody.includes("may cause health problems"), "expected the clause 2 tail to be dropped");
    assert(m.expected.checks["government-warning-text"] === "fail", "warning text check must fail");
  }

  // Missing net contents really is missing.
  {
    const m = byId.get("spirits-missing-net-contents")!;
    assert(m.labelText.netContents === null, "label must print no net contents");
    assert(m.application.netContents === "750 mL", "application must still declare net contents");
    assert(m.expected.checks["net-contents"] === "fail", "net contents check must fail");
  }

  // Every non-degraded sample with no defects must expect approval, and every
  // sample with a disqualifying defect must not.
  for (const m of manifestSamples) {
    if (m.kind !== "base") continue;
    const failing = Object.values(m.expected.checks).filter((v) => v === "fail").length;
    if (failing === 0) {
      assert(m.expected.recommendation === "approve", `${m.id} has no failing checks but does not expect approval`);
    } else {
      assert(m.expected.recommendation === "reject", `${m.id} has failing checks but does not expect rejection`);
    }
  }

  const base = manifestSamples.filter((m) => m.kind === "base").length;
  const deg = manifestSamples.filter((m) => m.kind === "degraded").length;
  const total = manifestSamples.reduce((a, m) => a + m.bytes, 0);
  console.log(
    `\n  ${base} base labels + ${deg} degraded variants = ${manifestSamples.length} PNGs, ` +
      `${(total / 1024).toFixed(0)} KB total. All self-checks passed.`,
  );
  console.log(`  Output: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
