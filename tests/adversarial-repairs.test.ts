import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdvancedInspector } from "../src/MapMakerApp";
import { BUILTIN_DOM6_CATALOG, createCatalogTemplate, mergeCatalogBundles, type Dom6CatalogBundle } from "../src/catalog";
import { createCatalogImportSession } from "../src/catalog/importSession";
import { createDefaultProject } from "../src/generator";
import { createProjectImportGuard } from "../src/projectSession";
import type { LoadedProjectAutosave } from "../src/autosave";
import type { Edge, MapProject, Plane } from "../src/domain";
import { edgeSpecial, terrainMask, validateProject } from "../src/dom6";
import { buildPackageFiles } from "../src/export";
import { borderStyles, setBorderKind } from "../src/edgeVisuals";
import { fitMapFrame, placeMapLabel, provinceBadgeRadius, screenToMapPoint } from "../src/mapView";
import { previewProvinceTerrain, provinceTerrainVisuals, winterPreviewStrength } from "../src/terrainVisuals";
import { analyzeStarts } from "../src/workbench";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const fixture = createDefaultProject("adversarial-repair-regressions");

/** Execute the production callback, not a duplicate implementation of its guard. */
function recoveryHarness() {
  const source = readFileSync(new URL("../src/MapMakerApp.tsx", import.meta.url), "utf8");
  const body = source.match(/const reloadAutosaveAfterConflict = async \(\) => \{([\s\S]*?)\n {2}\};/)![1]!;
  const guard = createProjectImportGuard();
  const reads: ReturnType<typeof deferred<LoadedProjectAutosave>>[] = [];
  const history: MapProject[] = [];
  const errors: unknown[] = [];
  const state = { current: structuredClone(fixture) };
  const queue = { current: Promise.resolve() };
  const bindings = {
    importGuardRef: { current: guard },
    autosaveState: { conflict: { reason: "revision-changed" } },
    autosaveQueueRef: queue,
    loadProjectAutosave: () => { const read = deferred<LoadedProjectAutosave>(); reads.push(read); return read.promise; },
    commit: (project: MapProject) => { history.push(state.current); state.current = project; guard.changed(); return true; },
    rangeEditStartRef: { current: undefined }, autosaveRevisionRef: { current: null },
    setAutosaveState() {}, setAutosaveSaving() {}, setActivePlaneId() {}, setSelectedId() {},
    setLinkSource() {}, setGateSource() {}, clearActionError() {}, setToast() {},
    showActionError: (...args: unknown[]) => errors.push(args),
  };
  const load = new Function(...Object.keys(bindings), `return async () => {${body}}`)(...Object.values(bindings)) as () => Promise<void>;
  const result = (name: string): LoadedProjectAutosave => ({ project: { ...structuredClone(fixture), name }, backend: "indexeddb", errors: [], migrated: false, revision: name });
  const edit = (name: string) => { history.push(state.current); state.current = { ...state.current, name }; guard.changed(); };
  return { load, result, edit, guard, reads, history, errors, state, queue };
}

async function microtasks() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

test("recovery cannot overwrite intervening edits and successful recovery retains Undo", async () => {
  const h = recoveryHarness();
  const pending = h.load(); await microtasks();
  h.edit("newer unsaved edit");
  h.reads[0]!.resolve(h.result("older storage copy")); await pending;
  assert.equal(h.state.current.name, "newer unsaved edit");
  assert.equal(h.history.length, 1);
  const previous = h.state.current;
  const successful = h.load(); await microtasks();
  h.reads[1]!.resolve(h.result("chosen recovery")); await successful;
  assert.equal(h.state.current.name, "chosen recovery");
  assert.equal(h.history.at(-1), previous);
  assert.deepEqual(h.errors, []);
});

test("reversed recovery completions, normal imports, cancellation, and read errors are safe", async () => {
  const h = recoveryHarness();
  const a = h.load(); await microtasks(); const b = h.load(); await microtasks();
  h.reads[1]!.resolve(h.result("B")); await b;
  h.reads[0]!.resolve(h.result("A")); await a;
  assert.equal(h.state.current.name, "B");
  for (const cancel of [() => h.guard.begin(), () => h.guard.cancel(), () => h.edit("changed")]) {
    const pending = h.load(); await microtasks(); cancel();
    const before = h.state.current;
    h.reads.at(-1)!.reject(new Error("stale read failure")); await pending;
    assert.equal(h.state.current, before);
  }
  assert.deepEqual(h.errors, []);
  const bad = h.load(); await microtasks();
  const before = h.state.current;
  h.reads.at(-1)!.reject(new Error("current read failure")); await bad;
  assert.equal(h.state.current, before);
  assert.equal(h.errors.length, 1);
});

test("recovery waits for queued saves and can be invalidated before reading", async () => {
  const h = recoveryHarness(); const saved = deferred<void>(); h.queue.current = saved.promise;
  const pending = h.load(); await microtasks(); assert.equal(h.reads.length, 0);
  h.edit("edit while waiting"); saved.resolve(); await pending;
  assert.equal(h.reads.length, 0); assert.equal(h.state.current.name, "edit while waiting");
});

