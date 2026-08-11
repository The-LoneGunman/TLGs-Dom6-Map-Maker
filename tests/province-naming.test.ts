import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { cloneProject, type Plane, type PlaneKind, type PlaneVariant, type Province, type TerrainFlag, type TerrainKey } from "../src/domain";
import { compileMapText } from "../src/dom6";
import { createDefaultProject, generateProject } from "../src/generator";
import {
  MIN_CONTEXTUAL_NAME_POOL,
  RESERVED_CAPITAL_NAMES,
  isReservedProvinceName,
  normalizeProvinceName,
  provinceNameContext,
  regenerateAllProvinceNames,
  regenerateGeneratedProvinceNames,
} from "../src/naming";

const KINDS: PlaneKind[] = ["surface", "cave", "cavern", "cloud", "air", "underworld", "hell", "abyss", "dream", "elemental", "custom"];
const VARIANTS: PlaneVariant[] = ["temperate", "wild", "frozen", "arid", "oceanic", "fungal", "crystal", "volcanic", "storm", "infernal", "void"];

const EXPECTED_CUSTOM_THEMES: Record<PlaneVariant, string> = {
  temperate: "custom:temperate",
  wild: "custom:wild",
  frozen: "custom:frozen",
  arid: "custom:arid",
  oceanic: "custom:oceanic",
  fungal: "custom:fungal",
  crystal: "custom:crystal",
  volcanic: "custom:volcanic",
  storm: "custom:storm",
  infernal: "custom:infernal",
  void: "custom:void",
};

const NAMING_TEMPLATE = createDefaultProject("province-naming-template");

const THEME_MODIFIERS: Record<string, Set<string>> = {
  surface: new Set("Amber Ancient Bright Broad Elder Golden Green Grey Long Old Red River Silver Summer White Windward Winter Crowned Eastern Western".split(" ")),
  cave: new Set("Buried Chthonic Deep Dripping Echoing Fungal Glimmering Hollow Lower Mosslit Resonant Rootbound Shadowed Stone Subterranean Umbral Under Vaulted Veiled Forgotten".split(" ")),
  cavern: new Set("Amethyst Ancient Argent Crystal Deep Diamond Echoing Faceted Gemlit Gilded Glittering Grand Hidden Lower Opaline Prismatic Resonant Stalactite Vast Vaulted".split(" ")),
  cloud: new Set("Aerial Azure Cirrus Cloudborne High Lightning Lofty Nimbus Rainbright Silver Skybound Stormlit Sunward Tempest Thunder Upper Vaporous White Windborne Zephyr".split(" ")),
  air: new Set("Breathless Celestial Gale High Horizon Invisible Jetstream Open Radiant Rushing Skyward Stormborne Stratospheric Tempestuous Thin Thunderous Upper Vast Windcut Zephyrous".split(" ")),
  underworld: new Set("Ashen Charonian Dusky Ebon Funereal Ghostlit Grave Hollow Last Mourning Pallid Sepulchral Shadebound Silent Spectral Stygian Tombward Umbral Wan Wraith".split(" ")),
  hell: new Set("Ashen Blackened Blazing Brazen Brimstone Cinder Crimson Damned Ember Flayed Furnace Infernal Iron Molten Pyre Scorched Searing Smoldering Sulfurous Tormented".split(" ")),
  abyss: new Set("Black Blank Broken Dissolving Distant Endless Fractured Hollow Impossible Lightless Lost Nameless Null Outer Silent Starless Unmade Unseen Vacant Voiceless".split(" ")),
  dream: new Set("Dancing Dreaming Enchanted Fay Glamoured Gloaming Iridescent Liminal Lucid Moonlit Oneiric Phantasmal Rainbow Reverie Silver Slumbering Soft Twilight Unreal Whispering".split(" ")),
  elemental: new Set("Aetheric Balanced Chaotic Concordant Elemental Flowing Fourfold Living Primal Pure Quintessential Riven Shifting Sublime Titanic Transforming Untamed Vast Worldborn Worldforged".split(" ")),
};

