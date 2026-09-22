# Playable illustrated realm export — September 22, 2026

## Status

Custom Atlas artwork now has a playable export path. Generated Cloud, Cave, Cavern, Underworld, Hell, Abyss, Dreamlands and Elemental artwork has been visibly confirmed inside Dominions 6.37, including actual generated sky snow in winter. This is no longer limited to editor/PNG previews or a diagnostic magenta image.

The feature is **unreleased development work**, prepared on `codex/realm-landscape-art-sep21`. The package version remains 0.1.5. Repository commits and merges do not deploy the hosted GUI or publish a Windows release; the published app and Windows v0.1.5 still use source `581b2b8`.

This record supersedes the preview-only export boundary in the [September 21 realm-art checkpoint](REALM_ARTWORK_2026-09-21.md). The earlier [format investigation](research/SKY_RENDERING_OPTIONS_2026-09-21.md) and [custom-map comparison](research/ILLUSTRATED_MAP_PARITY_2026-09-21.md) remain dated research, not descriptions of the new exporter.

## Using it

1. Generate or edit the atlas, save an editable JSON backup, and resolve validation errors.
2. Open **Install / export**.
3. Set **In-game artwork** to **Illustrated realms (custom artwork)**.
4. Choose **Install directly**, **Download ready ZIP**, or **Download player ZIP**. Keep the entire resulting map folder together.
5. Start a new Dominions game with that package. Do not replace a running game's map with an export using a different artwork mode or province numbering.

**Native scenery (existing exporter)** remains the default and continues to produce the established `.map`/`.d6m` package. Selecting illustrated output changes the package, not the editable atlas, its terrain, starts, or balance calculations.

## What is included

Illustrated export uses original, deterministic procedural TGA artwork for nine plane types: Cloud, Air, Cave, Great Cavern, Underworld, Infernal, Abyss, Dream and Elemental. Surface and Custom planes retain native D6M scenery. No extra mod, external artwork download or manual image assembly is required.

Each illustrated plane receives 18 lossless, 24-bit TGA sheets: base and winter, then forest, waste, farm, swamp, highland, plain, kelp and water, each with a winter counterpart. The engine selects the appropriate province areas during play. Cloud/Air winter artwork adds snow on eligible dry islands; other illustrated realms intentionally retain their winter palette. A duplicate winter appearance in those realms is a deliberate theme policy, not evidence of a tested climate transition.

The exporter uses the same province ownership model as the editor/native geometry. It reserves pure white for the single-pixel province markers, writes bottom-origin image coordinates, and supplies `#pb` ownership runs. Empty clouds and rock gaps remain unowned. All sheets retain the same province markers and silhouettes. Terrain motifs follow effective flags; water remains aquatic and Cave Wall stays sealed.

The game images do not bake in editor selections, analysis highlights, province labels, guardian badges or other editing overlays. Dominions displays its own gameplay markers and labels. The standalone Preview PNG is still a separate illustration, not an installable map image.

### File naming and mixed planes

The main map remains `<name>.map`, with additional planes `<name>_planeN.map`. Illustrated images use `<name>_realmN.tga` and `<name>_realmN_<condition>.tga`. Native planes normally keep the corresponding `.d6m` names. If the first plane itself is illustrated, later native planes use `<name>_realmN.d6m` aliases so the inverse mixed-format case also resolves correctly; their binary geography is unchanged.

The independent image stem avoids Dominions 6.37's mixed-format lookup ambiguity around `_planeN` image names. No auxiliary selectable `.map` registration is needed: the package is one selectable atlas. Do not manually rename the image files or their references.

