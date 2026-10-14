# October 14 audit repairs

Prepared on `codex/october-audit-repairs`, based on merged `11a4ede` (PR #14). Package version remains 0.1.5. The application fixes pass local checks, but the remaining upstream dependency advisory blocks a clean security gate and merge. No hosted deployment, Windows release or native-game acceptance is claimed.

## Corrections

- The export dialog detects secure folder access and cross-tab locking. Unsupported browsers no longer recommend direct installation or send users back to a memory-blocked ZIP. Editable JSON remains available for moving a project to a supported browser.
- Memory-blocked ZIPs offer **Reduce output resolution to fit ZIP** only when smaller plane dimensions pass both the existing ZIP ceiling and map validation. The edit preserves province content, starts, connections and aspect ratios, respects layout locks and minimum dimensions, and is restored by one Undo. No geography regeneration or weakened export checks are involved.
- Newly generated names collapse adjacent repeated words before uniqueness and reserved-capital checks. The reported `Mourning Mourning Bank` case becomes `Mourning Bank`. Loading saved maps and preserving manual or name-locked provinces do not silently rename them.
- README, the documentation index and multiplayer status now record the merged September 23 island-start repairs and the later 1,000-map corpus accurately. The user guide explains the new export recovery option and its limits.
- Compatible transitive dependency updates and scoped Miniflare overrides select `sharp` 0.35.5 and `undici` 7.29.1. Third-party notices were regenerated. Framework versions and CI security requirements are unchanged.

## Verification

| Check | Result |
| --- | --- |
| Full local suite with production build | **1,132 passed:** 14 integration + 1,118 TypeScript |
| Type checking, lint, third-party notices | Passed |
| Launcher self-test and local-server smoke test | Passed |
| Frozen generation compatibility | All five fixtures retained identical complete output, including geography, content and names |
| New naming regression matrix | Adjacent-repeat removal, determinism, uniqueness and manual/locked preservation across all realm kinds and terrain variants passed |
| Export fallback tests | Unsupported capabilities, two/eight-plane illustrated sizing, portrait/minimum-size planes, source immutability, layout locks and validation guards passed |
| Real browser use | Two-plane illustrated ZIP blocked at 4K; explicit reduction to 1920×1080 enabled both ZIP buttons; Undo/Redo restored/reapplied dimensions without changing 125 provinces; 390-pixel-wide dialog remained usable; no browser warnings/errors |
| Dependency audit | Production tree: 0 findings. Full tree: 7 high entries, all arising from the single unresolved `braces` advisory below |

The browser check used synthetic data at a separate local address. It did not install files into Dominions or alter game saves. Unsupported-browser behavior was tested with explicit capability fixtures; the interactive browser supported direct folder access.

The October 14 baseline audit also reran 128 structural corpus cases: no export errors or generation exceptions and 40 experimental quality misses. This was not a new 1,000-map run. The [September 23 record](AUDIT_ISLAND_REPAIRS_2026-09-23.md) remains the full-corpus evidence: 997 export-valid maps, three constrained continental cases and 328 experimental quality misses.

## Remaining security blocker

[`GHSA-vfj7-8cjw-p6xm`](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) reports stack exhaustion from deeply nested patterns in `braces` through 3.0.3; no patched upstream release was available when checked. It is a transitive build/lint dependency, not a player runtime dependency. The seven audit entries describe that dependency and its affected parents, not seven independent vulnerabilities.

The release workflow still runs `npm audit --audit-level=high` without exceptions. A reviewed local patch would introduce an ongoing maintenance obligation; approval for that approach is pending. Until a tested patch or upstream fix resolves it, the branch must not be represented as release-ready or security-clean.

Fresh native visual acceptance of the latest contours/rivers and multiplayer playtesting remain separate from these fixes. Hosted deployment and installer publication are also separate actions.
