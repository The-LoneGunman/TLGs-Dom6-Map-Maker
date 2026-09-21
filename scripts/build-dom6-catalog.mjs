import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceRoot = path.resolve(root, process.argv[2] ?? "tmp/catalog-source-6.37");
const outputRoot = path.resolve(root, "src/catalog/data");
const SOURCE_GAME_VERSION = "6.37";
const SOURCE_REVISION = "c30c6c14e18ab284415d599b81579af9b3070112";
const SOURCE_DATE = "2026-09-18";
// Pin the actual input bytes, not just their record counts: otherwise an older
// or locally changed dump could be silently labelled as a verified 6.37 export.
const SOURCE_SHA256 = {
  "BaseU.csv": "185675d8906b87dc94070d52776e19cfefec4d2efcee9b6e8084aeba059e4ec5",
  "MagicSites.csv": "817c61f15c1e371dde006eb47e98022da7c7ac86a821551b3580a481f361711a",
  "nations.csv": "911f17f8a9384862e619895101d7c2cdfec48cabb7d493a2ecdaf69ac9a4246f",
  "other_planes.csv": "9edbfe09189bd5abff83a6201dcf0a5fd77d35a1440f408f853065d56cebe8af",
  "site_terrain_types.csv": "23bfeabe4e1d3dcc5ff81f199238ec4de417bf006680d0b458da87e2b9b9fccb",
  "attributes_by_nation.csv": "de5a2b25b59be7ae7f639a709e1f5d5fccf22350e6df77fb5613e111c6c3355d",
  "attribute_keys.csv": "e4bc71e443f4816c35e7e6326cf11324e57196087f85ff3551af76c3ca6a43b9",
  "fort_leader_types_by_nation.csv": "b57366505ff4e1caabf53a32e628339148c5962910d0ebe434fd4672d7583801",
  "coast_leader_types_by_nation.csv": "69287caa914a218a2beeaa2e426c42f4f887e01899f6c3f3e3c48ddcc8d65016",
  "nonfort_leader_types_by_nation.csv": "5e38710af7bf16e7f815810a4da265671170e8470d81ea7057ad21ffc36be6b2",
  "fort_troop_types_by_nation.csv": "dc7bb4058042476cbc7ab9242205f334a7a6029749fbb0d83bba6527b1a98a7e",
  "coast_troop_types_by_nation.csv": "8bdbec540d8f18c1368a7dc902fab15f034fa4c9afb0f45e1d9c9d8b8f042180",
  "nonfort_troop_types_by_nation.csv": "2078522a991b3f83a508e7a74623e9b1ebe2eefc9cfc9604c261ab09570269a6",
};

function parseTsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = lines.shift().split("\t");
  return lines.map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

async function table(filename) {
  const bytes = await readFile(path.join(sourceRoot, filename));
  if (createHash("sha256").update(bytes).digest("hex") !== SOURCE_SHA256[filename]) {
    throw new Error(`${filename} does not match pinned Inspector ${SOURCE_GAME_VERSION} revision ${SOURCE_REVISION}. Download the exact raw source file before rebuilding.`);
  }
  return parseTsv(bytes.toString("utf8"));
}

function integer(value, context) {
  const result = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(result)) throw new Error(`${context} has invalid integer ${value}`);
  return result;
}

