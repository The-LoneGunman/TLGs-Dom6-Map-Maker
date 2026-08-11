import {
  DOM6_CATALOG_SCHEMA,
  DOM6_CATALOG_SCHEMA_VERSION,
  type Dom6CatalogBundle,
} from "./types";
import catalogData from "./data/dom6-6.35.json";

type CompactEntry = readonly [id: number, name: string];
type CompactSite = readonly [id: number, name: string, terrainMask: number, magicPath: string, rarity: number];
type CompactNation = readonly [id: number, name: string, subtitle: string, abbreviation: string, era: number];

const compactEntries = readCompactEntries(catalogData.units, "units");
const compactSites = readCompactSites(catalogData.sites);
const compactNations = readCompactNations(catalogData.nations);
const compactPoptypes = readCompactEntries(catalogData.poptypes, "poptypes");
const compactForts = readCompactEntries(catalogData.forts, "forts");
const compactPlanes = readCompactEntries(catalogData.planes, "planes");
const compactSiteTerrainTypes = readCompactEntries(catalogData.siteTerrainTypes, "siteTerrainTypes");

const inspectorEntry = ([id, name]: CompactEntry) => ({
  id,
  name,
  provenanceId: "dom6inspector-6.35-cfac4311",
});

const SPECIAL_NATIONS = new Map<number, string>([
  [0, "Independents"],
  [2, "Special Independents (e.g. Horrors)"],
  [4, "Roaming Independents (e.g. Barbarians)"],
]);

/**
 * Built-in entries retain source-level provenance. Poptypes and forts come
 * from the official map manual; the complete unit, site, nation, plane, and
 * site-location lookup indexes come from the pinned GPL Dom6 Inspector export.
 */
export const BUILTIN_DOM6_CATALOG: Dom6CatalogBundle = {
  schema: DOM6_CATALOG_SCHEMA,
  schemaVersion: DOM6_CATALOG_SCHEMA_VERSION,
  gameVersion: "6.35",
  catalogVersion: "dom6-6.35-cfac4311 + illwinter-map-manual-6.26",
  provenance: [
    {
      id: "illwinter-map-manual-6.26",
      title: "Dominions 6 Map Making Manual",
      authority: "official",
      version: "6.26",
      source: "Illwinter Game Design PDF supplied with Dominions 6",
      notes: "Poptype, fortification, and special-nation entries are verified against the manual tables. The manual does not catalog site or unit IDs.",
    },
    {
      id: "dom6inspector-6.35-cfac4311",
      title: "Dom6 Inspector data export",
      authority: "community",
      version: "6.35 / cfac4311bc0b58053b8dead7bffbc036ba9bd5dc",
      source: "https://github.com/larzm42/dom6inspector/tree/cfac4311bc0b58053b8dead7bffbc036ba9bd5dc/gamedata",
      notes: "Pinned 2026-05-26 gamedata exports: BaseU.csv, MagicSites.csv, nations.csv, other_planes.csv, and site_terrain_types.csv. Distributed under GPL-3.0; see src/catalog/data/LICENSE.dom6inspector.txt and NOTICE.md.",
    },
  ],
  poptypes: compactPoptypes.map(([id, name]) => ({ id, name, provenanceId: "illwinter-map-manual-6.26", sourceRef: "PDF p.7, Poptypes" })),
  sites: compactSites.map(([id, name, terrainMask, magicPath, rarity]) => ({
    id,
    name,
    terrainMask,
    magicPath: magicPath || undefined,
    subtitle: rarity >= 11 ? `Level ${rarity - 10} throne` : undefined,
    tags: rarity >= 11 ? ["throne", `throne-level-${rarity - 10}`] : undefined,
    provenanceId: "dom6inspector-6.35-cfac4311",
  })),
  units: compactEntries.map(inspectorEntry),
  nations: compactNations.filter(([id, , , , era]) => era > 0 || SPECIAL_NATIONS.has(id)).map(([id, name, subtitle, abbreviation, era]) => ({
    id,
    name: SPECIAL_NATIONS.get(id) ?? name,
    subtitle: SPECIAL_NATIONS.has(id) ? undefined : subtitle || undefined,
    abbreviation: SPECIAL_NATIONS.has(id) ? undefined : abbreviation || undefined,
    era,
    provenanceId: SPECIAL_NATIONS.has(id) ? "illwinter-map-manual-6.26" : "dom6inspector-6.35-cfac4311",
    sourceRef: SPECIAL_NATIONS.has(id) ? "PDF pp.5-6, Special Nations" : undefined,
  })),
  forts: compactForts.map(([id, name]) => ({ id, name, provenanceId: "illwinter-map-manual-6.26", sourceRef: "PDF p.8, Fortifications" })),
  planes: compactPlanes.map(inspectorEntry),
  siteTerrainTypes: compactSiteTerrainTypes.map(inspectorEntry),
};

function readCompactEntries(value: unknown, collection: string): CompactEntry[] {
  if (!Array.isArray(value)) throw new Error(`Bundled ${collection} catalog is not an array.`);
  return value.map((row, index) => {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "number" || typeof row[1] !== "string") {
      throw new Error(`Bundled ${collection}[${index}] has an invalid compact row.`);
    }
    return [row[0], row[1]];
  });
}

function readCompactSites(value: unknown): CompactSite[] {
  if (!Array.isArray(value)) throw new Error("Bundled sites catalog is not an array.");
  return value.map((row, index) => {
    if (
      !Array.isArray(row)
      || row.length !== 5
      || typeof row[0] !== "number"
      || typeof row[1] !== "string"
      || typeof row[2] !== "number"
      || typeof row[3] !== "string"
      || typeof row[4] !== "number"
    ) {
      throw new Error(`Bundled sites[${index}] has an invalid compact row.`);
    }
    return [row[0], row[1], row[2], row[3], row[4]];
  });
}

function readCompactNations(value: unknown): CompactNation[] {
  if (!Array.isArray(value)) throw new Error("Bundled nations catalog is not an array.");
  return value.map((row, index) => {
    if (
      !Array.isArray(row)
      || row.length !== 5
      || typeof row[0] !== "number"
      || typeof row[1] !== "string"
      || typeof row[2] !== "string"
      || typeof row[3] !== "string"
      || typeof row[4] !== "number"
    ) {
      throw new Error(`Bundled nations[${index}] has an invalid compact row.`);
    }
    return [row[0], row[1], row[2], row[3], row[4]];
  });
}
