import { effectiveProvinceTerrainFlags, type Plane, type PreviewCondition, type Province, type TerrainKey } from "./domain";

type ProvinceTerrain = Pick<Province, "terrain" | "terrainFlags" | "freshwater">;

/** Resolve the complete mask, independent of which flag was selected first. */
export function terrainVisualKey(province: ProvinceTerrain): TerrainKey {
  const flags = effectiveProvinceTerrainFlags(province);
  if (flags.has("cavewall")) return "cavewall";
  if (flags.has("sea")) return flags.has("deep") ? "deepsea" : flags.has("forest") ? "kelp" : "sea";
  if (flags.has("cave")) {
    if (flags.has("forest")) return "caveforest";
    if (flags.has("swamp")) return "caveswamp";
    if (flags.has("waste")) return "cavewaste";
    if (flags.has("mountains") || flags.has("highland")) return "cavehighland";
    return "cave";
  }
  if (flags.has("mountains")) return "mountains";
  if (flags.has("highland")) return "highland";
  if (flags.has("forest")) return "forest";
  if (flags.has("swamp")) return "swamp";
  if (flags.has("waste")) return "waste";
  if (flags.has("farm")) return "farm";
  // Fresh water is an auxiliary land marker, not an aquatic province.
  return "plains";
}

export type TerrainMarkKind = "forest" | "kelp" | "mountain" | "highland" | "water" | "freshwater" | "swamp" | "farm" | "waste" | "cave" | "cavewall" | "deep";

export interface ProvinceTerrainVisuals {
  base: TerrainKey;
  layers: TerrainKey[];
  marks: TerrainMarkKind[];
}

/** Preview transformations replace cover without mutating the native terrain. */
export function previewProvinceTerrain(province: ProvinceTerrain, condition: string): ProvinceTerrain {
  const flags = new Set(effectiveProvinceTerrainFlags(province));
  if (flags.has("cavewall") || condition === "normal" || condition === "winter") return province;
  if (condition === "forested") {
    flags.delete("farm"); flags.delete("waste"); flags.add("forest");
  } else if (condition === "flooded") {
    flags.add("sea"); flags.delete("farm"); flags.delete("swamp"); flags.delete("waste"); flags.delete("freshwater");
  } else if (condition === "wasted") {
    flags.delete("forest"); flags.delete("farm"); flags.delete("swamp");
    if (!flags.has("sea")) flags.add("waste");
  } else if (condition === "farmland") {
    if (flags.has("sea") || flags.has("cave")) return province;
    flags.delete("forest"); flags.delete("swamp"); flags.delete("waste"); flags.add("farm");
  }
  return { terrain: "plains", terrainFlags: [...flags], freshwater: false };
}

/** Illustrative winter cover, not a simulation of dominion or temperature. */
export function winterPreviewStrength(plane: Pick<Plane, "kind" | "variant">, province: ProvinceTerrain & Partial<Pick<Province, "warmer" | "colder">>): number {
  const flags = effectiveProvinceTerrainFlags(province);
  if (flags.has("cave") || flags.has("cavewall") || flags.has("sea")) return 0;
  if (plane.kind !== "surface" && plane.kind !== "custom") return 0;
  if (plane.kind === "custom" && ["fungal", "crystal", "volcanic", "infernal", "void", "storm"].includes(plane.variant ?? "")) return 0;
  return province.warmer && !province.colder ? 0.35 : province.colder && !province.warmer ? 1 : 0.8;
}

/** Only the effective preview mask contributes layers and marks. */
export function provinceTerrainVisuals(province: ProvinceTerrain, condition: PreviewCondition = "normal"): ProvinceTerrainVisuals {
  const displayed = previewProvinceTerrain(province, condition);
  const flags = effectiveProvinceTerrainFlags(displayed);
  const displayBase = terrainVisualKey(displayed);
  const layers = new Set<TerrainKey>([displayBase]);
  const marks: TerrainMarkKind[] = [];
  const add = (mark: TerrainMarkKind, layer: TerrainKey) => { marks.push(mark); layers.add(layer); };
  if (flags.has("forest")) add(flags.has("sea") ? "kelp" : "forest", flags.has("sea") ? "kelp" : flags.has("cave") ? "caveforest" : "forest");
  if (flags.has("farm")) add("farm", "farm");
  if (flags.has("mountains")) add("mountain", "mountains");
  if (flags.has("highland")) add("highland", flags.has("cave") ? "cavehighland" : "highland");
  if (flags.has("swamp")) add("swamp", flags.has("cave") ? "caveswamp" : "swamp");
  if (flags.has("waste")) add("waste", flags.has("cave") ? "cavewaste" : "waste");
  if (flags.has("sea")) add("water", flags.has("deep") ? "deepsea" : "sea");
  if (flags.has("freshwater")) marks.push("freshwater");
  // A lone Deep flag has no in-game effect without Sea.
  if (flags.has("deep") && flags.has("sea")) marks.push("deep");
  if (flags.has("cave")) add("cave", "cave");
  if (flags.has("cavewall")) add("cavewall", "cavewall");
  return { base: displayBase, layers: [...layers], marks };
}

const TERRAIN_HEIGHTS: Record<TerrainKey, number> = {
  plains: 90, forest: 130, farm: 75, swamp: 18, waste: 105,
  highland: 520, mountains: 900, freshwater: 90,
  sea: -380, deepsea: -1180, kelp: -290,
  cave: 120, caveforest: 165, caveswamp: 35, cavewaste: 210,
  cavehighland: 640, cavewall: 1250,
};

/** D6M relief uses the same current flags as the .map mask and editor. */
export function terrainElevation(province: ProvinceTerrain): number {
  const flags = effectiveProvinceTerrainFlags(province);
  if (flags.has("cavewall")) return 1250;
  if (flags.has("sea")) {
    if (flags.has("deep")) return -1180;
    if (flags.has("mountains") || flags.has("highland")) return -220;
    return flags.has("forest") ? -290 : -380;
  }
  if (flags.has("mountains")) return 900;
  if (flags.has("highland")) return flags.has("cave") ? 640 : 520;
  return TERRAIN_HEIGHTS[terrainVisualKey(province)];
}
