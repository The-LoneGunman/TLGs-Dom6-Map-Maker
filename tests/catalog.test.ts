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
  selectableUnitEntries,
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

test("includes every verified post-publication nation, unit, and throne ID missing from the 6.26 map-manual tables", () => {
  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.nations, 123)?.name, "Pyrène");
  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.nations, 123)?.subtitle, "Cambion Kings");
  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.nations, 124)?.name, "Zemaitia");
  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.nations, 124)?.subtitle, "Sylvan Knights");
  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.units, 2194)?.name, "Draugadrott");
  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.units, 2195)?.name, "Flayed Bull");

  const postManualUnits: ReadonlyArray<readonly [number, string]> = [
    [4020, "Armored Unicorn"],
    [4021, "Lich Oracle"],
    [4022, "Student of the Sword"],
    [4023, "Master of the Sword"],
    [4024, "Mother Mandragora"],
    [4025, "Titan Mandragora"],
    [4026, "Black Minotaur"],
    [4027, "Carrion Fury"],
    [4028, "Carrion Enkidu"],
    [4029, "Carrion Ogre"],
    [4030, "Carrion Giant"],
    [4031, "Carrion Titan"],
    [4032, "Worm Soul"],
    [4033, "Worm Soul"],
    [4034, "Pyrènian Crossbowman"],
    [4035, "Pyrènian Spearman"],
    [4036, "Pyrènian Footman"],
    [4037, "Pyrènian Man at Arms"],
    [4038, "Pyrènian Swordsman"],
    [4039, "Pyrènian Knight"],
    [4040, "Pyrènian Scout"],
    [4041, "Pyrènian Castellan"],
    [4042, "Pyrènian Marquess"],
    [4043, "Pyrènian Monk"],
    [4044, "Pyrènian Priest"],
    [4045, "Blood Bishop"],
    [4046, "Sorgina"],
    [4047, "Black Cat"],
    [4048, "Cambion King"],
    [4049, "Cambion Count"],
    [4050, "Cambion Knight"],
    [4051, "Cambion Queen"],
    [4052, "Cambion Countess"],
    [4053, "Incubus"],
    [4054, "Cambion Progeny"],
    [4055, "Cambion Progeny"],
    [4056, "Black Goat"],
    [4057, "Markata Mystic"],
    [4058, "Black Goat"],
    [4059, "Red Mistress"],
    [4060, "Crimson King"],
    [4061, "Centaur Manikin"],
    [4062, "C'tissian Medium Infantry"],
    [4063, "Azenach Shaman Chief"],
    [4064, "Agrimandri Shaman Chief"],
    [4065, "Fommepori Shaman Chief"],
    [4066, "Vintefolei Shaman Chief"],
    [4067, "Spirit Horse"],
    [4068, "Zemaite Archer"],
    [4069, "Zemaite Warrior"],
    [4070, "Zemaite Warrior"],
    [4071, "Zemaite Infantry"],
    [4072, "Zemaite Heavy Infantry"],
    [4073, "Zemaite Chud Warrior"],
    [4074, "Zemaite Crossbowman"],
    [4075, "Zemaite Pikeneer"],
    [4076, "Zemaite Castle Guard"],
    [4077, "Zemaite Skinshifter"],
    [4078, "Werewolf"],
    [4079, "Zemaite Chud Skinshifter"],
    [4080, "Werebear"],
    [4081, "Scout"],
    [4082, "Zemaite Chieftain"],
    [4083, "Seniunas"],
    [4084, "Chud Seniunas"],
    [4085, "Vedun"],
    [4086, "Chud Vedun"],
    [4087, "Antlered Vedun"],
    [4088, "Vedun Mage Smith"],
    [4089, "Antlered Hochmeister"],
    [4090, "Sylvan Knight"],
    [4091, "Sacred Moose"],
    [4092, "Lauma"],
    [4093, "Fay Folk Stablehand"],
    [4094, "Fay Folk Musician"],
    [4095, "Fay Folk Cat Knight"],
    [4096, "Fay Cat"],
    [4097, "Fay Folk Snail Knight"],
    [4098, "Snail"],
    [4099, "Fay Folk Emperor"],
    [4100, "Wight Hag"],
    [4101, "Wight Spider"],
    [4102, "Wight Hag"],
    [4103, "Wight Mage"],
    [4104, "Fay Folk Sheep Knight"],
    [4105, "Ram"],
    [4106, "Fay Folk Donkey-In-Waiting"],
    [4107, "Great Moose"],
    [4108, "Ghost Moose"],
    [4109, "Moose Vedun"],
    [4110, "Lost Knight"],
    [4111, "Fay Moose"],
    [4112, "Longdead"],
    [4113, "Longdead"],
    [4114, "Longdead"],
    [4115, "Buraq"],
    [4116, "Fay Archer"],
    [4117, "Unseelie Archer"],
    [4118, "Unseelie Folk"],
    [4119, "Unseelie Folk"],
    [4120, "Unseelie Folk"],
    [4121, "Unseelie Folk"],
    [4122, "Unseelie Folk"],
    [4123, "Unseelie Stablehand"],
    [4124, "Unseelie Musician"],
    [4125, "Unseelie Cat Knight"],
    [4126, "Unseelie Cat"],
    [4127, "Fay Folk Swan Knight"],
    [4128, "Fay Swan"],
    [4129, "Unseelie Raven Knight"],
    [4130, "Unseelie Raven"],
    [4131, "Shah of Horses"],
    [4132, "Gnu"],
    [4133, "Gnu Clan Cavalry"],
    [4134, "Gnu Clan Commander"],
  ];
  for (const [id, name] of postManualUnits) {
    assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.units, id)?.name, name, `unit #${id}`);
  }

  const postManualThrones: ReadonlyArray<readonly [number, string]> = [
    [1398, "The Throne of the Fool"],
    [1399, "The Throne of Pride"],
    [1400, "The White Throne"],
    [1401, "The Black Throne"],
    [1402, "The Throne of Deeper Fires"],
    [1403, "The Throne of Deeper Waters"],
    [1404, "The Throne of Secrets"],
    [1405, "The Throne of Violence"],
  ];
  for (const [id, name] of postManualThrones) {
    const entry = findCatalogEntry(BUILTIN_DOM6_CATALOG.sites, id);
    assert.equal(entry?.name, name, `site #${id}`);
    assert.ok(entry?.tags?.includes("throne"), `site #${id} remains throne-only`);
  }

  assert.equal(searchCatalog(BUILTIN_DOM6_CATALOG.nations, "#123", 1)[0]?.name, "Pyrène");
  assert.equal(searchCatalog(BUILTIN_DOM6_CATALOG.nations, "Zemaitia", 1)[0]?.id, 124);
  assert.equal(searchCatalog(BUILTIN_DOM6_CATALOG.units, "Gnu Clan Cavalry", 1)[0]?.id, 4133);
  assert.equal(searchCatalog(BUILTIN_DOM6_CATALOG.units, "#4134", 1)[0]?.name, "Gnu Clan Commander");
  assert.equal(searchCatalog(BUILTIN_DOM6_CATALOG.sites, "#1405", 1)[0]?.name, "The Throne of Violence");
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

