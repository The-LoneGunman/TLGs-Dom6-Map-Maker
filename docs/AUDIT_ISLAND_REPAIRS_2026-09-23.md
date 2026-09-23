# September 23 audit repairs

Prepared on `codex/audit-island-start-repairs-sep23`, based on `59a72ff` (PR #13). This is local source verification, not a merge, hosted deployment, installer publication, or native-game acceptance record. Package version remains 0.1.5.

## Corrections

- Bundle-boundary tests normalize filesystem separators and resolve files rather than stopping at directory imports. The Windows workflow now runs the bundle, numeric-input, and history checks as well as launcher checks.
- Numeric blur commits participate in the existing text-edit session. Entering `12`, then `120`, and leaving a Players field initially set to 6 clamps to 32; one Undo now restores 6 and Redo restores 32.
- README and installer instructions identify running-instance reuse as source-only. Published Windows v0.1.5 can still launch a second server at another address with separate browser storage.
- Island generation checks for a complete inland/coastal/water start assignment before accepting its geography. Where necessary, it reserves inland capital rings and grows separated islands around them while retaining the exact water count and one connected ocean. A bounded deterministic search either supplies safe start anchors or leaves an explicit warning; it never lowers the export spacing/degree requirements or changes the requested categories to claim success.

The island repair applies only during generation. It keeps province counts, centers, movement links, requested settings, and saved-map loading behavior. Already-feasible island geography stays unchanged. Changed land/water provinces receive appropriate terrain, population type, and guardians before normal capital protection and final ownership provenance are applied. Other ocean layouts are not reshaped by this repair.

## Verification

| Check | Result |
| --- | --- |
| Full Windows automated suite | **1,123 passed:** 14 integration + 1,109 TypeScript |
| Build, typecheck, lint, license notices, dependency audit | Passed; 0 dependency vulnerabilities |
| Launcher and local-server smoke checks | Passed |
| Original 128-map regression corpus | **0 export-error maps**, 0 exceptions; formerly 14 island failures |
| Full 1,000-map structural corpus | **997 export-valid maps**, 3 constrained continental cases, 0 exceptions |
| Island subset | **125/125 export-valid**; separate topology checks confirmed one connected ocean and at least three islands |
| Scale/reservation probes | 2, 8, 12, 20, and 32 players, both wrapped and unwrapped, plus a mixed cave/surface atlas with a reserved plane: all passed |
| Package probes | 40 host/player builds across 10 additional realm types and both artwork modes; 16 more builds for four repaired island seeds: all passed |
| Round trips | Host/player playable-file hashes match after JSON reopen; exports preserve source projects |
| Real browser use | Numeric clamp/Undo/Redo; formerly failing six-player island generation; map appearance; start analysis; export readiness |

The final island-topology guard was followed by another 125-case island run; all generated digests matched the corresponding full-corpus outputs. Tests retain the strict continental/inland-sea topology assertions; only the intentionally invalid island snapshots were updated after before/after inspection. The old frozen mixed-island fixture produced 0 inland and 4 coastal starts instead of 2 and 2. The repaired fixture keeps 96 provinces and 46 water provinces, supplies the requested categories, and has no export errors.

Browser testing used a separate local origin and synthetic projects. No user saves were replaced, and no Dominions game or new installer was launched for this round.

## Remaining constraints and evidence limits

The full corpus found three continental layouts whose existing terrain cannot accommodate the requested inland starts at the hard three-connection minimum:

| Corpus index | Requested inland starts | Maximum fitting its existing geography |
| --- | --- | --- |
| 641 | 6 | 5 |
| 665 | 6 | 5 |
| 921 (held-out) | 4 | 3 |

All three reproduce identically on the pre-repair `59a72ff` source. Exhaustive candidate packing established these maxima; they are not new island regressions. They remain export-blocked. A different seed, larger province budget, or more coastal starts is required unless continental shape adaptation is implemented separately. Export validation has not been weakened.

**328/1,000 maps missed experimental quality criteria** (40/128 in the smaller regression run, versus 46 previously). Structural export validity is not a multiplayer-balance certificate. These criteria concern expansion-proxy variation, shared surroundings, and nearest-rival spread, and are not engine/combat calibration. The earlier 243/1,000 historical result describes a different generator snapshot and is not the current rate.

Fresh in-game visual and multiplayer acceptance, hosted deployment, and clean-runner installer packaging/publication remain separate work.

Local diagnostic evidence is retained under `tmp/island-repairs-sep23/`, including `generation-1000.json`, `generation-128.json`, `island-corpus.json`, `continent-check.log`, `scale-matrix.log`, and export logs. The full suite log is `tmp/island-repairs-verified-tests.log`.
