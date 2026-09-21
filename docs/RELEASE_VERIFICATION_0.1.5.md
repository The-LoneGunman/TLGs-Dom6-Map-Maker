# Release verification — 0.1.5

Reviewed September 21, 2026. This record separates source testing from delivery. The work includes the September 20 multiplayer controls, September 21 underground polish, the pinned 6.37 catalog, and opt-in population-matched initial defenders.

## Delivery

At the verification checkpoint, the tested source is on `codex/underground-visual-polish-sep21`. Merge, hosted deployment and Windows release publication are pending; successful local tests alone do not publish a release. Their results will be recorded here after completion.

## Automated and browser checks

- Full `npm test`: **743 passing tests** — 14 production-build/integration tests and 729 TypeScript tests. The suite includes generation, export, editing, persistence, ownership/relief, Styx, safeguards, catalog extraction and every released population-template terrain scope.
- Type checking, lint, third-party license verification, local-server smoke and launcher self-test passed. Installer contract tests also check that the compiler's fallback version matches `package.json`.
- Independent review checked all 76 v3 profiles against source membership, leadership/habitat constraints and the native evidence matrix. The v3 suite freezes the entire revision's data; older v1/v2 profiles remain unchanged.
- Actual browser use covered importing a v2 project without upgrading its revision, explicit adoption of v3, manual Cavemen #84 edits producing the supported eight-troop army, unsupported Troglodytes #44 fallback, and Undo. At a 390×844 viewport, the panel had no horizontal overflow; no browser warnings/errors were captured.
- Existing build notices about the large client chunk and route classification remain. They did not fail production builds or the functional checks.

## Native Dominions 6.37 checks

Tests used newly isolated configuration, maps and saves under workspace temporary storage. They did not replace existing player saves or settings. Native acceptance is scoped to the installed Windows x64 6.37 executable, unmodded Middle Age, not future patches or modded games.

### Recruitment and defenders

- [Static recruitment membership](research/POPULATION_RECRUITMENT_TABLE_2026-09-21.md): 82 population rows, cross-checked against eight native recruitment controls. The optional maintainer extractor is hash-bound and never runs at application startup. No proprietary executable or game artwork is distributed.
- [Ordinary defender batch](research/NATIVE_POPULATION_DEFENDERS_2026-09-21.md): 163 trial cases were created and hosted twice; withholding Onyx Amazons leaves **76 released profiles and 161 accepted terrain cases**. Creation and surviving commander instances were checked; the logs do not establish a complete final troop census or calibrated combat strength.
- [Generated Inferno encounter](research/NATIVE_GUARDIAN_CAPTURE_2026-09-21.md): an actual attack defeated the designated Demonbred/Devil/Imp guardians and captured the province. Lava-born commander and troop recruitment completed; PD was inspected at level 10 and persisted after hosting. This is one functional encounter, not universal PD or replenishment verification.

### Eight-plane appearance and winter

The 267-province `Atlas_EightPlane_A6BNs3` package loaded and all eight authored planes were visually inspected: Surface, Caves, Underworld, Inferno, Abyss, Dreamlands, Cloud Realm and Elemental Expanse. Native Nexus behavior also produced the game's additional Void plane. Observer ownership and revealed terrain were test-only modifications; authored geography and designated guardians were preserved.

Observed features included irregular cave chambers, curved/flared corridors, flooded cave links, the Underworld's cross-map Styx, volcanic terrain, wooded Dreamlands and mountain/cloud islands. This verifies rendering of this fixture, not every possible shape or travel route.

Nine successful native hosts advanced the same game from Spring to **Winter in year 0**, confirmed in the game UI. Surface terrain changed to snow-covered scenery while water remained blue. The Caves and Underworld retained their underground floors, mushrooms and water routes without surface snow. A preceding verbose-debug host exceeded the test harness's 90-second limit during battle processing; it was not counted as a pass. Retrying without verbose battle logging completed all nine turns successfully.

Reproduction references:

- Main map SHA-256: `d10cdf7609db386e23e821d289c56af6ce1711114ebc67cde7146788f9fdf8d4`.
- Isolated local evidence: `tmp/population-native-jJoNTq`, with `winter-quiet-host-1.json` through `winter-quiet-host-9.json` reporting exit 0 and no timeout. Raw logs, saves and game files are deliberately not distributed.
- Geometry and relief details: [underground work record](UNDERGROUND_POLISH_2026-09-21.md).

## Limits retained deliberately

- The population option is off by default, requires explicit patch/era declarations, preserves custom guardians and protected starts, and leaves unsupported contexts to native defenders. Counts are fixed authored choices, not the independent-strength formula or post-capture PD replacements.
- Populations **43, 44, 72, 88, 105 and 106** remain unsupported for automatic armies. Shape changes, special leadership, missing commanders or empty rosters need separate treatment. Other eras, patches and mods are not silently accepted.
- Atlas preview textures/backgrounds are not native D6M artwork. Dominions draws its own scenery; owner-zero underground gaps remain black in-game. The winter check covers the observed fixture, not every terrain/season/temperature combination.
- No full multiplayer campaign, calibrated nation balance, universal recruitment/PD behavior, or every guardian matchup is certified. The earlier structural corpus's quality-target misses remain documented in [implementation status](MULTIPLAYER_IMPLEMENTATION_STATUS.md).
- Hosted and Windows delivery require their separate deployment and clean-runner packaging gates. Installer/portable assets must be verified before calling them released.
