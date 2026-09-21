import {
  DOM6_CATALOG_SCHEMA,
  DOM6_CATALOG_SCHEMA_VERSION,
  type Dom6CatalogBundle,
} from "./types";
import catalogData from "./data/dom6-6.37.json";

type CompactEntry = readonly [id: number, name: string];
type CompactUnit = readonly [id: number, name: string, roleFlags: number];
type CompactSite = readonly [id: number, name: string, terrainMask: number, magicPath: string, rarity: number, siteFlags: number];
type CompactNation = readonly [id: number, name: string, subtitle: string, abbreviation: string, era: number];

if (catalogData.format !== "pantokrator-atlas/compact-catalog" || catalogData.formatVersion !== 3) {
  throw new Error("Bundled Dominions catalog has an unsupported compact format.");
}

const compactUnits = readCompactUnits(catalogData.units);
const compactSites = readCompactSites(catalogData.sites);
const compactNations = readCompactNations(catalogData.nations);
const compactPoptypes = readCompactEntries(catalogData.poptypes, "poptypes");
const compactForts = readCompactEntries(catalogData.forts, "forts");
const compactPlanes = readCompactEntries(catalogData.planes, "planes");
const compactSiteTerrainTypes = readCompactEntries(catalogData.siteTerrainTypes, "siteTerrainTypes");
const inspectorProvenanceId = `dom6inspector-${catalogData.gameVersion}-${catalogData.sourceRevision.slice(0, 8)}`;

const inspectorEntry = ([id, name]: CompactEntry) => ({
  id,
  name,
  provenanceId: inspectorProvenanceId,
});

const SPECIAL_NATIONS = new Map<number, string>([
  [0, "Independents"],
  [2, "Special Independents (e.g. Horrors)"],
  [4, "Roaming Independents (e.g. Barbarians)"],
]);

const UNIT_ROLE_NATION_COMMANDER = 1;
const UNIT_ROLE_NATION_TROOP = 2;
const UNIT_ROLE_SITE_COMMANDER = 4;
const UNIT_ROLE_SITE_TROOP = 8;
const UNIT_INTERNAL_RECORD = 16;

/**
 * Built-in entries retain source-level provenance. Poptypes and forts come
 * from the official map manual; the complete unit, site, nation, plane, and
 * site-location lookup indexes plus factual nation-recruitment roles and home
 * site references come from the pinned GPL Dom6 Inspector export.
 */
