import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { VERIFIED_POPULATION_DEFENSE_PROFILES } from "../src/populationDefenseProfiles";
import { verifiedPopulationDefenseProfiles } from "../src/populationDefenseRegistry";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** Modules reachable through value (non-type) static imports and re-exports; dynamic import() is a split point. */
function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!/\.tsx?$/.test(file)) return;
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
    for (const statement of source.statements) {
      let specifier: string | undefined;
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        const typeOnly = clause?.isTypeOnly || (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly));
        if (!typeOnly) specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !statement.isTypeOnly) {
        const clause = statement.exportClause;
        const typeOnly = clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly);
        if (!typeOnly) specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
      }
      if (!specifier?.startsWith(".")) continue;
      const base = path.resolve(path.dirname(file), specifier.replace(/\?.*$/, ""));
      const resolved = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
      if (resolved) visit(resolved);
    }
  };
  visit(path.join(SRC, entry));
  return new Set([...seen].map((file) => path.relative(SRC, file).split(path.sep).join("/")));
}

test("the generation worker loads the catalog core without the unit table", () => {
  const worker = staticGraph("generation.worker.ts");
  assert.ok(worker.has("catalog/data/dom6-6.37.json"));
  assert.ok(worker.has("catalog/builtinCore.ts"));
  for (const excluded of ["catalog/data/dom6-6.37-units.json", "catalog/builtin.ts", "catalog/index.ts"]) {
    assert.equal(worker.has(excluded), false, `${excluded} must stay out of the worker`);
  }
});

test("the editor's first load excludes the package exporter and population templates, which load on demand", () => {
  const app = staticGraph("MapMakerApp.tsx");
  assert.ok(app.has("catalog/data/dom6-6.37-units.json"), "the editor keeps the complete catalog");
  for (const onDemand of ["export.ts", "hostReport.ts", "illustratedMap.ts", "populationDefenseProfiles.ts",
    "catalog/data/population-defense-6.37-v3.json"]) {
    assert.equal(app.has(onDemand), false, `${onDemand} must be loaded on demand`);
  }
  for (const light of ["projectFile.ts", "packageEstimate.ts", "illustratedArtworkPlan.ts", "populationDefenseRegistry.ts"]) {
    assert.ok(app.has(light), `${light} stays available synchronously`);
  }
});

test("importing the template data registers it as the default for compile, validation and estimates", () => {
  assert.equal(verifiedPopulationDefenseProfiles(), VERIFIED_POPULATION_DEFENSE_PROFILES);
});
