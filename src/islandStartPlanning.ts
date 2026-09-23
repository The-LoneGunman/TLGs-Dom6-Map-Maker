import { isBlockedProvince, isWaterProvince, type Plane, type StartDistribution } from "./domain";

type IslandStartType = "land" | "coastal" | "water";
export interface IslandStartPlan {
  water: Set<string>;
  starts: Array<{ provinceId: string; type: IslandStartType }>;
}

/**
 * Reserve inland capital rings before growing islands. A proposal is atomic:
 * it keeps the exact water quota, one connected sea and at least three real
 * islands, and is accepted only with a complete, separated start assignment.
 * It never edits the input plane, province count, graph or requested categories.
 */
export function planIslandStarts(
  plane: Plane,
  adjacency: ReadonlyMap<string, readonly string[]>,
  requested: Pick<StartDistribution, IslandStartType>,
  options: { minimumDegree: number; preferredSeparation: number; rank: (key: string) => number; excludedStarts?: ReadonlySet<string> },
): IslandStartPlan | undefined {
  const ids = plane.provinces.map(province => province.id);
  const originalWater = new Set(plane.provinces.filter(isWaterProvince).map(province => province.id));
  const dryTarget = ids.length - originalWater.size;
  const eligible = plane.provinces.filter(province => !province.noStart && !isBlockedProvince(province)
    && !options.excludedStarts?.has(province.id) && (adjacency.get(province.id)?.length ?? 0) >= options.minimumDegree).map(province => province.id);
  const distances = new Map<string, Map<string, number>>();
  const from = (id: string) => {
    let result = distances.get(id);
    if (!result) {
      result = new Map([[id, 0]]);
      const queue = [id];
      for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]!) ?? []) {
        if (result.has(next)) continue;
        result.set(next, result.get(queue[i]!)! + 1); queue.push(next);
      }
      distances.set(id, result);
    }
    return result;
  };
  const connected = (selection: ReadonlySet<string>) => {
    if (!selection.size) return false;
    const queue = [selection.values().next().value!], seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]!) ?? []) {
      if (selection.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
    return seen.size === selection.size;
  };
  const assign = (water: Set<string>, separation: number): IslandStartPlan | undefined => {
    const pools = new Map<IslandStartType, string[]>([["land", []], ["coastal", []], ["water", []]]);
    for (const id of eligible) {
      const type = water.has(id) ? "water" : (adjacency.get(id) ?? []).some(next => water.has(next)) ? "coastal" : "land";
      pools.get(type)!.push(id);
    }
    const types = ["land", "coastal", "water"] as const;
    if (types.some(type => pools.get(type)!.length < requested[type])) return undefined;
    const remaining = { ...requested }, chosen: IslandStartPlan["starts"] = [];
    const count = requested.land + requested.coastal + requested.water;
    let visited = 0;
    const search = (): boolean => {
      if (chosen.length === count) return true;
      if (++visited > 12_000) return false;
      const available = types.filter(type => remaining[type] > 0).map(type => ({ type, ids: pools.get(type)!
        .filter(id => chosen.every(start => (from(start.provinceId).get(id) ?? 0) >= separation)) }));
      if (available.some(pool => pool.ids.length < remaining[pool.type])) return false;
      available.sort((a, b) => a.ids.length / remaining[a.type] - b.ids.length / remaining[b.type]);
      const pool = available[0]!;
      pool.ids.sort((a, b) => options.rank(`start:${pool.type}:${a}`) - options.rank(`start:${pool.type}:${b}`));
      for (const id of pool.ids) {
        remaining[pool.type]--; chosen.push({ provinceId: id, type: pool.type });
        if (search()) return true;
        chosen.pop(); remaining[pool.type]++;
        if (visited > 12_000) break;
      }
      return false;
    };
    return search() ? { water, starts: chosen } : undefined;
  };
  // Retain existing geography only when both the island topology and its
  // typed packing are valid (tiny layouts can exhaust the initial shaper).
  const unseenDry = new Set(ids.filter(id => !originalWater.has(id)));
  let originalIslands = 0;
  while (unseenDry.size) {
    const queue = [unseenDry.values().next().value!]; unseenDry.delete(queue[0]!); originalIslands++;
    for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]!) ?? []) {
      if (unseenDry.delete(next)) queue.push(next);
    }
  }
  if (originalIslands >= 3 && connected(originalWater)) {
    for (let separation = options.preferredSeparation; separation >= 3; separation--) {
      const existing = assign(originalWater, separation);
      if (existing) return existing;
    }
  }
  if (!originalWater.size || requested.land * (options.minimumDegree + 1) > dryTarget
    || dryTarget < 9 || eligible.length < requested.land + requested.coastal + requested.water) return undefined;

  const degree = (id: string) => adjacency.get(id)?.length ?? 0;
  // A bounded deterministic search changes only failed layouts. Higher spacing
  // is tried first; the hard three-move floor is never relaxed by this planner.
  for (let separation = Math.max(4, options.preferredSeparation); separation >= 4; separation--) {
    for (let attempt = 0; attempt < 48; attempt++) {
      const water = new Set(ids), owners = new Map<string, number>(), sizes: number[] = [], centers: string[] = [];
      const addIsland = (id: string, ring: boolean) => {
        const members = ring ? [id, ...(adjacency.get(id) ?? [])] : [id];
        if (members.some(member => owners.has(member) || (adjacency.get(member) ?? []).some(next => owners.has(next)))) return false;
        if (owners.size + members.length > dryTarget) return false;
        const trial = new Set(water); for (const member of members) trial.delete(member);
        if (!connected(trial)) return false;
        for (const member of members) { owners.set(member, sizes.length); water.delete(member); }
        sizes.push(members.length); centers.push(id); return true;
      };
      let failed = false;
      for (let slot = 0; slot < Math.max(3, requested.land); slot++) {
        const ring = slot < requested.land;
        const candidates = (ring ? eligible : ids).filter(id => centers.every(center => (from(center).get(id) ?? 0) >= separation));
        candidates.sort((a, b) => {
          // Vary the initial packing, but favor compact one-rings so the
          // water quota does not get consumed by unusually large capital hubs.
          const jitter = (id: string) => options.rank(`island:${attempt}:${slot}:${id}`) % 10_000;
          return (ring ? Math.abs(degree(a) - (4 + attempt % 3)) - Math.abs(degree(b) - (4 + attempt % 3)) : 0)
            || jitter(a) - jitter(b);
        });
        if (!candidates.some(id => addIsland(id, ring))) { failed = true; break; }
      }
      if (failed) continue;
      while (owners.size < dryTarget) {
        const frontier = ids.flatMap(id => {
          if (!water.has(id)) return [];
          const touching = new Set((adjacency.get(id) ?? []).flatMap(next => owners.has(next) ? [owners.get(next)!] : []));
          if (touching.size !== 1) return []; // Never join two islands.
          const owner = [...touching][0]!;
          return [{ id, owner, contacts: (adjacency.get(id) ?? []).filter(next => owners.get(next) === owner).length }];
        });
        frontier.sort((a, b) => sizes[a.owner]! - sizes[b.owner]! || b.contacts - a.contacts
          || Number(originalWater.has(a.id)) - Number(originalWater.has(b.id))
          || options.rank(`grow:${attempt}:${a.id}`) - options.rank(`grow:${attempt}:${b.id}`));
        const chosen = frontier.find(candidate => {
          const trial = new Set(water); trial.delete(candidate.id); return connected(trial);
        });
        if (!chosen) break;
        owners.set(chosen.id, chosen.owner); sizes[chosen.owner]!++; water.delete(chosen.id);
      }
      if (owners.size !== dryTarget || sizes.some(size => size < 3)) continue;
      for (let startSeparation = options.preferredSeparation; startSeparation >= 3; startSeparation--) {
        const plan = assign(water, startSeparation);
        if (plan) return plan;
      }
    }
  }
  return undefined;
}
