# Pantokrator Atlas audit and remediation record

**Original audit snapshot:** 2026-08-11
**Remediation status updated:** 2026-08-13

This is a historical record, not the current issue tracker. The [documentation index](README.md) links subsequent repairs, including the [September 20 verification](REPAIR_VERIFICATION_2026-09-20.md); use the [user guide](USER_GUIDE.md) for current behavior. Source links and line references below describe historical snapshots and may no longer align with the present tree. August test counts and engine-load observations do not certify the current source or Dominions 6.37.

**Scope:** generation, multiplayer balance, all plane families, UI workflows, accessibility, persistence, project/catalog import, validation, Dominions map compilation, D6M encoding, direct install, ZIP packaging, dependencies, and documentation

**Release decision recorded on 2026-08-13:** **The engineering release blockers found through the original and post-merge audits were resolved and regression-tested. Both a compact package and a representative eight-plane package were accepted by the installed Dominions 6 engine through its scripted new-game path. The eight-plane package contained all eight map/D6M pairs, eight linked gate groups, eight starts, and eight recommended thrones; the engine created its game state and generated underworld files successfully. Extended visual play was classified as an optional follow-up, not an engineering release blocker.**

No P0 catastrophic security issue was found. The original audit found **5 P1 release blockers**, **17 P2 defects or material release risks**, and several P3 hardening and polish items. This document preserves their original evidence and reproductions for traceability; those historical descriptions are not a statement that every item remains present in the current tree.

## Remediation status as of 2026-08-13

| Original finding | August disposition |
|---|---|
| P1-1 staged-plane restore | **Resolved.** Schema-v1 import round-trips intentionally empty planned planes while validation keeps them out of playable export until generation. |
| P1-2 province-array/D6M mismatch | **Resolved.** Import rejects arrays that are not stored in local province-number order, and D6M encoding rechecks this invariant. |
| P1-3 debounce-window loss | **Resolved for the normal workflow.** The header exposes Saving/Saved states, the delay is 200 ms, and **Save now** provides an explicit durability boundary. A browser cannot guarantee completion after a forced process termination, so wait for Saved before closing. |
| P1-4 silent multi-tab overwrite | **Resolved.** Autosave uses revision fingerprints and compare-and-set writes. A detected stale tab pauses automatic saves behind a persistent Load newer copy / Keep this copy choice. |
| P1-5 main-thread generation freeze | **Resolved.** Generation runs in a disposable module worker with visible progress, cancellation, stale-result rejection, and complete-result-only commit. |

### 2026-08-12 post-merge blocker pass

A fresh parallel generation, persistence/export, and live-browser audit found and resolved four additional blockers plus one mobile access defect:

- Start-blocked auto-sized core planes no longer consume the province capacity needed by eligible cores; a deterministic 12-player mixed-plane regression retains every requested category and the hard spacing floor.
- A first or only Dream, Air, Cloud, Elemental, or special Custom plane can now receive generated Other starts; realm eligibility no longer depends on array position.
- Schema-v1 import rejects unknown fields at every structured nesting level instead of retaining attacker-controlled hidden payloads for autosave or package traversal.
- Direct install refuses to touch a nonempty colliding folder unless a bounded, parseable `atlas_project.json` proves that the same normalized Atlas root owns it. Refusal occurs before any stage, write, removal, or backup mutation.
- At narrow viewport widths, the only **Open project** control is now a readable 112×44-pixel, safe-area-aware touch target.

The original P2 set has also been substantially remediated: all authored start types now share capital cleanup/validation, staging preserves gateways, destructive replacement is confirmed with backup access, New atlas exists, slider history is coalesced, imported command values and custom catalogs use the active validation data, impossible start plans are preflighted, special-plane guardian capacity produces persistent warnings, temperature flags are exclusive, reserved Windows basenames are rewritten, the test runner is declared, and direct install uses staging, backups, rollback, binary-first publication, and cleanup-last ordering.

Limitations recorded in August:

