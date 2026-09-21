import { protectedStartProvinceKeys } from "./authoringLocks";
import { findCatalogEntry, type CatalogEntry, type Dom6CatalogBundle } from "./catalog";
import { isBlockedProvince, isCaveProvince, isWaterProvince, type GameEra, type MapProject, type PopulationDefensePolicy, type ProvinceDefense } from "./domain";

export type { PopulationDefensePolicy } from "./domain";

export interface PopulationDefenseIdentity {
  id: number;
  name: string;
  provenanceId: string;
}

export interface PopulationDefenseSource {
  title: string;
  reference: string;
  revision: string;
  verification: string;
}

/**
 * Caller-supplied, independently verified data only; this module has no roster registry.
 * Evidence must establish recruitment membership, commander leadership and survival
 * in every allowed medium, not merely matching names in a selector catalog.
 * Counts are fixed, versioned templates, not the engine's independent-strength formula.
 */
export interface VerifiedPopulationDefenseProfile {
  revision: string;
  poptype: PopulationDefenseIdentity;
  gameVersion: string;
  /** Exact host declaration; an empty string means no declared mods. */
  mods: string;
  /** Omission is unconstrained; restricted evidence requires an explicit matching host era. */
  allowedEras?: readonly GameEra[];
  allowedMedia: readonly ("dry" | "water")[];
  caveRule: "any" | "required" | "forbidden";
  source: PopulationDefenseSource;
  groups: readonly {
    commander: PopulationDefenseIdentity;
    squads: readonly { unit: PopulationDefenseIdentity; count: number }[];
  }[];
}

export type InitialDefenseStatus = "custom" | "derived" | "excluded" | "unsupported";
export type InitialDefenseReason =
  | "custom-preserved" | "disabled" | "invalid-policy" | "protected-start" | "guardian-lock"
  | "owned" | "blocked" | "throne" | "project-raw" | "plane-raw" | "province-raw" | "no-poptype"
  | "invalid-poptype" | "invalid-profiles" | "missing-profile" | "ambiguous-profile" | "invalid-profile"
  | "unknown-game-version" | "game-version-mismatch" | "unknown-era" | "era-mismatch" | "mods-mismatch" | "catalog-mismatch"
  | "terrain-mismatch" | "verified-template";

export interface InitialDefenseResolution {
  planeId: string;
  provinceId: string;
  status: InitialDefenseStatus;
  reason: InitialDefenseReason;
  message: string;
  /** Detached copies: consuming a plan cannot change the editable atlas or profile data. */
  groups: ProvinceDefense[];
  profile?: {
    revision: string;
    poptypeId: number;
    gameVersion: string;
    mods: string;
    allowedEras?: readonly GameEra[];
    source: PopulationDefenseSource;
  };
}

export interface InitialDefensePlan {
  /** Keys use the same planeId:provinceId convention as start protection. */
  entries: ReadonlyMap<string, InitialDefenseResolution>;
  counts: Readonly<Record<InitialDefenseStatus, number>>;
}

// Resource bounds, not balance recommendations. Native/export validation remains required.
export const POPULATION_DEFENSE_LIMITS = Object.freeze({ profiles: 256, groups: 8, squadsPerGroup: 8, units: 2000 });
const MAX_REFERENCE_ID = 1_000_000;

/**
 * Resolve ordinary initial defenders without touching generation, RNG, source armies,
 * terrain, or graph data. Custom groups always win, even in an invalid draft; existing
 * project validation remains responsible for rejecting unsafe authored start content.
 * Unsupported/excluded provinces keep their normal engine behavior, not an empty army.
 * The host's patch declaration is required: targetVersion is only a map minimum and
 * the catalog's gameVersion describes metadata, not the game that will host this map.
 */