THEME_MODIFIERS["custom:temperate"] = THEME_MODIFIERS.surface!;
THEME_MODIFIERS["custom:wild"] = THEME_MODIFIERS.dream!;
THEME_MODIFIERS["custom:frozen"] = new Set("Boreal Cold Frostbound Frosted Frozen Glacial Hoarfrost Icebound Icy Northward Pale Polar Rimed Shivering Snowbound Snowy White Wintry Wolfswinter Zeroed".split(" "));
THEME_MODIFIERS["custom:arid"] = new Set("Arid Bleached Burning Copper Desert Dry Dun Dusty Ochre Parched Red Salt Scoured Sere Sunburnt Sunscorched Thirsting Umber White Windworn".split(" "));
THEME_MODIFIERS["custom:oceanic"] = new Set("Azure Briny Coral Currentbound Deepblue Foaming Islanded Mariner Oceanic Pearl Pelagic Salt Sapphire Seaward Stormtossed Tidal Turquoise Wavebound Windward Whaleward".split(" "));
THEME_MODIFIERS["custom:fungal"] = THEME_MODIFIERS.cave!;
THEME_MODIFIERS["custom:crystal"] = THEME_MODIFIERS.cavern!;
THEME_MODIFIERS["custom:volcanic"] = new Set("Ashfall Basalt Burning Caldera Cinder Crimson Ember Eruptive Fireborn Igneous Lava Magma Molten Obsidian Pyroclastic Scoria Smoldering Sulfurous Volcanic Worldfire".split(" "));
THEME_MODIFIERS["custom:storm"] = THEME_MODIFIERS.air!;
THEME_MODIFIERS["custom:infernal"] = THEME_MODIFIERS.hell!;
THEME_MODIFIERS["custom:void"] = THEME_MODIFIERS.abyss!;

function fixturePlane(
  kind: PlaneKind,
  variant: PlaneVariant,
  terrain: TerrainKey = "plains",
  terrainFlags?: TerrainFlag[],
): Plane {
  const source = NAMING_TEMPLATE.planes[0]!;
  const province = source.provinces[0]!;
  return {
    ...source,
    id: `plane-${kind}-${variant}`,
    kind,
    variant,
    provinces: [{
      ...province,
      id: `province-${kind}-${variant}`,
      index: 1,
      terrain,
      terrainFlags,
      freshwater: undefined,
      name: "",
      nameSource: "generated",
    }],
    edges: [],
  };
}

test("the pinned reservation set includes capitals, epithets, home sites, and special realms", () => {
  assert.ok(RESERVED_CAPITAL_NAMES.length > 300);
  for (const name of ["Agartha", "Pale Ones", "Kokytos", "Inferno", "The Void", "Nexus", "Dreamlands"]) {
    assert.equal(isReservedProvinceName(name), true, `${name} should be reserved`);
  }
  assert.equal(normalizeProvinceName("  Thé   VOID! "), normalizeProvinceName("Void"));
});

test("all plane kind and variant combinations retain a recognizable plane vocabulary", () => {
  for (const kind of KINDS) {
    for (const variant of VARIANTS) {
      const plane = fixturePlane(kind, variant, kind === "cave" || kind === "cavern" ? "cave" : "plains");
      const expectedTheme = kind === "custom" ? EXPECTED_CUSTOM_THEMES[variant] : kind;
      const context = provinceNameContext(plane, plane.provinces[0]!);
      assert.equal(context.planeTheme, expectedTheme, `${kind}/${variant}`);
      regenerateGeneratedProvinceNames([plane], "plane-variant-matrix", 0);
      const modifier = plane.provinces[0]!.name.split(/\s+/)[1]!;
      assert.ok(THEME_MODIFIERS[expectedTheme]!.has(modifier), `${kind}/${variant} produced ${plane.provinces[0]!.name}`);
      assert.equal(isReservedProvinceName(plane.provinces[0]!.name), false);
    }
  }
});

