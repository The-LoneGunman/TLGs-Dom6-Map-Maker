# September 2026 bugfix review

Historical review performed on 2026-09-05 against public release v0.1.2. Three independent sub-agents audited generation/fairness, persistence/export/install, and editor interactions; the primary agent implemented and tested the repairs. This record predates v0.1.4's combined-terrain artwork/export changes; the results below apply to the repairs reviewed here. See the [user guide](USER_GUIDE.md) for current behavior.

## Confirmed issues repaired

| Area | Failure | Result |
|---|---|---|
| Autosave and JSON | A 4097-character description could save successfully but fail restoration. | The same structural and size limits now apply before edits, autosaves, and JSON/package serialization. Failed edits preserve the previous project. |
| Recovery | Opening an unreadable saved record could replace it with a fresh atlas; repeated Save attempts could lose recovery controls. | Unreadable records pause saving and retain their original bytes and revision tokens. Explicit replacement first downloads recovery data. Ordinary Save never bypasses recovery. |
| Guardian drafts | Empty commander/squad fields were valid editor states but not valid saved drafts. | Incomplete groups can be saved and reopened; gameplay validation still blocks incomplete playable exports. |
| Installer staging | A mistyped output directory could recursively erase source, runtime, or an existing build. | Staging never clears a directory and refuses every existing destination before copying. Tests cover source/runtime/build paths and Windows case aliases. |
| Catalog fields | Focusing and leaving an unchanged field created history and stripped generated cave-start provenance. | Unchanged catalog values create no project mutation. |
| Text and number entry | Guardian items lost spaces/newlines; typing 16 players could become 26 through early minimum clamping. | Local input drafts preserve incomplete keystrokes; valid values update the project and numbers normalize on blur. |
| Undo/Redo | Focusing a range control could clear Redo without changing a value. | Only an actual edit clears Redo. |
| Bonus-plane generation | Earlier sizing callbacks and stale generated sizes affected later planes, changing repeated results. | A frozen plan determines all bonus-plane start capacity before any target changes. Repeat and deliberately stale-history regressions agree. |
| Start categories | Cached Land/Other labels could disagree with edited terrain and produce conflicting fairness/validation results. | Both use the current terrain, realm family, and traversable neighbors. |
| Underworld ownership | Generating a valid imported solid Underworld produced connections inconsistent with its geometry. | Generate converts it to the supported Styx chamber/corridor geometry and explains the normalization. Import alone preserves authored data. |
| Windows CI | Calling a batch launcher without `call` skipped the later preparation and smoke commands. | Every launcher phase returns to CI and its exit status is checked. |
| Dependencies | The locked graph reported four high and one moderate vulnerable packages. | Compatible Vinext beta.8 and patched transitive dependencies remove all five; CI and releases now audit the complete locked graph. |

## Verification

- Production build; 13 installer/render tests and 281 TypeScript tests: **294 passed**.
- TypeScript, ESLint, dependency notices, and Git whitespace checks passed.
- Production HTTP server and launcher smoke tests passed.
- Full `npm audit`: **0 vulnerabilities** on 2026-09-05.
- Independent rechecks covered all reported reproductions; no remaining blocker was found in that scope.

These are bounded source, component-event, generation, file-driver, and HTTP checks. This review did not repeat a live Dominions play session or an assistive-technology/touch-device test. Earlier engine-load evidence remains in the [August record](FULL_AUDIT_2026-08-11.md); it is not new playtest evidence for this patch.

The dependency change removed `image-size` from the framework dependency graph. Its upstream [ICNS advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) listed no patched package at the review date; removing the dependency closed this application's affected chain without an override or forced downgrade.
