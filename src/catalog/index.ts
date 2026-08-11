import { BUILTIN_DOM6_CATALOG } from "./builtin";
import {
  DOM6_CATALOG_SCHEMA,
  DOM6_CATALOG_SCHEMA_VERSION,
  type CatalogCollection,
  type CatalogEntry,
  type CatalogProvenance,
  type Dom6CatalogBundle,
} from "./types";

export { BUILTIN_DOM6_CATALOG } from "./builtin";
export { provinceSiteLocationMask, siteCompatibility, type SiteCompatibility } from "./compatibility";
export {
  NATION_RECRUITABLE_COMMANDER_TAG,
  NATION_RECRUITABLE_TROOP_TAG,
  ORDINARY_SITE_TAG,
  commanderUnitEntries,
  provinceSiteEntries,
  troopUnitEntries,
} from "./selection";
export type { CatalogCollection, CatalogEntry, CatalogProvenance, Dom6CatalogBundle } from "./types";

const COLLECTIONS: CatalogCollection[] = ["poptypes", "sites", "units", "nations", "forts", "planes", "siteTerrainTypes"];

export function parseCatalogBundle(text: string): Dom6CatalogBundle {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The catalog file is not valid JSON.");
  }
  if (!isRecord(value)) throw new Error("The catalog root must be an object.");
  if (value.schema !== DOM6_CATALOG_SCHEMA || value.schemaVersion !== DOM6_CATALOG_SCHEMA_VERSION) {
    throw new Error(`Expected ${DOM6_CATALOG_SCHEMA} schema version ${DOM6_CATALOG_SCHEMA_VERSION}.`);
  }
  const provenance = parseProvenance(value.provenance);
  const provenanceIds = new Set(provenance.map((entry) => entry.id));
  if (!provenance.length) throw new Error("A catalog must include provenance.");

  const bundle: Dom6CatalogBundle = {
    schema: DOM6_CATALOG_SCHEMA,
    schemaVersion: DOM6_CATALOG_SCHEMA_VERSION,
    gameVersion: requiredString(value.gameVersion, "gameVersion"),
    catalogVersion: requiredString(value.catalogVersion, "catalogVersion"),
    provenance,
    poptypes: [],
    sites: [],
    units: [],
    nations: [],
    forts: [],
    planes: [],
    siteTerrainTypes: [],
  };
  for (const collection of COLLECTIONS) {
    bundle[collection] = parseEntries(value[collection], collection, provenanceIds);
  }
  return normalizeCatalogBundle(bundle);
}

export function mergeCatalogBundles(...bundles: Dom6CatalogBundle[]): Dom6CatalogBundle {
  const available = bundles.length ? bundles : [BUILTIN_DOM6_CATALOG];
  const provenanceById = new Map<string, CatalogProvenance>();
  for (const bundle of available) {
    for (const entry of bundle.provenance) {
      const current = provenanceById.get(entry.id);
      if (current && !sameProvenance(current, entry)) {
        throw new Error(`Catalog provenance ID ${entry.id} conflicts with an already loaded source. Use a globally unique provenance ID.`);
      }
      provenanceById.set(entry.id, entry);
    }
  }
  const provenance = [...provenanceById.values()];
  const merged: Dom6CatalogBundle = {
    schema: DOM6_CATALOG_SCHEMA,
    schemaVersion: DOM6_CATALOG_SCHEMA_VERSION,
    gameVersion: available.at(-1)?.gameVersion ?? BUILTIN_DOM6_CATALOG.gameVersion,
    catalogVersion: available.map((bundle) => bundle.catalogVersion).join(" + "),
    provenance,
    poptypes: [],
    sites: [],
    units: [],
    nations: [],
    forts: [],
    planes: [],
    siteTerrainTypes: [],
  };
  for (const collection of COLLECTIONS) {
    const byId = new Map<number, CatalogEntry>();
    for (const bundle of available) {
      for (const entry of bundle[collection]) {
        const current = byId.get(entry.id);
        if (collection === "sites" && current) {
          const protectedTags = (current.tags ?? []).filter((tag) =>
            tag === "throne" || tag.startsWith("throne-level-") || tag === "home-site" || tag === "nation-home-site");
          byId.set(entry.id, protectedTags.length ? {
            ...entry,
            tags: [...new Set([...(entry.tags ?? []), ...protectedTags])],
          } : entry);
        } else {
          byId.set(entry.id, entry);
        }
      }
    }
    merged[collection] = [...byId.values()].sort(compareCatalogEntries);
  }
  return merged;
}

function sameProvenance(left: CatalogProvenance, right: CatalogProvenance): boolean {
  return left.title === right.title
    && left.authority === right.authority
    && left.version === right.version
    && left.source === right.source
    && left.notes === right.notes;
}

export function normalizeCatalogBundle(bundle: Dom6CatalogBundle): Dom6CatalogBundle {
  const next = { ...bundle, provenance: dedupeBy(bundle.provenance, (entry) => entry.id) };
  for (const collection of COLLECTIONS) {
    next[collection] = dedupeBy(bundle[collection], (entry) => entry.id).sort(compareCatalogEntries);
  }
  return next;
}

