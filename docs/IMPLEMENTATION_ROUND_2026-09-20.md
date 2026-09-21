# Full implementation round — work log

Branch: `codex/full-implementation-round-sep20`, starting at `958e545`.

## Non-regression contract

- Existing settings, seeded generation, map/project exports, start protections, Styx crossings, gateways, recovery, and installation remain supported.
- New controls are opt-in; default generation must match frozen pre-change fixtures.
- Bulk and scoped edits preview their affected provinces, respect locks, and commit as one Undoable change. Failed, cancelled, or stale work must not replace the project.
- Optional metadata is bounded and validated. Existing schema-v1 projects remain readable; keep exact JSON backups for older app versions.
- Unknown game/mod assumptions remain explicit. No nation tiers, automatic compensation, or claimed battle/economic calibration without evidence.
- Native map inspection begins read-only; unsupported formats and directives must be reported instead of silently converted into a different map.

## Implemented in this development branch

- **Iterate:** role/terrain/effective-flag/name/region selection; named selections; five field-lock groups; layout/start locks; batch previews; selected name/economy/site/guardian rerolls; settings recipes; cancellable two/three-candidate comparisons with per-plane previews and structural spread.
- **Plane preferences:** inherited-by-default water/cave-water, dry-terrain weights, normalized rectangular regions, eligible road/river/pass shares, guarded-province coverage, troop-count multiplier, and many-sites frequency. Current achieved counts remain separate from requested settings. Styx geometry and safe starts take priority.
- **Diagnostics:** fractional two-step opportunity, hostile frontier groups, shared direct surroundings, nearest ally, separate fixed/preferred throne distances, and patch/mod-bound host terrain requirements. Requirements are check-only, not nation tiers or automatic bonuses.
- **Interoperability:** bounded read-only native inventories and D6M checks; player packages without host dossiers; separate background-generated guardian test fixtures. Native files remain inspectable, so player handoffs are not secrecy protection.
- **Documentation:** README, guide, and implementation status distinguish development, merged source, hosted app, and installer versions.

## Review corrections

Interactive testing exposed an existing deferred-state Undo/Redo bug: the history callback read the mutable current-project reference after it had already changed. Both handlers now capture the outgoing snapshot before scheduling updates. A production-callback regression and browser Undo/Redo verification cover it.

Other corrections include mobile checkbox widths, cross-field lock protection during cave-wall conversion, gateway-aware capital rings, strict stale lock selections, locked raw guardian/throne protection, active-catalog fixture/report validation, native-inspection and fixture-result races, stricter recipe/parser bounds, and explicit preference handling during scoped rerolls. Unusual guardian terrain is adapted only at a safe fixture target and disclosed before download.

Three independent sub-agents reviewed iteration safeguards, interoperability, and documentation. Their tests include 253 fixture combinations spanning every plane kind, variant, and dry/flooded target, plus sparse Custom cave-water targets.

## Scripted verification

The consolidated final suite passed **418 tests** (14 build/integration tests and 404 TypeScript tests) after the independent-review corrections. Type checking, lint, license verification, and whitespace checks pass. Build warnings about the existing large client chunk and vinext route classification remain; no bundle-performance improvement is claimed.

Five pre-round generation digests still match exactly when optional controls are unused:

| Fixture | SHA-256 (timestamps omitted) |
| --- | --- |
| Default | `bb6c7ae62970a8d44f42f82d6db7916b0984e3341dd82327b0aba120c2389da9` |
| Island chains / mixed starts | `f6e25c37740bd78b4fc803bffb89b75d7d925a36319fba56253e85543a092448` |
| Multiple continents | `e50ec3e83bef10a045f420b3405b59cf6e688ca4b7f5214221d2d3530b1cda4e` |
| Caves / split starts | `0dc98413c68b84b539b1f15a607aecb25e9e15ff99ac0d52b8d12c8ab1e3b207` |
| Eight planes | `6641d34face10d4c505b6456589cc6fcbfffff6fa76609eda139255eac34eacf` |

### Seed evaluation

Reproduce with:

```powershell
npx.cmd tsx scripts/evaluate-generation.ts --count 1000 --output tmp/generation-evaluation.json
```

