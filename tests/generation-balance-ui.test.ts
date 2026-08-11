import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerationBalanceNotice, generationBalanceWarnings } from "../src/MapMakerApp";
import type { ValidationIssue } from "../src/domain";

test("Generate visibly surfaces constrained spacing and degree parity as non-blocking warnings", () => {
  const issues: ValidationIssue[] = [
    { id: "ordinary", severity: "warning", message: "Export filenames will be normalized." },
    {
      id: "too-close",
      severity: "error",
      message: "Two capitals are only 2 movement connections apart; distinct multiplayer starts require at least 3.",
    },
    {
      id: "spacing",
      severity: "warning",
      message: "Scale-aware start spacing reaches 3 moves, below the preferred 5 for this map's traversable provinces per start.",
    },
    {
      id: "degree",
      severity: "warning",
      message: "Start connection counts across the atlas vary from 4 to 5.",
    },
  ];

  assert.deepEqual(generationBalanceWarnings(issues).map((issue) => issue.id), ["spacing", "degree"]);
  const html = renderToStaticMarkup(createElement(GenerationBalanceNotice, { issues }));
  assert.match(html, /role="status"/);
  assert.match(html, /Generation used a best-effort balance fallback/);
  assert.match(html, /Scale-aware start spacing reaches 3 moves/);
  assert.match(html, /Start connection counts across the atlas vary from 4 to 5/);
  assert.match(html, /warnings do not block export/);
});

test("Generate balance notice has no false positive for a normal warning or hard spacing error", () => {
  const issues: ValidationIssue[] = [
    { id: "ordinary", severity: "warning", message: "Export filenames will be normalized." },
    {
      id: "too-close",
      severity: "error",
      message: "Two capitals are only 2 movement connections apart; distinct multiplayer starts require at least 3.",
    },
  ];
  assert.deepEqual(generationBalanceWarnings(issues), []);
  assert.equal(renderToStaticMarkup(createElement(GenerationBalanceNotice, { issues })), "");
});
