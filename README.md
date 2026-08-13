# Pantokrator Atlas

Pantokrator Atlas is a local-first map maker for Dominions 6. It generates deterministic, multiplayer-oriented native `.d6m` maps with up to eight linked planes and exports a complete, ready-to-play map folder without requiring a mod.

- [Open the hosted GUI](https://pantokrator-atlas.mbatlle7.chatgpt.site)
- [Download the latest Windows release](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/releases/latest)
- [Read the complete user guide](docs/USER_GUIDE.md)

Projects, imported catalogs, and generated packages remain in your browser profile or on your device. Pantokrator Atlas does not upload or synchronize them.

## Run locally on Windows

1. Download `Pantokrator-Atlas-Setup-x64.exe` from the [latest release](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/releases/latest).
2. Run the setup and optionally select the Desktop shortcut.
3. Open **Pantokrator Atlas** from the Start Menu and leave its terminal window open while using the application.

The installer is per-user, needs no administrator access, and includes a private Node.js runtime plus the tested production build. It does not run npm, download dependencies, or need internet access after download. The launcher serves Atlas only on your computer, chooses a free port from 3000 through 3099, and opens the GUI automatically. Remove it later through **Windows Settings -> Apps -> Installed apps**.

The setup is not currently code-signed, so Windows may show an unknown-publisher warning. Download it only from this repository's release page; a `.sha256` file is supplied for verification. The portable `Pantokrator-Atlas-Windows.zip` remains available, but it requires Node.js 22.13.0 or newer and must be extracted before use. Edge or Chrome is recommended because its folder-access support enables **Install directly**; other current browsers can use **Download ready ZIP**. See the [quick start](docs/USER_GUIDE.md#quick-start) for updates, backups, and troubleshooting.

## What it can generate

- Coherent biomes, additive Dominions terrain flags, varied province shapes, configurable wrapping, and ownership-derived movement borders
- Natural oceans, a single continent, multiple continents, island chains, or a central inland sea
- Surface, cave, cavern, cloud, air, underworld, infernal, abyss, dream, elemental, and custom plane archetypes
- Sparse special realms with themed negative-space backdrops, irregular chambers, corridors, and hubs
- Flooded cave provinces, safe water-to-water interplane links, and an edge-to-edge River Styx with two banks and controlled crossings
- Compatible, hub, chain, ring, or manually configured gate networks between planes
- Scale-aware start spacing, configurable start allocations, plane-level start blocking, cave-start nations, throne placement, and warnings when requested spacing cannot fit
- Plane- and terrain-specific province names, populations, recruitment themes, guardians, sites, and initial guardian strength
- Searchable bundled Dominions catalogs for nations, units, sites, poptypes, forts, and thrones
- Scenario controls for ownership, armies, commanders, magic, sites, forts, temples, labs, AI players, victory points, battle maps, skyboxes, and advanced directives
- Editable project JSON, browser autosave, Undo/Redo, preview PNGs, direct folder installation, and ZIP export
- Validation for topology, start safety, gates, terrain, catalog IDs, filenames, directives, and `.d6m` structure

For every generator, plane, scenario, province, catalog, validation, and export control, use the [user guide](docs/USER_GUIDE.md).

## Typical workflow

1. Choose player count, provinces per player, start allocation, ocean style, and output size on **Generate**.
2. Add or customize planes, their sizes, start policies, terrain variants, and links on **Planes**.
3. Generate the atlas and review its balance notices and validation report.
4. Inspect or edit provinces, borders, gateways, starts, thrones, guardians, sites, and scenario settings.
5. Save **Editable project JSON** as a backup, then use **Install directly** or **Download ready ZIP**.

`Players x provinces per player` sizes only core Surface, Cave, Cavern, and surface-like solid Custom realms. Auto-sized bonus planes are added as a configurable percentage of that core total; percentages above 100% are allowed. Manual plane sizes are preserved.

Start provinces and their directly connected neighbors are protected from generated thrones and guardians. Gates prefer endpoints farther from starts and produce a warning when a constrained map requires a closer fallback. Assigning a nation-specific start clears conflicting independent setup from its capital. Start-blocked planes remain available for later manual or nation-specific allocation.

## Dominions engine boundaries

Pantokrator Atlas produces native, zero-mod map packages. A few engine distinctions are therefore important:

- Provinces sharing a `#gate` number are connected in both directions; native map gates are not one-way.
- A map can define initial independent guardians and an owned province's numeric defence level. A new replenishing post-capture province-defence roster requires a nation or poptype supplied by a `.dm` mod.
- `#poptype` controls vanilla local recruitment but does not replace the independent army Dominions initially generates.
- Referenced custom battle maps and skyboxes must be copied into the exported map folder separately.
- Steam Workshop publishing remains a Steam/Dominions workflow outside Pantokrator Atlas.

## Develop from source

```powershell
npm.cmd ci
npm.cmd run dev
```

Before submitting a change, run the release checks:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint
npm.cmd run licenses:check
```

The development server live-reloads source changes. The root launcher can also prepare a raw source checkout, but the hosted GUI or release ZIP is the recommended route for players.

## Documentation and references

- [Complete user guide](docs/USER_GUIDE.md)
- [Bundled content catalog and post-manual IDs](docs/CONTENT_CATALOG.md)
- [Illustrated asset specification](docs/ILLUSTRATED_ASSET_SPEC.md)
- [Asset provenance](docs/ASSET_PROVENANCE.md)
- [Official Dominions 6 map-making manual](https://illwinter.com/dom6/dom6mapman.pdf)
- [Official Dominions 6 file formats](https://illwinter.com/dom6/dom6fileformats.pdf)
- [Official Dominions 6 modding manual](https://illwinter.com/dom6/dom6modman.pdf)

The bundled population and fort tables come from the official map manual. Unit, site, nation, special-plane, and site-location indexes are generated from the pinned Dom6 Inspector revision documented in [`src/catalog/data/NOTICE.md`](src/catalog/data/NOTICE.md).

## License

Pantokrator Atlas application code and original project materials use the permissive [0BSD license](LICENSE). Bundled dependencies retain their licenses and notices in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt). The generated Dominions selector catalog retains its separately documented source and GPL-3.0 terms in [`src/catalog/data/NOTICE.md`](src/catalog/data/NOTICE.md) and [`src/catalog/data/LICENSE.dom6inspector.txt`](src/catalog/data/LICENSE.dom6inspector.txt).
