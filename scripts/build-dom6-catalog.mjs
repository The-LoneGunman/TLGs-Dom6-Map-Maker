import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceRoot = path.resolve(root, process.argv[2] ?? "tmp/catalog-source");
const outputRoot = path.resolve(root, "src/catalog/data");

function parseTsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = lines.shift().split("\t");
  return lines.map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

async function table(filename) {
  return parseTsv(await readFile(path.join(sourceRoot, filename), "utf8"));
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

const [unitRows, siteRows, nationRows, planeRows, siteTerrainRows] = await Promise.all([
  table("BaseU.csv"),
  table("MagicSites.csv"),
  table("nations.csv"),
  table("other_planes.csv"),
  table("site_terrain_types.csv"),
]);

const units = unitRows.filter((row) => row.id && row.name).map((row) => [integer(row.id, "unit"), row.name]);
const sites = siteRows.filter((row) => row.id && row.name).map((row) => [
  integer(row.id, "site"),
  row.name,
  row.loc ? integer(row.loc, "site loc") : 0,
  row.path ?? "",
  row.rarity ? integer(row.rarity, "site rarity") : 0,
]);
const nations = nationRows.filter((row) => row.id && row.name).map((row) => [integer(row.id, "nation"), row.name, row.epithet ?? "", row.abbreviation ?? "", row.era ? integer(row.era, "nation era") : 0]);
const planes = planeRows.filter((row) => row.number && row.name).map((row) => [integer(row.number, "plane"), row.name]);
const siteTerrainTypes = siteTerrainRows.filter((row) => row.bit_value && row.bit_name).map((row) => [integer(row.bit_value, "site terrain"), row.bit_name]);
const poptypes = poptypeGroups.flatMap(([ids, name]) => ids.map((id) => [id, name])).sort((left, right) => left[0] - right[0]);

if (units.length !== 4091) throw new Error(`Expected 4,091 units, found ${units.length}.`);
if (sites.length !== 1253) throw new Error(`Expected 1,253 sites, found ${sites.length}.`);
if (poptypes.length !== 82 || poptypes[0][0] !== 25 || poptypes.at(-1)[0] !== 106) throw new Error("Poptype table is incomplete.");

const output = {
  format: "pantokrator-atlas/compact-catalog",
  formatVersion: 1,
  gameVersion: "6.35",
  sourceRevision: "cfac4311bc0b58053b8dead7bffbc036ba9bd5dc",
  sourceDate: "2026-05-26",
  units,
  sites,
  nations,
  poptypes,
  forts,
  planes,
  siteTerrainTypes,
};

await mkdir(outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, "dom6-6.35.json"), `${JSON.stringify(output)}\n`, "utf8");
console.log(JSON.stringify({ units: units.length, sites: sites.length, nations: nations.length, poptypes: poptypes.length, forts: forts.length, planes: planes.length }));
