import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MapMakerApp, PlaneStartPolicyControl, markerAnnotationsForPlane, resetGeneratorDefaults, uniquePlaneName } from "../src/MapMakerApp";
import { addPlane, createDefaultProject } from "../src/generator";
import { RESOLUTION_PRESETS, cloneProject, type GenerationSettings } from "../src/domain";

const RESET_SETTING_KEYS = [
  "players",
  "provincesPerPlayer",
  "waterPercent",
  "oceanLayout",
  "continentCount",
  "specialPlaneSizePercent",
  "provinceNameSeed",
  "randomizeNamesOnLoad",
  "biomeCohesion",
  "economyBalance",
  "overlandTopology",
  "throneCount",
  "startDistribution",
  "startDegreeTarget",
  "caveStartNations",
  "resolution",
] as const satisfies readonly (keyof GenerationSettings)[];

function picked(settings: GenerationSettings) {
  return Object.fromEntries(RESET_SETTING_KEYS.map((key) => [key, settings[key]]));
}

test("reset generator defaults has an exact settings-only map-preserving contract", () => {
  const project = addPlane(createDefaultProject("keep-this-seed"), "cave", { generate: false, autoSize: false, provinceTarget: 37 });
  const activePlane = project.planes[1]!;
  project.name = "Keep This Atlas";
  project.description = "Keep scenario copy";
  project.targetVersion = 777;
  project.mapNoHide = true;
  project.rawDirectives = "#god 5 120";
  project.planes[0]!.name = "Hand-edited surface";
  project.planes[0]!.width = 721;
  project.planes[0]!.height = 654;
  project.planes[0]!.wrapX = false;
  project.planes[0]!.noGeneratedStarts = true;
  activePlane.width = 812;
  activePlane.height = 733;
  activePlane.wrapX = false;
  activePlane.wrapY = false;
  project.specificStarts = [
    { nation: 5, planeId: project.planes[0]!.id, provinceId: project.planes[0]!.provinces[0]!.id },
    { nation: 15, planeId: activePlane.id, provinceId: activePlane.provinces[0]?.id ?? "generated-placeholder", source: "generated-cave" },
  ];
  project.planes[0]!.provinces[0]!.name = "Manual Capital Name";
  Object.assign(project.settings, {
    players: 12,
    provincesPerPlayer: 27,
    waterPercent: 51,
    oceanLayout: "multiple_continents",
    continentCount: 6,
    specialPlaneSizePercent: 175,
    provinceNameSeed: 9,
    randomizeNamesOnLoad: true,
    biomeCohesion: 9,
    economyBalance: "none",
    overlandTopology: "strategic",
    throneCount: 31,
    startDistribution: { land: 3, coastal: 2, water: 2, cave: 3, other: 2 },
    startDegreeTarget: 7,
    caveStartNations: [15, 59, 102],
    resolution: "custom",
    siteFrequency: 83,
    gateLayout: "ring",
    gateDirection: "bidirectional",
    gatePairsPerConnection: 3,
    planeConnections: [{ a: project.planes[0]!.id, b: activePlane.id, pairs: 2, enabled: false }],
  } satisfies Partial<GenerationSettings>);

  const before = cloneProject(project);
  const defaults = createDefaultProject().settings;
  resetGeneratorDefaults(project, activePlane.id);

  assert.equal(project.seed, "pantokrator-001");
  assert.deepEqual(picked(project.settings), picked(defaults));
  assert.equal(project.settings.siteFrequency, before.settings.siteFrequency);
  assert.equal(project.settings.gateLayout, before.settings.gateLayout);
  assert.equal(project.settings.gateDirection, before.settings.gateDirection);
  assert.equal(project.settings.gatePairsPerConnection, before.settings.gatePairsPerConnection);
  assert.deepEqual(project.settings.planeConnections, before.settings.planeConnections);

  const expected = cloneProject(before);
  expected.specificStarts = expected.specificStarts.filter((start) => start.source !== "generated-cave");
  expected.seed = "pantokrator-001";
  for (const key of RESET_SETTING_KEYS) {
    Object.assign(expected.settings, { [key]: defaults[key] });
  }
  for (const plane of expected.planes) {
    plane.width = RESOLUTION_PRESETS["4k"].width;
    plane.height = RESOLUTION_PRESETS["4k"].height;
  }
  const expectedActive = expected.planes.find((plane) => plane.id === activePlane.id)!;
  expectedActive.wrapX = true;
  expectedActive.wrapY = true;
  assert.deepEqual(project, expected, "only controls visible on Generate are reset");
  assert.deepEqual(project.specificStarts, [before.specificStarts[0]], "reset removes generated cave assignments but preserves manual #specstart");
  assert.equal(project.planes[0]!.noGeneratedStarts, true, "Generate-tab reset preserves per-plane start policy");
});

