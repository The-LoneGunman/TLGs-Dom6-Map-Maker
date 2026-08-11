import type { CatalogEntry } from "./types";

export const NATION_RECRUITABLE_COMMANDER_TAG = "nation-recruitable-commander";
export const NATION_RECRUITABLE_TROOP_TAG = "nation-recruitable-troop";
export const ORDINARY_SITE_TAG = "ordinary-site";

export function provinceSiteEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return entries.filter((entry) => {
    const tags = entry.tags ?? [];
    if (tags.includes("throne") || tags.includes("home-site") || tags.includes("nation-home-site")) return false;
    return true;
  });
}

export function commanderUnitEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return entries.filter((entry) => entry.tags?.includes(NATION_RECRUITABLE_COMMANDER_TAG));
}

export function troopUnitEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return entries.filter((entry) => entry.tags?.includes(NATION_RECRUITABLE_TROOP_TAG));
}
