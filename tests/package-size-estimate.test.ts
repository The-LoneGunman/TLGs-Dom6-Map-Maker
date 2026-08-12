import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPackageFiles,
  estimatedPackageBytes,
  estimatedTextPackageBytes,
} from "../src/export";
import { createDefaultProject } from "../src/generator";

function compactProject(seed: string) {
  const project = createDefaultProject(seed);
  project.planes[0]!.width = 256;
  project.planes[0]!.height = 256;
  return project;
}

test("package estimate covers the bytes actually assembled for a compact atlas", async () => {
  const project = compactProject("package-estimate-actual");
  const files = await buildPackageFiles(project);
  const actualSourceBytes = files.reduce((sum, file) => sum + file.data.byteLength, 0);
  assert.ok(estimatedPackageBytes(project) >= actualSourceBytes);
  assert.ok(estimatedTextPackageBytes(project) >= files
    .filter((file) => !file.name.endsWith(".d6m"))
    .reduce((sum, file) => sum + file.data.byteLength, 0));
});

test("advanced directives are budgeted in both compiled maps and editable support JSON", () => {
  const project = compactProject("package-estimate-directives");
  const baseline = estimatedPackageBytes(project);
  const raw = `#description "${"x".repeat(512 * 1024)}"`;
  project.rawDirectives = raw;
  const growth = estimatedPackageBytes(project) - baseline;
  assert.ok(growth >= raw.length * 2, `expected duplicated directive budget, received ${growth}`);
});

test("support-only project JSON payloads contribute to package safety", () => {
  const project = compactProject("package-estimate-json");
  const baseline = estimatedTextPackageBytes(project);
  const warning = "z".repeat(512 * 1024);
  project.generationWarnings = [warning];
  assert.ok(estimatedTextPackageBytes(project) - baseline >= warning.length);
});
