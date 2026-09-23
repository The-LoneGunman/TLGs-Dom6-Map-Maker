import type { CatalogEntry } from "./types";

/**
 * Catalog lookup without the built-in unit table: the generation worker uses
 * it for site tags, so it must not import `./builtin`. `./index` re-exports it.
 */

interface CatalogEntryIndex {
  /** Entry count when built; a different length means the array changed and the index is rebuilt. */
  length: number;
  byId?: Map<number, CatalogEntry>;
  byName?: Map<string, CatalogEntry>;
}

// Validation and the editor look up thousands of catalog references per pass;
// normalizing every entry's name on each lookup dominated those passes.
// Catalog collections are replaced rather than mutated, so each array gets a
// lazily built index that keeps the first matching entry, exactly as a linear
// find over the array would return.
const catalogEntryIndexes = new WeakMap<readonly CatalogEntry[], CatalogEntryIndex>();

function catalogEntryIndex(entries: readonly CatalogEntry[]): CatalogEntryIndex {
  let index = catalogEntryIndexes.get(entries);
  if (!index || index.length !== entries.length) {
    index = { length: entries.length };
    catalogEntryIndexes.set(entries, index);
  }
  return index;
}

function catalogEntriesById(entries: readonly CatalogEntry[]): Map<number, CatalogEntry> {
  const index = catalogEntryIndex(entries);
  if (!index.byId) {
    const byId = new Map<number, CatalogEntry>();
    for (const entry of entries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
    index.byId = byId;
  }
  return index.byId;
}

function catalogEntriesByName(entries: readonly CatalogEntry[]): Map<string, CatalogEntry> {
  const index = catalogEntryIndex(entries);
  if (!index.byName) {
    const byName = new Map<string, CatalogEntry>();
    for (const entry of entries) {
      const name = normalizeSearch(entry.name);
      if (!byName.has(name)) byName.set(name, entry);
      for (const alias of entry.aliases ?? []) {
        const normalized = normalizeSearch(alias);
        if (!byName.has(normalized)) byName.set(normalized, entry);
      }
    }
    index.byName = byName;
  }
  return index.byName;
}

export function findCatalogEntry(entries: CatalogEntry[], value: string | number | undefined): CatalogEntry | undefined {
  if (value === undefined || value === "") return undefined;
  const text = String(value).trim();
  const numeric = /^#?-?\d+$/.test(text) ? Number.parseInt(text.replace(/^#/, ""), 10) : undefined;
  if (numeric !== undefined) return catalogEntriesById(entries).get(numeric);
  return catalogEntriesByName(entries).get(normalizeSearch(text));
}

export function formatCatalogEntry(entry: CatalogEntry): string {
  return `${entry.name} (#${entry.id})`;
}

/** A nation as the editor names it, "Ulm (#13)", or "nation 13" when the catalog lacks it. */
export function formatNationLabel(nations: CatalogEntry[], nation: number): string {
  const entry = findCatalogEntry(nations, nation);
  return entry ? formatCatalogEntry(entry) : `nation ${nation}`;
}

export function normalizeSearch(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLocaleLowerCase();
}
