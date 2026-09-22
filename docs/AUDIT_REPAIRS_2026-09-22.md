# Audit repairs — September 22, 2026

Follow-up to the audit of `b7f3214`, implemented on `codex/audit-repairs-sep22`. Package version remains 0.1.5. This is source repair/verification, not a hosted deployment or installer release.

## Corrections

- **Portable seeds and seeded recipes:** full generation runs against seed-and-plane-order identities, then restores the atlas's stable reference IDs. This removes the original new-atlas seed from later random choices without breaking plane links, nation starts, selections or locks. Applied `generationKey` metadata keeps geometry and artwork stable after editing a next-generation seed. Standalone plane generation follows the same separation.
- **Saved-map compatibility:** missing `generationKey` retains the historical plane-ID salt. Loading, exporting, applying a settings-only recipe or rerolling content does not silently upgrade it. The field is strictly validated, included in geometry/art caches and protected by layout locks. Settings recipes omit it; their current generator revision is `atlas-generation-2026-09-22-portable-seed-v1`, with older recipe revisions still readable.
- **Rejected numeric edits:** bounded controls restore their accepted value after a rejected commit and reconcile on blur even if the model value did not change. Incomplete multi-digit input remains possible. The same-valued-plane switch no longer carries the rejected width into another layer.
- **Island guidance:** Island Chains now explains that thin, coast-heavy land may not fit the requested inland starts. Use more Coastal starts, more provinces/player or a continental layout. Export/start-safety checks were not weakened.

## Verification

- Production build and **1,029 tests: 14 build/integration + 1,015 TypeScript**, all passing. Type checking, lint, third-party notices, full dependency audit (zero vulnerabilities), launcher self-test and local-server smoke passed.
- Cross-fresh-atlas and seeded-recipe regressions cover all **11 plane types**. Province content, links, native map/D6M output and all 18 illustrated terrain/season sheets for supported realms match. An eight-plane case additionally exercises distributed cave/other starts, a configured cave nation and explicit gateway plans.
- Tests protect reference IDs, authored names, province locks, nation starts, named regions, unchanged generation-input snapshots, seed-only edits, content rerolls, strict import and JSON round trips. An adversarial dangling-reference test also prevents missing plane IDs from aliasing temporary generation IDs: unresolved starts stay unresolved, and stale regions/planned links are pruned rather than rebound.
- All five existing generation digest baselines still match after excluding only the added provenance field; no gameplay hashes were replaced. Historical Cave/Underworld ownership snapshots remain unchanged. PNG tests cover applied-art seed caching and the legacy-ID fallback.
- An independent comparison loaded maps produced by the frozen `b7f3214` source into the repaired parser: native `.map`/`.d6m` and supported illustrated sheets were **byte-identical across all 11 plane types**.
- Isolated production-browser QA used a separate local origin, leaving the user's existing preview untouched. It covered locked-width rejection, switching between layers both 1,536 pixels wide, accepted dimensions, Undo/Redo, island guidance, two-plane generation, Underworld artwork, export-mode availability, autosave reload and a 390×844 responsive viewport. No document horizontal overflow or captured warning/error console messages were observed. The generated 50-province test atlas had no export errors and correctly disclosed a non-blocking preferred-spacing fallback.

## Remaining limits

The first 128 cases of `atlas-evaluation-v1` produced **14 export-blocked maps, zero generation exceptions and 46 experimental quality misses**. All blocked maps were the same constrained Island Chains cases identified before the repair (52% water, 16 provinces/player, multiple inland starts); the preceding audit had 48 quality misses. These results are not a clean full-corpus pass or a balance guarantee. Hard validation remains intact and the UI explains viable adjustments.

No fresh Dominions 6 native-game visual/combat acceptance, hosted publication or Windows installer publication was performed in this round. The [implementation status](MULTIPLAYER_IMPLEMENTATION_STATUS.md#verification-and-remaining-work) lists those separate tasks and the previously documented population-template limits. Keep editable project JSON for exact maps; seeds and recipes are tied to the generator revision and do not include authored content.
