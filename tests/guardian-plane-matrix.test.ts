import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_DOM6_CATALOG } from "../src/catalog";
import {
  cloneProject,
  isWaterProvince,
  type PlaneKind,
  type PlaneVariant,
  type Province,
} from "../src/domain";
import {
  GUARDIAN_CATALOG_POOLS,
  adjacencyFor,
  createDefaultProject,
  generatePlane,
  shortestDistances,
} from "../src/generator";

const KINDS: PlaneKind[] = ["surface", "cave", "cavern", "cloud", "air", "underworld", "hell", "abyss", "dream", "elemental", "custom"];
const VARIANTS: PlaneVariant[] = ["temperate", "wild", "frozen", "arid", "oceanic", "fungal", "crystal", "volcanic", "storm", "infernal", "void"];

function themeFor(kind: PlaneKind, variant: PlaneVariant, province: Province): keyof typeof GUARDIAN_CATALOG_POOLS {
  if (isWaterProvince(province)) {
    if (kind === "underworld") return "underworld";
    if (kind === "cave" || kind === "cavern") return "cave_water";
    if (kind === "dream") return "dream_water";
    if (kind === "elemental") return "elemental_water";
    if (kind === "hell") return "hell_water";
    if (kind === "abyss") return "abyss_water";
    if (kind === "custom") {
      if (variant === "wild") return "dream_water";
      if (variant === "volcanic" || variant === "frozen") return "elemental_water";
      if (variant === "storm") return "storm_water";
      if (variant === "infernal") return "hell_water";
      if (variant === "void") return "abyss_water";
      if (variant === "fungal" || variant === "crystal") return "cave_water";
    }
    return "water";
  }
  if (kind !== "custom") return kind;
  if (variant === "infernal") return "hell";
  if (variant === "void") return "abyss";
  if (variant === "storm") return "air";
  if (variant === "wild") return "dream";
  if (variant === "volcanic") return "elemental";
  if (variant === "fungal" || variant === "crystal") return "cavern";
  return "custom";
}

function usesHardGuardians(kind: PlaneKind, variant: PlaneVariant): boolean {
  if (["cloud", "air", "underworld", "hell", "abyss", "dream", "elemental"].includes(kind)) return true;
  if (kind === "custom") return !["temperate", "frozen", "arid"].includes(variant);
  return kind === "surface" && variant === "oceanic";
}

test("all 121 plane and terrain-variant combinations use valid, thematic, start-safe guardians", () => {
  const base = createDefaultProject("guardian-plane-matrix");
  const catalogIds = new Set(BUILTIN_DOM6_CATALOG.units.map((unit) => String(unit.id)));
  let checkedGroups = 0;

  for (const kind of KINDS) {
    for (const variant of VARIANTS) {
      const source = cloneProject(base).planes[0]!;
      source.kind = kind;
      source.variant = variant;
      source.autoSize = false;
      source.provinceTarget = 72;
      const plane = generatePlane(source, { ...base.settings, players: 2 }, `guardian-matrix:${kind}:${variant}`, 0);
      assert.equal(plane.provinces.some((province) => province.warmer && province.colder), false, `${kind}/${variant} emitted mutually exclusive temperature flags`);
      const guardians = plane.provinces.flatMap((province) => province.defenders.map((group) => ({ province, group })));
      assert.ok(guardians.length > 0, `${kind}/${variant} produced no guardian groups`);

      const adjacency = adjacencyFor(plane, { traversableOnly: true });
      const startDistances = plane.provinces.filter((province) => province.start || province.teamStart !== undefined)
        .map((province) => shortestDistances(adjacency, province.id));
      const hard = usesHardGuardians(kind, variant);
      for (const { province, group } of guardians) {
        checkedGroups += 1;
        const theme = themeFor(kind, variant, province);
        const pool = GUARDIAN_CATALOG_POOLS[theme];
        assert.ok(catalogIds.has(group.commander), `${kind}/${variant} commander ${group.commander} is absent from the vanilla catalog`);
        assert.ok(pool.commanders.includes(group.commander as never), `${kind}/${variant} used off-theme commander ${group.commander}`);
        assert.equal(group.squads.length, hard ? 2 : 1, `${kind}/${variant} used the wrong force tier`);
        const total = group.squads.reduce((sum, squad) => sum + squad.count, 0);
        assert.ok(total >= (hard ? 28 : 8) && total <= (hard ? 48 : 18), `${kind}/${variant} guardian force ${total} is outside its tier`);
        if (hard) assert.ok((group.experience ?? 0) >= 1 && (group.experience ?? 0) <= 3, `${kind}/${variant} hard guardian lacks experience`);
        for (const squad of group.squads) {
          assert.ok(catalogIds.has(squad.unit), `${kind}/${variant} troop ${squad.unit} is absent from the vanilla catalog`);
          assert.ok(pool.units.includes(squad.unit as never), `${kind}/${variant} used off-theme troop ${squad.unit}`);
        }
        for (const distances of startDistances) {
          assert.ok((distances.get(province.id) ?? Infinity) >= 3, `${kind}/${variant} placed guardians inside a start's two-ring`);
        }
      }
    }
  }

  assert.ok(checkedGroups > KINDS.length * VARIANTS.length, "the matrix should exercise multiple guardian groups, not only fallbacks");
});
