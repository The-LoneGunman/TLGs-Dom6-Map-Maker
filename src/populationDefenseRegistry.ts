import type { VerifiedPopulationDefenseProfile } from "./populationDefenders";

/** Revisions are immutable: saved maps must not silently adopt new army templates. */
// v1 was exposed with an empty registry. Do not add armies to that saved revision.
export const POPULATION_DEFENSE_PROFILE_REVISION = "dom6-6.37-native-2026-09-21-v3";

/**
 * The verified template data (`./populationDefenseProfiles`) is only needed
 * when population-matched defenders are enabled, previewed in Scenario, or
 * exported, so the editor loads it on demand. That module registers its
 * profiles here when it evaluates; anything that imports it statically (the
 * package exporter, host reports, tests) therefore sees the registry filled
 * before its first call.
 */
export interface PopulationDefenseRegistryState {
  profiles?: readonly VerifiedPopulationDefenseProfile[];
  failed?: boolean;
}

/**
 * Stands in for the registry until it is loaded. It is empty, so a caller
 * relying on the default sees "no verified template" rather than a crash;
 * the editor loads the registry before an enabled policy is shown.
 */
const NOT_LOADED: readonly VerifiedPopulationDefenseProfile[] = Object.freeze([]);

let state: PopulationDefenseRegistryState = {};
let pending: Promise<readonly VerifiedPopulationDefenseProfile[]> | undefined;
const listeners = new Set<() => void>();

function publish(next: PopulationDefenseRegistryState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function registerVerifiedPopulationDefenseProfiles(profiles: readonly VerifiedPopulationDefenseProfile[]): void {
  if (state.profiles !== profiles) publish({ profiles });
}

/** The verified registry once loaded; the default for every compile, validation and estimate call. */
export function verifiedPopulationDefenseProfiles(): readonly VerifiedPopulationDefenseProfile[] {
  return state.profiles ?? NOT_LOADED;
}

export function populationDefenseRegistryState(): PopulationDefenseRegistryState {
  return state;
}

export function subscribePopulationDefenseRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadVerifiedPopulationDefenseProfiles(): Promise<readonly VerifiedPopulationDefenseProfile[]> {
  if (state.profiles) return Promise.resolve(state.profiles);
  pending ??= import("./populationDefenseProfiles").then(
    (module) => {
      registerVerifiedPopulationDefenseProfiles(module.VERIFIED_POPULATION_DEFENSE_PROFILES);
      return module.VERIFIED_POPULATION_DEFENSE_PROFILES;
    },
    (error: unknown) => {
      pending = undefined;
      publish({ failed: true });
      throw error;
    },
  );
  return pending;
}

/** Start loading without waiting; a failure is reported through the registry state. */
export function prefetchVerifiedPopulationDefenseProfiles(): void {
  loadVerifiedPopulationDefenseProfiles().catch(() => undefined);
}
