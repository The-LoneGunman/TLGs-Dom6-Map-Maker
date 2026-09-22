import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILTIN_DOM6_CATALOG, type Dom6CatalogBundle } from "../src/catalog";
import type { MapProject, Province } from "../src/domain";
import { createDefaultProject } from "../src/generator";
import { PopulationDefensePanel, PopulationDefenseProvinceStatus, populationDefensePolicyForToggle } from "../src/PopulationDefensePanel";
import { POPULATION_DEFENSE_PROFILE_REVISION } from "../src/populationDefenseProfiles";
import { buildInitialDefensePlan, type VerifiedPopulationDefenseProfile } from "../src/populationDefenders";

// Synthetic IDs establish UI behavior only. They do not assert any vanilla
// poptype membership or make fabricated roster data available to the app.
function fixture() {
  const catalog: Dom6CatalogBundle = structuredClone(BUILTIN_DOM6_CATALOG);
  const poptype = { id: 900_010, name: "UI-only population", provenanceId: "ui-test-only" };
  const commander = { id: 900_001, name: "UI-only commander", provenanceId: "ui-test-only" };
  const unit = { id: 900_002, name: "UI-only troop", provenanceId: "ui-test-only" };
  catalog.poptypes.push(poptype);
  catalog.units.push(commander, unit);
  const profile: VerifiedPopulationDefenseProfile = {
    revision: POPULATION_DEFENSE_PROFILE_REVISION, poptype, gameVersion: "6.37", mods: "",
    allowedMedia: ["dry"], caveRule: "any",
    source: { title: "Synthetic test only", reference: "test:population-defense-ui", revision: "fixture-1", verification: "Not vanilla recruitment evidence." },
    groups: [{ commander, squads: [{ unit, count: 12 }] }],
  };
  const project = createDefaultProject("population-defense-ui", { generate: false });
  const plane = project.planes[0]!;
  plane.provinces = Array.from({ length: 6 }, (_, index): Province => ({
    id: `ui-pop-${index}`, index: index + 1, x: 0.1 + (index % 3) * 0.35, y: index < 3 ? 0.25 : 0.75,
    gridX: index % 3, gridY: Math.floor(index / 3), name: `UI province ${index + 1}`,
    biome: "heartland", terrain: "plains", small: false, large: false, noStart: false,
    manySites: false, warmer: false, colder: false, siteBias: [], start: false, throne: "none",
    sites: [], killRandomSites: false, temple: false, lab: false, defenders: [], battle: {},
    rawDirectives: "", poptype: poptype.id,
  }));
  plane.provinces[1]!.poptype = 900_011; // Deliberately unsupported.
  plane.provinces[2]!.defenders = [{ commander: "900001", squads: [{ id: "authored", unit: "900002", count: 7 }] }];
  plane.provinces[3]!.start = true;
  plane.provinces[5]!.editorLocks = ["guardians"];
  plane.edges = [{ id: "protected-neighbour", a: plane.provinces[3]!.id, b: plane.provinces[4]!.id, kind: "standard" }];
  project.analysisContext = { gameVersion: "6.37", mods: "" };
  return { project, catalog, profiles: [profile] };
}

function markup(value: ReturnType<typeof fixture>, busy = false) {
  return renderToStaticMarkup(createElement(PopulationDefensePanel, {
    ...value, busy, onPolicyChange() {}, onContextChange() {}, onOpenAssumptions() {},
  }));
}

test("population defender UI is off by default with explicit current-map scope and limitations", () => {
  const value = fixture();
  const before = JSON.stringify(value.project);
  const html = markup(value);
  assert.match(html, /Match ordinary defenders to recruitment population/);
  assert.match(html, /class="scope-badge">Current Map/);
  assert.match(html, /type="checkbox"/);
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
  assert.match(html, /Off: no automatic defenders are applied/);
  assert.match(html, /Coverage preview: 1 ordinary province would match if enabled/);
  assert.match(html, /Verified coverage for this map: 1 of 2 otherwise eligible provinces/);
  assert.match(html, /1 custom-guardian province preserved; 3 excluded/);
  assert.match(html, /1 otherwise eligible province is unsupported/);
  assert.match(html, /Existing custom guardians are always preserved/);
  assert.match(html, /starts and their directly connected neighbours are excluded/);
  assert.match(html, /Manual and generated population-type edits take effect immediately, without a reroll or Generate/);
  assert.match(html, /not persistent province defence \(PD\)/);
  assert.match(html, /do not reproduce the game’s independent-strength formula/);
  assert.equal(JSON.stringify(value.project), before, "coverage preview must not apply an army or policy");
});

