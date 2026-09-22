# Custom-map artwork parity — September 21, 2026

> Historical checkpoint. The September 22 development work now implements an optional illustrated exporter and has displayed generated realm artwork in Dominions 6.37. See [current implementation and verification](../ILLUSTRATED_EXPORT_2026-09-22.md). Follow-up tests also showed the diagnostic's auxiliary `.map` was unnecessary: an independent image basename without `_planeN` permits clean hybrid loading. The incomplete status and helper requirement below describe the earlier experiment, not the current source.

## Outcome

Atlas does **not yet match illustrated custom maps in its exported in-game artwork**. Its native package carries real province geography, terrain, connections, gates and scenario data, but the custom Cloud/Air pixels remain editor/PNG-only. A visually attractive preview is not completion of the requested game feature.

The comparison also corrected a technical overstatement: Dominions 6.37 is not universally unable to mix D6M and TGA planes. A new registered-image diagnostic loaded a custom TGA sky among native D6M planes with correct province ranges. The earlier failure occurred during image-recipe lookup. A production-safe hybrid may therefore preserve native scenery elsewhere; converting every plane to images is an alternative, not a proven requirement.

This review used primary creator/source material, current Atlas package inspection, focused regressions, and an isolated native loading experiment. No community artwork or code was incorporated into Atlas.

## References and evidence limits

