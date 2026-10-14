import assert from "node:assert/strict";
import test from "node:test";
import { addPlane, createDefaultProject, generateProject } from "../src/generator";
import { cloneProject } from "../src/domain";
import { validateProject } from "../src/dom6";
import { smallerZipProject, supportsDirectInstall, unsupportedInstallMessage } from "../src/exportOptions";
import { zipPackageSafety } from "../src/packageEstimate";

test("direct install requires a secure context, a picker and callable cross-tab locking", () => {
  const supported = { isSecureContext: true, showDirectoryPicker() {}, navigator: { locks: { request() {} } } };
  assert.equal(supportsDirectInstall(supported), true);
  assert.equal(supportsDirectInstall({}), false);
  assert.equal(supportsDirectInstall({ ...supported, isSecureContext: false }), false);
  assert.equal(supportsDirectInstall({ ...supported, showDirectoryPicker: true }), false);
  assert.equal(supportsDirectInstall({ ...supported, navigator: {} }), false);
  assert.equal(supportsDirectInstall({ ...supported, navigator: { locks: { request: true } } }), false);
});

test("unsupported install never recommends downloading a blocked ZIP", () => {
  const project = createDefaultProject("export-fallback");
  const safe = zipPackageSafety(project);
  assert.match(unsupportedInstallMessage(safe), /Download the ready ZIP/);
  const blocked = { ...safe, level: "blocked" as const };
  assert.doesNotMatch(unsupportedInstallMessage(blocked), /Download the ready ZIP/);
  assert.match(unsupportedInstallMessage(blocked), /Reduce output resolution/);
  assert.match(unsupportedInstallMessage(blocked), /Editable project JSON/);
});

const twoPlanes = generateProject(addPlane(createDefaultProject("zip-resize-regression"), "underworld", { generate: false, autoSize: true }));

test("large illustrated ZIP offers validated dimensions without changing content or the source", () => {
  const original = structuredClone(twoPlanes);
  assert.equal(zipPackageSafety(original, undefined, "illustrated").level, "blocked");
  const next = smallerZipProject(original, undefined, "illustrated");
  assert.ok(next);
  assert.deepEqual(original, twoPlanes);
  assert.notEqual(zipPackageSafety(next, undefined, "illustrated").level, "blocked");
  assert.deepEqual(validateProject(next).filter(issue => issue.severity === "error"), []);
  assert.equal(next.settings.resolution, "custom");
  const restoredDimensions = { ...next, settings: { ...next.settings, resolution: original.settings.resolution },
    planes: next.planes.map((plane, i) => ({ ...plane, width: original.planes[i]!.width, height: original.planes[i]!.height })) };
  assert.deepEqual(restoredDimensions, original);
});

test("eight illustrated planes fit while portrait and already-small planes keep their aspect ratio", () => {
  let project = cloneProject(twoPlanes);
  for (const kind of ["cave", "cloud", "air", "hell", "dream", "elemental"] as const) project = addPlane(project, kind, { generate: false, autoSize: true });
  project = generateProject(project);
  project.planes[0]!.width = 2160;
  project.planes[0]!.height = 3840;
  project.planes[2]!.width = project.planes[2]!.height = 256;
  const original = structuredClone(project);
  const next = smallerZipProject(project, undefined, "illustrated");
  assert.ok(next);
  assert.notEqual(zipPackageSafety(next, undefined, "illustrated").level, "blocked");
  assert.deepEqual(validateProject(next).filter(issue => issue.severity === "error"), []);
  next.planes.forEach((plane, i) => {
    const before = original.planes[i]!;
    assert.ok(plane.width >= 256 && plane.height >= 256);
    assert.ok(plane.width <= before.width && plane.height <= before.height);
    assert.ok(Math.abs(plane.width / plane.height - before.width / before.height) < .01);
  });
  assert.deepEqual(project, original);
});

test("ZIP resize respects layout locks, valid-small packages, and pre-existing validation errors", () => {
  const locked = cloneProject(twoPlanes);
  locked.authoring = { lockLayout: true };
  assert.equal(smallerZipProject(locked, undefined, "illustrated"), undefined);
  assert.equal(smallerZipProject(twoPlanes), undefined);
  const invalid = cloneProject(twoPlanes);
  invalid.planes[0]!.provinces[0]!.x = -1;
  assert.equal(smallerZipProject(invalid, undefined, "illustrated"), undefined);
  invalid.planes[0]!.provinces[0]!.x = twoPlanes.planes[0]!.provinces[0]!.x;
  invalid.rawDirectives = "#start 1";
  assert.equal(smallerZipProject(invalid, undefined, "illustrated"), undefined);
});
