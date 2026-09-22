import { BUILTIN_DOM6_CATALOG, findCatalogEntry, type Dom6CatalogBundle } from "./catalog";
import { isBlockedProvince, type MapProject, type Province } from "./domain";

export function isThroneSite(value: string, catalog: Dom6CatalogBundle): boolean {
  return findCatalogEntry(catalog.sites, value)?.tags?.includes("throne") ?? false;
}

/** Structured cleanup only: unknown sites and authored raw commands are never guessed away. */
export function clearBlockedTerrainContent(province: Province, catalog: Dom6CatalogBundle): void {
  province.noStart = true;
  province.start = false;
  province.startType = undefined;
  province.teamStart = undefined;
  province.throne = "none";
  province.fixedThrone = undefined;
  province.defenders = [];
  province.sites = province.sites.filter(site => !isThroneSite(site.value, catalog));
}

export function hasRawIndependentDefenderDirectives(raw: string): boolean {
  return raw.split(/\r?\n/).some(line => /^\s*#(?:commander|comname|bodyguards|units|xp|randomequip|additem|clearmagic|mag_[a-z_]+)\b/i.test(line));
}

function hasRawThroneSite(raw: string, catalog: Dom6CatalogBundle): boolean {
  return raw.split(/\r?\n/).some(line => {
    const match = /^\s*#(?:knownfeature|feature)\s+(?:"([^"]+)"|([+-]?\d+)\b)/i.exec(line);
    return match !== null && isThroneSite(match[1] ?? String(Number(match[2])), catalog);
  });
}

/** Imported or subsequently edited walls remain editable, but cannot ship inaccessible objectives/armies. */
export function blockedTerrainContentConflicts(province: Province, catalog: Dom6CatalogBundle): string[] {
  if (!isBlockedProvince(province)) return [];
  const conflicts: string[] = [];
  if (province.throne === "preferred" || province.throne === "fixed") conflicts.push("throne setup");
  if (province.sites.some(site => isThroneSite(site.value, catalog))) conflicts.push("throne sites");
  if (province.defenders.length) conflicts.push("independent guardian groups");
  if (hasRawIndependentDefenderDirectives(province.rawDirectives)) conflicts.push("raw independent-defender commands");
  if (hasRawThroneSite(province.rawDirectives, catalog)) conflicts.push("raw throne-site commands");
  return conflicts;
}

export function assertBlockedTerrainContentSafe(project: MapProject, catalog = BUILTIN_DOM6_CATALOG): void {
  for (const plane of project.planes) for (const province of plane.provinces) {
    const conflicts = blockedTerrainContentConflicts(province, catalog);
    if (conflicts.length) {
      throw new Error(`${plane.name}, #${province.index} ${province.name}: blocked Cave Wall cannot contain ${conflicts.join(", ")}. Remove that content or the Cave Wall flag before exporting.`);
    }
  }
}
