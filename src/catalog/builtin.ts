import type { CatalogEntry, Dom6CatalogBundle } from "./types";
import {
  BUILTIN_CATALOG_SOURCE,
  BUILTIN_DOM6_CORE_CATALOG as core,
  BUILTIN_INSPECTOR_PROVENANCE_ID,
  COMPACT_CATALOG_FORMAT_VERSION,
} from "./builtinCore";
import unitData from "./data/dom6-6.37-units.json";

type CompactUnit = readonly [id: number, name: string, roleFlags: number];

if (
  unitData.format !== "pantokrator-atlas/compact-catalog-units"
  || unitData.formatVersion !== COMPACT_CATALOG_FORMAT_VERSION
  || unitData.gameVersion !== BUILTIN_CATALOG_SOURCE.gameVersion
  || unitData.sourceRevision !== BUILTIN_CATALOG_SOURCE.sourceRevision
) {
  throw new Error("Bundled Dominions unit table does not match the bundled catalog source.");
}

const compactUnits = readCompactUnits(unitData.units);

const UNIT_ROLE_NATION_COMMANDER = 1;
const UNIT_ROLE_NATION_TROOP = 2;
const UNIT_ROLE_SITE_COMMANDER = 4;
const UNIT_ROLE_SITE_TROOP = 8;
const UNIT_INTERNAL_RECORD = 16;

const units: CatalogEntry[] = compactUnits.map(([id, name, roleFlags]) => ({
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
  provenanceId: BUILTIN_INSPECTOR_PROVENANCE_ID,
}));

/**
 * The complete built-in catalog: the core collections (shared by reference
 * with `BUILTIN_DOM6_CORE_CATALOG`) plus the separately stored unit table.
 * Key order and contents match the former single-file bundle exactly.
 */
export const BUILTIN_DOM6_CATALOG: Dom6CatalogBundle = {
  schema: core.schema,
  schemaVersion: core.schemaVersion,
  gameVersion: core.gameVersion,
  catalogVersion: core.catalogVersion,
  provenance: core.provenance,
  poptypes: core.poptypes,
  sites: core.sites,
  units,
  nations: core.nations,
  forts: core.forts,
  planes: core.planes,
  siteTerrainTypes: core.siteTerrainTypes,
};

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
