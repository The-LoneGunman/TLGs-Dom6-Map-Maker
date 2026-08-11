# Realm backdrop asset provenance

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

## Where the backdrops appear

These images are presentation assets for the Pantokrator Atlas editor and its high-resolution PNG previews. They give sparse planes a themed backdrop behind areas that no province owns.

They are intentionally not embedded in native `.d6m` exports. Dominions 6's native D6M v3 format has no separate raster-underlay field behind owner-zero pixels: its single `#imagefile` is the D6M owner image itself. The game therefore uses its own presentation for those unowned areas when it loads the exported map.
