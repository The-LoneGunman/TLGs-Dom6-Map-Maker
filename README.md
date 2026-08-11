# Pantokrator Atlas

Pantokrator Atlas is a local-first Dominions 6 map maker. It creates deterministic, multiplayer-friendly native `.d6m` maps, supports one to eight linked planes, and exports a complete ready-to-play map folder without requiring a mod.

New to the program? Start with the [complete user guide](docs/USER_GUIDE.md) for the recommended workflow and a reference for every generator, plane, scenario, province, validation, and export option.

Release readiness and known blockers are tracked in the [2026-08-11 full bug and release audit](docs/FULL_AUDIT_2026-08-11.md). Resolve its P1 findings before treating the current build as a seamless public release.

## Included map features

- Coherent procedural biomes with controlled terrain variety and plane-specific site/population themes
- Topology-aware overland ocean presets: natural, single continent, multiple continents, island chains, and a central inland sea
- Surface, cave, cavern, cloud, air, underworld, hell, abyss, dream, elemental, and custom plane archetypes
- Pre-generation plane planning with independent names, sizes, terrain variants, wrapping, display flags, and colors
- Exact land, coastal, water, cave, and other-plane start allocations
- One-click Generate-tab default reset that preserves the current map and participates in Undo
- Deterministic plane-, terrain-, coast-, flooded-cave-, and Styx-aware province names with project-wide uniqueness, capital-name protection, and a reroll that preserves manual edits
- Ordered deterministic cave-start nations, bound to generated cave capitals with `#specstart` when special starts are enabled
- Configurable minimum start degree and scale-aware capital spacing: starts never share a one-ring province, larger maps seek progressively wider separation, and any infeasible shared-degree or preferred-distance target is reported as an accessible best-effort warning
- Start exclusion zones for generated thrones, gates, and unique independent guardians
- Preferred, avoided, and catalog-verified fixed throne locations
- Up to eight planes connected through compatible, hub, chain, ring, or explicit gate graphs
- Standard, road, river, bridge, mountain, impassable, and custom borders
- Ownership-boundary topology: every positive-length shared border is an exported neighbour, including wrap seams
- Searchable Dominions 6.35 catalogs: 4,091 units, 1,253 sites, 82 poptypes, 106 active/special nations, and 28 forts
- Terrain-compatible hidden/known selection across all 900 ordinary province sites plus an explicit 71-site non-random/non-home expansion, with 208 nation home references excluded and a separate 74-site throne-only fixed-throne selector
- Unique initial independent commanders, squads, bodyguards, items, cleared/assigned magic, experience, and equipment; all 4,091 vanilla monster IDs are searchable by default, with optional factual filters for 627 nation-recruitable commanders and 679 troops
- Province ownership, poptypes, population, unrest, forts, temples, labs, and owned PD level
- Battle maps, skyboxes, colors, host restrictions, AI players, victory points, and raw advanced directives
- Fully additive Dominions terrain flags (including freshwater land, forest + swamp, and sea + mountains/underwater forest) with native game-rendered winter, forest, waste, farm, submergence, water, and kelp changes
- Sparse non-overland chambers and corridors with native owner-0 negative space shared by D6M output, interactive hit-testing, and themed editor/PNG backdrops for cavern, cloud, underworld, infernal, abyssal, dream, and elemental realms
- IndexedDB-first device autosave with localStorage fallback, legacy migration, and a visible failure state for atlas sizes that exceed browser quotas
- Direct installation through the browser File System Access API, plus a ready-to-install ZIP fallback
- Validation for filenames, command ranges, catalog IDs, start safety, site terrain, topology, gates, and `.d6m` structure

## Plane and gate behavior

Dominions connects every province carrying the same `#gate` number in both directions. Pantokrator Atlas therefore treats plane links as an undirected graph and does not promise unsupported one-way travel. Presets quickly seed the full graph; the Planes tab then shows only the selected plane’s destinations so each next-generation link and gate-pair count can be customized without an all-plane matrix. A separate Existing gateways editor lists the saved gate groups touching that plane, including every endpoint’s local province index and stable ID, and lets you reassign endpoints, edit the shared gate number, or delete the group. The compatible preset favors surface-to-cave/cavern, surface-to-cloud/air, and cave-family-to-underworld/hell/abyss links.

Generated gate and throne endpoints prefer provinces at least two graph steps from every generic, team, and nation-specific start. On a cramped custom plane, validation exposes any deterministic fallback that had to use the adjacent ring.

Sparse cave, cloud, underworld, infernal, abyssal, dream, and elemental realms use subdued illustrated art behind ownerless space in the editor and high-resolution PNG preview. Dominions' native D6M v3 format has no second raster/underlay field: its single `#imagefile` is the D6M itself, so the game renders owner-zero space with its own presentation rather than loading these preview backdrops. See [realm backdrop asset provenance](docs/ASSET_PROVENANCE.md) for the original OpenAI ImageGen inventory.