const poptypeGroups = [
  [[25], "Barbarians"],
  [[26], "Horse Tribe"],
  [[27, 28, 29], "Militia, Archers, Hvy Inf"],
  [[30], "Militia, Longbow, Knight"],
  [[31], "Tritons"],
  [[32, 33], "Lt Inf, Hvy Inf, X-Bow"],
  [[34], "Raptors"],
  [[35], "Slingers"],
  [[36], "Lizards"],
  [[37], "Woodsmen"],
  [[38], "Hoburg"],
  [[39], "Militia, Archers, Lt Inf"],
  [[40], "Amazon, Crystal"],
  [[41], "Amazon, Garnet"],
  [[42], "Amazon, Jade"],
  [[43], "Amazon, Onyx"],
  [[44], "Troglodytes"],
  [[45], "Tritons, Shark Knights"],
  [[46], "Amber Clan Tritons"],
  [[47], "X-Bow, Hvy Cavalry"],
  [[48, 49, 50], "Militia, Lt Inf, Hvy Inf"],
  [[51, 52, 53], "Militia, Lt Cav, Hvy Cav"],
  [[54, 55, 56], "Hvy Inf, Hvy Cavalry"],
  [[57], "Shamblers"],
  [[58], "Lt Inf, Hvy Inf, X-Bow"],
  [[59, 60], "Militia, Lt Inf, Archers"],
  [[61], "Vaettir, Trolls"],
  [[62], "Tribals, Deer"],
  [[63, 64], "Tritons"],
  [[65], "Ichtyids"],
  [[66], "Vaettir"],
  [[67], "Vaettir, Dwarven Smith"],
  [[68], "Slingers, Hvy Inf, Elephants"],
  [[69], "Asmeg"],
  [[70], "Vaettir, Svartalf"],
  [[71], "Trolls"],
  [[72], "Mermen"],
  [[73], "Tritons, Triton Knights"],
  [[74], "Lt Inf, Lt Cav, Cataphracts"],
  [[75], "Hoburg, LA"],
  [[76], "Hoburg, EA"],
  [[77], "Atavi Apes"],
  [[78], "Tribals, Wolf"],
  [[79], "Tribals, Bear"],
  [[80], "Tribals, Lion"],
  [[81], "Pale Ones"],
  [[82], "Tribals, Jaguar"],
  [[83], "Tribals, Toad"],
  [[84], "Cavemen"],
  [[85], "Kappa"],
  [[86, 87], "Bakemono"],
  [[88], "Ko-Oni"],
  [[89], "Fir Bolg"],
  [[90], "Turtle Tribe Tritons"],
  [[91], "Shark Tribe Tritons"],
  [[92], "Shark Tribe, Shark Riders"],
  [[93], "Zotz"],
  [[94], "Lava-born"],
  [[95], "Ichtyids with Shaman"],
  [[96], "Bone Tribe"],
  [[97], "Merrow"],
  [[98], "Kulullu"],
  [[99], "Bronze Hoplites"],
  [[100], "Bronze Hvy Inf"],
  [[101], "Bronze Hvy Cav, Hvy Inf"],
  [[102], "Bronze Hvy Spear"],
  [[103], "Cynocephalians"],
  [[104], "Bekrydes"],
  [[105], "Wet Ones"],
  [[106], "Nexus"],
];

const forts = [
  [1, "Palisades"], [2, "Fortress"], [3, "Castle"], [4, "Citadel"], [5, "Rock Walls"],
  [6, "Fortress"], [7, "Castle"], [8, "Castle of Bronze and Crystal"], [9, "Kelp Fort"],
  [10, "Bramble Fort"], [11, "City Palisades"], [12, "Walled City"], [13, "Fortified City"],
  [14, "Great Walled City"], [15, "Giant Palisades"], [16, "Giant Fortress"], [17, "Giant Castle"],
  [18, "Giant Citadel"], [19, "Grand Citadel"], [20, "Ice Walls"], [21, "Ice Fortress"],
  [22, "Ice Castle"], [23, "Ice Citadel"], [24, "Wizard's Tower"], [25, "Citadel of Power"],
  [27, "Fortified village"], [28, "Wooden Fort"], [29, "Crystal Citadel"],
];

const LEADER_TABLES = [
  "fort_leader_types_by_nation.csv",
  "coast_leader_types_by_nation.csv",
  "nonfort_leader_types_by_nation.csv",
];
const TROOP_TABLES = [
  "fort_troop_types_by_nation.csv",
  "coast_troop_types_by_nation.csv",
  "nonfort_troop_types_by_nation.csv",
];

const UNIT_ROLE_NATION_COMMANDER = 1;
const UNIT_ROLE_NATION_TROOP = 2;
const UNIT_ROLE_SITE_COMMANDER = 4;
const UNIT_ROLE_SITE_TROOP = 8;
const UNIT_INTERNAL_RECORD = 16;
const INTERNAL_UNIT_NAME = /(^|\b)(debug|test|xxx|unused)(\b|$)/i;