- The compact package and a representative eight-plane package passed the installed engine's scripted new-game loader. The eight-plane smoke verified all eight exported map/D6M pairs plus the generated underworld files. Longer visual play remains worthwhile post-release, but is no longer classified as an engineering release gate.
- ZIP assembly is still in-memory. The export dialog now warns before cautionary sizes and disables only ZIP when the estimated peak crosses the safety ceiling; direct install remains the large-atlas path.
- Browser file access has no atomic rename. Direct install therefore provides transaction-like staging and rollback, not filesystem-level atomicity, and reports retained recovery files if rollback itself is denied.
- Autosave is one browser-local recovery slot, not cloud sync or a recent-project library. Revision conflicts are explicit; portable Editable project JSON remains the durable backup format.
- The August production dependency audit was clean. Compatible React/RSC, Vite, Wrangler, and Cloudflare tooling updates reduced the full development-tool audit from 17 findings to 2 high findings inherited from Vinext's exact `image-size@2.0.2` dependency. No patched `image-size` release was available at that review date; npm's proposed forced Vinext downgrade was rejected. The [September follow-up](BUGFIX_AUDIT_2026-09-05.md) records closure of the affected chain. Raw-directive, imported-catalog trust-label, and tiny-map Styx items were recorded as non-blocking maintenance at the August review.
- Some mathematically constrained maps cannot achieve every requested spacing, connection, throne-access, or guardian-density target simultaneously. The generator preserves hard safety rules and reports best-effort quality warnings instead of silently weakening them.

## Severity definitions

- **P0:** catastrophic loss, compromise, or universally unusable release.
- **P1:** release blocker; can lose work, corrupt playable output, or make an advertised supported configuration unusable.
- **P2:** important correctness, multiplayer-quality, security, or usability defect that should be fixed before a broad release.
- **P3:** hardening, clarity, accessibility, or infrequent quality issue.

## Historical P1 findings (resolved)

The evidence and requested remedies below describe the pre-remediation snapshot. Their August remediation status is recorded above.

### P1-1: A staged plane makes the saved project unrestorable — resolved

