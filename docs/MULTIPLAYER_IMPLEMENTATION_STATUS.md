# Multiplayer workbench implementation

Reviewed September 22, 2026, including the [audit-repair follow-up](AUDIT_REPAIRS_2026-09-22.md). Package version remains 0.1.5, but hosted Site version 13 and Windows v0.1.5 still contain the earlier `581b2b8` source. The post-release source additions below are not deployed. See [Versions and documentation](../README.md#versions-and-documentation) and [release verification](RELEASE_VERIFICATION_0.1.5.md) for the separate delivery records.

This tracks the approved [comparative-research roadmap](MULTIPLAYER_MAPMAKER_RESEARCH_2026-09-06.md). Approval is not proof of delivery or measured balance. Selector catalogs are pinned to 6.37; they are not nation-strength rulesets or automatic update feeds.

## Existing source features

- Control-scope labels, pending generation inputs, current/planned province budgets, and cross-plane province search.
- Per-start structural analysis with explicit unknown economy/combat data, conservative dry/water access, team-aware comparisons, throne/gateway distances, and saved patch/era/mod assumptions.
- Generation cancellation, replacement confirmations/backups, bounded Undo/Redo, guarded recovery/import, ordered catalog imports, and conflict-aware direct installation.
- Fresh-project seeds, optional generated-name shuffling on reopen, contextual names, and September 19–20 generation, export, border, preview, and readability repairs.

## Implemented in the September 20 round

| Area | Available controls and limits |
| --- | --- |
| Safe iteration | The **Iterate** tab filters the active plane by role, terrain, effective flags, name/number, or a named selection. Batch edits and selected-content rerolls preview changes and newly introduced export blockers before applying as one Undoable edit. |
| Safeguards | Layout/start locks guard structure; five province field groups protect batch tools and same-seed generation. Different-seed full generation is rejected while field-locked province IDs would disappear. Direct inspector edits remain intentional edits. |
| Alternatives | Settings-only recipes and two/three background-generated candidates, with per-plane previews and two-step spread comparisons. Candidates are never selected automatically; their scores remain structural heuristics. Recipes are not exact map backups. |
| Generation preferences | Per-plane water/cave-ocean preferences, dry-terrain weights, normalized regional plans, eligible road/river/pass shares, guardian coverage/troop-count multipliers, and many-sites preferences. Safety and topology take precedence over quotas; inherited settings preserve existing behavior. |
| Structural analysis | Fractional two-step opportunity, distinct hostile frontier groups, nearest ally, shared direct capital surroundings, and separate preferred/fixed-throne distances. No movement-turn, income, resources, recruitment-point, or combat model is claimed. |
| Patch-bound requests | Optional host-declared nation terrain requirements, tied to the declared patch/mod snapshot and one explicit nation start. They report met/shortfall/unassigned/unverified; they never apply automatic compensation. |
| Interoperability | Read-only `.map` inventories and bounded `.d6m` structure checks. Referenced assets are not opened; arbitrary native artwork is not converted into editable Atlas geometry. |
| Handoffs and fixtures | Player ZIPs omit editable JSON and host reports while retaining identical playable files. Separate background-generated two-player guardian fixtures copy one authored encounter and disclose any target-terrain adaptation; they do not simulate battles or alter the current atlas. |

## September 21 additions

- Softer underground chambers, curved and flared passages where safe, and smoother native relief share the same preview/export ownership model. Gameplay records, starts, gateways and Styx crossings remain protected.
- The pinned 6.37 selector refresh and separately verified 82-row static recruitment table distinguish content metadata from actual template acceptance.
- **Population-matched initial defenders** is opt-in and off by default. The current v3 revision covers 76 populations and 161 tested land/water × Cave scopes in unmodded 6.37 Middle Age. It requires explicit patch/era declarations, preserves custom guardians and protected starts, and leaves unsupported contexts unchanged. Counts are fixed authored choices, not calibrated combat difficulty or persistent PD.
- Saved v1/v2 template revisions remain unchanged until the user explicitly selects the newer revision. Manual population edits re-evaluate the read-only army preview without regeneration.

## Merged post-release additions — September 21–22

| Area | Current-main behavior and scope |
| --- | --- |
| Realm layout and artwork | [Connected regions and broad passages](CONNECTED_REGIONS_2026-09-21.md) replace the classic sparse-layout selector. Procedural landscapes cover nine realm types, with optional [playable illustrated export](ILLUSTRATED_EXPORT_2026-09-22.md), terrain/winter sheets and remapped province references. Surface/Custom remain native. |
| Natural geography | [Distinct coast, ocean, lake and realm contours](NATURAL_LANDFORMS_2026-09-22.md) share editor/export ownership. New generations record shape provenance; terrain edits and content rerolls do not reshape those boundaries. Explicit ocean presets keep their water layout during start placement. |
| Terrain distribution | New-project and Balanced FFA cohesion defaults are 58%, with modest extra variation in temperate terrain below 80%. Saved settings, themed samplers and explicit preferences are preserved. |
| Rivers | [Connected border watercourses](CONNECTED_BORDER_RIVERS_2026-09-22.md) use real shared-border junctions and safe capital/road bridges. Complete routes take priority over a precise requested share; the province-water Styx is unchanged. |
| Terrain editing | [Cave-wall safety and mixed relief](TERRAIN_EDIT_REPAIRS_2026-09-22.md): consistent primary/additive cleanup, blocked-content export checks, submerged aquatic relief and low wooded-swamp relief. |
| Audit repairs | [Portable seeds/seeded recipes](AUDIT_REPAIRS_2026-09-22.md) separate generation identity from saved references; older maps retain their artwork. Rejected numeric edits restore accepted values. Island Chains explains inland-start capacity limits. |

## Verification and remaining work

**September 23 repair branch:** [Island-start and audit corrections](AUDIT_ISLAND_REPAIRS_2026-09-23.md) passed **1,123 local tests** and a new 1,000-map structural run: **all 125 island cases passed**, no generation exceptions, and three unchanged continental-capacity cases remained export-blocked. The island repair can reshape otherwise infeasible interiors during Generate while preserving water count, a connected sea and at least three islands; feasible existing masks and saved-map loading are unchanged. **328 maps missed experimental quality criteria**. This is local branch evidence, not a merge, deployment or native-playtest result.

**Audit-repair follow-up:** **1,029 local automated tests (14 build/integration + 1,015 TypeScript)** passed, alongside type checking, lint, licenses, dependency audit and launcher/server checks. Real browser use verified rejected/accepted numeric edits, plane switching, Undo/Redo, generation, saved reload and narrow-screen layout. [The repair record](AUDIT_REPAIRS_2026-09-22.md) distinguishes compatibility evidence from remaining limits.

**Natural-landform baseline:** `464ff03` passed [merged-main CI](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/actions/runs/35738115402): **1,010 automated tests (14 build/integration + 996 TypeScript)**. Browser use covered continental, island and inland-sea generation, mixed starts, terrain editing/Undo and saved geometry. The [natural-landform record](NATURAL_LANDFORMS_2026-09-22.md#final-checks) gives the fixtures and limits.

Five generation fixtures cover default, islands, continents, caves and eight planes. Their expected output intentionally changed with the new generator after before/after review; they are not promises that a seed recreates older geography. Frozen saved-map fixtures separately preserve legacy ownership checks. Keep project JSON for an exact map, not just its seed or settings recipe.

**Published release evidence:** `581b2b8` passed **743 tests (14 build/integration + 729 TypeScript)**, type checking, lint, license checks, and server/launcher checks. Native Dominions 6.37 loaded all eight planes of that acceptance package, and each was visually inspected. All 163 trial cases passed the documented creation/hosting checks; withholding the unresolved Onyx Amazon mount case leaves 76 released templates and 161 accepted scopes. The [template evidence](research/NATIVE_POPULATION_DEFENDERS_2026-09-21.md) expressly does not claim a final troop census or combat balance. One [generated Inferno encounter](research/NATIVE_GUARDIAN_CAPTURE_2026-09-21.md) was also fought and captured, followed by completed Lava-born commander/troop recruitment and PD-level-10 inspection.

Browser checks covered old-v2 import/pinning, explicit adoption of v3, manual Cavemen population edits, unsupported Troglodytes fallback, Undo and a 390-pixel-wide viewport without panel overflow or console errors. These do not substitute for native gameplay checks.

The [September 20 structural evaluation](IMPLEMENTATION_ROUND_2026-09-20.md) ran 1,000 fixed-corpus maps with zero export-error maps or generation exceptions. **243 missed the experimental quality criteria**; the separate held-out set had **48 misses out of 200**. These are historical measurements, not current miss counts; the September 23 branch rerun is recorded above. Quality misses remain follow-up work, not export blockers or proof that the maps are unplayable. The criteria are proposed diagnostics, not established community standards, and the results do not certify multiplayer balance.

The September 22 repair check reran the first **128** corpus cases: **14 export-blocked Island Chains configurations, zero exceptions, and 46 experimental quality misses**. Those island failures are corrected on the September 23 repair branch: the same 128 cases now have **zero export errors**, zero exceptions, and 40 experimental quality misses. This does not make every possible island start mix feasible or certify multiplayer balance.

Still outstanding:

- Fresh native-game visual acceptance for the latest Cloud/Air and natural contours, connected river/bridge rendering (including wrap seams), and Sea + Cave Wall relief. Earlier illustrated-art loading/visual checks predate these refinements.
- Separate hosted deployment and clean-runner installer packaging/publication for the post-release additions; a source merge does not complete either.
- Full lossless editable import of arbitrary external maps, including authored raster geometry and unsupported directives.
- Calibrated nation movement, separate income/resources/recruitment estimates, and combat difficulty models.
- Verified automatic nation accommodations. Host-declared checks are not a substitute for patch-specific evidence.
- Comprehensive in-engine seasonal, recruitment, post-capture defence, and guardian-combat acceptance beyond the specific completed checks above. Populations 43, 44, 72, 88, 105 and 106 have no released automatic defender template; other eras, patches and mods remain outside v3's scope.
- Human task studies and actual multiplayer playtests, plus investigation of the seed-corpus quality misses.

The general illustrated asset-pack specification also remains a future contract, not a delivered pack-import system. New editing metadata is optional, but older apps can reject projects containing it; retain pre-upgrade JSON backups.
