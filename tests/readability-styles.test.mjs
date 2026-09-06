import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

const intentionallyDecorativeSelectors = [
  ".plane-gem",
  ".check-card i",
  ".issue > span",
  ".package-summary > i",
];

test("functional interface copy has an 11px minimum typography floor", () => {
  const undersizedRules = [...css.matchAll(/([^{}]+)\{([^{}]*?font-size:\s*([\d.]+)px[^{}]*?)\}/g)]
    .map((match) => ({ selector: match[1].trim(), size: Number(match[3]) }))
    .filter(({ size }) => size < 11)
    .filter(({ selector }) => !intentionallyDecorativeSelectors.some((allowed) => selector.endsWith(allowed)));

  assert.deepEqual(
    undersizedRules,
    [],
    `functional text below 11px:\n${undersizedRules.map(({ selector, size }) => `${selector}: ${size}px`).join("\n")}`,
  );
});

test("small-screen controls and summaries retain readable sizes", () => {
  assert.match(css, /\.canvas-controls label\s*\{\s*font-size:\s*11px;\s*\}/);
  assert.match(css, /\.tool-group button small\s*\{\s*display:\s*inline;\s*font-size:\s*11px;\s*\}/);
  assert.match(css, /\.statusbar\s*\{[^}]*font-size:\s*11px;/);
  assert.match(css, /\.map-legend\s*\{[^}]*flex-wrap:\s*wrap;[^}]*font-size:\s*11px;/);
  assert.match(css, /\.export-option > b\s*\{[^}]*font-size:\s*11px;/);
});

test("analysis panels keep scroll containment and toolbar controls wrap instead of overlapping", () => {
  assert.match(css, /\.canvas-toolbar\s*\{[^}]*flex-wrap:\s*wrap;/);
  assert.match(css, /\.canvas-column\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) 48px;/);
  assert.match(css, /\.analysis-table-wrap\s*\{[^}]*min-width:\s*0;[^}]*overflow-x:\s*auto;/);
  assert.match(css, /\.balance-panel\s*\{[^}]*overflow:\s*auto;/);
  assert.match(css, /\.analysis-status-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /@media \(min-width: 980px\)\s*\{\s*\.atlas-shell\s*\{\s*position: fixed;\s*inset: 0;/);
});