**Evidence.** `+ Add plane to plan` deliberately creates an empty draft plane in [`addPlane`](../src/generator.ts#L366-L392). Project autosave and Editable project JSON serialize that state, but [`parseProject`](../src/export.ts#L129-L136) rejects every plane whose province list is empty at [`assertPlane`](../src/export.ts#L251-L270).

**Deterministic reproduction.** Serializing and parsing:

```ts
parseProject(JSON.stringify(
  addPlane(createDefaultProject("x"), "underworld", { generate: false }),
))
```

throws `project.planes[1].provinces must contain at least one province.`

**Impact.** The app can autosave a project it cannot reopen. On the next load it falls back to a fresh default unless another same-origin tab has overwritten the shared slot, after which the intended draft can be replaced.

**Required fix and regression.** Permit empty staged planes in the project schema while keeping them as export-validation errors until Generate runs. Round-trip staged one-through-eight-plane projects through JSON, IndexedDB, and localStorage.

### P1-2: Imported province-array order can desynchronize `.map` commands from D6M geography — resolved

**Evidence.** Validation sorts a copy of province indices and only verifies the set is contiguous in [`validateProject`](../src/dom6.ts#L661-L664). D6M province records and owner values use array position in [`encodeD6m`](../src/dom6.ts#L402-L445), while `.map` commands use each object's explicit `province.index` in [`compileMapText`](../src/dom6.ts#L256-L329).

**Deterministic reproduction.** Swap province objects 1 and 2 in imported JSON without changing their `index`. Validation reports no error. The D6M's first province slot and owner value now describe index 2's geometry while `#terrain 1`, `#landname 1`, starts, and other directives still target index 1.

**Impact.** A project can be reported export-ready yet install mismatched geography, names, terrain, ownership, and commands.

**Required fix and regression.** Canonicalize imported province arrays by index before any geometry/compiler work, or reject arrays unless `province.index === arrayPosition + 1`. Compare every province center, owner raster ID, name, terrain, start, and gateway before and after an imported reorder.

### P1-3: Edits made inside the autosave debounce window are lost on close or reload — resolved

**Live reproduction.** A project-name edit completed, then reload began 134 ms later. Autosave waits 450 ms and the unmount cleanup cancels that timer, so the previous name returned after reload. As a positive control, waiting about 800 ms before reloading retained the same edit.

**Evidence.** The header reports only the selected backend, not dirty/saving/saved state, around [`autosaveLabel`](../src/MapMakerApp.tsx#L307-L312). The only save is the delayed effect at [`MapMakerApp.tsx`](../src/MapMakerApp.tsx#L355-L367); no `pagehide` flush or explicit Save command exists.

**Impact.** The green `Device autosave` label can be visible while the latest work is not durable.

**Required fix and regression.** Track dirty, saving, saved, and failed states; add an explicit Save Project action; persist committed revisions promptly; and use `visibilitychange`/`pagehide` only as best-effort signals, with a synchronous emergency journal where feasible. Warn before unload while dirty. Test unmount/reload at every point from 0-449 ms after text, slider, and province edits.

### P1-4: Multiple tabs silently overwrite one another's autosave — resolved

**Observed concurrent same-origin reproduction.** An eight-plane project was saved in one tab. A second local tab wrote a one-plane project to the same slot. Reload restored the unrelated one-plane project; importing the downloaded eight-plane JSON restored the intended state.

**Evidence.** All projects share one key and one IndexedDB record in [`autosave.ts`](../src/autosave.ts#L4-L9). Saves unconditionally overwrite that record in [`saveProjectAutosave`](../src/autosave.ts#L137-L172) and the IndexedDB driver in [`autosave.ts`](../src/autosave.ts#L208-L214). There is no project ID, revision, lock, or conflict prompt.

**Impact.** An old or unrelated tab can replace the only durable autosave copy of newer work even after the normal debounce completes.

**Required fix and regression.** Add stable project IDs and monotonic revisions; reject or fork stale writes; coordinate tabs with `BroadcastChannel` and Web Locks; and provide separate recent-project/autosave slots. Test stale-write rejection with two tabs at the same starting revision.

### P1-5: Large supported generation freezes the browser's main thread — resolved

**Evidence.** The Generate click handler calls `generateProject(source)` synchronously at [`MapMakerApp.tsx`](../src/MapMakerApp.tsx#L421-L430). There is no generation busy state, progress, worker, or cancellation. The table below is a one-seed-per-configuration benchmark of that same synchronous generator in a local Windows x64 Node v24.13.0 harness on an AMD Ryzen 9 7950X3D with 32 logical processors and 63.1 GiB RAM. Time and process RSS were measured in Node, not in the browser; the source architecture independently confirms that equivalent work blocks the browser main thread.

| Configuration | Provinces | Generation time | RSS increase |
|---|---:|---:|---:|
| Default-sized, 8 planes | 232 | 0.22 s | 1.8 MiB |
| 16 players x 16 PPP, 8 planes | 672 | 14.0 s | 40 MiB |
| 32 players x 16 PPP, 8 planes | 1,344 | 98.1 s | 84 MiB |
| Maximum 8 x 800 planes | 6,400 | 175.9 s | 528 MiB |

The maximum project eventually had zero validation errors, zero duplicate names, 21 valid gateways, and all 64 thrones. The defect is UI availability: the browser cannot repaint, report progress, or accept cancellation for almost three minutes.

**Required fix and regression.** Move generation and heavy fairness work to a Web Worker, report plane/stage progress within 100 ms, support cancellation without replacing the current project, and enforce practical performance budgets.

## Historical important findings (P2)

This table retains the original defect ledger, not the current issue tracker. Most rows had implemented fixes or bounded mitigations by the August remediation status above. P2-9 was retained as a constrained-map quality case; P2-16's dependency findings were subsequently closed in the [September follow-up](BUGFIX_AUDIT_2026-09-05.md).

| ID | Finding and evidence | Required remediation |
|---|---|---|
| P2-1 | **Team and nation-specific starts bypass capital-safety checks.** Generic starts receive degree, border, and independent-defender checks at [`dom6.ts`](../src/dom6.ts#L729-L741); team and specific starts receive only partial checks around [`dom6.ts`](../src/dom6.ts#L743-L744) and [`dom6.ts`](../src/dom6.ts#L929-L943). A validator-approved specific capital emitted `#setland`, `#commander`, and `#units`. | Apply every hard start rule to the deduplicated union of generic, team, and specific starts. Assigning a start in the UI should clear guardians/no-start and mark throne avoidance, or block with a clear confirmation. |
| P2-2 | **Staging a plane silently deletes every actual gateway.** [`addPlane`](../src/generator.ts#L366-L392) assigns `next.gates = []` when `generate:false`. Live testing changed three gateway groups to zero while the toast only said a plane was added. | Preserve existing groups when staging; prune only removed endpoints; regenerate gateways only during explicit Generate. |
| P2-3 | **Generate replaces most manual province work without an in-app confirmation.** [`handleGenerate`](../src/MapMakerApp.tsx#L421-L448) immediately commits a reconstructed project, while [`generateProject`](../src/generator.ts#L457-L499) regenerates every plane and replaces actual gates and throne recommendations. Authored names survive, but terrain, economy, sites, defenders, borders, starts, thrones, directives, and gateways do not. | Detect post-generation authored content, list what will be replaced, offer backup first, and require confirmation. Cancel and Undo must preserve the complete previous state. |
| P2-4 | **There is no New atlas or Clear autosave workflow.** Live testing reloaded an existing atlas with no new-project action available. Reset deliberately preserves the current planes, provinces, gateways, and manual edits in [`MapMakerApp.tsx`](../src/MapMakerApp.tsx#L201-L233); only Open project is available. | Add New atlas with backup/cancel choices and replace the active autosave slot. Consider a recent-project picker. |
| P2-5 | **Undo is internally inconsistent.** Live testing found that unchanged catalog focus/blur enabled Undo, sliders bypassed it, and text edits created rapid successive history entries. The generic remembered mutation always snapshots at [`MapMakerApp.tsx`](../src/MapMakerApp.tsx#L375-L388); concrete text/change handlers include [`MapMakerApp.tsx`](../src/MapMakerApp.tsx#L718-L719), [`MapMakerApp.tsx`](../src/MapMakerApp.tsx#L903), and [`MapMakerApp.tsx`](../src/MapMakerApp.tsx#L1006). Unchanged catalog focus/blur commits at [`CatalogCombobox.tsx`](../src/catalog/CatalogCombobox.tsx#L49-L64), while Water and Biome sliders bypass history at [`MapMakerApp.tsx`](../src/MapMakerApp.tsx#L809-L826). | Skip no-op commits, create one history entry per slider gesture, and coalesce text edits by focus session. |
| P2-6 | **Imported numeric command values are under-validated.** Unsafe gate integers and values as large as `1e308` pass several checks and can emit rounded or exponential syntax. Fractional `special=1.5` emits `#neighbourspec ... 1.5`; negative site/unit strings emit `#feature -3`, `#commander -1`, and `#units ... -2`. Relevant code includes [`dom6.ts`](../src/dom6.ts#L722-L723), [`dom6.ts`](../src/dom6.ts#L978-L982), and argument formatting at [`dom6.ts`](../src/dom6.ts#L1137-L1145). | Require safe integers for every integer-valued directive field; keep coordinates and other intentionally fractional fields valid; require border bitmasks 0-255; reject negative numeric site/unit IDs and reject zero unless a loaded verified catalog establishes it as valid; retain named mod content and add documented command-specific bounds. |
| P2-7 | **Custom catalog entries can be selected but are not honored by validation.** The UI constructs merged catalog data but calls built-in-only validation at [`MapMakerApp.tsx`](../src/MapMakerApp.tsx#L288-L297); the command checks use the bundled catalog in [`dom6.ts`](../src/dom6.ts#L766-L789). Custom poptypes and forts consequently block export; other custom records get misleading vanilla warnings. | Pass the same merged catalog into all validation and compiler-readiness checks; clearly distinguish bundled, user-supplied, and unresolved data. |
| P2-8 | **A valid special-plane start plan can erase every special guardian.** Seed `audit-start-3-8` produced a 24-province Air plane with three starts; every province lay inside a protected two-ring, leaving zero legal guardian provinces. | Size bonus planes using both start-basin and requested guardian-coverage capacity; warn before generation if 22-30% guardian coverage among eligible neutral provinces after start-protection exclusions cannot fit. |
| P2-9 | **Feasible maps can retain severe nearby-throne imbalance.** In 40 mixed three-plane maps, mean throne-access score was 71.85; 15 scored below 70 and three scored 0. Seed `audit-throne-mixed-14` gave nearby counts `6,1,5,5,2,1,1,5` with 8 players/12 PPP, 32% inland-sea water, X wrap off/Y wrap on, starts 2 Land/2 Coastal/1 Water/2 Cave/1 Other, target degree 8, Surface 60 + Cavern 24 + Dream 25, and ring gates with three pairs. | Optimize the actual radius-four count range before plane quotas, support multi-throne swaps, and raise a validation warning for severe imbalance. |
| P2-10 | **Volcanic and Infernal generation can mark a province both warmer and colder.** The flags are independent around [`generator.ts`](../src/generator.ts#L952-L957). Across 3,630 kind/variant generations, 56/330 Volcanic seeds and 52/330 Infernal seeds conflicted. Repro: `audit-temp-surface-volcanic-0`, Surface/Volcanic/96 provinces, province 10. | Produce one mutually exclusive temperature state. Add a complete kind x variant invariant corpus. |
| P2-11 | **Impossible start-category plans run before becoming export-blocked.** Surface + Hell/Underworld/Abyss with an `Other` start can only generate a fallback category; validation reports the mismatch afterward. The Generate button checks only that counts sum to player count. | Preflight category capacity against planned plane families, disable Generate when impossible, and identify the category/plane change needed. |
| P2-12 | **The maximum eight-plane ZIP path can exceed roughly 760 MiB peak memory.** Eight 4K D6Ms total about 253 MiB; packaging retains them, concatenates a second full ZIP, then copies it again for the Blob in [`export.ts`](../src/export.ts#L26-L62) and [`export.ts`](../src/export.ts#L527-L603). | Stream ZIP output or use a streaming save API, remove the extra copy, and warn/enforce a safe ceiling when direct install is unavailable. |
| P2-13 | **Direct install is non-atomic.** [`installPackage`](../src/export.ts#L84-L116) deletes obsolete planes, overwrites map/support files, and only then finishes D6M rendering/writing. A quota, permission, or encode failure can leave a previously working map partially updated. | Render/stage everything first, write D6Ms before their `.map` references, commit atomically where possible, preserve backups, and delete stale files last. Inject failures at each stage in tests. |
| P2-14 | **Windows-reserved names remain valid-looking export stems.** `CON`, `PRN`, `AUX`, and `NUL` survive [`sanitizeMapName`](../src/domain.ts#L425-L432), so direct install or ZIP extraction can fail. | Detect reserved device basenames case-insensitively and prefix/suffix them; display the normalized result before export. |
| P2-15 | **Custom-catalog storage recovery can throw a second time.** The load catch and Reset call `localStorage.removeItem` without guarding the same denied-storage condition around [`MapMakerApp.tsx`](../src/MapMakerApp.tsx#L338-L350) and [`MapMakerApp.tsx`](../src/MapMakerApp.tsx#L503-L506). | Use a guarded storage adapter for get/set/remove and keep session-only custom data usable when persistence is unavailable. |
| P2-16 | **The original development/runtime toolchain had 17 audit findings.** August upgrades used React/RSC 19.2.8, Vite 8.2.1, Wrangler 4.121.0, Cloudflare Vite plugin 1.51.3, and compatible Vite plugins. The production audit was clean; the complete graph had 2 high findings inherited from Vinext's exact `image-size@2.0.2` dependency. | The August decision was to avoid npm's incompatible forced downgrade and track the dependency. The [September follow-up](BUGFIX_AUDIT_2026-09-05.md) records the later compatible framework update that removed the affected chain. |
| P2-17 | **A clean clone cannot run the advertised full test script.** After `npm.cmd ci`, `npm.cmd test` completed the production build and both rendered-HTML tests, then stopped with `'tsx' is not recognized`. The script invokes `tsx --test tests/*.test.ts`, but `tsx` is absent from both dependencies and devDependencies in [`package.json`](../package.json). The established development checkout passed because it retained an undeclared local runner. | Declare and lock a compatible `tsx` dev dependency, or replace it with a declared/native TypeScript test path. Add a clean-clone CI job that runs `npm ci`, `npm test`, typecheck, and lint from an empty dependency directory. |

## Historical P3 hardening and quality ledger

This list preserves the August lower-priority findings and remediation labels. Unmarked entries describe that snapshot, not confirmed open issues in the current release. In particular, the historical interaction-copy bullet below predates the same-plane gate feedback and plane-removal confirmation now described in the user guide; it should not be read as a current UI inventory.

- **Resolved — import resource ceilings:** browser pickers reject oversized project/catalog files before `file.text()`, and recursive schema validation enforces bounded planes, provinces, edges, gates, collections, strings, directives, and safe nested fields before cloning.
- **Resolved — delimiter-safe IDs:** imported plane, province, edge, gate, and reference IDs use a bounded delimiter-safe grammar.
- **Raw-directive lint:** advanced raw commands may duplicate `#imagefile`, `#mapsize`, or `#dom2title`, or append `#land` to a protected start. Preserve the power feature but lint required-command overrides and require explicit review of imported raw directives.
- **Catalog trust labels:** a custom catalog can self-label its provenance as official and override matching IDs. Treat all imported bundles as user-supplied unless their trust is established outside their own payload.
- **Resolved — forwarded-host metadata:** [`app/layout.tsx`](../app/layout.tsx) accepts only validated HTTP(S) authorities and falls back to a safe loopback origin; rendered-output regressions cover malformed forwarded values.
- **Minimum Styx center span:** five of 225 size/aspect/wrap cases retained one connected river and exactly two banks but failed the center-span proxy; all five were size 8. Repro `styx-2160x3840-8-false-false-4` placed its two water centers at `(0.795, 0.123)` and `(0.211, 0.780)`. Confirm the ownership raster before treating this as a visual edge failure, then force boundary anchors if needed.
- **Capital-degree best effort:** 2/40 mixed target-8 projects used two nearby degree values (`fuzz-mixed-11` and `fuzz-mixed-20`). Both preserved hard spacing and surfaced warnings; retain this as a quality metric rather than an export error.
- **Continent repair:** 3/1,200 feasible five-continent cases produced four (`continent-96-40-false-5-2`, `-13`, and `-26`); the achieved-count warning worked. Improve the final repair search without hiding the warning.
- **Resolved — legibility:** all functional labels, help, status, validation, catalog, gateway, and export text now use an 11 px minimum; the narrow-screen Open project control is a 112×44 px safe-area-aware target.
- **Resolved — transient feedback:** import, export, preview, and explicit save failures remain in scoped, dismissible `role=alert` regions; repeat failures reannounce and successful retries clear only the corresponding alert.
- **Minor interaction copy:** a same-plane gate still reports `Cross-plane gate linked`; plane and gateway deletion are single-click destructive actions; the default `Pantokrator Atlas` name always creates a filename-normalization warning.

## Verification record

The August audit recorded these release-critical checks:

- Production build, TypeScript, and lint pass.
- The lockfile declared the TypeScript test runner that the full `npm test` command invoked. The August remediation run passed the production build, 7 rendered-output/style checks, and 271 TypeScript tests (278 total); typecheck and lint also passed. Focused regressions covered worker cancellation, bounded project import, autosave conflicts and races, start reservation/protection and capacity, direct-install ownership/rollback, ZIP memory gating, persistent action errors, readable responsive controls, and destructive UI workflows.
- All 121 plane-kind/variant combinations generate deterministically.
- Player limits 2, 6, 16, and 32; provinces/player 8, 16, and 30; plane counts 1-8; and supported start categories were exercised.
- Compatible start plans retained exact categories, hard three-move spacing, and no shared capital surroundings.
- Gate pair counts 1-3, deterministic numbering, valid endpoints, and start/throne exclusion zones passed.
- Traversable graphs remained connected and edge references valid.
- The 6,400-province maximum retained unique noncapital contextual names.
- A 225-case Styx corpus retained one connected river and exactly two connected banks.
- A 1,200-case continent corpus achieved the requested count in 99.75% of cases and warned on every miss.
- An eight-plane package produced all eight correctly suffixed `.map`/`.d6m` pairs; every D6M passed magic, version, dimension, center, owner, length, and trailer inspection.
- Manual command ordering, wrapping scope, 64-bit terrain masks, global specific-start numbering, and shared gate numbers agree with Illwinter's [Dominions 6 Map Editing Manual, version 6.26](https://www.illwinter.com/dom6/dom6mapman.pdf) and [D6M format specification](https://www.illwinter.com/dom6/dom6fileformats.pdf).
- Project data remains browser-local; no telemetry or project-upload path was found.
- Keyboard map editing, tab navigation, combobox selection, modal focus trapping/restoration, invalid-import handling, ordinary autosave, and 375 px responsive layout worked in live browser testing.
- `npm audit --omit=dev` reports zero advisories in the four production dependencies.

## Historical remediation order

The numbered plan below records the original remediation order. By 2026-08-13, the runner/toolchain/full-suite work and both compact and representative eight-plane engine-load smokes were complete. The dependency findings recorded here were subsequently closed in the September follow-up.

1. Fix project round-trip and autosave integrity (P1-1, P1-3, P1-4).
2. Fix province-order canonicalization before any further export claims (P1-2).
3. Move generation off the main thread and add cancellation (P1-5).
4. Unify all authored-start safety validation and eliminate silent gateway/manual-edit loss.
5. Harden numeric arguments, custom-catalog validation, filenames, and install atomicity.
6. Restore special-plane guardian guarantees and improve throne/Styx/start-plan preflight quality.
7. Declare the clean-install test runner, upgrade the compatible local runtime toolchain, then rerun every audit corpus and live Dominions load tests. The runner/toolchain/full-suite portion and both engine-load smokes were complete by August 13. Two Vinext transitive advisories were still recorded then as development-tool maintenance; see the September closure above.

## External engine smoke tests

On 2026-08-12, the audit generated and installed an isolated compact package named `Atlas_Release_Smoke_20260812`. The installed Dominions 6 executable accepted its `.map`/`.d6m` through the documented scripted `--newgame` path and created a game-state file plus its generated underworld map pair. The uniquely named smoke map/save were then removed; existing maps and saves were not touched. This closes the compact package-load check.

On 2026-08-13, the audit also generated and installed `Atlas_Release_Eight_Plane_20260813`: Surface, Cave, Cavern, Cloud, Underworld, Hell, Abyss, and Dream planes; 216 authored provinces; eight starts; eight recommended thrones; and eight bidirectional ring gates. The package contained eight correctly suffixed `.map`/`.d6m` pairs plus its project, host, topology, and balance reports. Dominions 6 accepted the main map through `--newgame`, created the game-state file, and generated the expected underworld `.map`/`.d6m` pair. A live Dominions window displayed the loaded native map scenery without a crash or compatibility dialog. This closes the representative multi-plane engine-load release gate; extended AI play remains a useful post-release playtest rather than a blocker.
