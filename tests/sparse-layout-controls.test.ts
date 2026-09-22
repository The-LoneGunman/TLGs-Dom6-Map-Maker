import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assertProjectLocks } from "../src/authoringLocks";
import { connectedRegionLayoutNotice } from "../src/connectedRegions";
import { cloneProject, type MapProject, type PlaneKind, type PlaneSparseLayout } from "../src/domain";
import { compileMapText, validateProject } from "../src/dom6";
import { parseProject, serializeProject } from "../src/export";
import { addPlane, createDefaultProject, generateProject } from "../src/generator";
import { usesConnectedRegions } from "../src/geometry";
import { prepareGuardianScenario } from "../src/guardianScenario";
import * as AppExports from "../src/MapMakerApp";
import { PlaneLayoutInfo, updatePlaneArchetype } from "../src/MapMakerApp";
import { applySettingsRecipe, createSettingsRecipe, parseSettingsRecipe } from "../src/recipes";
import { captureGenerationInputs, pendingGenerationGroups, recordGenerationInputs } from "../src/workbench";

function fixture(): MapProject {
  let project = createDefaultProject("sparse-layout-controls", { generate: false });
  project.settings.players = 2;
  project.settings.provincesPerPlayer = 16;
  project.settings.startDistribution = { land: 2, coastal: 0, water: 0, cave: 0, other: 0 };
  project.settings.throneCount = 0;
  project = addPlane(project, "cave", { generate: false });
  project.planes[1]!.autoSize = false;
  project.planes[1]!.provinceTarget = 24;
  for (const plane of project.planes) { plane.width = 256; plane.height = 256; }
  return cloneProject(generateProject(project));
}
const baseline = fixture();

function legacyPlaneInputs(project: MapProject): string {
  return JSON.stringify(project.planes.map((p, i) => [p.id, p.kind, p.variant, p.autoSize ?? (i === 0),
    (p.autoSize ?? (i === 0)) ? null : p.provinceTarget, p.noGeneratedStarts ?? false,
    p.ownershipMode, p.width, p.height, p.wrapX, p.wrapY, ...(p.generationOverrides ? [p.generationOverrides] : [])]));
}

test("new planes omit the deprecated choice while valid schema-v1 metadata round-trips verbatim", () => {
  const draft = createDefaultProject("sparse-defaults", { generate: false });
  assert.ok(draft.planes.every(plane => !Object.hasOwn(plane, "sparseLayout")));
  for (const kind of ["cave", "cavern", "underworld", "hell", "abyss", "cloud", "air", "dream", "elemental", "custom"] as const) {
    const added = addPlane(draft, kind, { generate: false });
    assert.equal(Object.hasOwn(added.planes[1]!, "sparseLayout"), false, kind);
  }
  for (const sparseLayout of ["chambers", "regions"] as const) {
    const project = cloneProject(baseline);
    project.planes[1]!.sparseLayout = sparseLayout;
    assert.deepEqual(parseProject(serializeProject(project)), project);
  }
  const underworld = cloneProject(baseline);
  underworld.planes[1]!.kind = "underworld";
  underworld.planes[1]!.sparseLayout = "regions";
  assert.deepEqual(parseProject(serializeProject(underworld)), underworld);
  const withoutMetadata = cloneProject(underworld);
  delete withoutMetadata.planes[1]!.sparseLayout;
  assert.deepEqual(validateProject(underworld), validateProject(withoutMetadata), "compatibility metadata must not alter true Styx validation");
});

test("unknown compatibility values and fields still fail closed", () => {
  for (const invalid of [null, 1, true, "", "Regions", "tunnels", {}, ["regions"]]) {
    const project = cloneProject(baseline);
    Object.assign(project.planes[1]!, { sparseLayout: invalid });
    assert.throws(() => parseProject(JSON.stringify(project)), /sparseLayout/);
    assert.throws(() => serializeProject(project), /sparseLayout/);
    assert.ok(validateProject(project).some(issue => issue.severity === "error" && /province layout/.test(issue.message)));
  }
  const unknown = cloneProject(baseline);
  Object.assign(unknown.planes[1]!, { unknownSparseOption: true });
  assert.throws(() => parseProject(JSON.stringify(unknown)), /unknownSparseOption|unknown field/i);
});