export function buildInitialDefensePlan(
  project: MapProject,
  activeCatalog: Dom6CatalogBundle,
  policy?: PopulationDefensePolicy,
  profiles: readonly VerifiedPopulationDefenseProfile[] = [],
): InitialDefensePlan {
  const entries = new Map<string, InitialDefenseResolution>();
  const counts: Record<InitialDefenseStatus, number> = { custom: 0, derived: 0, excluded: 0, unsupported: 0 };
  const disabled = policy === undefined || (isRecord(policy) && policy.enabled === false);
  const validPolicy = isRecord(policy) && onlyKeys(policy, ["enabled", "profileRevision"])
    && policy.enabled === true && shortText(policy.profileRevision, 120);
  const resolutionEnabled = !disabled && validPolicy;
  const protectedKeys = resolutionEnabled ? protectedStartProvinceKeys(project, 1) : new Set<string>();
  const profileCollectionValid = !resolutionEnabled || (Array.isArray(profiles) && profiles.length <= POPULATION_DEFENSE_LIMITS.profiles);
  const rows: readonly VerifiedPopulationDefenseProfile[] = resolutionEnabled && profileCollectionValid
    ? profiles.filter(row => isRecord(row) && row.revision === policy.profileRevision) : [];
  const validations = new Map<VerifiedPopulationDefenseProfile, string | undefined>();
  const units = rows.length ? catalogIndex(activeCatalog.units) : new Map<number, CatalogEntry | undefined>();
  const poptypes = rows.length ? catalogIndex(activeCatalog.poptypes) : new Map<number, CatalogEntry | undefined>();
  // Raw native commands are not sandboxed to the editor field that contains them.
  // Even a province block can select another province, so no automatic #land
  // may be emitted anywhere in an atlas containing arbitrary raw directives.
  const rawReason = !resolutionEnabled ? undefined : project.rawDirectives.trim() ? "project-raw"
    : project.planes.some(p => p.rawDirectives.trim()) ? "plane-raw"
      : project.planes.some(p => p.provinces.some(v => v.rawDirectives.trim())) ? "province-raw" : undefined;

  for (const plane of project.planes) for (const province of plane.provinces) {
    const key = `${plane.id}:${province.id}`;
    const put = (status: InitialDefenseStatus, reason: InitialDefenseReason, message: string,
      groups: ProvinceDefense[] = [], profile?: VerifiedPopulationDefenseProfile) => {
      entries.set(key, {
        planeId: plane.id, provinceId: province.id, status, reason, message, groups,
        ...(profile ? { profile: {
          revision: profile.revision, poptypeId: profile.poptype.id, gameVersion: profile.gameVersion,
          mods: profile.mods, source: { ...profile.source },
          ...(profile.allowedEras ? { allowedEras: [...profile.allowedEras] } : {}),
        } } : {}),
      });
      counts[status]++;
    };
    const exclude = (reason: InitialDefenseReason, message: string) => put("excluded", reason, message);
    const unsupported = (reason: InitialDefenseReason, message: string) => put("unsupported", reason, message);

    if (province.defenders.length) {
      put("custom", "custom-preserved", "Existing authored or generated guardian groups are preserved unchanged.", structuredClone(province.defenders));
    } else if (disabled) {
      exclude("disabled", "Population-matched initial defenders are disabled; engine behavior is unchanged.");
    } else if (!validPolicy) {
      unsupported("invalid-policy", "The enabled policy must pin a valid profile revision; engine defenders are retained.");
    } else if (protectedKeys.has(key)) {
      exclude("protected-start", "A player start or directly connected start neighbor is protected, including gateways.");
    } else if (province.editorLocks?.includes("guardians")) {
      exclude("guardian-lock", "The guardian field group is locked, including an intentionally empty group.");
    } else if (province.owner !== undefined) {
      exclude("owned", "An explicit owner declaration is preserved without adding automatic defenders.");
    } else if (isBlockedProvince(province)) {
      exclude("blocked", "Blocked terrain cannot receive automatic defenders.");
    } else if (province.throne === "preferred" || province.throne === "fixed"
      || province.sites.some(site => findCatalogEntry(activeCatalog.sites, site.value)?.tags?.includes("throne"))) {
      exclude("throne", "Planned or catalog-identified throne defenses are left to the existing map setup.");
    } else if (rawReason) {
      exclude(rawReason, "Raw directives anywhere in the atlas can change province selection or contents; all automatic defenders are suppressed, while custom groups remain unchanged.");
    } else if (province.poptype === undefined) {
      exclude("no-poptype", "No explicit recruitment population type is assigned; engine defenders are retained.");
    } else if (!positiveReference(province.poptype)) {
      unsupported("invalid-poptype", "Population type IDs must be finite positive integers in the supported range.");
    } else if (!profileCollectionValid) {
      unsupported("invalid-profiles", "The supplied profile collection is invalid or exceeds its resource limit.");
    } else {
      const matches = rows.filter(row => isRecord(row.poptype) && row.poptype.id === province.poptype);
      if (!matches.length) {
        unsupported("missing-profile", "No verified template for this population exists in the pinned revision; engine defenders are retained.");
        continue;
      }
      if (matches.length !== 1) {
        unsupported("ambiguous-profile", "Multiple templates claim this population and revision; none is selected.");
        continue;
      }
      const profile = matches[0]!;
      if (!validations.has(profile)) validations.set(profile, profileProblem(profile));
      const problem = validations.get(profile);
      if (problem) {
        unsupported("invalid-profile", problem);
        continue;
      }
      const gameVersion = project.analysisContext?.gameVersion?.trim();
      const era = project.analysisContext?.era;
      if (!gameVersion) {
        unsupported("unknown-game-version", "Declare the host game patch before using a patch-bound defender template.");
      } else if (gameVersion !== profile.gameVersion) {
        unsupported("game-version-mismatch", "The declared host patch differs from the verified template snapshot.");
      } else if (profile.allowedEras && era !== 1 && era !== 2 && era !== 3) {
        unsupported("unknown-era", "Declare the host game era before using an era-restricted defender template; native armies are retained.");
      } else if (profile.allowedEras && !profile.allowedEras.includes(era!)) {
        unsupported("era-mismatch", "The declared host era is outside this template's verified scope; native armies are retained.");
      } else if ((project.analysisContext?.mods ?? "").trim() !== profile.mods) {
        unsupported("mods-mismatch", "The declared mod set differs from the verified template snapshot.");
      } else if (!identityMatches(poptypes, profile.poptype)
        || profile.groups.some(group => !identityMatches(units, group.commander)
          || group.squads.some(squad => !identityMatches(units, squad.unit)))) {
        unsupported("catalog-mismatch", "A referenced ID, exact name, or provenance differs in the active catalog; engine defenders are retained.");
      } else if (!profile.allowedMedia.includes(isWaterProvince(province) ? "water" : "dry")
        || (profile.caveRule === "required" && !isCaveProvince(province))
        || (profile.caveRule === "forbidden" && isCaveProvince(province))) {
        unsupported("terrain-mismatch", "The effective Sea/Cave terrain flags are outside this template's verified scope.");
      } else {
        put("derived", "verified-template", "Using fixed counts from the supplied verified template; combat difficulty is not calibrated.",
          profile.groups.map((group, groupIndex) => ({
            commander: String(group.commander.id),
            squads: group.squads.map((squad, squadIndex) => ({
              id: `poptype-${profile.poptype.id}-${groupIndex}-${squadIndex}`,
              unit: String(squad.unit.id), count: squad.count,
            })),
          })), profile);
      }
    }
  }
  return { entries, counts };
}