test("effective additive terrain combinations select compound, aquatic, cave, and Styx lexicons", () => {
  const cases: Array<{ plane: Plane; expected: string[]; words: RegExp }> = [
    { plane: fixturePlane("surface", "temperate", "farm"), expected: ["farm"], words: /Acres|Barleyfield|Croft|Farmland|Grange|Harvest|Orchards|Pastures|Ryevale|Steading|Vineyard|Wheatland|Demesne|Fallow|Hedgerows|Homestead|Plantation|Terraces|Tilth|Village/ },
    { plane: fixturePlane("surface", "temperate", "plains", ["mountains", "forest"]), expected: ["mountains", "forest"], words: /Crown|Massif|Mountain|Needles|Peak|Pinnacle|Range|Spine|Summit|Teeth|Alps|Cliffs|Horn|Mount|Precipice|Sierra|Crags|Rampart|Ridge|Tor/ },
    { plane: fixturePlane("surface", "temperate", "plains", ["freshwater", "swamp"]), expected: ["swamp", "freshwater"], words: /Bog|Fen|Marsh|Mere|Mire|Morass|Quagmire|Reedlands|Slough|Wetland|Bayou|Carr|Fens|Marish|Moor|Pools|Sedge|Sink|Swale|Wash/ },
    { plane: fixturePlane("surface", "oceanic", "sea"), expected: ["sea"], words: /Bay|Bight|Bluewater|Current|Gulf|Ocean|Reach|Roadstead|Sea|Sound|Strait|Tide|Waters|Channel|Main|Passage|Swell|Brine|Seaway|Gyre/ },
    { plane: fixturePlane("surface", "oceanic", "deepsea"), expected: ["deep_sea"], words: /Abyss|Basin|Deep|Depths|Fathoms|Trench|Undersea|Blackwater|Chasm|Deepwater|Gulf|Hadals|Rift|Sounding|Sunless Sea|Trough|Blue Hole|Dropoff|Ocean Floor|Subduction/ },
    { plane: fixturePlane("surface", "oceanic", "kelp"), expected: ["kelp"], words: /Canopy|Forest|Garden|Grove|Kelpwood|Tangle|Weedbank|Wrack|Beds|Bower|Fronds|Greenwater|Holdfast|Kelp Sea|Marine Wood|Reefwood|Sargassum|Thicket|Underforest|Wall/ },
    { plane: fixturePlane("cave", "fungal", "caveforest"), expected: ["cave_forest"], words: /Funguswood|Mossgrove|Rootcave|Sporewood|Underforest|Mushroom Grove|Mycelium|Puffball Wood|Lichen Hall|Glowcap Grove|Root Vault|Fungal Garden|Moss Grotto|Spore Cavern|Blindwood|Mold Forest|Underbrush|Cave Copse|Buried Grove|Sunless Wood/ },
    { plane: fixturePlane("cavern", "crystal", "caveswamp"), expected: ["cave_swamp"], words: /Blackpool|Dripfen|Flooded Hollow|Gloomfen|Mirecave|Mud Grotto|Sump|Underbog|Wet Vault|Brackish Hall|Cavern Mire|Drowned Gallery|Flooded Deep|Muck Tunnel|Seepage|Silt Chamber|Sodden Cavern|Sunless Marsh|Undermire|Waterlogged Delve/ },
    { plane: fixturePlane("cave", "fungal", "cave", ["sea"]), expected: ["flooded_cave"], words: /Black Lake|Drowned Cavern|Flooded Hall|Grotto Sea|Subterranean Lake|Sunless Waters|Underground Sea|Water Vault|Blue Grotto|Cavern Sound|Deep Cistern|Drowned Gallery|Flooded Deep|Hidden Loch|Lower Ocean|Sump Sea|Underlake|Water Cave|Wet Chasm|Abyssal Reservoir/ },
    { plane: fixturePlane("underworld", "fungal", "cave", ["sea"]), expected: ["styx"], words: /Black Ford|Dark Ferry|Deadwater|Funeral Reach|Ghost Current|Mourning Bank|Pale Crossing|Shade River|Silent Strand|Stygian Course|Charonian Ferry|Dusky Waters|Grave Current|Last Ford|Obol Reach|Spectral Channel|Tombward Flow|Understream|Wan River|Wraithwater/ },
  ];

  for (const [index, { plane, expected, words }] of cases.entries()) {
    const province = plane.provinces[0]!;
    assert.deepEqual(provinceNameContext(plane, province).terrainThemes, expected);
    regenerateGeneratedProvinceNames([plane], `terrain-combination:${index}`, 0);
    assert.match(province.name, words);
    if (expected.length > 1) assert.match(province.name, / of /, "compound flags must contribute an epithet");
  }

  const coast = fixturePlane("surface", "temperate");
  const land = coast.provinces[0]!;
  const sea = { ...land, id: "coast-sea", index: 2, terrain: "sea" as const, name: "", nameSource: "generated" as const };
  coast.provinces.push(sea);
  coast.edges = [{ id: "coast-edge", a: land.id, b: sea.id, kind: "standard" }];
  assert.deepEqual(provinceNameContext(coast, land).terrainThemes, ["coast"]);
});

test("the 96-province duplicate repro is unique, deterministic, and capital-safe", () => {
  const first = generateProject(createDefaultProject("province-name-duplicate-repro"));
  const second = generateProject(createDefaultProject("province-name-duplicate-repro"));
  const names = first.planes.flatMap((plane) => plane.provinces.map((province) => province.name));
  assert.equal(names.length, 96);
  assert.equal(new Set(names.map(normalizeProvinceName)).size, 96);
  assert.deepEqual(names, second.planes.flatMap((plane) => plane.provinces.map((province) => province.name)));
  assert.equal(names.some(isReservedProvinceName), false);
});

