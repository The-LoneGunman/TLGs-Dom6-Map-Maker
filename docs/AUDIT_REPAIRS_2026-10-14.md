# October 14 audit repairs

Prepared on `codex/october-audit-repairs`, based on merged `11a4ede` (PR #14), for [PR #15](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/pull/15). Package version remains 0.1.5. The application fixes and approved local dependency patch pass the local release checks. No hosted deployment, Windows release or native-game acceptance is claimed.

## Corrections

- The export dialog detects secure folder access and cross-tab locking. Unsupported browsers no longer recommend direct installation or send users back to a memory-blocked ZIP. Editable JSON remains available for moving a project to a supported browser.
- Memory-blocked ZIPs offer **Reduce output resolution to fit ZIP** only when smaller plane dimensions pass both the existing ZIP ceiling and map validation. The edit preserves province content, starts, connections and aspect ratios, respects layout locks and minimum dimensions, and is restored by one Undo. No geography regeneration or weakened export checks are involved.
- Newly generated names collapse adjacent repeated words before uniqueness and reserved-capital checks. The reported `Mourning Mourning Bank` case becomes `Mourning Bank`. Loading saved maps and preserving manual or name-locked provinces do not silently rename them.
- README, the documentation index and multiplayer status now record the merged September 23 island-start repairs and the later 1,000-map corpus accurately. The user guide explains the new export recovery option and its limits.
- Compatible transitive dependency updates and scoped Miniflare overrides select `sharp` 0.35.5 and `undici` 7.29.1. The approved [local braces fork](../vendor/braces/README.md) bounds recursive nesting; all consumers resolve to that reviewed copy. Third-party notices retain its MIT license and identify the local version explicitly. Framework versions and the audit threshold are unchanged; CI adds mandatory patch regression checks.

## Verification

| Check | Result |
| --- | --- |
| Full local suite with production build | **1,141 passed:** 14 integration + 9 dependency-security + 1,118 TypeScript |
| Type checking, lint, third-party notices | Passed |
| Launcher self-test and local-server smoke test | Passed |
| Frozen generation compatibility | All five fixtures retained identical complete output, including geography, content and names |
| New naming regression matrix | Adjacent-repeat removal, determinism, uniqueness and manual/locked preservation across all realm kinds and terrain variants passed |
| Export fallback tests | Unsupported capabilities, two/eight-plane illustrated sizing, portrait/minimum-size planes, source immutability, layout locks and validation guards passed |
| Real browser use | Two-plane illustrated ZIP blocked at 4K; explicit reduction to 1920×1080 enabled both ZIP buttons; Undo/Redo restored/reapplied dimensions without changing 125 provinces; 390-pixel-wide dialog remained usable; no browser warnings/errors |
| Dependency audit | Full and production-only registry audits: **0 findings** after a clean locked installation; the local fork is separately covered by mandatory security tests |
| Local dependency patch | 9 tests pass, including 328 upstream compatibility cases, 128/129-level boundaries, 4,000-level hostile input, direct/cyclic ASTs, actual dependency resolution, provenance and license checks |

The browser check used synthetic data at a separate local address. It did not install files into Dominions or alter game saves. Unsupported-browser behavior was tested with explicit capability fixtures; the interactive browser supported direct folder access.

The October 14 baseline audit also reran 128 structural corpus cases: no export errors or generation exceptions and 40 experimental quality misses. This was not a new 1,000-map run. The [September 23 record](AUDIT_ISLAND_REPAIRS_2026-09-23.md) remains the full-corpus evidence: 997 export-valid maps, three constrained continental cases and 328 experimental quality misses.

## Local dependency security patch

[`GHSA-vfj7-8cjw-p6xm`](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) reports stack exhaustion from deeply nested patterns in `braces` through 3.0.3; no patched upstream release was available when checked. It is a build/lint dependency, not a player runtime dependency. The earlier seven audit entries described that dependency and its affected parents, not seven independent vulnerabilities.

The approved `@pantokrator-atlas/braces` 3.0.3-atlas.1 fork preserves the upstream API and MIT license while limiting brace/parenthesis nesting and AST traversal to 128 levels. Deep inputs fail with a controlled diagnostic; ordinary parsing/expansion remains identical across the compatibility corpus. The release workflow still runs `npm audit --audit-level=high` without exceptions and now also verifies the local patch before that audit. Registry audits do not independently assess private forks, so both checks are required.

The [patch notes](../vendor/braces/README.md) record source integrity, scope, testing and removal criteria. Review upstream advisories when dependencies change, and replace the fork with a verified upstream fix when available. No audit allowlist, postinstall source mutation or fabricated upstream release is used.

Fresh native visual acceptance of the latest contours/rivers and multiplayer playtesting remain separate from these fixes. Hosted deployment and installer publication are also separate actions.
