import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILTIN_DOM6_CATALOG } from "../src/catalog";
import { CaveStartNationField, planeAutoSizeDescription } from "../src/MapMakerApp";
import { addPlane, createDefaultProject } from "../src/generator";

const playableNations = BUILTIN_DOM6_CATALOG.nations.filter((entry) => entry.id >= 5 && (entry.era === undefined || entry.era > 0));

test("empty cave-start nation UI preserves Dominions native preference", () => {
  const html = renderToStaticMarkup(createElement(CaveStartNationField, {
    values: [],
    caveStartCount: 0,
    hasCaveFamilyPlane: true,
    entries: playableNations,
    onChange() {},
  }));

  assert.match(html, /Deterministic cave-start nations/);
  assert.match(html, /Dominions native cave preference remains in control/);
  assert.match(html, /choose Generate to create one distinct cave capital/);
  assert.match(html, /Validation blocks export until those assignments are current/);
  assert.match(html, /#specstart/);
  assert.match(html, /No generic cave capital will be generated/);
  assert.match(html, /native cave preference has no cave slot to use/);
  assert.match(html, /starts remain exactly as allocated above/);
  assert.doesNotMatch(html, /role="alert"/);
});

test("configured cave-start nation UI shows priority and capacity overflow", () => {
  const values = [102, 15, 59];
  const html = renderToStaticMarkup(createElement(CaveStartNationField, {
    values,
    caveStartCount: 2,
    hasCaveFamilyPlane: true,
    entries: playableNations,
    onChange() {},
  }));

  assert.match(html, /1\. Agartha/);
  assert.match(html, /Move nation 102 earlier/);
  assert.match(html, /Move nation 15 later/);
  assert.match(html, /3 nations selected for 2 requested cave starts/);
  assert.match(html, /Only the first 2 can be assigned/);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /No generic cave capital will be generated/);
  assert.ok(html.indexOf("#102") < html.indexOf("#15"), "the configured assignment order is preserved");
  assert.ok(html.indexOf("#15") < html.indexOf("#59"), "later priorities remain ordered");
});

test("plane auto-size copy follows overland, core Cave/Cavern, and bonus-realm budgets", () => {
  let project = createDefaultProject("auto-size-copy");
  project.settings.startDistribution = { land: 2, coastal: 1, water: 1, cave: 2, other: 0 };
  assert.match(planeAutoSizeDescription(project, project.planes[0]!), /Land \+ coastal \+ water starts/);
  assert.match(planeAutoSizeDescription(project, project.planes[0]!), /minimum 18 provinces/);

  project = addPlane(project, "cave", { generate: false, autoSize: true });
  const cave = project.planes[1]!;
  assert.match(planeAutoSizeDescription(project, cave), /Cave starts × provinces\/player/);
  assert.match(planeAutoSizeDescription(project, cave), /1 auto-sized core Cave\/Cavern plane/);
  assert.match(planeAutoSizeDescription(project, cave), /minimum 18 provinces per plane/);

  project = addPlane(project, "cloud", { generate: false, autoSize: true });
  const cloud = project.planes[2]!;
  assert.match(planeAutoSizeDescription(project, cloud), /Bonus realm: 30% of the combined generated core total/);
  assert.match(planeAutoSizeDescription(project, cloud), /minimum 18, maximum 800 provinces/);
});