const [
  unitRows,
  siteRows,
  nationRows,
  planeRows,
  siteTerrainRows,
  nationAttributeRows,
  attributeKeyRows,
  ...roleTables
] = await Promise.all([
  table("BaseU.csv"),
  table("MagicSites.csv"),
  table("nations.csv"),
  table("other_planes.csv"),
  table("site_terrain_types.csv"),
  table("attributes_by_nation.csv"),
  table("attribute_keys.csv"),
  ...LEADER_TABLES.map(table),
  ...TROOP_TABLES.map(table),
]);

const documentedStartSiteAttributeIds = new Set(attributeKeyRows
  .filter((row) => row.name?.includes("{Ntn: #startsite}"))
  .map((row) => integer(row.number, "nation start-site attribute")));
if (!documentedStartSiteAttributeIds.has(52)) throw new Error("Nation attribute metadata does not identify #startsite fields.");
// The pinned nation dump uses 25 for the three death-nation home sites and
// 631 for Ubar's additional/future home sites. Attribute 100 is the second
// #startsite key in attribute_keys.csv even though this revision has no rows.
const nationHomeSiteAttributeIds = new Set([25, ...documentedStartSiteAttributeIds, 631]);
const nationHomeSiteIds = new Set(nationAttributeRows
  .filter((row) => nationHomeSiteAttributeIds.has(integer(row.attribute, "nation attribute")))
  .map((row) => integer(row.raw_value, "nation home site")));

const roleIds = (tables, context) => new Set(tables.flatMap((rows) => rows
  .filter((row) => row.monster_number)
  .map((row) => integer(row.monster_number, context))));
const leaderIds = roleIds(roleTables.slice(0, LEADER_TABLES.length), "leader unit");
const troopIds = roleIds(roleTables.slice(LEADER_TABLES.length), "troop unit");
const siteRoleIds = (pattern, context) => new Set(siteRows.flatMap((row) => Object.entries(row)
  .filter(([column, value]) => pattern.test(column) && value)
  .map(([, value]) => integer(value, context))));
// hcom/hmon are the commander's/troop's recruit slots supplied by a magic
// site. natcom/natmon are the nation-restricted site recruit slots. Together
// with the six nation recruitment tables, these are authoritative role data
// and avoid guessing a unit's role from its display name.
const siteCommanderIds = siteRoleIds(/^hcom\d+$|^natcom$/, "site commander unit");
const siteTroopIds = siteRoleIds(/^hmon\d+$|^natmon$/, "site troop unit");

const units = unitRows.filter((row) => row.id && row.name).map((row) => {
  const id = integer(row.id, "unit");
  const roleFlags = (leaderIds.has(id) ? UNIT_ROLE_NATION_COMMANDER : 0)
    | (troopIds.has(id) ? UNIT_ROLE_NATION_TROOP : 0)
    | (siteCommanderIds.has(id) ? UNIT_ROLE_SITE_COMMANDER : 0)
    | (siteTroopIds.has(id) ? UNIT_ROLE_SITE_TROOP : 0)
    | (INTERNAL_UNIT_NAME.test(row.name) ? UNIT_INTERNAL_RECORD : 0);
  return [id, row.name, roleFlags];
});
const sites = siteRows.filter((row) => row.id && row.name).map((row) => [
  integer(row.id, "site"),
  row.name,
  row.loc ? integer(row.loc, "site loc") : 0,
  row.path ?? "",
  row.rarity ? integer(row.rarity, "site rarity") : 0,
  (nationHomeSiteIds.has(integer(row.id, "site")) ? 1 : 0) | (row.loc === "0" ? 2 : 0),
]);
const nations = nationRows.filter((row) => row.id && row.name).map((row) => [integer(row.id, "nation"), row.name, row.epithet ?? "", row.abbreviation ?? "", row.era ? integer(row.era, "nation era") : 0]);
const planes = planeRows.filter((row) => row.number && row.name).map((row) => [integer(row.number, "plane"), row.name]);
const siteTerrainTypes = siteTerrainRows.filter((row) => row.bit_value && row.bit_name).map((row) => [integer(row.bit_value, "site terrain"), row.bit_name]);
const poptypes = poptypeGroups.flatMap(([ids, name]) => ids.map((id) => [id, name])).sort((left, right) => left[0] - right[0]);

