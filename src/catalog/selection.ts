import type { CatalogEntry } from "./types";

export const NATION_RECRUITABLE_COMMANDER_TAG = "nation-recruitable-commander";
export const NATION_RECRUITABLE_TROOP_TAG = "nation-recruitable-troop";
export const KNOWN_COMMANDER_TAG = "known-commander";
export const KNOWN_TROOP_TAG = "known-troop";
export const INTERNAL_UNIT_RECORD_TAG = "internal-unit-record";
export const ORDINARY_SITE_TAG = "ordinary-site";

export function provinceSiteEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return entries.filter((entry) => {
    const tags = entry.tags ?? [];
    if (tags.includes("throne") || tags.includes("home-site") || tags.includes("nation-home-site")) return false;
    return true;
  });
}

export function commanderUnitEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return entries.filter((entry) => entry.tags?.includes(KNOWN_COMMANDER_TAG)
    || entry.tags?.includes(NATION_RECRUITABLE_COMMANDER_TAG));
}

export function troopUnitEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return entries.filter((entry) => entry.tags?.includes(KNOWN_TROOP_TAG)
    || entry.tags?.includes(NATION_RECRUITABLE_TROOP_TAG));
}

/**
 * Normal guardian browsing hides records explicitly marked as internal test,
 * debug, unused, or placeholder data. The complete catalog remains available
 * for raw numeric ID lookup and for preserving an already selected value.
 */
export function selectableUnitEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return entries.filter((entry) => !entry.tags?.includes(INTERNAL_UNIT_RECORD_TAG));
}
