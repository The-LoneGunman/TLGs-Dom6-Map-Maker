# Documentation index

Documentation for source whose package version remains **0.1.5**, reviewed September 21, 2026. Post-release work is explicitly marked **unreleased development**. See the root [versions and documentation table](../README.md#versions-and-documentation) before assuming a hosted build or installer contains these controls. Merging, deploying the hosted GUI, and publishing a Windows release are separate actions.

This development checkout additionally documents automatic **Connected regions & passages** for sparse realms, with no classic selector, plus procedural Cloud/Air artwork in the editor and PNG preview. Native packages remain `.map`/`.d6m`; the preview artwork is not embedded. The published 0.1.5 build still uses the earlier layouts and previews.

## Current references

- [User guide](USER_GUIDE.md): installation, generation, safe iteration, inspection, recovery, host/player export, and troubleshooting.
- [0.1.5 release verification](RELEASE_VERIFICATION_0.1.5.md): completed checks, remaining limits, and delivery status.
- [Multiplayer implementation status](MULTIPLAYER_IMPLEMENTATION_STATUS.md): available controls and work that is still planned.
- [Content catalog](CONTENT_CATALOG.md): pinned Dominions 6.37 selector data, separate recruitment membership, numeric IDs, and provenance limits.
- [Population-defender acceptance](research/NATIVE_POPULATION_DEFENDERS_2026-09-21.md): 76 opt-in v3 templates, 161 accepted terrain cases, excluded populations and evidence limits.
- [Recruitment-table evidence and extraction](research/POPULATION_RECRUITMENT_TABLE_2026-09-21.md): 82 static population rosters; membership is separate from defender-template acceptance.
- [Artwork implementation and future asset-pack contract](ILLUSTRATED_ASSET_SPEC.md): what the renderer does now versus future requirements.
- [Artwork provenance](ASSET_PROVENANCE.md): bundled textures/backdrops and their licenses.

## Dated evidence and proposals

These records preserve the conditions and evidence at the stated revision/date. They are not a live defect list, a promise of feature delivery, or proof of compatibility with later game patches.

| Record | Role |
| --- | --- |
| [September 21 connected-region verification](CONNECTED_REGIONS_2026-09-21.md) | Unreleased adjacent-region layout, compatibility safeguards, automated checks and browser/native visual acceptance. |
| [September 21 cave and sky-layout references](research/NATURAL_CAVERN_REFERENCES_2026-09-21.md) | Creator-map and official references; layout motifs only, no copied artwork. |
| [Sky-realm rendering options](research/SKY_RENDERING_OPTIONS_2026-09-21.md) | Editor/PNG sky art, native protocol results, and the boundary between a successful loading diagnostic and a supported exporter. |
| [Custom-map artwork parity](research/ILLUSTRATED_MAP_PARITY_2026-09-21.md) | Creator/source comparisons, current native payload gaps, feasible export directions, and in-game acceptance criteria. |
| [September 21 underground and population work](UNDERGROUND_POLISH_2026-09-21.md) | Shape/relief changes, the initial v2 checkpoint, and later v3 verification; historical observations are labelled. |
| [September 21 native guardian capture](research/NATIVE_GUARDIAN_CAPTURE_2026-09-21.md) | One generated Inferno encounter tested through battle, capture, completed recruitment and PD inspection; not universal balance/PD proof. |
| [September 20 implementation round](IMPLEMENTATION_ROUND_2026-09-20.md) | Implementation-stage tests, seed evaluation and browser observations before later native checks. |
| [September 20 repair verification](REPAIR_VERIFICATION_2026-09-20.md) | Nine corrected findings and that snapshot's automated/browser results. |
| [September 20 adversarial review](ADVERSARIAL_REVIEW_2026-09-20.md) | Original reproductions at `c0ab14a`; the companion repair report records their corrections. |
| [September 19 repairs](AUDIT_FIXES_2026-09-19.md) | Generation, editing, import, installation, and analysis safety changes. |
| [September 6 mapmaker research](MULTIPLAYER_MAPMAKER_RESEARCH_2026-09-06.md) | Comparative research and proposed targets; use implementation status for what exists now. |
| [September 5 bugfix review](BUGFIX_AUDIT_2026-09-05.md) | Earlier recovery, input, installer, generation, and dependency repairs. |
| [August audit and remediation](FULL_AUDIT_2026-08-11.md) | Historical findings, fixes, and engine-load observations for older snapshots. |
| [August playtests](PLAYTEST_NOTES.md) | Historical seed corpora, browser observations, and follow-up ideas. |

The older records' blocked or incomplete native checks are historical, not current release status. Later checks establish the specific loading, template and guardian-capture results linked above; they do not establish every seasonal visual, PD roster or multiplayer matchup. Raw directives, custom catalogs/mods, and advanced battle assets still require host verification as explained in the user guide.