test("per-plane generated-start policy is opt-in and explains manual-start behavior", () => {
  const allowed = renderToStaticMarkup(createElement(PlaneStartPolicyControl, {
    plane: {},
    onChange() {},
  }));
  assert.match(allowed, /Block generated starts on this plane/);
  assert.match(allowed, /type="checkbox"/);
  assert.doesNotMatch(allowed, /checked=""/);
  assert.match(allowed, /aria-describedby="plane-generated-start-policy-help"/);
  assert.match(allowed, /Applies on the next Generate only/);
  assert.match(allowed, /Manual generic, team, and nation-specific starts remain available/);
  assert.match(allowed, /directly connected provinces/);

  const blocked = renderToStaticMarkup(createElement(PlaneStartPolicyControl, {
    plane: { noGeneratedStarts: true },
    onChange() {},
  }));
  assert.match(blocked, /type="checkbox"[^>]*checked=""/);
});

test("map marker annotations expose nation starts and all gate numbers on the selected plane", () => {
  const project = createDefaultProject("marker-annotation-fixture");
  const plane = project.planes[0]!;
  const province = plane.provinces[0]!;
  project.specificStarts = [{ nation: 27, planeId: plane.id, provinceId: province.id }];
  project.gates = [71, 22, 71].map((gateNumber, index) => ({
    id: `gate-${index}`,
    gateNumber,
    endpoints: [
      { planeId: plane.id, provinceId: province.id },
      { planeId: plane.id, provinceId: plane.provinces[index + 1]!.id },
    ],
  }));
  const annotations = markerAnnotationsForPlane(project, plane.id);
  assert.equal(annotations.get(province.id)?.specificStartNation, 27);
  assert.deepEqual(annotations.get(province.id)?.gateNumbers, [22, 71]);
});

test("reset generator defaults control is clearly labeled", () => {
  const html = renderToStaticMarkup(createElement(MapMakerApp));
  assert.match(html, /aria-label="Reset generator defaults"/);
  assert.match(html, /title="Restore Generate-tab defaults without replacing the current map"/);
  assert.match(html, /Undo restores the prior values/);
});

test("reset restores the non-wrapping Underworld default needed by the River Styx", () => {
  const project = addPlane(createDefaultProject("styx-reset"), "underworld", { generate: false });
  const underworld = project.planes[1]!;
  underworld.wrapX = true;
  underworld.wrapY = true;
  resetGeneratorDefaults(project, underworld.id);
  assert.equal(underworld.wrapX, false);
  assert.equal(underworld.wrapY, false);
});

test("new plane names remain distinguishable when the same archetype is added repeatedly", () => {
  const project = createDefaultProject("plane-name-fixture");
  project.planes[0]!.name = "The Underworld";
  project.planes.push({ ...project.planes[0]!, id: "plane-two", name: "The Underworld 2" });
  assert.equal(uniquePlaneName(project.planes, "The Underworld"), "The Underworld 3");
  assert.equal(uniquePlaneName(project.planes, "The Dreamlands"), "The Dreamlands");
});

test("staging another plane preserves every existing actual gateway", () => {
  const project = createDefaultProject("staged-plane-gates");
  project.gates = [{
    id: "manual-gate",
    gateNumber: 71,
    endpoints: [
      { planeId: project.planes[0]!.id, provinceId: project.planes[0]!.provinces[0]!.id },
      { planeId: project.planes[0]!.id, provinceId: project.planes[0]!.provinces[1]!.id },
    ],
  }];
  const staged = addPlane(project, "underworld", { generate: false });
  assert.deepEqual(staged.gates, project.gates);
  assert.equal(staged.planes[1]!.provinces.length, 0);
});

test("Generate copy and completion reporting disclose effective ocean-layout normalization", () => {
  const source = readFileSync(new URL("../src/MapMakerApp.tsx", import.meta.url), "utf8");
  assert.match(source, /Island chains use at least \{ISLAND_CHAIN_MIN_WATER_PERCENT\}% water/);
  assert.match(source, /validation report the achieved count/);
  assert.match(source, /Island chains used the \$\{ISLAND_CHAIN_MIN_WATER_PERCENT\}% effective water minimum/);
  assert.match(source, /continentNote\.message/);
  assert.doesNotMatch(source, /Players Ã— provinces per player/);
});

test("Generate exposes documented economy and overland policy choices", () => {
  const html = renderToStaticMarkup(createElement(MapMakerApp));
  // The scope is stated once on the section summary instead of inside each control's label.
  assert.match(html, /<summary><span class="setup-section-title">Balance &amp; routes<\/span><small class="scope-badge">Next generation<\/small>/);
  const section = html.slice(html.indexOf("Balance &amp; routes"), html.indexOf("Plane size &amp; output"));
  assert.match(section, /<span>Economy balance<\/span><select/);
  assert.match(section, />Hard competitive balance</);
  assert.match(section, /<span>Overland topology<\/span><select/);
  assert.match(section, />Competitive mix</);
  assert.match(section, /sparse and cave realms keep their authored route profiles/);
});