test("enabled coverage follows current poptype and patch edits immediately without touching custom armies", () => {
  const value = fixture();
  value.project.populationDefense = populationDefensePolicyForToggle(undefined, true);
  const customBefore = structuredClone(value.project.planes[0]!.provinces[2]!.defenders);
  assert.match(markup(value), /On: 1 ordinary province will use population-matched initial defenders/);
  const changed: MapProject = structuredClone(value.project);
  changed.planes[0]!.provinces[1]!.poptype = value.profiles[0]!.poptype.id;
  assert.match(markup({ ...value, project: changed }), /On: 2 ordinary provinces will use population-matched initial defenders/);
  const plan = buildInitialDefensePlan(changed, value.catalog, changed.populationDefense, value.profiles);
  assert.deepEqual(plan.counts, { custom: 1, derived: 2, excluded: 3, unsupported: 0 });
  changed.analysisContext!.gameVersion = "6.38";
  const mismatch = markup({ ...value, project: changed });
  assert.match(mismatch, /On: 0 ordinary provinces will use population-matched initial defenders/);
  assert.match(mismatch, /declared host patch differs from the verified template snapshot/);
  assert.match(mismatch, /Native initial armies are retained and may not match the assigned recruitment population/);
  assert.deepEqual(changed.planes[0]!.provinces[2]!.defenders, customBefore);
});

