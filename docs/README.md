# Documentation index

Current source documentation reviewed September 20, 2026. See the root [versions and documentation table](../README.md#versions-and-documentation) before assuming a hosted or installed build contains every source feature. Merging `main`, deploying the hosted GUI, and publishing a Windows release are separate actions.

## Current references

- [User guide](USER_GUIDE.md): installation, generation options, manual editing, recovery, export, and troubleshooting.
- [Multiplayer implementation status](MULTIPLAYER_IMPLEMENTATION_STATUS.md): available controls and work that is still planned.
- [Content catalog](CONTENT_CATALOG.md): pinned Dominions 6.35 data, numeric IDs, and patch/provenance limits.
- [Artwork implementation and future asset-pack contract](ILLUSTRATED_ASSET_SPEC.md): what the renderer does now versus future requirements.
- [Artwork provenance](ASSET_PROVENANCE.md): bundled textures/backdrops and their licenses.
- [September 20 repair verification](REPAIR_VERIFICATION_2026-09-20.md): nine corrected findings, regression/browser results, and outstanding in-engine verification.

## Dated evidence and proposals

These records preserve the conditions and evidence at the stated revision/date. They are not a live defect list, a promise of feature delivery, or proof of compatibility with later game patches.

| Record | Role |
| --- | --- |
| [September 20 adversarial review](ADVERSARIAL_REVIEW_2026-09-20.md) | Original reproductions at `c0ab14a`; the companion repair report records their corrections. |
| [September 19 repairs](AUDIT_FIXES_2026-09-19.md) | Generation, editing, import, installation, and analysis safety changes. |
| [September 6 mapmaker research](MULTIPLAYER_MAPMAKER_RESEARCH_2026-09-06.md) | Comparative research and proposed targets; use implementation status for what exists now. |
| [September 5 bugfix review](BUGFIX_AUDIT_2026-09-05.md) | Earlier recovery, input, installer, generation, and dependency repairs. |
| [August audit and remediation](FULL_AUDIT_2026-08-11.md) | Historical findings, fixes, and engine-load observations for older snapshots. |
| [August playtests](PLAYTEST_NOTES.md) | Historical seed corpora, browser observations, and follow-up ideas. |

The latest repair pass does **not** confirm actual Dominions 6.37 game loading, seasonal visuals, guardian combat, post-capture defence, recruitment, or multiplayer balance. Older engine-load observations do not certify the current source. Raw directives, custom catalogs/mods, and advanced battle assets require host verification as explained in the user guide.