test("unit roles combine the complete pinned nation and magic-site recruitment tables", () => {
  const commanders = commanderUnitEntries(BUILTIN_DOM6_CATALOG.units);
  const troops = troopUnitEntries(BUILTIN_DOM6_CATALOG.units);
  assert.ok(commanders.length >= 800, "commander-role coverage must not regress to a hand-curated subset");
  assert.ok(troops.length >= 800, "troop-role coverage must not regress to a hand-curated subset");
  assert.equal(commanders.length, 850);
  assert.equal(troops.length, 842);

  for (const id of [1076, 54, 1645, 2390, 2825, 1632, 4134]) assert.ok(findCatalogEntry(commanders, id), `nation leader-table unit #${id} is available`);
  for (const id of [4084, 4086, 4087, 4089]) assert.ok(findCatalogEntry(commanders, id), `site commander unit #${id} is available`);
  for (const id of [1077, 61, 1578, 2388, 2821, 1617, 4133]) assert.ok(findCatalogEntry(troops, id), `nation troop-table unit #${id} is available`);
  for (const id of [4073, 4077, 4079, 4090]) assert.ok(findCatalogEntry(troops, id), `site troop unit #${id} is available`);
  assert.ok(findCatalogEntry(commanders, 4089)?.tags?.includes("site-recruitable-commander"));
  assert.equal(findCatalogEntry(commanders, 4089)?.tags?.includes("nation-recruitable-commander"), false);
  assert.ok(findCatalogEntry(troops, 4090)?.tags?.includes("site-recruitable-troop"));
  assert.equal(findCatalogEntry(troops, 4090)?.tags?.includes("nation-recruitable-troop"), false);
  assert.equal(commanders.some((entry) => troops.some((troop) => troop.id === entry.id)), false);

  for (const id of [34, 2844, 3624]) {
    assert.equal(findCatalogEntry(commanders, id), undefined, `unclassified monster #${id} is not guessed into the commander role`);
    assert.equal(findCatalogEntry(troops, id), undefined, `unclassified monster #${id} is not guessed into the troop role`);
    assert.ok(findCatalogEntry(BUILTIN_DOM6_CATALOG.units, id), `full-catalog search retains unusual valid monster #${id}`);
  }
});

test("normal unit browsing hides internal records while preserving complete raw-ID lookup", () => {
  const selectable = selectableUnitEntries(BUILTIN_DOM6_CATALOG.units);
  assert.equal(BUILTIN_DOM6_CATALOG.units.length, 4091);
  assert.equal(selectable.length, 4078);
  for (const id of [368, 543, 764, 1080, 1454, 2322, 2488, 2638, 3309, 3500, 3501, 4135, 4136]) {
    const raw = findCatalogEntry(BUILTIN_DOM6_CATALOG.units, id);
    assert.ok(raw?.tags?.includes("internal-unit-record"), `raw unit #${id} is retained and classified`);
    assert.equal(findCatalogEntry(selectable, id), undefined, `internal unit #${id} is hidden from normal browsing`);
  }
  assert.equal(findCatalogEntry(BUILTIN_DOM6_CATALOG.units, 4135)?.name, "Debug Senpai");
  assert.equal(searchCatalog(BUILTIN_DOM6_CATALOG.units, "#4136", 1)[0]?.name, "Debug Kohai");
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