test("missing declarations, mod changes and missing profile coverage are disclosed instead of guessed", () => {
  const value = fixture();
  value.project.populationDefense = populationDefensePolicyForToggle(undefined, true);
  value.project.analysisContext = undefined;
  const missing = markup(value);
  assert.match(missing, /Declare the host game patch before using a patch-bound defender template/);
  assert.match(missing, /not auto-detected/);
  assert.match(missing, /#domversion/);
  value.project.analysisContext = { gameVersion: "6.37", mods: "Changed recruitment mod" };
  assert.match(markup(value), /declared mod set differs from the verified template snapshot/);
  const absent = markup({ ...value, profiles: [] });
  assert.match(absent, /Verification pending: no verified population templates are available for this revision/);
  assert.match(absent, /complete population coverage is not claimed/);
  assert.match(absent, /Available verified population types in this revision: 0/);
});

test("host-era controls remain unknown by default and disclose the exact verified scope", () => {
  const value = fixture();
  value.profiles[0]!.allowedEras = [2];
  const before = JSON.stringify(value.project);
  const unknown = markup(value);
  assert.match(unknown, /Declared host game era/);
  assert.match(unknown, /aria-describedby="population-defense-era-help"/);
  assert.match(unknown, /<option value="" selected="">Unknown \/ not declared/);
  assert.match(unknown, /Declare the host game era before using an era-restricted defender template/);
  assert.match(unknown, /not inferred from nations/);
  assert.match(unknown, /does not configure the game host/);
  assert.match(unknown, /Middle Age \(2\)/);
  assert.equal(JSON.stringify(value.project), before, "rendering must never fill in the host era");
  value.project.populationDefense = populationDefensePolicyForToggle(undefined, true);
  value.project.analysisContext!.era = 1;
  assert.match(markup(value), /declared host era is outside this template/);
  value.project.analysisContext!.era = 2;
  const matching = markup(value);
  assert.match(matching, /<option value="2" selected="">Middle Age/);
  assert.match(matching, /On: 1 ordinary province will use population-matched initial defenders/);
  const selected = renderToStaticMarkup(createElement(PopulationDefenseProvinceStatus, {
    ...value, planeId: value.project.planes[0]!.id, provinceId: value.project.planes[0]!.provinces[0]!.id,
  }));
  assert.match(selected, /Verified for patch 6\.37; Middle Age \(2\)/);
  assert.match(markup(value, true), /<select disabled="" aria-describedby="population-defense-era-help"/);
  delete value.project.analysisContext!.era;
  assert.match(markup(value), /On: 0 ordinary provinces/);
});

test("toggles preserve saved revisions and offer an explicit upgrade rather than silently adopting new armies", () => {
  const prior = { enabled: false, profileRevision: "older-template-revision" };
  assert.deepEqual(populationDefensePolicyForToggle(prior, true), { ...prior, enabled: true });
  assert.deepEqual(prior, { enabled: false, profileRevision: "older-template-revision" });
  const value = fixture();
  value.project.populationDefense = populationDefensePolicyForToggle(prior, true);
  const html = markup(value);
  assert.match(html, /This project pins a different template revision/);
  assert.match(html, /It is not upgraded automatically/);
  assert.match(html, /Use current verified profiles/);
  assert.match(html, /older-template-revision/);
  assert.match(html, /On: 0 ordinary provinces/);
  assert.deepEqual(populationDefensePolicyForToggle(value.project.populationDefense, false), prior);
});

test("population controls have associated help, native keyboard inputs and the narrow-screen checkbox style", () => {
  const html = markup(fixture(), true);
  assert.match(html, /<section[^>]*aria-labelledby="population-defense-heading"/);
  assert.match(html, /<label class="iteration-check"><input type="checkbox" disabled=""/);
  assert.match(html, /aria-describedby="population-defense-help population-defense-coverage"/);
  assert.match(html, /id="population-defense-help"/);
  assert.match(html, /id="population-defense-coverage" role="status" aria-live="polite"/);
  assert.match(html, /Declared host game patch/);
  assert.match(html, /maxLength="64" disabled="" placeholder="For example, 6.37" aria-describedby="population-defense-version-help"/);
  assert.match(html, /aria-haspopup="dialog"[^>]*>Review patch, era and mod assumptions/);
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.iteration-check input\s*\{[^}]*width:\s*16px/);
  assert.match(css, /\.iteration-panel p\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

test("Host and scenario integrates the policy through undoable project mutation and the active catalog", () => {
  const app = readFileSync(new URL("../src/MapMakerApp.tsx", import.meta.url), "utf8");
  const start = app.indexOf('leftTab === "scenario"');
  assert.ok(start >= 0);
  const panel = app.indexOf("<PopulationDefensePanel", start);
  assert.ok(panel > start);
  assert.match(app.slice(panel, panel + 500), /project=\{project\} catalog=\{catalog\}/);
  assert.match(app.slice(panel, panel + 500), /onPolicyChange=\{policy => mutate\(draft => \{ draft\.populationDefense = policy;/);
  assert.match(app.slice(panel, panel + 500), /onContextChange=\{context => mutate\(draft => \{ draft\.analysisContext = context;/);
  assert.match(app, /zipPackageSafety\(project, catalog, artwork\)/);
  assert.match(app, /<ExportDialog\s+project=\{project\}\s+catalog=\{catalog\}/);
  assert.match(app, /estimatedPackageBytes\(project, catalog\)/);
  assert.match(app, /<PopulationDefenseProvinceStatus project=\{project\} catalog=\{catalog\} planeId=\{activePlane\.id\} provinceId=\{selected\.id\}/);
});

test("activation is unavailable with no verified data but imported enabled policies can always be disabled", () => {
  const value = { ...fixture(), profiles: [] };
  const before = JSON.stringify(value.project);
  const disabled = markup(value);
  assert.match(disabled, /type="checkbox" disabled=""/);
  assert.match(disabled, /Verification pending/);
  assert.match(disabled, /Activation is unavailable until verified data exists/);
  assert.equal(JSON.stringify(value.project), before);
  value.project.populationDefense = populationDefensePolicyForToggle(undefined, true);
  const imported = markup(value);
  const checkbox = imported.match(/<input type="checkbox"[^>]*>/)![0];
  assert.match(checkbox, /checked=""/);
  assert.doesNotMatch(checkbox, /disabled/);
  value.project.populationDefense.profileRevision = "older-revision";
  assert.match(markup(value), /<button[^>]*disabled=""[^>]*>Use current verified profiles/);
});

test("selected-province preview distinguishes readonly derived armies from custom guardian editors", () => {
  const value = fixture();
  value.project.populationDefense = populationDefensePolicyForToggle(undefined, true);
  const renderProvince = (index: number) => renderToStaticMarkup(createElement(PopulationDefenseProvinceStatus, {
    ...value, planeId: value.project.planes[0]!.id, provinceId: value.project.planes[0]!.provinces[index]!.id,
    onConfigure() {},
  }));
  const derived = renderProvince(0);
  assert.match(derived, /Automatic population template/);
  assert.match(derived, /Read-only export result, not an editable custom guardian group/);
  assert.match(derived, /Commander: UI-only commander \(#900001\)/);
  assert.match(derived, /12 × UI-only troop \(#900002\)/);
  assert.match(derived, /Fixed template counts, not the game’s independent-strength formula or persistent PD/);
  assert.match(derived, /Configure population-matched defenders/);
  assert.doesNotMatch(derived, /<input|<select|<textarea/);
  const custom = renderProvince(2);
  assert.match(custom, /Custom guardians preserved/);
  assert.match(custom, /never replaced by this option/);
  assert.doesNotMatch(custom, /12 ×/);
  assert.match(renderProvince(3), /No automatic population army/);
  assert.match(renderProvince(3), /player start or directly connected start neighbor is protected/);
  assert.match(renderProvince(1), /Population template unsupported/);
  assert.match(renderProvince(1), /Native initial armies are retained/);
  value.project.planes[0]!.provinces[0]!.poptype = 900_011;
  assert.match(renderProvince(0), /Population template unsupported/);
  assert.doesNotMatch(renderProvince(0), /12 ×/);
});
