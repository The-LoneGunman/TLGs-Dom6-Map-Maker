import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MapMakerApp } from "../src/MapMakerApp";
import { autosaveRevision, loadProjectAutosave, saveProjectAutosave, type AutosaveDriver } from "../src/autosave";
import { cloneProject, type MapProject } from "../src/domain";
import { compileMapText } from "../src/dom6";
import { parseProject, serializeProject } from "../src/export";
import { addPlane, createDefaultProject } from "../src/generator";
import { normalizeProvinceName } from "../src/naming";
import { createFreshProject, prepareProjectForOpening, randomSeed } from "../src/projectSession";
import { pendingGenerationGroups, recordGenerationInputs } from "../src/workbench";

function entropy(t: TestContext, ...values: number[]) {
  let index = 0;
  return t.mock.method(globalThis.crypto, "getRandomValues", <T extends ArrayBufferView>(array: T): T => {
    assert.ok(array instanceof Uint32Array);
    for (let i = 0; i < array.length; i++) {
      assert.ok(index < values.length, "unexpected random draw");
      array[i] = values[index++]!;
    }
    return array;
  });
}

const template = recordGenerationInputs(addPlane(createDefaultProject("session-name-fixture"), "underworld"));
const names = (project: MapProject) => project.planes.flatMap(plane => plane.provinces.map(province => province.name));

test("fresh atlases use independent random seeds and record the generated baseline", t => {
  entropy(t, 1, 2, 3, 4, 0xffffffff, 0);
  const first = createFreshProject();
  const second = createFreshProject();
  assert.equal(first.seed, "realm-1-2");
  assert.equal(second.seed, "realm-3-4");
  assert.notDeepEqual(names(first), names(second));
  assert.deepEqual(pendingGenerationGroups(first), []);
  assert.deepEqual(pendingGenerationGroups(second), []);
  assert.equal(first.settings.randomizeNamesOnLoad ?? false, false);
  assert.equal(randomSeed(), "realm-1z141z3-0");
  assert.equal(createDefaultProject().seed, "pantokrator-001", "deterministic library fixtures remain stable");
});

test("saved projects preserve their exact names and seed unless opening rerolls are enabled", t => {
  const draws = entropy(t);
  for (const enabled of [undefined, false]) {
    const project = cloneProject(template);
    project.settings.randomizeNamesOnLoad = enabled;
    const before = structuredClone(project);
    assert.equal(prepareProjectForOpening(project), project);
    assert.deepEqual(project, before);
  }
  assert.equal(draws.mock.callCount(), 0);
});

test("opening rerolls change only generated names, their salt, and edit time across all planes", t => {
  entropy(t, 1729);
  const project = cloneProject(template);
  project.settings.randomizeNamesOnLoad = true;
  project.planes[0]!.provinces[0]!.name = "Player's Haven";
  project.planes[0]!.provinces[0]!.nameSource = "authored";
  project.planes[0]!.provinces[1]!.name = "Ancient Saved Name";
  delete project.planes[0]!.provinces[1]!.nameSource;
  const before = cloneProject(project);
  const opened = prepareProjectForOpening(project);
  assert.notEqual(opened, project);
  assert.deepEqual(project, before, "the saved snapshot remains available for recovery/Undo");
  assert.equal(opened.seed, project.seed);
  assert.deepEqual(pendingGenerationGroups(opened), []);
  const normalized = names(opened).map(normalizeProvinceName);
  assert.equal(new Set(normalized).size, normalized.length);

  const expected = cloneProject(before);
  expected.settings.provinceNameSeed = 1729;
  expected.updatedAt = opened.updatedAt;
  opened.planes.forEach((plane, pi) => {
    assert.notDeepEqual(plane.provinces.map(p => p.name), before.planes[pi]!.provinces.map(p => p.name));
    plane.provinces.forEach((province, i) => {
      if (province.nameSource === "generated") expected.planes[pi]!.provinces[i]!.name = province.name;
    });
    const withoutNames = (text: string) => text.split("\n").filter(line => !line.startsWith("#landname ")).join("\n");
    assert.equal(withoutNames(compileMapText(opened, pi)), withoutNames(compileMapText(before, pi)));
  });
  assert.deepEqual(opened, expected, "manual/legacy names and every non-naming field must survive");
});

test("reopening the same JSON can produce fresh names without changing the stored file", t => {
  entropy(t, 101, 202);
  const project = cloneProject(template);
  project.settings.randomizeNamesOnLoad = true;
  const json = serializeProject(project);
  const first = prepareProjectForOpening(parseProject(json));
  const second = prepareProjectForOpening(parseProject(json));
  assert.notDeepEqual(names(first), names(second));
  assert.equal(serializeProject(project), json);
  assert.deepEqual(names(parseProject(json)), names(project), "parsing alone is lossless");
  assert.equal(parseProject(serializeProject(first)).settings.randomizeNamesOnLoad, true);
  assert.deepEqual(names(parseProject(serializeProject(first))), names(first));
});