export function searchCatalog(entries: CatalogEntry[], query: string, limit = 10): CatalogEntry[] {
  const needle = normalizeSearch(query);
  if (!needle) return entries.slice(0, limit);
  const numeric = /^#?-?\d+$/.test(needle) ? Number.parseInt(needle.replace(/^#/, ""), 10) : undefined;
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, needle, numeric) }))
    .filter((result) => Number.isFinite(result.score))
    .sort((left, right) => left.score - right.score || compareCatalogEntries(left.entry, right.entry))
    .slice(0, limit)
    .map((result) => result.entry);
}

export function findCatalogEntry(entries: CatalogEntry[], value: string | number | undefined): CatalogEntry | undefined {
  if (value === undefined || value === "") return undefined;
  const text = String(value).trim();
  const numeric = /^#?-?\d+$/.test(text) ? Number.parseInt(text.replace(/^#/, ""), 10) : undefined;
  if (numeric !== undefined) return entries.find((entry) => entry.id === numeric);
  const normalized = normalizeSearch(text);
  return entries.find((entry) => normalizeSearch(entry.name) === normalized || entry.aliases?.some((alias) => normalizeSearch(alias) === normalized));
}

export function formatCatalogEntry(entry: CatalogEntry): string {
  return `${entry.name} (#${entry.id})`;
}

export function createCatalogTemplate(gameVersion = "6.26"): Dom6CatalogBundle {
  return {
    schema: DOM6_CATALOG_SCHEMA,
    schemaVersion: DOM6_CATALOG_SCHEMA_VERSION,
    gameVersion,
    catalogVersion: "user-catalog-1",
    provenance: [{
      id: "replace-with-source-id",
      title: "Replace with catalog title",
      authority: "user",
      version: gameVersion,
      source: "Replace with URL, filename, or in-game inspection method",
      notes: "Only include names and IDs you have verified.",
    }],
    poptypes: [],
    sites: [],
    units: [],
    nations: [],
    forts: [],
    planes: [],
    siteTerrainTypes: [],
  };
}

function parseProvenance(value: unknown): CatalogProvenance[] {
  if (!Array.isArray(value)) throw new Error("provenance must be an array.");
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`provenance[${index}] must be an object.`);
    const authority = requiredString(item.authority, `provenance[${index}].authority`);
    if (!(["official", "community", "user"] as string[]).includes(authority)) {
      throw new Error(`provenance[${index}].authority must be official, community, or user.`);
    }
    return {
      id: requiredString(item.id, `provenance[${index}].id`),
      title: requiredString(item.title, `provenance[${index}].title`),
      authority: authority as CatalogProvenance["authority"],
      version: optionalString(item.version),
      source: optionalString(item.source),
      notes: optionalString(item.notes),
    };
  });
}

function parseEntries(value: unknown, collection: CatalogCollection, provenanceIds: Set<string>): CatalogEntry[] {
  if (!Array.isArray(value)) throw new Error(`${collection} must be an array.`);
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`${collection}[${index}] must be an object.`);
    const id = item.id;
    if (typeof id !== "number" || !Number.isSafeInteger(id)) {
      throw new Error(`${collection}[${index}].id must be an integer.`);
    }
    if (id < 0 && collection !== "planes") {
      throw new Error(`${collection}[${index}].id cannot be negative.`);
    }
    const provenanceId = requiredString(item.provenanceId, `${collection}[${index}].provenanceId`);
    if (!provenanceIds.has(provenanceId)) {
      throw new Error(`${collection}[${index}] references unknown provenance ${provenanceId}.`);
    }
    return {
      id,
      name: requiredString(item.name, `${collection}[${index}].name`),
      subtitle: optionalString(item.subtitle),
      aliases: optionalStringArray(item.aliases, `${collection}[${index}].aliases`),
      tags: optionalStringArray(item.tags, `${collection}[${index}].tags`),
      terrainMask: optionalInteger(item.terrainMask, `${collection}[${index}].terrainMask`),
      magicPath: optionalString(item.magicPath),
      era: optionalInteger(item.era, `${collection}[${index}].era`),
      abbreviation: optionalString(item.abbreviation),
      provenanceId,
      sourceRef: optionalString(item.sourceRef),
    };
  });
}

function scoreEntry(entry: CatalogEntry, needle: string, numeric: number | undefined): number {
  if (numeric !== undefined) {
    if (entry.id === numeric) return 0;
    if (String(entry.id).startsWith(String(numeric))) return 5;
  }
  const name = normalizeSearch(entry.name);
  if (name === needle) return 1;
  if (name.startsWith(needle)) return 2;
  if (entry.aliases?.some((alias) => normalizeSearch(alias) === needle)) return 3;
  if (entry.aliases?.some((alias) => normalizeSearch(alias).startsWith(needle))) return 4;
  if (name.includes(needle)) return 6;
  if (entry.aliases?.some((alias) => normalizeSearch(alias).includes(needle))) return 7;
  if (entry.tags?.some((tag) => normalizeSearch(tag).includes(needle))) return 8;
  return Number.POSITIVE_INFINITY;
}

function compareCatalogEntries(left: CatalogEntry, right: CatalogEntry): number {
  return left.id - right.id || left.name.localeCompare(right.name);
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase();
}

function dedupeBy<T>(entries: T[], key: (entry: T) => string | number): T[] {
  const values = new Map<string | number, T>();
  for (const entry of entries) values.set(key(entry), entry);
  return [...values.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`${field} must be an array of non-empty strings.`);
  }
  return value.map((entry) => entry.trim());
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${field} must be an integer.`);
  return value;
}
