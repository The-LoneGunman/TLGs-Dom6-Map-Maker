# Pantokrator Atlas

Pantokrator Atlas is a local-first Dominions 6 map maker. It creates deterministic, multiplayer-friendly native `.d6m` maps, supports one to eight linked planes, and exports a complete ready-to-play map folder without requiring a mod.

## Included map features

- Coherent procedural biomes with controlled terrain variety
- Multiplayer start placement and explicit nation/team starts
- Preferred, avoided, and advanced fixed throne locations
- Up to eight contiguous planes connected by matching gate numbers
- Standard, road, river, bridge, mountain, impassable, and custom borders
- Ownership-boundary topology: every positive-length shared border is an exported neighbour, including wrap seams
- Hidden or known vanilla magic sites and path/site-frequency terrain flags
- Unique initial independent commanders, squads, items, and magic
- Province ownership, poptypes, population, unrest, forts, temples, labs, and owned PD level
- Battle maps, skyboxes, colors, host restrictions, AI players, victory points, and raw advanced directives
- Native game-rendered winter, forest, waste, farm, swamp/submergence, water, and kelp changes
- Direct installation through the browser File System Access API, plus a ready-to-install ZIP fallback

## Important PD distinction

Standalone map files can author unique initial independent guardians and set an owned province's numeric `#defence` level. A completely new, replenishing post-capture PD unit roster is defined by a nation or poptype in a `.dm` mod. Pantokrator Atlas stays zero-mod, so it does not mislabel initial guardians as persistent custom PD.

## Development

```powershell
npm install
npm run dev
npm test
npm run lint
```

The default output is 3840×2160. The D6M encoder streams one plane at a time during direct installation; ZIP export holds the package in memory and is best for smaller atlases.

Older saved projects created before ownership-boundary topology may show a **Synchronize visible borders** action. It preserves valid authored border types, adds missing shared-border neighbours, and removes stale links that cross province interiors.

## Format references

- [Official Dominions 6 map-making manual](https://illwinter.com/dom6/dom6mapman.pdf)
- [Official Dominions 6 file formats](https://illwinter.com/dom6/dom6fileformats.pdf)
- [Official Dominions 6 modding manual](https://illwinter.com/dom6/dom6modman.pdf)