test("absent, chambers and regions metadata select the same effective topology", () => {
  const plane = baseline.planes[1]!;
  for (const style of [undefined, "chambers", "regions"] as const) {
    const configured = { ...plane, sparseLayout: style };
    assert.equal(usesConnectedRegions(configured), true, String(style));
  }
  const underworld = { ...plane, kind: "underworld" as const, sparseLayout: "regions" as const };
  const solid = { ...plane, ownershipMode: "solid" as const, sparseLayout: "regions" as const };
  assert.equal(usesConnectedRegions(underworld), false);
  assert.equal(usesConnectedRegions(solid), false);

  const compiled = ([undefined, "chambers", "regions"] as const).map(style => {
    const project = cloneProject(baseline);
    if (style === undefined) delete project.planes[1]!.sparseLayout;
    else project.planes[1]!.sparseLayout = style;
    return project.planes.map((_, index) => compileMapText(project, index));
  });
  assert.deepEqual(compiled[1], compiled[0]);
  assert.deepEqual(compiled[2], compiled[0]);
});

test("archetype edits preserve compatibility bytes while real topology follows the new archetype", () => {
  const project = cloneProject(baseline), plane = project.planes[1]!;
  plane.sparseLayout = "regions";
  const provinces = structuredClone(plane.provinces), starts = structuredClone(project.specificStarts);
  updatePlaneArchetype(project, plane.id, "underworld");
  assert.equal(plane.kind, "underworld");
  assert.equal(plane.sparseLayout, "regions");
  assert.equal(usesConnectedRegions(plane), false);
  assert.deepEqual(plane.provinces, provinces);
  assert.deepEqual(project.specificStarts, starts);
  assert.doesNotThrow(() => serializeProject(project));
});

test("generation signatures describe effective topology and ignore metadata-only edits", () => {
  const project = cloneProject(baseline), plane = project.planes[1]!;
  delete plane.sparseLayout;
  assert.notEqual(captureGenerationInputs(project).planes, legacyPlaneInputs(project), "old sparse snapshots must be stale");
  recordGenerationInputs(project);
  const signature = project.generationInputs!.planes;
  assert.match(signature, /connected-regions/);
  for (const style of ["chambers", "regions"] as const) {
    plane.sparseLayout = style;
    assert.equal(captureGenerationInputs(project).planes, signature);
    assert.deepEqual(pendingGenerationGroups(project), []);
  }

  for (const kind of ["underworld", "surface"] as const) {
    const standard = cloneProject(baseline);
    standard.planes[1]!.kind = kind;
    if (kind === "surface") standard.planes[1]!.ownershipMode = "solid";
    delete standard.planes[1]!.sparseLayout;
    assert.equal(captureGenerationInputs(standard).planes, legacyPlaneInputs(standard), kind);
    standard.planes[1]!.sparseLayout = "regions";
    assert.equal(captureGenerationInputs(standard).planes, legacyPlaneInputs(standard), `${kind} metadata`);
  }
});

test("layout locks ignore obsolete metadata but still protect real geometry", () => {
  const original = cloneProject(baseline);
  original.authoring = { lockLayout: true, lockStarts: true };
  for (const style of ["chambers", "regions"] as const) {
    const metadataOnly = cloneProject(original);
    metadataOnly.planes[1]!.sparseLayout = style;
    assert.doesNotThrow(() => assertProjectLocks(original, metadataOnly));
  }
  const moved = cloneProject(original);
  moved.planes[1]!.provinces[0]!.x += 0.01;
  assert.throws(() => assertProjectLocks(original, moved), /Layout is locked/);
  const changedKind = cloneProject(original);
  changedKind.planes[1]!.kind = "underworld";
  assert.throws(() => assertProjectLocks(original, changedKind), /Layout is locked/);
});

