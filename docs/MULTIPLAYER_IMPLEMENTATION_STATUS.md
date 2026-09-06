# Multiplayer workbench implementation

Branch: `codex/multiplayer-workbench`. Release scope: first-stage public-app update; not a Windows installer release. Later roadmap stages remain in development.

This tracks the approved [comparative-research roadmap](MULTIPLAYER_MAPMAKER_RESEARCH_2026-09-06.md). Approval is not evidence that every stage has shipped. Nation-specific compensation remains disabled; selector catalogs are not balance rulesets.

## Implemented in this branch

- Stage 1: scope labels for shared controls and mixed-behavior exceptions; pending generation inputs; current/planned province budgets; clearer descriptive-biome and initial-guardian wording.
- Stage 1: per-start structural breakdown, all seven legacy subscores, explicit validity/confidence distinctions, unknown economy and combat data, versioned analysis assumptions, saved user-declared patch/mod notes.
- Early Stage 2: cross-plane province search and editor-only two-step region overlays. Navigation cancels armed editing tools; stale overlays disappear after project edits.
- Early Stage 3: conservative dry/water graph filtering, team-label-aware competition, and per-start throne/realm-entrance distances. These are graph diagnostics, not validated game-movement or combat models.
- Host reports include both structural access views and quoted patch/mod assumptions. Playable map directives and native artwork formats are unchanged.

## Remaining approved work

- Safer iteration: batch edits, authored-field locks, constrained rerolls, candidate comparison, and settings-only recipes.
- Opportunity analysis: calibrated movement profiles, separate income/resources/recruitment estimates, richer team exposure and objective comparisons.
- Richer generation: regional planning; granular terrain, route and ocean controls; guardian/reward profiles; explicitly optional and patch-validated nation accommodations.
- Interoperability: external-map inspection/import, differentiated player handoffs, and isolated guardian test scenarios.
- Release evaluation: held-out seed corpus, the proposed 1,000-seed quality evaluation, in-engine checks, multiplayer playtests, and measured user-task studies. The research targets are not achieved performance claims.

## Verification boundary

The first implementation leaves generation policies and random sequences unchanged. Four pre-change fixtures (default, mixed core/bonus, island-chain mixed starts, and manual/automatic sizing) retain identical generated-map digests. Regression tests cover budget/generation agreement, input provenance, metadata import safety, terrain/media filters, teams, unknown values, large/empty start sets, navigation wiring, and accessible server-rendered panels.

The full regression run passed 319 tests (14 build/integration checks and 305 TypeScript tests). Type checking, lint, license verification, and whitespace checks also passed. The build retains its existing large-client-chunk warning; no bundle-performance claim is implied.

Interactive local browser checks covered the default desktop and a 390×844 viewport: switching access models; start-region navigation; search with the Start tool armed; future-patch warnings and Undo; budget changes without regeneration; draft-plane handling; keyboard focus into native disclosure controls; and horizontal table scrolling. No browser errors were logged. Testing found and fixed toolbar overlap and a header disappearing after switching from a scrolled mobile layout back to desktop. The new label scopes use explicit props instead of shared React context to avoid a development-renderer warning. The original map/settings were restored, and the temporary viewport override was reset.

These checks do not substitute for Dominions playtests, full movement calibration, or user studies. No nation has been assigned a strength tier or silently compensated. New project metadata is optional for current imports, but older releases may reject it; retain older backups when testing upgrades.
