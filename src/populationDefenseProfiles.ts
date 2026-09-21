import type { VerifiedPopulationDefenseProfile } from "./populationDefenders";

/** Revisions are immutable: saved maps must not silently adopt new army templates. */
// v1 was exposed with an empty registry. Do not add armies to that saved revision.
export const POPULATION_DEFENSE_PROFILE_REVISION = "dom6-6.37-native-2026-09-21-v2";

/** Only independently observed native recruitment rosters belong in this registry. */
export const VERIFIED_POPULATION_DEFENSE_PROFILES: readonly VerifiedPopulationDefenseProfile[] = [{
  revision: POPULATION_DEFENSE_PROFILE_REVISION,
  poptype: { id: 81, name: "Pale Ones", provenanceId: "illwinter-map-manual-6.26" },
  gameVersion: "6.37",
  mods: "",
  allowedEras: [2],
  allowedMedia: ["dry"],
  caveRule: "required",
  source: {
    title: "Native 6.37 Middle Age recruitment and initial-army check",
    reference: "docs/research/POPULATION_RECRUITMENT_EVIDENCE_2026-09-21.md",
    revision: "native-6.37-r21-pop81 + Inspector c30c6c14e18ab284415d599b81579af9b3070112",
    verification: "Recruitment observed under MA Ulm in an unmodded dry Cave with poptype 81. Native export created commander 1463 and a squad of 15 troop 1465; a scripted turn completed leadership validation. Fixed counts, not calibrated combat difficulty. Other eras, non-cave terrain and underwater recruitment are not verified.",
  },
  groups: [{
    commander: { id: 1463, name: "Pale One Commander", provenanceId: "dom6inspector-6.37-c30c6c14" },
    squads: [{
      unit: { id: 1465, name: "Pale One", provenanceId: "dom6inspector-6.37-c30c6c14" },
      count: 15,
    }],
  }],
}];