function profileProblem(value: unknown): string | undefined {
  if (!isRecord(value) || !onlyKeys(value, ["revision", "poptype", "gameVersion", "mods", "allowedEras", "allowedMedia", "caveRule", "source", "groups"])
    || !shortText(value.revision, 120) || !validIdentity(value.poptype)
    || !shortText(value.gameVersion, 64) || !shortText(value.mods, 4096, true)) {
    return "A profile contains invalid identity, version, mod-set, or unrecognized fields.";
  }
  if (value.allowedEras !== undefined && (!Array.isArray(value.allowedEras)
    || value.allowedEras.length < 1 || value.allowedEras.length > 3
    || [...value.allowedEras].some(era => era !== 1 && era !== 2 && era !== 3)
    || new Set(value.allowedEras).size !== value.allowedEras.length)) {
    return "A profile's era scope must be a nonempty, unique list of game eras 1, 2 or 3.";
  }
  if (!Array.isArray(value.allowedMedia) || value.allowedMedia.length < 1 || value.allowedMedia.length > 2
    || value.allowedMedia.some(medium => medium !== "dry" && medium !== "water")
    || new Set(value.allowedMedia).size !== value.allowedMedia.length
    || typeof value.caveRule !== "string" || !["any", "required", "forbidden"].includes(value.caveRule)) {
    return "A profile must explicitly declare its supported dry/water and cave terrain scope.";
  }
  const source = value.source;
  if (!isRecord(source) || !onlyKeys(source, ["title", "reference", "revision", "verification"])
    || !shortText(source.title, 256) || !shortText(source.reference, 2048)
    || !shortText(source.revision, 256) || !shortText(source.verification, 2048)) {
    return "A profile requires bounded source, revision, and independent verification evidence.";
  }
  if (!Array.isArray(value.groups) || !value.groups.length || value.groups.length > POPULATION_DEFENSE_LIMITS.groups) {
    return "A defender template must contain a bounded, nonempty set of commander groups.";
  }
  let total = value.groups.length;
  for (const group of value.groups) {
    if (!isRecord(group) || !onlyKeys(group, ["commander", "squads"]) || !validIdentity(group.commander)
      || !Array.isArray(group.squads) || !group.squads.length || group.squads.length > POPULATION_DEFENSE_LIMITS.squadsPerGroup) {
      return "Each template group requires an exact commander identity and bounded, nonempty squads.";
    }
    for (const squad of group.squads) {
      if (!isRecord(squad) || !onlyKeys(squad, ["unit", "count"]) || !validIdentity(squad.unit)
        || !Number.isSafeInteger(squad.count) || (squad.count as number) < 1 || (squad.count as number) > 1000) {
        return "Template troop IDs must be exact and squad counts must be whole numbers from 1 to 1000.";
      }
      total += squad.count as number;
      if (total > POPULATION_DEFENSE_LIMITS.units) return "The defender template exceeds the total-unit safety limit.";
    }
  }
}

function catalogIndex(entries: CatalogEntry[]): Map<number, CatalogEntry | undefined> {
  const result = new Map<number, CatalogEntry | undefined>();
  // Duplicates are ambiguous even if the first entry would happen to match.
  for (const entry of entries) result.set(entry.id, result.has(entry.id) ? undefined : entry);
  return result;
}

function identityMatches(index: Map<number, CatalogEntry | undefined>, identity: PopulationDefenseIdentity): boolean {
  const entry = index.get(identity.id);
  return entry?.name === identity.name && entry.provenanceId === identity.provenanceId;
}

function validIdentity(value: unknown): value is PopulationDefenseIdentity {
  return isRecord(value) && onlyKeys(value, ["id", "name", "provenanceId"])
    && positiveReference(value.id) && shortText(value.name, 256) && shortText(value.provenanceId, 256);
}

function positiveReference(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_REFERENCE_ID;
}

function shortText(value: unknown, maximum: number, emptyAllowed = false): value is string {
  return typeof value === "string" && value.length <= maximum && value === value.trim()
    && (emptyAllowed || value.length > 0) && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
