# Procedural realm artwork — September 21, 2026

> **September 22 follow-up:** the [illustrated exporter](ILLUSTRATED_EXPORT_2026-09-22.md) now carries these procedural landscapes into playable packages, with native-game loading and Cloud visual evidence. The preview-only statements and 873-test result below describe this earlier checkpoint, not the current export capability. Both phases remain unreleased development work.

## Status and scope

This is an **unreleased development feature**. The published hosted app and Windows v0.1.5 release still use application source `581b2b8`. The package version remains 0.1.5.

At this September 21 checkpoint, the new artwork appeared in the Atlas editor and high-resolution **Preview PNG** only. Playable export remained native `.map`/`.d6m`; Dominions rendered its own strategic-map scenery. Custom-image export was added in the separately documented September 22 follow-up.

## Realm treatments

| Realm | Procedural editor/PNG treatment |
| --- | --- |
| Cloud and Air | Existing cloud banks, floating-island cliffs and owner-clipped terrain motifs. |
| Cave and Great Cavern | Textured rock relief with fungal growth or crystal details. |
| Underworld | Tomb-like stones and mist around a blue, water-filled River Styx. |
| Infernal and Abyss | Ember fissures in Infernal; obsidian forms and void depth in Abyss. |
| Dream | Drifting mist and enchanted vegetation. |
| Elemental | Variant-led accents over terrain-responsive ground. |

No Astral-grid realm or additional plane archetype was introduced.

## Rendering invariants

- The renderers are deterministic, project-owned TypeScript and use no external artwork, downloads, or new dependencies.
- Canonical province ownership clips the landscape. Starts, thrones, gates, sites, guardians, labels, borders, and selection remain separate overlays.
- Effective primary terrain, additional flags, realm presets, and Condition preview drive the visible motifs. Theme never overrides actual medium: Sea/Submerged provinces remain blue and receive aquatic-colored details even in Infernal or Abyss realms.
- Cave Wall remains sealed rock. Narrow or tiny provinces may omit optional detail rather than drawing outside their owner mask.
- Existing winter policy is unchanged. Cloud/Air can show snow on eligible dry islands; the newly illustrated Cave/Cavern, Underworld, Infernal, Abyss, Dream, and Elemental realms do not gain snow merely because Frozen/winter preview is selected.
- Editor rendering is bounded to display density; **Preview PNG** uses the configured plane dimensions. Neither appearance certifies Dominions' exact native seasonal art.

## Native-export boundary at this checkpoint

This rendering pass did not add TGA/RGB files, image variants, or a custom-image export mode. Its installed and downloaded playable packages contained the normal native `.map`/`.d6m` files. The [image-format research](research/SKY_RENDERING_OPTIONS_2026-09-21.md) documents the preceding protocol investigation; see the [September 22 implementation](ILLUSTRATED_EXPORT_2026-09-22.md) for the later playable exporter.

## Verification

**Final combined verification:** `npm test` passed **873 tests** (14 build/integration + 859 TypeScript), with no failures or skips. Type checking, repository lint, third-party license checks and `git diff --check` passed. The build retains its existing non-blocking chunk-size and route-classification notices.

- Seventeen renderer tests cover supported realms, all terrain flags, aquatic indicators, Cave Wall precedence, exact mutable-mask caching, wrap seams and extreme dimensions through 3840×2160. Three additional PNG integration tests cover all seven new realms and preserve the existing Surface/Custom painters and Cloud/Air behavior.
- Eleven independent preservation tests verify native `.map` and D6M bytes before/after every preview condition, both Styx orientations, semantic content, and 63 additive-water combinations. The review caught and fixed omitted underwater terrain indicators; they now remain aquatic-colored and owner-clipped.
- The existing Surface/Cave/Cavern/Cloud/Air native acceptance fixture was re-encoded: all five `.map` and five `.d6m` files remained byte-identical. No new game-native image rendering claim is made.
- Actual browser use at `127.0.0.1:3023` generated a separate 482-province atlas: 96 Surface, 48 Cave, 48 Great Cavern, and 58 each Underworld, Infernal, Abyss, Dream and Elemental. Every new realm was inspected, and all 42 realm/condition combinations were exercised. Cave variant changes and a Cave Wall edit repainted immediately; both test edits were undone. Infernal Submerged remained blue water.
- Actual Cave and Dream PNG downloads were opened and verified at 1536×1024 with readable province names and semantic badges. At a 390×844 browser viewport, the document had no horizontal overflow and the map remained usable. The viewport override was reset; no browser warnings or errors were captured.
- A local synthetic 4K renderer benchmark measured about 0.54 seconds initially and 0.29 seconds for a cached terrain edit. This excludes ownership sampling, PNG encoding and UI work, and is not a performance guarantee. Exact cached owners plus the rim field retain about 23.7 MiB at 4K, plus coarse fields and placements; output RGB buffers are caller-owned, not cached.

This pass was prepared on `codex/realm-landscape-art-sep21`, after the connected-region/sky work was merged as `25a7586`. At this verification checkpoint it was not yet committed, deployed or packaged as a Windows release; later repository merges do not themselves publish the hosted app or installer.
