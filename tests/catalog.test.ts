import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILTIN_DOM6_CATALOG,
  commanderUnitEntries,
  createCatalogTemplate,
  findCatalogEntry,
  mergeCatalogBundles,
  parseCatalogBundle,
  provinceSiteEntries,
  provinceSiteLocationMask,
  searchCatalog,
  siteCompatibility,
  troopUnitEntries,
} from "../src/catalog";
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

test("province-site catalog includes ordinary and special non-home pools while excluding homes and thrones", () => {
  const sites = provinceSiteEntries(BUILTIN_DOM6_CATALOG.sites);
  const ordinarySites = sites.filter((entry) => entry.tags?.includes("ordinary-site"));
  const nonRandomSites = sites.filter((entry) => entry.tags?.includes("non-random-site"));
  assert.ok(ordinarySites.length >= 900, "ordinary site coverage must not regress below the pinned 6.35 pool");
  assert.equal(ordinarySites.length, 900);
  assert.equal(nonRandomSites.length, 71);
  assert.equal(sites.length, 971);

  for (const id of [401, 400, 418]) assert.ok(findCatalogEntry(ordinarySites, id), `ordinary site #${id} is available`);
  for (const id of [1261, 1331]) assert.ok(findCatalogEntry(sites, id), `non-random non-home site #${id} is available`);
  for (const id of [75, 79, 5, 127, 204, 216, 1332, 1361, 1383]) {
    assert.equal(findCatalogEntry(sites, id), undefined, `home/throne site #${id} is excluded`);
  }
  assert.ok(findCatalogEntry(BUILTIN_DOM6_CATALOG.sites, 204)?.tags?.includes("nation-home-site"));
  assert.ok(findCatalogEntry(BUILTIN_DOM6_CATALOG.sites, 216)?.tags?.includes("nation-home-site"));

  const custom = createCatalogTemplate("6.35");
  custom.sites.push({ id: 9001, name: "Verified mod province site", provenanceId: custom.provenance[0]!.id });
  assert.equal(provinceSiteEntries(custom.sites)[0]?.id, 9001, "untagged verified mod sites remain available");
});

test("unit roles come from the complete pinned nation recruitment tables", () => {
  const commanders = commanderUnitEntries(BUILTIN_DOM6_CATALOG.units);
  const troops = troopUnitEntries(BUILTIN_DOM6_CATALOG.units);
  assert.ok(commanders.length >= 600, "commander-role coverage must not regress to a hand-curated subset");
  assert.ok(troops.length >= 650, "troop-role coverage must not regress to a hand-curated subset");
  assert.equal(commanders.length, 627);
  assert.equal(troops.length, 679);

  for (const id of [1076, 54, 1645, 2390, 2825, 1632, 4134]) assert.ok(findCatalogEntry(commanders, id), `leader-table unit #${id} is available`);
  for (const id of [1077, 61, 1578, 2388, 2821, 1617, 4133]) assert.ok(findCatalogEntry(troops, id), `troop-table unit #${id} is available`);
  assert.equal(commanders.some((entry) => troops.some((troop) => troop.id === entry.id)), false);

  for (const id of [34, 2844, 3624]) {
    assert.equal(findCatalogEntry(commanders, id), undefined, `unclassified monster #${id} is not guessed into the commander role`);
    assert.equal(findCatalogEntry(troops, id), undefined, `unclassified monster #${id} is not guessed into the troop role`);
    assert.ok(findCatalogEntry(BUILTIN_DOM6_CATALOG.units, id), `full-catalog search retains unusual valid monster #${id}`);
  }
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

test("custom overrides cannot strip protected home-site or throne classifications", () => {
  const custom = createCatalogTemplate("6.35");
  const provenanceId = custom.provenance[0]!.id;
  custom.sites.push(
    { id: 204, name: "Renamed capital site", tags: ["ordinary-site"], provenanceId },
    { id: 1361, name: "Renamed throne", tags: ["ordinary-site"], provenanceId },
  );
  const merged = mergeCatalogBundles(BUILTIN_DOM6_CATALOG, custom);
  assert.ok(findCatalogEntry(merged.sites, 204)?.tags?.includes("nation-home-site"));
  assert.ok(findCatalogEntry(merged.sites, 1361)?.tags?.includes("throne"));
  assert.equal(findCatalogEntry(provinceSiteEntries(merged.sites), 204), undefined);
  assert.equal(findCatalogEntry(provinceSiteEntries(merged.sites), 1361), undefined);
});
