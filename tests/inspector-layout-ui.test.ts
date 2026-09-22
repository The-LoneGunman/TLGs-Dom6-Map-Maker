import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILTIN_DOM6_CATALOG } from "../src/catalog";
import { terrainMask } from "../src/dom6";
import { createDefaultProject } from "../src/generator";
import { AdvancedInspector, MapMakerApp, SitesDefenseInspector } from "../src/MapMakerApp";

test("advanced inspector shows the terrain mask, a real multi-line directive example and the Planes-tab pointer", () => {
  const project = createDefaultProject("inspector-advanced-layout");
  const plane = project.planes[0]!;
  const province = plane.provinces[0]!;
  const html = renderToStaticMarkup(createElement(AdvancedInspector, { project, planeId: plane.id, province, update() {}, mutateProject() {}, onOpenPlanes() {} }));
  assert.ok(html.includes(`<span>Terrain mask</span><code>${terrainMask(province).toString()}</code>`));
  assert.match(html, /placeholder="#clearmagic\n#mag_fire 2"/, "the example directive spans two lines");
  assert.doesNotMatch(html, /#clearmagic\\n/, "no literal backslash-n is shown");
  assert.match(html, /also editable on the Planes tab/);
  assert.match(html, />Open Planes tab<\/button>/);
});

test("site and guardian filters are toggle chips with explanations behind About these lists", () => {
  const project = createDefaultProject("inspector-sites-layout");
  const plane = project.planes[0]!;
  const province = plane.provinces.find((entry) => !entry.start)!;
  const html = renderToStaticMarkup(createElement(SitesDefenseInspector, { catalog: BUILTIN_DOM6_CATALOG, plane, province, update() {} }));
  assert.equal(html.match(/class="filter-chip" aria-pressed="false"/g)?.length, 3);
  assert.match(html, /aria-pressed="false"[^>]*>Show terrain mismatches</);
  assert.match(html, /aria-pressed="false"[^>]*>Use role-focused lists</);
  assert.equal(html.match(/<summary>About these lists<\/summary>/g)?.length, 2);
  assert.match(html, /Map-only boundary/);
});

test("the empty inspector is a getting-started checklist and file actions sit behind the header File menu", () => {
  const html = renderToStaticMarkup(createElement(MapMakerApp));
  assert.match(html, /PROVINCE INSPECTOR/);
  assert.match(html, /Getting started/);
  const steps = [...html.matchAll(/<li><button[^>]*><b aria-hidden="true">\d<\/b><span><strong>([^<]+)<\/strong>/g)].map((match) => match[1]);
  assert.deepEqual(steps, ["Generate", "Planes", "Scenario", "Validate", "Install"]);
  assert.match(html, /aria-expanded="false"[^>]*>File/);
  assert.match(html, /aria-label="Workbench sections"/);
  assert.match(html, /<summary>Find a province<\/summary>/);
  assert.match(html, />\+ Add plane<\/button>/);
});
