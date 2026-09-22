import {
  effectiveProvinceTerrainFlags,
  isBlockedProvince,
  isWaterProvince,
  type Plane,
  type Province,
} from "../domain";
import type { CatalogEntry } from "./types";

const SITE_UNIQUE_BIT = 16_384;
const SITE_LOCATION_BITS: Array<[number, string]> = [
  [1, "plain"],
  [2, "forest"],
  [4, "mountain"],
  [8, "waste"],
  [16, "farm"],
  [32, "sea"],
  [64, "coast"],
  [128, "swamp"],
  [256, "deep sea"],
  [512, "cave"],
  [32_768, "underwater mountain"],
  [65_536, "underwater forest"],
  [131_072, "underwater coast"],
];
const KNOWN_SITE_LOCATION_MASK = SITE_LOCATION_BITS.reduce((mask, [bit]) => mask | bit, 0);

export interface SiteCompatibility {
  label: string;
  compatible: boolean;
  unique: boolean;
  locations: string[];
}

export function siteCompatibility(entry: CatalogEntry, province: Province, plane: Plane): SiteCompatibility {
  const mask = entry.terrainMask ?? 0;
  const requestedLocations = mask & KNOWN_SITE_LOCATION_MASK;
  const unique = (mask & SITE_UNIQUE_BIT) !== 0;
  const locations = SITE_LOCATION_BITS.filter(([bit]) => (requestedLocations & bit) !== 0).map(([, label]) => label);
  const compatible = requestedLocations === 0 || (requestedLocations & provinceSiteLocationMask(province, plane)) !== 0;
  const scope = locations.length ? locations.join(" / ") : "any terrain";
  return { compatible, unique, locations, label: `${compatible ? "Compatible" : "Terrain mismatch"}: ${scope}${unique ? "; unique" : ""}` };
}

export function provinceSiteLocationMask(province: Province, plane: Plane): number {
  // Cave walls are blocked map geometry, not cave provinces on which a site
  // can be placed. Keeping their mask empty prevents the site picker from
  // presenting cave-only sites as valid on an impassable wall.
  if (isBlockedProvince(province)) return 0;

  const flags = effectiveProvinceTerrainFlags(province);
  let mask = 0;
  const hasMountain = flags.has("highland") || flags.has("mountains");
  const hasSpecificLandType = flags.has("forest") || hasMountain || flags.has("waste")
    || flags.has("farm") || flags.has("sea") || flags.has("swamp") || flags.has("cave");
  // Underwater forest and highland have their own site bits, so the dry-land
  // bits describe only provinces without the sea flag.
  const sea = flags.has("sea");
  if (!hasSpecificLandType) mask |= 1;
  if (!sea && flags.has("forest")) mask |= 2;
  if (!sea && hasMountain) mask |= 4;
  if (!sea && flags.has("waste")) mask |= 8;
  if (!sea && flags.has("farm")) mask |= 16;
  if (sea) mask |= 32;
  if (!sea && flags.has("swamp")) mask |= 128;
  if (flags.has("deep") && sea) mask |= 256;
  if (flags.has("cave")) mask |= 512;
  if (sea && hasMountain) mask |= 32_768;
  if (sea && flags.has("forest")) mask |= 65_536;
  const neighbors = plane.edges
    .filter((edge) => edge.a === province.id || edge.b === province.id)
    .map((edge) => plane.provinces.find((item) => item.id === (edge.a === province.id ? edge.b : edge.a)))
    .filter((item): item is Province => !!item);
  if (isWaterProvince(province) && neighbors.some((neighbor) => !isWaterProvince(neighbor))) mask |= 131_072;
  if (!isWaterProvince(province) && neighbors.some((neighbor) => isWaterProvince(neighbor))) mask |= 64;
  return mask;
}