Corpus `atlas-evaluation-v1` covers eight profiles, 125 maps each; 4/6 players, 16 provinces/player, topology/economy modes, wrapping, mixed starts, and inherited/explicit controls. Indices 0–799 are the fixed set; 800–999 are held out. The held-out set was not used to tune the generator. This is not exhaustive coverage of every option combination, maximum map size, or nation.

Both the initial and final post-review runs completed **1,000 maps, zero export-error maps, zero exceptions, and 243 experimental-quality misses**. No map shared directly connected capital surroundings. The held-out set had 48 misses among 200 maps. The final local artifact is `tmp/generation-evaluation-sep20-final.json`; rerun the command above for a fresh report.

| Profile | Quality misses / 125 |
| --- | --- |
| FFA | 13 |
| Multiple continents | 43 |
| Island chains | 24 |
| Caves | 31 |
| Bonus realms | 16 |
| Inland sea | 30 |
| Team annotations | 55 |
| Cave/naval | 31 |

A miss means two-step CV exceeded 15%/was unavailable, shared direct surroundings existed, or nearest-rival distance spread exceeded one hop. These are experimental targets, not community standards; the same neutral targets are diagnostic rather than validated for team/naval profiles. Team annotations are assigned after generation, not by a new team-placement optimizer. The proposed 99% quality target is **not met**. Correctness and quality are separate; zero errors is not a claim of balanced gameplay.

## Actual browser use

The production build was exercised on an isolated `localhost:3017` browser origin, leaving the pre-existing `127.0.0.1:3017` autosave untouched. Checks included:

- Named-region creation, terrain field lock/unlock, zero-change disabled previews, batch terrain edits, Undo and Redo.
- Layout lock, successful background candidates, immediate cancellation, unchanged current map, and content-only name reroll.
- Two-plane candidate comparison, selecting the 29-province Underworld preview while the current Underworld remained a zero-province draft, explicit candidate replacement, and Undo restoring that draft plan.
- Recipe preview/application without rebuilding current geography; malformed JSON rejection.
- Current native-text inventory; separate guardian fixture preparation and JSON download.
- Invalid route totals rejected with the previous input restored; valid terrain/route/region preferences staged, then generated through the existing replacement confirmation. The observed 96-province map had 29 water provinces for a 30% preference, and 26 forest-flagged provinces after the regional bias.
- Nation requirements changing from unassigned to unverified when the declared patch changes.
- Desktop and 390×844 layouts. The corrected mobile view has document width equal to viewport width, with readable checkbox labels. Temporary viewport override was reset.
- Player ZIP download through the actual export dialog. The browser event monitor timed out, but the downloaded 33,196,918-byte file was independently found and checked: all CRCs valid, exactly `.map`, `.d6m`, and `PLAYER_README.txt`, a valid 96-province native raster, and no host dossiers. No captured browser console errors.

## Dominions 6.37 acceptance boundary

The user authorized a visible test. Two fresh native packages were built in an isolated temporary directory: an eight-plane, 267-province atlas using new controls and a two-player guardian fixture. Their native binaries and map validation passed before launch. Configuration, map, and save paths were redirected to the test directory; no existing save was selected or replaced.

The installed game opened a black window before a usable menu. Both its normal and documented simple rendering paths showed this behavior; it also persisted with an **empty test-map directory and no Atlas map selected**. Logs identify OpenGL initialization but do not establish a successful game load. The user has been asked whether the visible desktop shows the same black window. This is **not a passed in-engine test**. No current-source seasonal, recruitment, post-capture defence, or guardian-combat acceptance is claimed.

The installed engine's `--listnations` output lists 103 playable nation IDs; all are present in the bundled catalog. Name/subtitle comparison found only surrounding quotation marks on Nidavangr's subtitle in the catalog. This spot check does not verify unit data, movement, recruitment, combat, or the entire 6.37 ruleset; the catalog remains labeled 6.35.

## Release gate and unfinished roadmap

This round is not merged, pushed, deployed, or packaged as a new Windows release. Resolve native acceptance before calling it release-ready. Full lossless external editable import, calibrated movement/economy/combat, verified automatic nation accommodations, measured human usability studies, multiplayer playtests, quality-target tuning, and the general artwork-pack importer remain unfinished. See [implementation status](MULTIPLAYER_IMPLEMENTATION_STATUS.md).