export const BUILTIN_DOM6_CATALOG: Dom6CatalogBundle = {
  schema: DOM6_CATALOG_SCHEMA,
  schemaVersion: DOM6_CATALOG_SCHEMA_VERSION,
  gameVersion: catalogData.gameVersion,
  catalogVersion: `dom6-${catalogData.gameVersion}-${catalogData.sourceRevision.slice(0, 8)} + illwinter-map-manual-6.26`,
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
      id: inspectorProvenanceId,
      title: "Dom6 Inspector data export",
      authority: "community",
      version: `${catalogData.gameVersion} / ${catalogData.sourceRevision}`,
      source: `https://github.com/larzm42/dom6inspector/tree/${catalogData.sourceRevision}/gamedata`,
      notes: `Pinned ${catalogData.sourceDate} gamedata exports include BaseU/MagicSites, nation recruitment-role tables, nation #startsite attributes, nations, planes, and site terrain types. Source bytes are SHA-256 checked by the builder. Distributed under GPL-3.0; see src/catalog/data/LICENSE.dom6inspector.txt and NOTICE.md.`,
    },
  ],
  poptypes: compactPoptypes.map(([id, name]) => ({ id, name, provenanceId: "illwinter-map-manual-6.26", sourceRef: "PDF p.7, Poptypes" })),
  sites: compactSites.map(([id, name, terrainMask, magicPath, rarity, siteFlags]) => {
    const isThrone = rarity >= 11;
    const isCapitalSite = (siteFlags & 1) !== 0;
    const hasNoOrdinaryLocation = (siteFlags & 2) !== 0;
    const tags = [
      ...(isThrone ? ["throne", `throne-level-${rarity - 10}`] : []),
      ...(isCapitalSite ? ["nation-home-site", "home-site"] : []),
      ...(hasNoOrdinaryLocation ? ["no-ordinary-location"] : []),
      ...(rarity < 5 ? ["ordinary-site"] : rarity === 5 ? ["non-random-site"] : []),
    ];
    return {
      id,
      name,
      terrainMask,
      magicPath: magicPath || undefined,
      subtitle: isThrone
        ? `Level ${rarity - 10} throne`
        : isCapitalSite
          ? "Nation home site"
          : hasNoOrdinaryLocation
            ? "Non-random special site"
            : rarity === 5
              ? "Non-random site"
              : undefined,
      tags: tags.length ? tags : undefined,
      provenanceId: inspectorProvenanceId,
    };
  }),
  units: compactUnits.map(([id, name, roleFlags]) => ({
    id,
    name,
    subtitle: unitSubtitle(roleFlags),
    tags: [
      ...((roleFlags & (UNIT_ROLE_NATION_COMMANDER | UNIT_ROLE_SITE_COMMANDER)) !== 0 ? ["known-commander"] : []),
      ...((roleFlags & (UNIT_ROLE_NATION_TROOP | UNIT_ROLE_SITE_TROOP)) !== 0 ? ["known-troop"] : []),
      ...((roleFlags & UNIT_ROLE_NATION_COMMANDER) !== 0 ? ["nation-recruitable-commander"] : []),
      ...((roleFlags & UNIT_ROLE_NATION_TROOP) !== 0 ? ["nation-recruitable-troop"] : []),
      ...((roleFlags & UNIT_ROLE_SITE_COMMANDER) !== 0 ? ["site-recruitable-commander"] : []),
      ...((roleFlags & UNIT_ROLE_SITE_TROOP) !== 0 ? ["site-recruitable-troop"] : []),
      ...((roleFlags & UNIT_INTERNAL_RECORD) !== 0 ? ["internal-unit-record"] : []),
    ],
    provenanceId: inspectorProvenanceId,
  })),
  nations: compactNations.filter(([id, , , , era]) => era > 0 || SPECIAL_NATIONS.has(id)).map(([id, name, subtitle, abbreviation, era]) => ({
    id,
    name: SPECIAL_NATIONS.get(id) ?? name,
    subtitle: SPECIAL_NATIONS.has(id) ? undefined : subtitle || undefined,
    abbreviation: SPECIAL_NATIONS.has(id) ? undefined : abbreviation || undefined,
    era,
    provenanceId: SPECIAL_NATIONS.has(id) ? "illwinter-map-manual-6.26" : inspectorProvenanceId,
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

function readCompactUnits(value: unknown): CompactUnit[] {
  if (!Array.isArray(value)) throw new Error("Bundled units catalog is not an array.");
  return value.map((row, index) => {
    if (
      !Array.isArray(row)
      || row.length !== 3
      || typeof row[0] !== "number"
      || typeof row[1] !== "string"
      || typeof row[2] !== "number"
      || !Number.isSafeInteger(row[2])
      || row[2] < 0
      || row[2] > 31
    ) {
      throw new Error(`Bundled units[${index}] has an invalid compact row.`);
    }
    return [row[0], row[1], row[2]];
  });
}

function unitSubtitle(roleFlags: number): string | undefined {
  if ((roleFlags & UNIT_INTERNAL_RECORD) !== 0) return "Internal/debug data record";
  const nationCommander = (roleFlags & UNIT_ROLE_NATION_COMMANDER) !== 0;
  const siteCommander = (roleFlags & UNIT_ROLE_SITE_COMMANDER) !== 0;
  const nationTroop = (roleFlags & UNIT_ROLE_NATION_TROOP) !== 0;
  const siteTroop = (roleFlags & UNIT_ROLE_SITE_TROOP) !== 0;
  if (nationCommander && siteCommander) return "Nation- and site-recruitable commander";
  if (nationCommander) return "Nation-recruitable commander";
  if (siteCommander) return "Site-recruitable commander";
  if (nationTroop && siteTroop) return "Nation- and site-recruitable troop";
  if (nationTroop) return "Nation-recruitable troop";
  if (siteTroop) return "Site-recruitable troop";
  return undefined;
}

function readCompactSites(value: unknown): CompactSite[] {
  if (!Array.isArray(value)) throw new Error("Bundled sites catalog is not an array.");
  return value.map((row, index) => {
    if (
      !Array.isArray(row)
      || row.length !== 6
      || typeof row[0] !== "number"
      || typeof row[1] !== "string"
      || typeof row[2] !== "number"
      || typeof row[3] !== "string"
      || typeof row[4] !== "number"
      || typeof row[5] !== "number"
      || !Number.isSafeInteger(row[5])
      || row[5] < 0
      || row[5] > 3
    ) {
      throw new Error(`Bundled sites[${index}] has an invalid compact row.`);
    }
    return [row[0], row[1], row[2], row[3], row[4], row[5]];
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