function catalog(name: string, id: number) {
  const value = createCatalogTemplate("6.35"); value.catalogVersion = name;
  value.provenance[0]!.id = name;
  value.units = [{ id, name, provenanceId: name }];
  return value;
}

test("catalog imports preserve selection order and merge against the latest successful state", async () => {
  const session = createCatalogImportSession();
  const a = deferred<Dom6CatalogBundle>(); const b = deferred<Dom6CatalogBundle>();
  let stored: Dom6CatalogBundle | undefined;
  const persist = (value: Dom6CatalogBundle) => { stored = value; };
  const pa = session.import(() => a.promise, persist); const pb = session.import(() => b.promise, persist);
  b.resolve(catalog("B", 60002)); a.resolve(catalog("A", 60001)); await Promise.all([pa, pb]);
  assert.deepEqual(stored!.units.map(u => u.id).sort(), [60001, 60002]);
  const pc = session.import(() => Promise.resolve(catalog("C", 60001)), persist); await pc;
  assert.equal(stored!.units.find(u => u.id === 60001)!.name, "C");
});

test("catalog reset cancels pending reads and queued imports, including late failures", async () => {
  const session = createCatalogImportSession(); const late = deferred<Dom6CatalogBundle>();
  const writes: Dom6CatalogBundle[] = [];
  const a = session.import(() => late.promise, b => { writes.push(b); });
  const b = session.import(() => Promise.resolve(catalog("B", 60002)), x => { writes.push(x); });
  await microtasks(); session.reset();
  late.reject(new Error("cancelled file read"));
  assert.deepEqual(await Promise.all([a, b]), [undefined, undefined]); assert.equal(writes.length, 0);
  await session.import(() => Promise.resolve(catalog("C", 60003)), x => { writes.push(x); });
  assert.deepEqual(writes[0]!.units.map(u => u.id), [60003]);
});

test("catalog persistence failure leaves the active merge base unchanged", async () => {
  const session = createCatalogImportSession(); session.reset(catalog("A", 60001));
  await assert.rejects(session.import(() => Promise.resolve(catalog("B", 60002)), () => { throw new Error("quota"); }), /quota/);
  let stored: Dom6CatalogBundle | undefined;
  await session.import(() => Promise.resolve(catalog("C", 60003)), b => { stored = b; });
  assert.deepEqual(stored!.units.map(u => u.id).sort(), [60001, 60003]);
});

test("package validation uses the active catalog without changing native map contents", async () => {
  const project = structuredClone(fixture); const plane = project.planes[0]!;
  plane.width = 448; plane.height = 256;
  plane.provinces.find(p => !p.start)!.fort = 9000;
  const custom = catalog("test-catalog", 60001);
  custom.forts = [{ id: 9000, name: "Synthetic test fort", provenanceId: "test-catalog" }];
  const active = mergeCatalogBundles(BUILTIN_DOM6_CATALOG, custom);
  assert.equal(validateProject(project, active).filter(i => i.severity === "error").length, 0);
  const activeFiles = await buildPackageFiles(project, undefined, active);
  const defaultFiles = await buildPackageFiles(project);
  const text = (files: typeof activeFiles) => files.filter(f => f.name.endsWith(".txt")).map(f => new TextDecoder().decode(f.data)).join("\n");
  assert.doesNotMatch(text(activeFiles), /\[ERROR\].*fortification 9000/);
  assert.match(text(defaultFiles), /\[ERROR\].*fortification 9000/);
  assert.match(text(activeFiles), /Active selector catalog:.*test-catalog/);
  for (const file of activeFiles.filter(f => /\.(map|d6m)$/.test(f.name))) {
    assert.deepEqual(file.data, defaultFiles.find(f => f.name === file.name)!.data);
  }
});

test("custom borders initialize from the preset, render their input, and share bit-aware styles", () => {
  for (const kind of ["standard", "road", "river", "bridge", "mountain_pass", "mountain_border", "impassable"] as const) {
    const edge: Edge = { id: "edge", a: "a", b: "b", kind };
    const styles = borderStyles(edge); const native = edgeSpecial(edge);
    setBorderKind(edge, "custom");
    assert.equal(edge.special, native); assert.deepEqual(borderStyles(edge), styles);
  }
  const combined = borderStyles({ kind: "custom", special: 14 });
  assert.equal(combined.length, 3); assert.match(combined.at(-1)!.color, /225, 91, 76/);
  assert.equal(borderStyles({ kind: "custom", special: 64 }).length, 1);
  const project = structuredClone(fixture); const plane = project.planes[0]!; const edge = plane.edges[0]!;
  setBorderKind(edge, "custom");
  const html = renderToStaticMarkup(createElement(AdvancedInspector, { project, planeId: plane.id, province: plane.provinces.find(p => p.id === edge.a)!, update() {}, mutateProject() {} }));
  assert.match(html, /Border bitmask to province/); assert.match(html, /max="255"/);
  assert.equal(validateProject(project).some(i => i.message.includes("custom connection requires")), false);
});