The terrain-sheet behavior follows the [official map-making manual](https://www.illwinter.com/dom6/dom6mapman.pdf), with the independent image stem verified by native loading experiments. Native Surface/Custom geography continues to use the D6M format linked from [Illwinter's documentation](https://www.illwinter.com/dom6/docs.html).

## Province identity and host reports

Dominions derives image-province numbering by scanning the white center pixels. Atlas therefore remaps supported structured references, including local terrain/names/starts, province content, neighbors, border modifiers, gateways and global nation-specific starts. Stable project IDs, editing order, geometry and analysis remain unchanged.

The editor, `balance_report.txt` and `host_topology.txt` continue to use editor numbers. The host package's `host_settings.txt` includes an **ILLUSTRATED PROVINCE NUMBERING** table with editor local/global → in-game local/global numbers and province names for every plane. Use that table when comparing an in-game province to the editor. Native planes retain their usual numbering.

Any active raw `#` command at project, plane or province scope blocks illustrated export. Arbitrary raw numeric references cannot be remapped safely; Atlas neither guesses nor silently drops them. Use Native scenery or supported structured controls. Comment-only notes remain allowed.

## Packaging, memory and safe updates

- Host and player packages have identical playable map/image files and image ownership records. Player packages still omit editable project JSON and host reports; this reduces accidental spoilers, not deliberate inspection.
- `atlas_artwork.json` records exact generated TGA names, any `_realmN.d6m` aliases, and their SHA-256 hashes. It is an installation ownership record, not a project backup or proof of authorship.
- Direct install stages one image at a time, backs up existing owned targets, publishes images before `.map` references and checks for concurrent changes. Detected external edits are preserved rather than overwritten during recovery.
- An unrecorded target-image collision, a malformed/foreign manifest or an edited owned image causes refusal. Unrelated files are preserved. Back up and move the conflict yourself, or choose a new project name.
- Removing a plane or switching back to Native scenery cleans up only unchanged, previously owned images after successful publication. Historical image hashes may remain in the manifest after deletion so interrupted cleanup can be retried; a different file later created under that name is not silently treated as disposable.
- ZIP estimates conservatively include all variants, ownership text, packaging copies and rendering workspace, without assuming favorable compression. Large illustrated ZIPs can be blocked even when an ordinary native ZIP is allowed. Use direct install, lower resolution or fewer planes rather than bypassing the limit.
- When installing from ZIP, replace the old same-named folder after backing up anything important. Do not merge it: stale plane or terrain-image files can change the result. Keep every TGA variant and ownership record together.

## Verification and limits

| Check | Observed result | Evidence boundary |
| --- | --- | --- |
| Real generated artwork in Dominions 6.37 | Cloud terrain, island edges, colored cloud gaps and a gateway icon were visible in the strategic map. Clicking an island interior selected province 157; clicking the ownerless gap did not change the selected province. | A specific visual/selection check, not an all-realms or all-seasons playthrough. |
| Other realm artwork | Visually inspected Cave, Cavern, Underworld (including blue Styx), Hell, Abyss, Dreamlands and Elemental images through the native plane selector. Wrapped examples retain their repeated geography and gameplay overlays. | Representative generated fixtures, not every size/variant/terrain combination. |
| Production package loading | An eight-plane fixture built through `buildPackageFiles` produced 141 files, about 84 MB, and loaded 250 authored provinces plus the engine's Void province 251. All 186 illustrated province centers matched the expected coordinates. | Headless/native data evidence; file presence alone does not establish visual quality. |
| Gameplay reference preservation | Saved adjacency for all 250 authored provinces matched the intended border and gateway graph. A nation-specific Ulm start landed in the intended Dreamlands province, in-game number 220. | Does not calibrate guardian difficulty, simulate a multiplayer campaign or certify every authored scenario. |
| Terrain-sheet selection | A separate flat-color native diagnostic showed a capital changing from Forest to Plains and displaying the orange plain sheet rather than the gray base image. | Confirms the engine uses a terrain variant; this was diagnostic art, not a complete production-art transition matrix. |
| Winter activation | Advanced an isolated game through nine native hosting turns to winter. Contrasting diagnostic winter sheets activated. Replaced the diagnostics in a fresh copy with all 18 production sky sheets (marker positions, map data and saves unchanged); the native winter map visibly displayed snow on the generated islands. | Confirms a real seasonal transition and production winter pixels, not every climate scale or terraforming spell. |
| Automated delivery checks | Native defaults, mixed native-surface preservation, host/player equality, manifest hashes, missing/modified-file protection, staged rollback, concurrent writers, mode switching, plane removal and cleanup retries passed focused regressions. | Focused results are not a substitute for the final full-suite checkpoint. |

The initial illustrated-export implementation passed **901 tests** (14 build/integration plus 887 TypeScript), with no failures or skips. Type checking, lint, license checks and diff whitespace checks passed. The earlier realm-preview checkpoint's 873 tests describe that earlier source state.

At that initial checkpoint, the five-plane native acceptance fixture retained all ten `.map`/`.d6m` files byte-for-byte. Real browser checks exercised the mode selector, memory warning and export progress. The user saved `Illustrated_Brave_QA.zip` from Brave's native Save dialog. The downloaded ZIP contains 25 files, including all 18 artwork sheets for the 96-province fixture, and is 25,854,693 bytes. Every packaged file's SHA-256 matched a fresh export regenerated from the embedded project with that implementation. The existing JSON download was also saved successfully. An in-app-browser download event was not observable, so this saved-file delivery check certifies Brave rather than the in-app browser.

Remaining extended acceptance includes every terraforming spell/combination, wrapped-edge selection at every supported dimension, native map-editor save-back and sustained gameplay/network multiplayer handoff. Do not describe every sheet or realm as exhaustively verified merely because its file exists or its headless loading passed. Existing battle-map/skybox assets, mods and custom catalog content still require their own host setup and verification. Isolated game fixtures and protocol logs are retained under ignored `tmp/illustrated-protocol-*` directories; no existing user saves were modified.

### Cloud/Air landform follow-up

A later September 22 refinement broadens connected Cloud/Air island groups, varies their elongated and lobed coastlines, and replaces constant-width straight causeways with gently curved, tapered routes. Passage provinces remain separately owned. Open-sky setbacks preserve nearby doorway clearance; an adversarial wrapped-Air fixture caught and now guards against a short frontier being swallowed by a coastal inset.

These are intentional sky-footprint changes shared by the editor, PNG, native D6M and illustrated `#pb` ownership, not a movement-graph rewrite. Compatible current maps keep their province IDs, centers, links, content, guardians and starts without regeneration. Existing nonlocal-link and extreme-density compatibility safeguards remain. Non-sky ownership snapshots remain unchanged; older Cloud/Air D6M and artwork hashes are not expected to match the refined silhouettes.

Nineteen dedicated tests cover broad group frontiers, usable passage floors, varied axes and routes, exact movement contacts, connected ownership, dense and wrapped maps, native/illustrated/editor pixel parity, cache invalidation and non-sky preservation. Browser use generated a 96-province Surface plus 48-province Cloud atlas, then checked island shapes, gateway/guardian overlays, selection, winter cover and an additional Forest flag. The native-game evidence above predates these latest contour refinements; the new contours have browser and serialized-ownership verification, not a separate native-game visual acceptance run.

The final full-suite checkpoint passed **920 tests** (14 build/integration plus 906 TypeScript), with no failures or skips. Type checking, lint, license and whitespace checks passed. Four before/after Cloud, wrapped Cloud, portrait Cloud and Air fixtures retain identical generated plane data; only their rendered ownership outlines differ. The browser console reported no warnings or errors during the isolated Cloud-layer checks. Hosted-app deployment and installer publication remain separate release steps.
