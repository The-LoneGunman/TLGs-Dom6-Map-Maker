# Documentation index

Reviewed September 23, 2026 against merged `main` at **`59a72ff`** and the separately tested [island-start audit repair branch](AUDIT_ISLAND_REPAIRS_2026-09-23.md). The package version remains **0.1.5**. Dated records identify the branch or commit tested; unreleased source is not proof of publication. See the root [version table](../README.md#versions-and-documentation): source merges, hosted deployments and Windows releases are separate actions.

## Current source checkpoint

| Edition / evidence | Verified state |
| --- | --- |
| Merged source | [`59a72ff`, PR #13](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/pull/13), including connected/illustrated realms, the review round, small-Underworld borders, launcher reuse and import caps. [Main CI](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/actions/runs/35803359934) passed; its Windows job covered launcher/server checks, not the full TypeScript suite. |
| Locally tested repair branch | **1,123 passing tests** (14 integration + 1,109 TypeScript), including the Windows bundle-test fix, numeric Undo and island-start regressions. See the [September 23 repair record](AUDIT_ISLAND_REPAIRS_2026-09-23.md) for branch, corpus results and remaining limits. This does not claim a merge or CI run. |
| Hosted / Windows | Rechecked September 22: Site version 13 and Windows v0.1.5 still use `581b2b8`. Their [743-test release record](RELEASE_VERIFICATION_0.1.5.md) is separate from current source testing. |

Post-release source includes automatic **Connected regions & passages** without the classic selector; procedural realm artwork and optional playable **Illustrated realms** export; distinct coastal, ocean, lake and realm contours; connected border rivers; 58% default biome cohesion with modest temperate variation; and cave-wall/mixed-terrain safety repairs. **Native scenery** remains the default. See the user guide for controls and the dated records below for evidence.

Latest-generation shape changes require **Generate**; loading, exporting and content rerolls preserve saved natural-landform provenance. The earlier Cloud/Air renderer refinement can update compatible saved sky outlines without regenerating their graph. See [Province layout](USER_GUIDE.md#province-layout) for these distinct compatibility rules.

Remaining acceptance includes an in-game visual pass for the latest sky/natural contours, connected rivers and mixed Sea + Cave Wall terrain, and multiplayer playtesting. Earlier illustrated artwork was loaded and visually checked in Dominions 6.37, but those observations predate these refinements. The repair branch reran 1,000 structural cases: all 125 island cases passed, while three unchanged continental capacity limits remained export-blocked; see [implementation status](MULTIPLAYER_IMPLEMENTATION_STATUS.md#verification-and-remaining-work). Hosted deployment and a new installer also remain separate work.

## Current references

- [User guide](USER_GUIDE.md): installation, generation, safe iteration, inspection, recovery, host/player export, and troubleshooting.
- [0.1.5 release verification](RELEASE_VERIFICATION_0.1.5.md): completed checks, remaining limits, and delivery status.
- [Multiplayer implementation status](MULTIPLAYER_IMPLEMENTATION_STATUS.md): available controls and work that is still planned.
- [Content catalog](CONTENT_CATALOG.md): pinned Dominions 6.37 selector data, separate recruitment membership, numeric IDs, and provenance limits.
- [Population-defender acceptance](research/NATIVE_POPULATION_DEFENDERS_2026-09-21.md): 76 opt-in v3 templates, 161 accepted terrain cases, excluded populations and evidence limits.
- [Recruitment-table evidence and extraction](research/POPULATION_RECRUITMENT_TABLE_2026-09-21.md): 82 static population rosters; membership is separate from defender-template acceptance.
- [Artwork implementation and future asset-pack contract](ILLUSTRATED_ASSET_SPEC.md): what the renderer does now versus future requirements.
- [Artwork provenance](ASSET_PROVENANCE.md): bundled textures/backdrops and their licenses.
- [Illustrated export](ILLUSTRATED_EXPORT_2026-09-22.md): unreleased playable artwork, installation safeguards, numbering differences, native-game evidence and remaining verification limits.

## Dated evidence and proposals

These records preserve the conditions and evidence at the stated revision/date. They are not a live defect list, a promise of feature delivery, or proof of compatibility with later game patches.

| Record | Role |
| --- | --- |
| [September 23 audit repairs](AUDIT_ISLAND_REPAIRS_2026-09-23.md) | Island-start-aware generation, Windows test portability, single-step numeric Undo, accurate installer instructions, and local 1,000-map verification. |
| [September 22 review round](REVIEW_ROUND_2026-09-22.md) | Unreleased defect repairs, natural-water / authored-start / budget / strategic-river / Underworld-border generation fixes, the usability pass and measured performance and memory changes (PR #12). |
| [September 22 natural landforms](NATURAL_LANDFORMS_2026-09-22.md) | Unreleased shared province curves, natural ocean/basin layouts, realm-specific contours and saved-map compatibility. |
| [September 22 connected border rivers](CONNECTED_BORDER_RIVERS_2026-09-22.md) | Unreleased continuous river routing, safe bridge crossings, geographic constraints and verification evidence. |
| [September 22 terrain-edit repairs](TERRAIN_EDIT_REPAIRS_2026-09-22.md) | Unreleased cave-wall cleanup, blocked-content export checks, mixed-terrain relief corrections and verification scope. |
| [September 21 connected-region verification](CONNECTED_REGIONS_2026-09-21.md) | Unreleased adjacent-region layout, compatibility safeguards, automated checks and browser/native visual acceptance. |
| [September 22 illustrated export](ILLUSTRATED_EXPORT_2026-09-22.md) | Playable custom-image implementation, eight-plane loading/connectivity evidence, Cloud visual acceptance and safe delivery. |
| [September 21 procedural realm artwork](REALM_ARTWORK_2026-09-21.md) | Earlier editor/PNG checkpoint, rendering invariants and dated tests; its preview-only export boundary is superseded by September 22. |
| [September 21 cave and sky-layout references](research/NATURAL_CAVERN_REFERENCES_2026-09-21.md) | Creator-map and official references; layout motifs only, no copied artwork. |
| [Sky-realm rendering options](research/SKY_RENDERING_OPTIONS_2026-09-21.md) | Editor/PNG sky art, native protocol results, and the boundary between a successful loading diagnostic and a supported exporter. |
| [Custom-map artwork parity](research/ILLUSTRATED_MAP_PARITY_2026-09-21.md) | Creator/source comparisons, September 21 payload gaps, feasible export directions and in-game acceptance criteria. |
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
