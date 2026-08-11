# Pantokrator Atlas

Pantokrator Atlas is a local-first Dominions 6 map maker. It creates deterministic, multiplayer-friendly native `.d6m` maps, supports one to eight linked planes, and exports a complete ready-to-play map folder without requiring a mod.

## Included map features

- Coherent procedural biomes with controlled terrain variety and plane-specific site/population themes
- Surface, cave, cavern, cloud, air, underworld, hell, abyss, dream, elemental, and custom plane archetypes
- Pre-generation plane planning with independent names, sizes, terrain variants, wrapping, display flags, and colors
- Exact land, coastal, water, cave, and other-plane start allocations
- Configurable minimum start degree with an exact shared degree whenever the requested land/coast/water/cave mix has a feasible assignment, plus deterministic best-fit fallback and blocker repair
- Start exclusion zones for generated thrones, gates, and unique independent guardians
- Preferred, avoided, and catalog-verified fixed throne locations
- Up to eight planes connected through compatible, hub, chain, ring, or explicit gate graphs
- Standard, road, river, bridge, mountain, impassable, and custom borders
- Ownership-boundary topology: every positive-length shared border is an exported neighbour, including wrap seams
- Searchable Dominions 6.35 catalogs: 4,091 units, 1,253 sites, 82 poptypes, 106 active/special nations, and 28 forts
- Terrain-compatible hidden/known site selection and throne-only fixed-throne selection
- Unique initial independent commanders, squads, bodyguards, items, cleared/assigned magic, experience, and equipment
- Province ownership, poptypes, population, unrest, forts, temples, labs, and owned PD level
- Battle maps, skyboxes, colors, host restrictions, AI players, victory points, and raw advanced directives
- Fully additive Dominions terrain flags (including freshwater land, forest + swamp, and sea + mountains/underwater forest) with native game-rendered winter, forest, waste, farm, submergence, water, and kelp changes
- Direct installation through the browser File System Access API, plus a ready-to-install ZIP fallback
- Validation for filenames, command ranges, catalog IDs, start safety, site terrain, topology, gates, and `.d6m` structure

## Plane and gate behavior

Dominions connects every province carrying the same `#gate` number in both directions. Pantokrator Atlas therefore treats the connection matrix as an undirected graph and does not promise unsupported one-way travel. The compatible preset favors surface-to-cave/cavern, surface-to-cloud/air, and cave-family-to-underworld/hell/abyss links instead of connecting every plane to every other plane.

Generated gate and throne endpoints prefer provinces at least two graph steps from every generic, team, and nation-specific start. On a cramped custom plane, validation exposes any deterministic fallback that had to use the adjacent ring.

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

The bundled population and fort tables are transcribed from the official map manual. Unit, site, nation, special-plane, and site-location indexes are generated from the pinned Dom6 Inspector 6.35 data revision documented in `src/catalog/data/NOTICE.md`; its GPL-3.0 license is included beside the generated catalog.