Cave and Cavern generation includes connected flooded chambers whose terrain remains additively both Sea and Cave. Every Underworld is crossed edge-to-edge by a connected, named River Styx band with Death + Water site bias, amphibious spectral guardians, two connected dry banks, and one or two controlled bridge crossings. Newly staged Underworld planes therefore default to no wrap; manually enabling both wrap axes is preserved but validation warns that a single river band cannot truly divide a torus. When both realms have enough safe aquatic provinces, a bounded share of surface-to-underground gate pairs link ocean to subterranean water while retaining at least one dry entrance. This follows Illwinter's official Hollow World precedent, where sea provinces have linked underground levels and several entrances are underwater.

Natural, single-continent, multiple-continent, and inland-sea layouts preserve the requested feasible water quota. Island chains require enough surrounding sea to read as islands, so Generate raises and records any lower request to an effective 48% minimum. Multiple-continent cuts use the exported movement topology; when the selected water quota and wrapping cannot sustain every requested continent, validation reports the achieved component count instead of silently presenting one connected landmass as several continents.

`Players x provinces per player` budgets only core Surface, Cave, Cavern, and surface-like solid Custom realms. Each auto-sized bonus realm independently uses the Generate-tab bonus-plane percentage of the combined core total; values above 100% intentionally make every bonus plane larger than all core realms combined, subject to the 800-province per-plane cap. Manual plane sizes are never changed by that setting.

Leaving the cave-start nation list empty preserves Dominions' native cave preference. Within the requested capacity, configured entries are guaranteed generated cave capitals through `#specstart` in the displayed priority order when the host enables special starts; the UI warns when the list exceeds that capacity. Auto-sized Cave and Cavern core planes share the cave-start province budget, while the main overland plane follows the combined land, coastal, and water allocation.

Generated province names use original, historically rooted geographic vocabulary rather than copied third-party map lists. The grammar combines the plane archetype or Custom variant with effective additive terrain flags, so flooded caves, kelp seas, forested highlands, and Styx provinces receive different language. Names are unique across the entire atlas and avoid normalized matches with playable nation names and epithets, nation home-site names, and official special-realm labels from the pinned catalog. Editing a name in the province inspector marks it manual; map regeneration and the ordinary Generate-tab reroll leave it untouched. Older projects without name provenance can use the separately confirmed **Replace every province name** action to repair legacy duplicates; it replaces manual names too, but remains Undoable. Dominions can still apply a nation's homeland name to a start when special starts are enabled unless the scenario author explicitly turns on `#nohomelandnames`.

## Important PD distinction

Standalone map files can author unique initial independent guardians and set an owned province's numeric `#defence` level. A completely new, replenishing post-capture PD unit roster is defined by a nation or poptype in a `.dm` mod. Pantokrator Atlas stays zero-mod, so it does not mislabel initial guardians as persistent custom PD.

`#poptype` selects vanilla local recruitment; the map manual does not define separate PD-roster IDs, and poptype does not replace the independent army initially randomized by Dominions. Generated unique guardians are explicit map-only initial defenders.

## Manual coverage

All map-command families in the Dominions 6 Map Making Manual are either represented by structured controls, generated from native `.d6m` geography, or available in the scoped map/plane/province directive editors. The `.d6m` owner raster replaces hand-authored `#pb` runs and lets Dominions render terrain transformations without separate TGA variants. Rare scenario commands such as `#god`, `#dominionstr`, and `#scale ...` remain in the advanced map-directive editor because their order can be scenario-specific.

Terrain follows the manual's additive 64-bit model rather than treating forest, swamp, waste, highland, mountains, farm, fresh water, sea, deep sea, and cave as mutually exclusive. The primary terrain controls the generated artwork while additional flags preserve every legal mechanical combination; validation warns when a province exceeds the manual's recommendation of at most two adverse terrain types.

Skybox and custom battle-map directives are supported, but their referenced external `.tga`, `.rgb`, or `.d3m` assets must also exist in the map folder; validation calls this out. Steam Workshop upload and its optional banner/visibility metadata remain a Steam/Dominions workflow rather than part of ordinary ready-to-play map installation.

## Development

```powershell
npm install
npm run dev
npm test
npm run lint
```

The default output is 3840×2160. Square output is available at 2880×2880; custom output is hard-limited to 8,294,400 pixels so malformed settings cannot allocate a multi-gigabyte browser raster. The D6M encoder streams one plane at a time during direct installation; ZIP export holds the package in memory and is best for smaller atlases.

Older saved projects created before ownership-boundary topology may show a **Synchronize visible borders** action. It preserves valid authored border types, adds missing shared-border neighbours, and removes stale links that cross province interiors.

## Format and data references

- [Official Dominions 6 map-making manual](https://illwinter.com/dom6/dom6mapman.pdf)
- [Official Dominions 6 file formats](https://illwinter.com/dom6/dom6fileformats.pdf)
- [Official Dominions 6 modding manual](https://illwinter.com/dom6/dom6modman.pdf)

The bundled population and fort tables are transcribed from the official map manual. Unit, site, nation, special-plane, and site-location indexes are generated from the pinned Dom6 Inspector 6.35 data revision documented in `src/catalog/data/NOTICE.md`; its nation recruitment tables supply commander/troop roles and its nation attributes identify home-site references without name guessing. The same pinned nation, epithet, home-site, plane, and Nexus entries generate the reserved-name blacklist used by the province namer. The GPL-3.0 license is included beside the generated catalog.