test("condition previews replace cover, retain geography, and leave native masks untouched", () => {
  const province = structuredClone(fixture.planes[0]!.provinces[0]!);
  Object.assign(province, { terrain: "caveforest", terrainFlags: ["highland"], freshwater: true });
  const before = structuredClone(province); const mask = terrainMask(province);
  const flooded = provinceTerrainVisuals(province, "flooded");
  assert.ok(flooded.marks.includes("water") && flooded.marks.includes("cave") && flooded.marks.includes("kelp"));
  assert.ok(!flooded.marks.includes("swamp") && !flooded.marks.includes("freshwater"));
  const wasted = provinceTerrainVisuals(province, "wasted");
  assert.ok(!wasted.marks.includes("forest") && wasted.marks.includes("waste") && wasted.marks.includes("highland"));
  assert.deepEqual(provinceTerrainVisuals({ terrain: "sea" }, "farmland"), provinceTerrainVisuals({ terrain: "sea" }));
  for (const condition of ["forested", "flooded", "wasted", "farmland"] as const) {
    assert.deepEqual(provinceTerrainVisuals({ terrain: "cavewall" }, condition), provinceTerrainVisuals({ terrain: "cavewall" }));
  }
  assert.ok(!provinceTerrainVisuals({ terrain: "forest" }, "farmland").marks.includes("forest"));
  assert.ok(!provinceTerrainVisuals({ terrain: "sea", terrainFlags: ["forest"] }, "wasted").marks.includes("kelp"));
  assert.deepEqual(province, before); assert.equal(terrainMask(province), mask);
  assert.deepEqual(previewProvinceTerrain({ terrain: "plains" }, "normal"), { terrain: "plains" });
});

test("winter cover respects cave/water/realm exclusions and warmer/colder flags", () => {
  const land = { terrain: "plains" as const };
  for (const kind of ["cave", "cavern", "underworld", "hell", "abyss", "dream", "air", "cloud", "elemental"] as const) assert.equal(winterPreviewStrength({ kind }, land), 0);
  for (const terrain of ["cave", "cavewall", "sea", "kelp", "deepsea"] as const) assert.equal(winterPreviewStrength({ kind: "surface" }, { terrain }), 0);
  assert.equal(winterPreviewStrength({ kind: "custom", variant: "infernal" }, land), 0);
  assert.ok(winterPreviewStrength({ kind: "surface" }, { ...land, colder: true }) > winterPreviewStrength({ kind: "surface" }, land));
  assert.ok(winterPreviewStrength({ kind: "surface" }, land) > winterPreviewStrength({ kind: "surface" }, { ...land, warmer: true }));
});

test("aspect-preserving framing and hit testing are inverse across shape, pan, and zoom", () => {
  for (const [mapWidth, mapHeight] of [[3840, 2160], [2880, 2880], [256, 3840]]) {
    for (const [width, height] of [[588, 489], [374, 520], [1200, 300]]) {
      const plane = { width: mapWidth!, height: mapHeight! };
      const frame = fitMapFrame(plane, width!, height!);
      assert.ok(Math.abs(frame.width / frame.height - plane.width / plane.height) < 1e-10);
      for (const zoom of [0.78, 1, 4]) for (const [x, y] of [[0, 0], [0.5, 0.5], [0.9, 0.1], [1, 1]]) {
        const view = { zoom, panX: 31, panY: -17 };
        const sx = width! / 2 + view.panX + (x! - 0.5) * frame.width * zoom;
        const sy = height! / 2 + view.panY + (y! - 0.5) * frame.height * zoom;
        const back = screenToMapPoint(plane, width!, height!, view, sx, sy);
        assert.ok(Math.abs(back.x - x!) < 1e-10 && Math.abs(back.y - y!) < 1e-10);
      }
    }
  }
});

test("labels avoid collisions and marker glyphs retain a useful screen-space minimum", () => {
  const occupied = [{ x: 90, y: 90, width: 20, height: 20 }];
  const first = placeMapLabel(100, 100, 130, 14, 18, 300, 200, occupied)!;
  assert.ok(first); occupied.push(first);
  const second = placeMapLabel(100, 100, 130, 14, 18, 300, 200, occupied)!;
  assert.ok(second); assert.notDeepEqual(second, first);
  assert.equal(placeMapLabel(50, 50, 800, 14, 18, 300, 200, []), undefined);
  for (const width of [200, 588, 3840]) for (const zoom of [0.78, 1, 4]) {
    const radius = provinceBadgeRadius(width, zoom) * zoom;
    assert.ok(radius >= 6 && radius <= 10);
  }
});

test("malformed huge populations remain unknown instead of overflowing analysis", () => {
  const p = structuredClone(fixture);
  p.planes.forEach((plane: Plane) => plane.provinces.forEach(province => { province.population = 1e308; }));
  const analysis = analyzeStarts(p);
  assert.ok(analysis.starts.every(s => s.knownPopulation === 0 && Number.isFinite(s.knownPopulation)));
  assert.ok(analysis.starts.some(s => s.unknownPopulationCount > 0));
  assert.ok(validateProject(p).some(i => i.severity === "error" && i.message.includes("population")));
});
