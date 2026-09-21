# Multiplayer workbench implementation

Reviewed September 20, 2026. This document covers the current `main` source, including implementation commit **`950481f`** from `codex/full-implementation-round-sep20`. The user authorized merging current progress while deferring the native-game check. This round has not been deployed to the hosted app or included in a Windows release. See [Versions and documentation](../README.md#versions-and-documentation).

This tracks the approved [comparative-research roadmap](MULTIPLAYER_MAPMAKER_RESEARCH_2026-09-06.md). Approval is not proof of delivery or measured balance. Selector catalogs remain pinned to 6.35; they are not nation-strength rulesets.

## Existing source features

- Control-scope labels, pending generation inputs, current/planned province budgets, and cross-plane province search.
- Per-start structural analysis with explicit unknown economy/combat data, conservative dry/water access, team-aware comparisons, throne/gateway distances, and saved patch/mod assumptions.
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

## Verification and remaining work

Five fixed generation fixtures cover default, islands, continents, caves, and eight planes to detect changes when new preferences are unused. The [implementation-round record](IMPLEMENTATION_ROUND_2026-09-20.md) owns the final automated/browser/native results; do not reuse an earlier test count as evidence for this branch.

The structural evaluation ran 1,000 fixed-corpus maps with zero export-error maps or generation exceptions. **243 missed the experimental quality criteria**; the separate held-out set had **48 misses out of 200**. These misses remain quality follow-up work, not export blockers or proof that the maps are unplayable. The criteria are proposed diagnostics, not established community standards, and the results do not certify multiplayer balance.

Still outstanding:

- Full lossless editable import of arbitrary external maps, including authored raster geometry and unsupported directives.
- Calibrated nation movement, separate income/resources/recruitment estimates, and combat difficulty models.
- Verified automatic nation accommodations. Host-declared checks are not a substitute for patch-specific evidence.
- Comprehensive in-engine seasonal, recruitment, post-capture defence, and guardian-combat acceptance; inspect the dated record for the exact scope of any completed engine test.
- Human task studies and actual multiplayer playtests, plus investigation of the seed-corpus quality misses.
- Native-game acceptance, hosted deployment, and a separately built/tested Windows release for this round. The source merge is complete, not a release-readiness claim.

The general illustrated asset-pack specification also remains a future contract, not a delivered pack-import system. New editing metadata is optional, but older apps can reject projects containing it; retain pre-upgrade JSON backups.
