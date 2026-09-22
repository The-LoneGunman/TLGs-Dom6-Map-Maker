import assert from "node:assert/strict";
import test from "node:test";
import { autosaveRevision } from "../src/autosave";
import { validateProject } from "../src/dom6";
import { cloneProject } from "../src/domain";
import { serializeProject } from "../src/export";
import { addPlane, calculateFairness, createDefaultProject, globalMovementAdjacency, markProjectImmutable, sharedGlobalMovementAdjacency } from "../src/generator";
import { shareUnchangedPlanes } from "../src/uiWorkflow";
import { analyzeStarts } from "../src/workbench";

const baseline = addPlane(createDefaultProject("shared-analysis"), "cave", { generate: false });

function bigIntRevision(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${text.length}:${hash.toString(16).padStart(16, "0")}`;
}

test("autosave revisions keep the 64-bit FNV-1a tokens, including repeated and non-ASCII text", () => {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) >>> 0);
  const samples = ["", "a", "é☃x", "😀", "\uD800", "￿".repeat(33), serializeProject(baseline)];
  for (let index = 0; index < 200; index += 1) {
    samples.push(String.fromCharCode(...Array.from({ length: next() % 120 }, () => next() % 0x10000)));
  }
  for (const text of [...samples, ...samples]) assert.equal(autosaveRevision(text), bigIntRevision(text));
});

test("projects marked immutable share analyses without changing any result", () => {
  const project = cloneProject(baseline);
  const surface = project.planes[0]!;
  // A repeated gate endpoint must not leak a self-exit into the shared movement graph.
  project.gates.push({ id: "self", gateNumber: 99, endpoints: [
    { planeId: surface.id, provinceId: surface.provinces[2]!.id },
    { planeId: surface.id, provinceId: surface.provinces[2]!.id },
  ] });
  const expected = {
    issues: validateProject(project), fairness: calculateFairness(project),
    structural: analyzeStarts(project, "structural"), conservative: analyzeStarts(project, "conservative"),
    movement: [...globalMovementAdjacency(project)],
  };
  const marked = markProjectImmutable(structuredClone(project));
  for (let round = 0; round < 2; round += 1) {
    assert.deepEqual(analyzeStarts(marked, "structural"), expected.structural);
    assert.deepEqual(validateProject(marked), expected.issues);
    assert.deepEqual(calculateFairness(marked), expected.fairness);
    assert.deepEqual(analyzeStarts(marked, "conservative"), expected.conservative);
  }
  // Start analysis filters the self-exit into its own copy; the shared graph is untouched.
  assert.equal(sharedGlobalMovementAdjacency(marked), sharedGlobalMovementAdjacency(marked));
  assert.deepEqual([...sharedGlobalMovementAdjacency(marked)], expected.movement);
  // Cached validation hands out copies, so callers cannot alter later results.
  validateProject(marked)[0]!.message = "changed";
  assert.deepEqual(validateProject(marked), expected.issues);
  // Unmarked projects are never cached: editing one in place is always re-validated.
  project.name = "";
  assert.ok(validateProject(project).some((issue) => issue.message === "Map name is required."));
});

test("editor history shares unchanged planes without changing the saved project", () => {
  const previous = markProjectImmutable(cloneProject(baseline));
  const provinceEdit = cloneProject(previous);
  provinceEdit.planes[0]!.provinces[3]!.name = "Renamed";
  const expectedText = serializeProject(provinceEdit);
  const shared = shareUnchangedPlanes(previous, provinceEdit);
  assert.equal(serializeProject(shared), expectedText);
  assert.notEqual(shared.planes[0], previous.planes[0]);
  assert.equal(shared.planes[1], previous.planes[1]);

  const settingEdit = cloneProject(shared);
  settingEdit.description = "Only the description changed.";
  const settingText = serializeProject(settingEdit);
  const next = shareUnchangedPlanes(markProjectImmutable(shared), settingEdit);
  assert.equal(serializeProject(next), settingText);
  assert.ok(next.planes.every((plane, index) => plane === shared.planes[index]));
});
