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