| Reference | Useful comparison | What the evidence does not establish |
| --- | --- | --- |
| [Latus, updated Dominions 6 conversion — Laughing Prophet](https://steamcommunity.com/sharedfiles/filedetails/?id=3546454690) | Creator-posted in-game gallery shows a central world surrounded by strongly differentiated magical regions; terrain, backgrounds and decorative features are part of the game image. The creator describes repainted province boundaries and confirms a winter texture in the comments. | “Dimensional” artwork and cave-nation support do not prove separate native sky planes. The public metadata did not provide an inspectable archive URL. |
| [Biddyn Deep — Pymous](https://steamcommunity.com/sharedfiles/filedetails/?id=3492310104) | True cave layer: 81 surface land, 9 sea and 20 cave provinces. Broad adjoining chambers, textured rock framing and painted summer/winter art are appropriate cave appearance references. | Summer/winter art is not evidence of complete terraforming variants. The [creator's announcement](https://www.reddit.com/r/IllwintersDominions/comments/1mk0r2k/) discusses the additional work and size of a full terrain-image set. |
| [Arena — DasTactic](https://steamcommunity.com/sharedfiles/filedetails/?id=3142555207) | Creator explicitly describes changing terrain and winter versions. Inspected gallery images show the same drawn province outlines with different terrain appearances. This is the strongest reviewed authored-map target for condition-reactive illustration. | The same description says special cave terrain does not display properly yet. Do not copy that limitation or treat the description as a complete current-version test. |
| [Phantasia and the Underground Realm — Welzi](https://steamcommunity.com/sharedfiles/filedetails/?id=3146608154) | Four cave systems, about 60 cave provinces and ten gateways provide a useful layout/connectivity benchmark, documented in the earlier [geometry review](NATURAL_CAVERN_REFERENCES_2026-09-21.md). | Gallery appearance alone does not certify image formats, every terrain transition or click-area accuracy. |
| [The Lost Capital — amuys](https://steamcommunity.com/sharedfiles/filedetails/?id=3146126454) | Creator confirms a three-plane scenario with defended objectives. It demonstrates that additional themed realms can be genuine gameplay planes rather than decorations. | No independently inspected archive or verified dedicated sky plane was obtained. |
| [MapNuke map writer](https://github.com/nuke-haus/mapnuke/blob/c85334e25036f412305b20c75241924607a25db8/Assets/Scripts/Output/MapFileWriter.cs) and [generation manager](https://github.com/nuke-haus/mapnuke/blob/c85334e25036f412305b20c75241924607a25db8/Assets/Scripts/Interactive/GenerationManager.cs) | Concrete procedural implementation: TGA artwork, province-area runs, cave-plane files, gates, terrain sheets and winter generation. It demonstrates that this workflow can be automated rather than requiring hand painting. | Support for generated surface sheets is not proof that every cave/extra-plane transformation is covered. |
| [Cartographic Revision 2.x — Corbeau](https://corbeau.itch.io/cartographic-revision) | Current creator page explicitly describes `.map`/`.d6m` output in place of the older custom-image renderer. Atlas's native export is a legitimate contemporary approach, not inherently an incomplete map format. | It is not a custom-sky-art benchmark. The creator notes native road-rendering and wrapped-bridge limitations; these require current-engine visual checks rather than assumptions of preview parity. |
| [DreamAtlas source](https://github.com/DreamTlaloc/DreamAtlas/blob/5c7713646dbad837607720f5374389a9c599a125/DreamAtlas/classes/class_map.py#L432-L452) | Its inspected `publish()` implementation accepts the native art style and writes map/D6M data per plane. | This confirms a format choice, not equal feature coverage or aesthetics between the projects. |

An inspectable [CustomArena derivative](https://github.com/AntonDnepr/domutils/blob/40d1a66fdb399078419127045340214a35fd7aab/apps/mapgenerator/app.py#L271-L294) bundles base, winter and cave-plane art without the complete terrain-sheet family. It is not the same artifact as DasTactic's Workshop distribution, so it neither verifies nor disproves the original creator's full-variant claim. Reference package/version identity matters.

Dominions 5 compositions remain useful aesthetic references, but they must not be relabeled as proof of Dominions 6's native multiple-plane behavior. None of the externally inspected references establishes a completely tested, genuine additional sky plane with every terrain/season transition. That remains an Atlas acceptance task, not a fact to assume from a map's title.

### Local technical reference, not an independent community benchmark

The installed `Cosmogenesis_Stitched` package contains six real `.map`/TGA planes, including a 240-province Aetherial Sky. Its data includes explicit province ownership and gates, and the image headers are 2560×1440, 24-bit, bottom-origin TGA. Authorship/licensing could not be established from its notes, so no assets were reused and it is not credited as an independently sourced community benchmark.

Its README/changelog explicitly state that winter images duplicate the base images. The sky pair's hashes match. It has no forest/farm/waste/swamp/plain/kelp/water image set. Consequently, image-file presence alone must not be scored as changing-season or terraforming artwork support. This package was inspected as data, not playtested in this review.

## What Atlas actually sends to Dominions

The inspected five-plane acceptance package contains five `.map` files, five `.d6m` files and host support documents. It contains no custom sky image. `src/export.ts` calls `encodeD6m` for every plane; `src/dom6.ts` points every `#imagefile` at D6M. `renderSkyRgb` is called from `src/MapCanvas.tsx`, not from the game-package exporter.

| Feature | Current game output | Parity status / remaining work |
| --- | --- | --- |
| Cloud banks, floating-island cliffs/shadows and realm-specific empty space | None of Atlas's custom sky pixels is included. Dominions renders the native recipe. | **Gap.** Include actual strategic-map imagery and verify it in the native game. Battle `#skybox` is not a substitute. |
| Broad caves and passage provinces | Canonical province geometry and terrain are in D6M; existing native acceptance covers Cave/Cavern layouts. | **Geography present.** Hand-painted crystals, wall framing and other custom cave scenery are not exported. Geometry parity is not artistic parity. |
| Forest/farm/waste/highland/water and composite terrain | Terrain masks and relief are exported; native rendering remains responsible for their appearance. | **Native data present.** Any illustrated path must retain correct visuals after changes, not only paint the starting map. |
| Winter/climate | Native terrain/temperature flags remain in the package. The custom winter sky renderer is preview-only. | **Native mechanism retained; custom-art gap.** Require actual differing winter artwork where appropriate and verify per-province transitions. |
| Gates, starts, thrones, guardians and movement | Current `.map` directives remain independent of illustration. | **Present, must preserve.** Image marker ordering must never move commands to another province. |
| Roads, rivers, passes and bridges | Special-border movement data is exported; game rendering is separate from Atlas's visible line styles. | **Visual parity not certified.** Native roads and wrapped bridges need direct checks, especially given the current Cartographic Revision creator's limitations above. |
| Province selection and dominion overlays | D6M includes exact ownership and center data. | **Present in native format.** An image path needs equivalent `#pb` runs, correct coordinate origin and no clickable ownerless sky. |
| Automatic installation and multiplayer handoff | Host/player packages and transactional installation support native files. | **Illustrated-path gap.** Package all images automatically, preserve rollback and handle memory, stale files and multiplayer transfer. |

## Follow-up hybrid diagnostic

The old failed fixture used `Atlas_TGA_mixed_plane4.tga`. Native lookup stripped the plane suffix and sought a registered `.tga` main image, but only the `.d6m` main image was registered. It failed before decoding that custom TGA. Separately, the native D6M control successfully loaded the built-in `nexus.tga`, contradicting a universal mixed-renderer prohibition.

A bounded follow-up named the custom image `Atlas_Sky.tga` and registered it through an auxiliary `Atlas_Sky.map`. Dominions 6.37 then decoded the custom image and created the game with these ranges:

| Plane | Format | Global provinces |
| --- | --- | --- |
| Surface | D6M | 1–48 |
| Caves | D6M | 49–96 |
| Great Cavern | D6M | 97–144 |
| Cloud | TGA | 145–184 |
| Air | D6M | 185–224 |
| Built-in Void | TGA | 225 |

This is a **successful headless loading diagnostic, not a shippable exporter**. The helper becomes a second selectable map. The deliberately magenta image has no ownership runs, and semantic reference remapping and condition variants were not tested. A GUI attempt opened the isolated game but did not complete strategic-map inspection, so no in-game visual or gameplay acceptance is claimed. The owned process was closed, and existing saves were untouched.

Reproduction artifacts are ignored local developer files: `tmp/sky-alias-protocol.mjs`, `tmp/sky-alias-fixture-1HGE45/`, and `tmp/population-native-M4yD6t/{create.native.log,alias-diagnostic-summary.json}`. They are not release dependencies.

## Acceptance criteria for matching the game-facing feature

1. **Actual artwork, not a preview:** clouds and island depth must be visible in a newly created Dominions game, with all artwork bundled and no user painting or file assembly.
2. **Preserved gameplay:** compare every province's identity, terrain, starts, guardians, sites, throne, edges and gates before/after image export. Validate both local and global references; do not silently guess how unknown raw numeric directives should be remapped.
3. **Authoritative areas:** ownership, visible borders, selection and dominion overlays must agree. Pure white must occur only at unique province centers. Verify marker scan order, same-row ties and Y origin natively.
4. **Real condition coverage:** test normal and winter looks, mixed flags, forest growth, farmland, wasteland, swamp, highlands, kelp, flooding, capital terrain overrides, cave and cave-wall exclusions. File existence or identical duplicate images is not sufficient evidence.
5. **Shape and wrap safety:** cover minimum resolution, normal multiplayer maps, 4K, portrait/wide layouts, both wrap axes, small islands and broad passage provinces. Terrain transitions must not shift silhouettes or markers.
6. **Clean delivery:** one clearly selectable playable atlas; no confusing helper-map entries, missing assets, unsafe stale-image cleanup or host/player differences. Preserve installation rollback and bounded memory.
7. **Visual review inside the game:** assess map-scale readability, meaningful terrain motifs, gateway visibility and province selection in summer/winter. Compare these features with the references without copying their artwork or claiming identical aesthetic quality.

Priority is to resolve clean image registration first, then complete marker/reference and ownership serialization, then variants and packaging, and finally native visual/gameplay acceptance. Keep the current native export available throughout. An all-image mode remains a fallback if clean hybrid delivery cannot be established.

## Verification and change scope

The independent export/terrain audit passed 48 focused regressions during this comparison. The preceding sky-renderer checkpoint passed 832 tests; those are dated component results rather than the final aggregate result after documentation and integration work. Production generation/export code was not changed by this comparison, and no commit, deployment, or installer release occurred.

**Final combined verification:** The combined connected-region/sky-preview source passed **842 tests** (14 build/integration + 828 TypeScript), type checking, lint, license checks and `git diff --check`. Local browser and downloaded-PNG checks passed; the existing five-plane native fixture retained all ten playable files byte for byte. These checks prepare the current preview/geometry work for commit and do not satisfy the pending native image-export criteria above.