test("recipes preserve deprecated bytes and never rewrite existing content, starts, or gates", () => {
  const configured = cloneProject(baseline);
  configured.planes[1]!.sparseLayout = "regions";
  const recipe = parseSettingsRecipe(JSON.stringify(createSettingsRecipe(configured)));
  assert.equal(recipe.planes[1]!.sparseLayout, "regions");
  const provinces = structuredClone(baseline.planes.map(plane => plane.provinces));
  const starts = structuredClone(baseline.specificStarts);
  const gates = structuredClone(baseline.gates);
  const applied = applySettingsRecipe(baseline, recipe);
  assert.equal(applied.planes[1]!.sparseLayout, "regions");
  assert.deepEqual(applied.planes.map(plane => plane.provinces), provinces);
  assert.deepEqual(applied.specificStarts, starts);
  assert.deepEqual(applied.gates, gates);

  const locked = cloneProject(baseline);
  locked.authoring = { lockLayout: true };
  assert.doesNotThrow(() => applySettingsRecipe(locked, recipe));

  const underworldRecipe = structuredClone(recipe);
  underworldRecipe.planes[1]!.kind = "underworld";
  underworldRecipe.planes[1]!.sparseLayout = "regions";
  assert.doesNotThrow(() => parseSettingsRecipe(JSON.stringify(underworldRecipe)));
});

test("guardian fixtures derive layout from plane type without propagating obsolete metadata", () => {
  for (const style of [undefined, "chambers", "regions"] as const) {
    const source = cloneProject(baseline), plane = source.planes[1]!, target = plane.provinces[0]!;
    if (style === undefined) delete plane.sparseLayout; else plane.sparseLayout = style;
    target.defenders = [{ commander: "1463", squads: [{ id: "sparse-fixture", unit: "1465", count: 15 }] }];
    const before = serializeProject(source);
    const prepared = prepareGuardianScenario(source, plane.id, target.id);
    assert.equal(Object.hasOwn(prepared.planes[0]!, "sparseLayout"), false);
    assert.equal(usesConnectedRegions(prepared.planes[0]!), true);
    assert.equal(serializeProject(source), before);
  }
});

test("the planes screen reports one effective layout and exposes no classic selector", () => {
  assert.equal("updatePlaneSparseLayout" in AppExports, false);
  const plane = baseline.planes[1]!;
  const render = (kind: PlaneKind, ownershipMode?: "sparse" | "solid", sparseLayout?: PlaneSparseLayout) => renderToStaticMarkup(createElement(PlaneLayoutInfo, {
    plane: { ...plane, kind, ownershipMode, sparseLayout },
  }));
  for (const style of [undefined, "chambers", "regions"] as const) {
    const html = render("cave", undefined, style);
    assert.match(html, /Province layout/);
    assert.match(html, /Connected regions &amp; passages/);
    assert.match(html, /broad, playable passage provinces/);
    assert.doesNotMatch(html, /<select|classic|Chambers &amp; tunnels/i);
  }
  const underworld = render("underworld", undefined, "regions");
  assert.match(underworld, /River Styx layout/);
  assert.match(underworld, /realm-bisecting Styx/);
  assert.doesNotMatch(underworld, /<select|classic/i);
  assert.equal(render("surface"), "");
  assert.equal(render("cave", "solid"), "");
});

test("unsafe authored regional graphs remain importable and show a compatibility-geometry notice", () => {
  const project = cloneProject(baseline), plane = project.planes[1]!;
  plane.wrapX = false; plane.wrapY = false;
  plane.provinces = plane.provinces.slice(0, 3);
  plane.provinces.forEach((province, index) => { province.x = 0.2 + index * 0.3; province.y = 0.5; });
  plane.edges = [{ id: "authored-remote-link", a: plane.provinces[0]!.id, b: plane.provinces[2]!.id, kind: "standard" }];
  const before = serializeProject(project);
  assert.deepEqual(parseProject(before).planes[1]!.edges, plane.edges);
  assert.ok(connectedRegionLayoutNotice(plane));
  for (const style of [undefined, "chambers", "regions"] as const) {
    if (style === undefined) delete plane.sparseLayout; else plane.sparseLayout = style;
    const html = renderToStaticMarkup(createElement(PlaneLayoutInfo, { plane }));
    assert.match(html, /province-layout-notice/);
    assert.match(html, /Current map uses compatibility geometry/);
    assert.doesNotMatch(html, /Classic footprints are retained/i);
  }
});