test("name rerolls preserve manual names and remain deterministic", () => {
  const project = createDefaultProject("manual-name-provenance");
  const manual = project.planes[0]!.provinces[0]!;
  manual.name = "Cartographer's Rest";
  manual.nameSource = "authored";
  const before = project.planes[0]!.provinces[1]!.name;

  const first = cloneProject(project);
  const second = cloneProject(project);
  const report = regenerateGeneratedProvinceNames(first.planes, first.seed, 3);
  regenerateGeneratedProvinceNames(second.planes, second.seed, 3);

  assert.equal(first.planes[0]!.provinces[0]!.name, "Cartographer's Rest");
  assert.equal(first.planes[0]!.provinces[0]!.nameSource, "authored");
  assert.equal(report.authoredPreserved, 1);
  assert.deepEqual(first.planes.map((plane) => plane.provinces.map((province) => province.name)), second.planes.map((plane) => plane.provinces.map((province) => province.name)));
  assert.notEqual(first.planes[0]!.provinces[1]!.name, before);

  const regenerated = generateProject(first);
  assert.equal(regenerated.planes[0]!.provinces[0]!.name, "Cartographer's Rest");

  const legacy = createDefaultProject("legacy-name-provenance");
  const legacyProvince = legacy.planes[0]!.provinces[2]!;
  legacyProvince.name = "Legacy Atlas Name";
  delete legacyProvince.nameSource;
  assert.equal(generateProject(legacy).planes[0]!.provinces[2]!.name, "Legacy Atlas Name");
});

test("the explicit legacy migration replaces duplicate and manual names only when requested", () => {
  const project = createDefaultProject("legacy-name-force-migration");
  for (const province of project.planes[0]!.provinces) {
    province.name = "Oldmead";
    delete province.nameSource;
  }
  project.planes[0]!.provinces[0]!.name = "Cartographer's Rest";
  project.planes[0]!.provinces[0]!.nameSource = "authored";

  const safe = cloneProject(project);
  regenerateGeneratedProvinceNames(safe.planes, safe.seed, 1);
  assert.equal(safe.planes[0]!.provinces[0]!.name, "Cartographer's Rest");
  assert.ok(safe.planes[0]!.provinces.slice(1).every((province) => province.name === "Oldmead"));

  const forced = cloneProject(project);
  const report = regenerateAllProvinceNames(forced.planes, forced.seed, 1);
  const names = forced.planes.flatMap((plane) => plane.provinces.map((province) => province.name));
  assert.equal(report.generated, names.length);
  assert.equal(report.authoredPreserved, 0);
  assert.equal(new Set(names.map(normalizeProvinceName)).size, names.length);
  assert.equal(names.some(isReservedProvinceName), false);
  assert.ok(forced.planes.every((plane) => plane.provinces.every((province) => province.nameSource === "generated")));
  assert.notEqual(forced.planes[0]!.provinces[0]!.name, "Cartographer's Rest");
});

test("eight 800-province planes receive stable unique names without numeric exhaustion", () => {
  const base = createDefaultProject("name-scale-6400");
  const template = base.planes[0]!.provinces[0]!;
  const planes: Plane[] = Array.from({ length: 8 }, (_, planeIndex) => ({
    ...base.planes[0]!,
    id: `scale-plane-${planeIndex}`,
    name: `Scale plane ${planeIndex}`,
    provinceTarget: 800,
    provinces: Array.from({ length: 800 }, (_, provinceIndex): Province => ({
      ...template,
      id: `scale-${planeIndex}-${provinceIndex}`,
      index: provinceIndex + 1,
      terrain: "plains",
      terrainFlags: undefined,
      freshwater: undefined,
      name: "",
      nameSource: "generated",
    })),
    edges: [],
  }));

  const started = performance.now();
  const report = regenerateGeneratedProvinceNames(planes, "name-scale-6400", 0);
  const elapsed = performance.now() - started;
  const names = planes.flatMap((plane) => plane.provinces.map((province) => province.name));

  assert.equal(report.generated, 6400);
  assert.equal(report.numericFallbacks, 0);
  assert.ok(MIN_CONTEXTUAL_NAME_POOL >= 6400);
  assert.equal(new Set(names.map(normalizeProvinceName)).size, 6400);
  assert.equal(names.some(isReservedProvinceName), false);
  assert.ok(elapsed < 5000, `name generation took ${elapsed.toFixed(0)}ms`);
});

test("land names are escaped and homeland override flags retain manual semantics", () => {
  const project = createDefaultProject("landname-escaping");
  const start = project.planes[0]!.provinces.find((province) => province.start)!;
  start.name = "Pilgrim's \"Rest\"\nAnnex";
  start.nameSource = "authored";
  let text = compileMapText(project, 0);
  assert.match(text, new RegExp(`#landname ${start.index} "Pilgrim's 'Rest' Annex"`));
  assert.doesNotMatch(text, /#nohomelandnames/);
  assert.match(text, new RegExp(`#start ${start.index}`));

  project.noHomelandNames = true;
  text = compileMapText(project, 0);
  assert.match(text, /#nohomelandnames/);
  assert.match(text, new RegExp(`#landname ${start.index} "Pilgrim's 'Rest' Annex"`));
});