if (units.length !== 4091) throw new Error(`Expected 4,091 units, found ${units.length}.`);
if (sites.length !== 1253) throw new Error(`Expected 1,253 sites, found ${sites.length}.`);
if (leaderIds.size !== 627) throw new Error(`Expected 627 nation-recruitable leaders, found ${leaderIds.size}.`);
if (troopIds.size !== 679) throw new Error(`Expected 679 nation-recruitable troops, found ${troopIds.size}.`);
if (siteCommanderIds.size !== 234) throw new Error(`Expected 234 site-recruitable commanders, found ${siteCommanderIds.size}.`);
if (siteTroopIds.size !== 170) throw new Error(`Expected 170 site-recruitable troops, found ${siteTroopIds.size}.`);
if ([...leaderIds].some((id) => !units.some(([unitId]) => unitId === id))) throw new Error("Leader table references a missing unit.");
if ([...troopIds].some((id) => !units.some(([unitId]) => unitId === id))) throw new Error("Troop table references a missing unit.");
if ([...siteCommanderIds].some((id) => !units.some(([unitId]) => unitId === id))) throw new Error("Magic-site commander slot references a missing unit.");
if ([...siteTroopIds].some((id) => !units.some(([unitId]) => unitId === id))) throw new Error("Magic-site troop slot references a missing unit.");
if (units.filter(([, , flags]) => (flags & (UNIT_ROLE_NATION_COMMANDER | UNIT_ROLE_SITE_COMMANDER)) !== 0).length !== 850) {
  throw new Error("Expected 850 known commander-role units.");
}
if (units.filter(([, , flags]) => (flags & (UNIT_ROLE_NATION_TROOP | UNIT_ROLE_SITE_TROOP)) !== 0).length !== 842) {
  throw new Error("Expected 842 known troop-role units.");
}
if (units.filter(([, , flags]) => (flags & UNIT_INTERNAL_RECORD) !== 0).length !== 13) {
  throw new Error("Expected 13 internal/debug unit records.");
}
if (nationHomeSiteIds.size !== 208) throw new Error(`Expected 208 referenced nation home/future sites, found ${nationHomeSiteIds.size}.`);
if (poptypes.length !== 82 || poptypes[0][0] !== 25 || poptypes.at(-1)[0] !== 106) throw new Error("Poptype table is incomplete.");

const output = {
  format: "pantokrator-atlas/compact-catalog",
  formatVersion: 3,
  gameVersion: SOURCE_GAME_VERSION,
  sourceRevision: SOURCE_REVISION,
  sourceDate: SOURCE_DATE,
  sourceFileSha256: SOURCE_SHA256,
  units,
  sites,
  nations,
  poptypes,
  forts,
  planes,
  siteTerrainTypes,
};

await mkdir(outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, `dom6-${SOURCE_GAME_VERSION}.json`), `${JSON.stringify(output)}\n`, "utf8");
console.log(JSON.stringify({
  units: units.length,
  nationRecruitableLeaders: leaderIds.size,
  nationRecruitableTroops: troopIds.size,
  siteRecruitableCommanders: siteCommanderIds.size,
  siteRecruitableTroops: siteTroopIds.size,
  knownCommanderRoles: units.filter(([, , flags]) => (flags & (UNIT_ROLE_NATION_COMMANDER | UNIT_ROLE_SITE_COMMANDER)) !== 0).length,
  knownTroopRoles: units.filter(([, , flags]) => (flags & (UNIT_ROLE_NATION_TROOP | UNIT_ROLE_SITE_TROOP)) !== 0).length,
  internalUnitRecords: units.filter(([, , flags]) => (flags & UNIT_INTERNAL_RECORD) !== 0).length,
  sites: sites.length,
  nationHomeSites: nationHomeSiteIds.size,
  nations: nations.length,
  poptypes: poptypes.length,
  forts: forts.length,
  planes: planes.length,
}));
