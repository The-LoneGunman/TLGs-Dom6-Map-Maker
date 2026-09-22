# Sky-realm strategic-map appearance — September 21, 2026

## Verified boundaries

The official [D6M v3 specification](https://www.illwinter.com/dom6/dom6fileformats.pdf) defines province centers, sea flags, elevation and pixel ownership, not custom textures, a cloud material or a background image. Atlas's native acceptance in Dominions 6.37 displayed black ownerless space. No documented native strategic-sky toggle was found; this is not a claim that every future patch or undocumented engine behavior has been ruled out.

The [official map manual](https://www.illwinter.com/dom6/dom6mapman.pdf), version 6.26 as currently published, distinguishes these capabilities:

- Page 3: `#mapnohide` affects province fog of war. Changing it merely for appearance would also reveal the map and is not a sky-background solution.
- Page 4: `#pb` records pixel ownership separately from the displayed artwork.
- Page 8: `#skybox`, `#groundcol`, `#rockcol` and `#fogcol` describe battle scenery, not the strategic world map.
- Pages 9–10: each plane can have custom map imagery, including terrain-specific and winter variants. Unsupported image variants use the default appearance.

The current Atlas exporter produces `.map`/`.d6m` packages. Its editor cloud backdrops are not embedded in native strategic-map artwork. Native generator sea/coast/border colors do not establish a portable per-plane sky backdrop. This investigation covers the documented format and the installed 6.37 behavior, not every possible undocumented technique or future patch.

## Native 6.37 protocol tests

Disposable maps and games were created in workspace-local temporary directories. Existing saves, installed map files and user preferences were not targets. A deliberately flat magenta TGA distinguished supplied artwork from native rendering; it was diagnostic data, not proposed map art.

| Test | Observed result | Consequence |
| --- | --- | --- |
| D6M main plane; conventional `_plane4.map` references TGA while other planes use D6M | Native loader could not find the TGA map recipe. The plane received range `0-0`, offset `-1`; later plane offsets were also wrong. | The proposed automatic mixed-format package does **not** work in this tested configuration. Do not emit it. |
| `#imagefile` selects D6M; matching TGA supplied alongside it | D6M centers loaded. GUI displayed native ground/water rendering, not the magenta image. | A companion TGA does not replace the native strategic-map background. |
| `#imagefile` selects TGA; matching D6M supplied alongside it | Loader used `FindCapitalsFromImg` and found the 48 white image markers. | A companion D6M does not preserve its original center numbering in an image-based map. |
| Follow-up: D6M main, custom TGA sky named `Atlas_Sky.tga`, with separately registered `Atlas_Sky.map` | Native 6.37 loaded the custom sky as provinces 145–184, retained the following D6M Air plane at 185–224, and created the game. | Mixed rendering is possible. The first failure was an image-recipe lookup problem, not a universal mixed-format restriction. This workaround is not a supported Atlas export. |

The initial three commands exited successfully. **Exit code zero is not native-map acceptance:** logs must confirm each plane's actual province range and offsets. A malformed mixed package can finish game creation while assigning data to the wrong provinces.

The later registered-image diagnostic also exited successfully, but unlike the failed first test it had correct per-plane ranges. The native D6M control additionally loaded the built-in `nexus.tga` Void plane. These results supersede the earlier conclusion that in-game sky art necessarily requires converting every plane to images.

## Numbering and ownership evidence

The manual documents pure-white province markers and `#pb` ownership runs, but does not specify scan order or an explicit center-number directive. No such directive was found among the installed executable's relevant command strings; that is not a proof about undocumented commands.

[MapNuke's numbering implementation](https://github.com/nuke-haus/mapnuke/blob/c85334e25036f412305b20c75241924607a25db8/Assets/Scripts/Interactive/ElementManager.cs) sorts Unity Y ascending, then X ascending: bottom-to-top, left-to-right. Its [map writer](https://github.com/nuke-haus/mapnuke/blob/c85334e25036f412305b20c75241924607a25db8/Assets/Scripts/Output/MapFileWriter.cs) writes ownership rows in the same bottom-up image-readback order. For a top-down canvas, this implies marker ordering by integer Y descending then X ascending, and `pbY = height - 1 - canvasY`. This is primary implementation evidence; direct native coordinate and hit-area acceptance is separate from the successful marker-count check.

## Supported direction and unresolved scope

Keep native D6M export intact. More atmospheric editor artwork does not change what Dominions renders from that export. The original conventional hybrid package failed, but a registered-image hybrid passed a later loading diagnostic. Production hybrid export is still unimplemented: the prototype registers an unwanted second selectable map, uses diagnostic magenta artwork without `#pb`, and has not passed native visual, hit-area, numbering, variant or multiplayer acceptance.

An **optional all-image export** remains an alternative, not a demonstrated necessity. Either image-export architecture requires consistent numbering/remapping of province references, starts and gates; exact ownership runs; terrain/winter variants; and real-game checks for hit areas, overlays, wrapping and terrain changes. The manual does not document a cave-specific image variant, so cave transitions also need investigation. No claim is made that either alternative preserves every native feature today. See the [custom-map parity comparison](ILLUSTRATED_MAP_PARITY_2026-09-21.md) for the reference-backed acceptance criteria.

## Local evidence

These ignored temporary artifacts are developer QA evidence, not distributed assets or files present in a fresh checkout:

- Fixture builder: `tmp/make-tga-protocol-fixtures.mjs`; source fixtures: `tmp/tga-protocol-v3uEhp/`.
- Mixed failure: `tmp/population-native-jqiS8U/create.native.log`, especially lines 1978–1992 and 2110 onward.
- D6M selected with companion TGA: `tmp/population-native-ypijhY/`.
- TGA selected with companion D6M: `tmp/population-native-TAtXoJ/create.native.log`, especially lines 100–130.
- Successful registered-image diagnostic: `tmp/sky-alias-protocol.mjs`, fixture `tmp/sky-alias-fixture-1HGE45/`, and `tmp/population-native-M4yD6t/alias-diagnostic-summary.json` plus `create.native.log`.
- Test harness: `tmp/run-population-native-smoke.mjs`; underlying fixture: `tmp/natural-regions-native-FyCHLo/maps/Atlas_Natural_Regions_FyCHLo/`.

See [sky artwork QA status](../SKY_ARTWORK_2026-09-21.md) for acceptance boundaries.
