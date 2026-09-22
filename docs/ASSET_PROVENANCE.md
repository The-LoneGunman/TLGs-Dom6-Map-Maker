# Artwork provenance

The seven PNG realm backdrops in `public/plane-backgrounds/` are original project assets generated with OpenAI ImageGen from project-authored prompts on 2026-08-10. They are not Illwinter Game Design, Dominions 6, or extracted community-map assets, and they do not reproduce artwork shipped with Dominions.

## Inventory

| File | Realm use | Dimensions | File size |
| --- | --- | ---: | ---: |
| `abyss.png` | Abyssal void | 1254 x 1254 px | 1,733,921 bytes |
| `cavern.png` | Cave and cavern | 1254 x 1254 px | 2,434,265 bytes |
| `cloud-air.png` | Cloud and air | 1254 x 1254 px | 1,879,270 bytes |
| `dream.png` | Dream and glamour | 1254 x 1254 px | 2,550,324 bytes |
| `elemental.png` | Elemental realms | 1254 x 1254 px | 3,005,507 bytes |
| `infernal.png` | Hell and infernal realms | 1254 x 1254 px | 2,481,923 bytes |
| `underworld.png` | Underworld | 1254 x 1254 px | 1,991,830 bytes |

The seven files total 16,077,040 bytes (15.33 MiB). Each file is distinct.

## Universal material textures

The four grayscale material textures in `public/map-art/materials/` were also
generated with OpenAI ImageGen from project-authored prompts on 2026-08-11,
then transformed locally into mathematically periodic mirror tiles. They are
original Pantokrator Atlas assets, not artwork extracted from Dominions or a
community map.

| File | Adaptive uses | Dimensions |
| --- | --- | ---: |
| `earth.png` | Plains, farms, dry land, and wastes | 1024 x 1024 px |
| `foliage.png` | Forests, cave forests, kelp, and magical vegetation | 1024 x 1024 px |
| `stone.png` | Highlands, mountains, caves, infernal rock, and void islands | 1024 x 1024 px |
| `water.png` | Seas, lakes, swamps, flooded caves, and the River Styx | 1024 x 1024 px |

These are source materials rather than fixed province illustrations. The
renderer clips and recolors them against canonical province ownership, keeps
their scale relative to the complete map, and suppresses optional details that
cannot fit safely inside a tiny island or narrow corridor. This avoids stretching
a province-shaped illustration and suppresses details that lack a safe footprint.

Field rows, trees, kelp, cave arches, and other combined-terrain symbols are
code-drawn procedural marks, not additional bitmap assets. The v0.1.4 terrain-flag
update reuses the materials above rather than requiring a new image for every
terrain combination.

## Where the artwork appears

The September 21 development source additionally draws Cloud/Air cloud banks,
floating cliff faces, shadows, and terrain motifs procedurally in `src/skyArt.ts`.
These are original code-generated pixels under the project license, not new
ImageGen assets or copied community-map images. They replace the normal sky
preview painter at supported dimensions; the bundled backdrop remains available
to the fallback renderer. No extra downloads or third-party assets are required.

The material textures, backdrops, and procedural sky pixels are presentation assets for the Atlas editor and its high-resolution PNG previews. Backdrops give sparse planes a theme behind areas that no province owns.

None is embedded in the current native `.d6m` export. Atlas's `#imagefile` references the D6M geography recipe, not a raster illustration, so Dominions uses its own scenery for exported geography and terrain. A registered-image loading experiment is documented separately and is not production export behavior; see [sky-realm rendering options](research/SKY_RENDERING_OPTIONS_2026-09-21.md).

These original project assets use the root [0BSD license](../LICENSE). This does not apply to the separately licensed Dominions selector catalog. See the [illustrated asset specification](ILLUSTRATED_ASSET_SPEC.md) for the shipped implementation and future pack requirements.