test("recovery copies and projects with no generated names never consume randomness or change", t => {
  const draws = entropy(t);
  const project = cloneProject(template);
  project.settings.randomizeNamesOnLoad = true;
  assert.equal(prepareProjectForOpening(project, true), project);
  for (const plane of project.planes) for (const province of plane.provinces) province.nameSource = "authored";
  assert.equal(prepareProjectForOpening(project), project);
  for (const plane of project.planes) plane.provinces = [];
  assert.equal(prepareProjectForOpening(project), project);
  assert.equal(draws.mock.callCount(), 0);
});

test("a random salt collision advances safely, including missing and maximum old salts", t => {
  entropy(t, 0, 0xffffffff);
  const project = cloneProject(template);
  project.settings.randomizeNamesOnLoad = true;
  delete project.settings.provinceNameSeed;
  assert.equal(prepareProjectForOpening(project).settings.provinceNameSeed, 1);
  project.settings.provinceNameSeed = 0xffffffff;
  assert.equal(prepareProjectForOpening(project).settings.provinceNameSeed, 0);
});

test("project import validates the optional opening preference as a boolean", () => {
  for (const invalid of ["false", 1, null, {}, []]) {
    const project = JSON.parse(serializeProject(template));
    project.settings.randomizeNamesOnLoad = invalid;
    assert.throws(() => parseProject(JSON.stringify(project)), /randomizeNamesOnLoad/);
  }
});

test("a startup name reroll saves against the original device revision without mutating storage during load", async t => {
  entropy(t, 707);
  const project = cloneProject(template);
  project.settings.randomizeNamesOnLoad = true;
  const original = serializeProject(project);
  let stored: string | null = original;
  const driver: AutosaveDriver = {
    async get() { return stored; },
    async set(value) { stored = value; },
    async remove() { stored = null; },
    async compareAndSet(expected, value) {
      if ((stored === null ? null : autosaveRevision(stored)) !== expected) return { saved: false, current: stored };
      stored = value;
      return { saved: true, current: stored };
    },
  };
  const drivers = { indexeddb: driver };
  const loaded = await loadProjectAutosave(drivers);
  assert.ok(loaded.project);
  assert.equal(stored, original);
  assert.deepEqual(names(loaded.project), names(project));
  const opened = prepareProjectForOpening(loaded.project, Boolean(loaded.conflict));
  assert.equal(stored, original, "opening must not bypass the autosave write guard");
  const saved = await saveProjectAutosave(opened, drivers, { expectedRevision: loaded.revision });
  assert.equal(saved.conflict, undefined);
  assert.equal(saved.backend, "indexeddb");
  assert.deepEqual(names(parseProject(stored!)), names(opened));
  const conflict = await saveProjectAutosave(project, drivers, { expectedRevision: loaded.revision });
  assert.ok(conflict.conflict, "a stale tab cannot overwrite the newly shuffled atlas");
});

test("initial rendering is hydration-safe and explains opening behavior with unambiguous map scopes", t => {
  const draws = entropy(t);
  const html = renderToStaticMarkup(createElement(MapMakerApp));
  assert.equal(draws.mock.callCount(), 0, "randomness must wait until autosave has loaded");
  assert.match(html, /inert=""/);
  assert.match(html, /Fresh generated names on open/);
  assert.match(html, /aria-describedby="fresh-names-help"/);
  assert.match(html, /Off by default/);
  assert.match(html, /New atlases start with a random seed/);
  assert.match(html, /<small class="scope-badge">Current Map<\/small>/);
  assert.match(html, /<small class="scope-badge">Current Map \+ next generation<\/small>/);
  assert.doesNotMatch(html, /<small class="scope-badge">(?:Map|Current map)(?: \+ next generation)?<\/small>/);
});

test("opening randomization is wired to normal opens but not conflict inspection or Undo", () => {
  const source = readFileSync(new URL("../src/MapMakerApp.tsx", import.meta.url), "utf8");
  assert.match(source, /prepareProjectForOpening\(result\.project, Boolean\(result\.conflict\)\)/);
  assert.match(source, /prepareProjectForOpening\(opened\)/);
  assert.match(source, /setUndoStack\(\[result\.project\]\)/);
  const newAtlas = source.slice(source.indexOf("const startNewAtlas ="), source.indexOf("const removePlane ="));
  assert.match(newAtlas, /createFreshProject\(\)/);
  const recovery = source.slice(source.indexOf("const reloadAutosaveAfterConflict ="), source.indexOf("if (!activePlane) return"));
  assert.doesNotMatch(recovery, /prepareProjectForOpening|createFreshProject|randomSeed/);
});
