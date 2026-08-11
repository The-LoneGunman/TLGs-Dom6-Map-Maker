import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_DOM6_CATALOG, createCatalogTemplate, findCatalogEntry, mergeCatalogBundles, parseCatalogBundle, provinceSiteLocationMask, searchCatalog, siteCompatibility } from "../src/catalog";
import { createDefaultProject } from "../src/generator";

test("ships the complete pinned Dominions selector catalogs", () => {
  assert.equal(BUILTIN_DOM6_CATALOG.units.length, 4091);
  assert.equal(BUILTIN_DOM6_CATALOG.sites.length, 1253);
  assert.equal(BUILTIN_DOM6_CATALOG.poptypes.length, 82);
  assert.equal(BUILTIN_DOM6_CATALOG.nations.length, 106);
  assert.equal(BUILTIN_DOM6_CATALOG.forts.length, 28);

  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.poptypes, 25)?.name, "Barbarians");
  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.sites, 1361)?.name, "The Throne of Gaia");
  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.units, 2468)?.name, "Druid");
  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.forts, 29)?.name, "Crystal Citadel");
  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.nations, 2)?.name, "Special Independents (e.g. Horrors)");
  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.nations, 4)?.name, "Roaming Independents (e.g. Barbarians)");
  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.poptypes, 40)?.name, "Amazon, Crystal");
  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.poptypes, 75)?.name, "Hoburg, LA");
  assert.ok(findCatalogEntry(BUILTIN_DOM6_CATALOG.sites, 1361)?.tags?.includes("throne"));
  assert.equal(BUILTIN_DOM6_CATALOG.nations.some((entry) => entry.name.startsWith("nation_")), false);
});

test("catalog search disambiguates duplicate names with stable numeric IDs", () => {
  const heavyCavalry = searchCatalog(BUILTIN_DOM6_CATALOG.units, "Heavy Cavalry", 20);
  assert.ok(heavyCavalry.length > 1);
  assert.ok(new Set(heavyCavalry.map((entry) => entry.id)).size > 1);
  assert.equal(searchCatalog(BUILTIN_DOM6_CATALOG.units, "#2468", 1)[0]?.name, "Druid");
});

test("site selectors carry terrain compatibility and throne metadata", () => {
  const project = createDefaultProject("catalog-site-compatibility");
  const plane = project.planes[0]!;
  const land = plane.provinces.find((province) => province.terrain === "plains" || province.terrain === "farm")!;
  const deepOnly = BUILTIN_DOM6_CATALOG.sites.find((entry) => entry.terrainMask === 256);
  assert.ok(deepOnly);
  assert.equal(siteCompatibility(deepOnly!, land, plane).compatible, false);
  assert.equal(BUILTIN_DOM6_CATALOG.sites.filter((entry) => entry.tags?.includes("throne")).length, 74);
});

test("site locations honor additive terrain and keep freshwater on land", () => {
  const project = createDefaultProject("catalog-additive-terrain");
  const plane = project.planes[0]!;
  const province = plane.provinces.find((item) => !item.start)!;

  province.terrain = "plains";
  province.freshwater = true;
  province.terrainFlags = undefined;
  let mask = provinceSiteLocationMask(province, plane);
  assert.ok((mask & 1) !== 0, "freshwater land remains eligible for plain sites");
  assert.equal((mask & 32) !== 0, false, "freshwater alone is not a sea site location");

  province.freshwater = undefined;
  province.terrainFlags = ["sea", "mountains", "forest"];
  mask = provinceSiteLocationMask(province, plane);
  assert.ok((mask & 32_768) !== 0, "sea + mountains enables underwater-mountain sites");
  assert.ok((mask & 65_536) !== 0, "sea + forest enables underwater-forest sites");

  province.terrainFlags = ["cavewall"];
  assert.equal(provinceSiteLocationMask(province, plane), 0, "blocked cave walls are not valid cave-site provinces");
});

test("catalog ingestion permits verified special-plane codes but rejects negative game IDs", () => {
  const template = createCatalogTemplate("6.35");
  template.planes.push({ id: -13, name: "Custom negative plane code", provenanceId: template.provenance[0]!.id });
  const parsed = parseCatalogBundle(JSON.stringify(template));
  assert.equal(parsed.planes[0]?.id, -13);

  template.units.push({ id: -1, name: "Invalid unit", provenanceId: template.provenance[0]!.id });
  assert.throws(() => parseCatalogBundle(JSON.stringify(template)), /cannot be negative/);
});

test("catalog merging rejects conflicting provenance identities", () => {
  const custom = createCatalogTemplate("6.35");
  custom.provenance[0] = {
    ...BUILTIN_DOM6_CATALOG.provenance[0]!,
    title: "Conflicting source claim",
  };
  assert.throws(() => mergeCatalogBundles(BUILTIN_DOM6_CATALOG, custom), /provenance ID .* conflicts/);
});
