# Pantokrator Atlas

Pantokrator Atlas is a local-first map maker for Dominions 6. It generates deterministic, multiplayer-oriented maps with up to eight linked planes and exports native `.map`/`.d6m` packages without requiring a mod.

- [Open the hosted GUI](https://pantokrator-atlas.mbatlle7.chatgpt.site)
- [Download the latest Windows release](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/releases/latest)
- [Read the complete user guide](docs/USER_GUIDE.md)

Projects, imported catalogs, and generated packages remain in your browser profile or on your device. Pantokrator Atlas does not upload or synchronize them. Save **Editable project JSON** backups to move projects between browsers or app addresses.

The Windows v0.1.4 installer predates the generation-budget and start-region analysis controls described below; those are part of this branch's hosted-app update. Keep a JSON backup from your older app before testing new project metadata.

## Run locally on Windows

1. Download `Pantokrator-Atlas-Setup-x64.exe` from the [latest release](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/releases/latest).
2. Run the setup and optionally select the Desktop shortcut.
3. Open **Pantokrator Atlas** from the Start Menu and leave its terminal window open while using the application.

The installer is per-user, needs no administrator access, and includes a private Node.js runtime plus the tested production build. It does not run npm, download dependencies, or need internet access after download. The launcher serves Atlas only on your computer, chooses a free port from 3000 through 3099, and opens the GUI automatically. Remove it later through **Windows Settings -> Apps -> Installed apps**.

The setup is not currently code-signed, so Windows may show an unknown-publisher warning. Download it only from this repository's release page; a `.sha256` file is supplied for verification. The portable `Pantokrator-Atlas-Windows.zip` is an alternative: it requires Node.js 22.13.0 or newer, extraction, and **Start Pantokrator Atlas.cmd**. GitHub's automatically generated source archives are not the portable release.

Where browser folder access is supported, use **Install directly**; otherwise use **Download ready ZIP**. See the [quick start](docs/USER_GUIDE.md#quick-start) for backups, updates, and troubleshooting.

## What it can generate

- Seeded terrain regions, varied province shapes, configurable wrapping, and movement borders derived from visible ownership.
- Natural oceans, one or several continents, island chains, or a central inland sea.
- Surface, Cave, Great Cavern, Cloud, Air, Underworld, Infernal, Abyss, Dream, Elemental, and Custom realms, including sparse chambers, corridors, and hubs.
- Flooded caves, water-to-water interplane links, and an edge-to-edge River Styx with two banks and controlled crossings.
- Automatic or manually edited gate networks, scale-aware starts, per-plane start blocking, cave-start nations, throne recommendations, and fairness warnings.
- Contextual province names, themed populations/recruitment, random-site affinities, and powerful special-plane guardians.
- Searchable game-content catalogs and scenario editing for nations, commanders, squads, sites, buildings, battle settings, and advanced directives.
- Combined terrain-flag artwork in the editor and PNG previews: adding Farm, Forest, Cave, and other flags changes the province's appearance immediately.
- Browser autosave, Undo/Redo, editable JSON backups, direct folder installation, ZIP export, and structural/gameplay validation.
- Planned-versus-current province budgets, control-scope labels, cross-plane province search, and a per-start structural inspector with temporary region highlights.

For every generator, plane, scenario, province, catalog, validation, and export control, use the [user guide](docs/USER_GUIDE.md).

## Typical workflow

1. Choose player count, provinces per player, start allocation, ocean style, and output size on **Generate**.
2. Add or customize planes, their sizes, start policies, terrain variants, and links on **Planes**.
3. Review the next-generation province budget, generate the atlas, then inspect current starts and validation notices.
4. Inspect or edit provinces, borders, gateways, starts, thrones, guardians, sites, and scenario settings.
5. Save **Editable project JSON** as a backup, then use **Install directly** or **Download ready ZIP**.

`Players x provinces per player` sizes only core Surface, Cave, Cavern, and surface-like solid Custom realms. Auto-sized bonus planes are added as a configurable percentage of that core total; percentages above 100% are allowed. Manual plane sizes are preserved.

Start provinces and their directly connected neighbors are protected from generated thrones and guardians. Gates prefer endpoints farther from starts and produce a warning when a constrained map requires a closer fallback. Assigning a nation-specific start clears conflicting independent setup from its capital. Start-blocked planes remain available for later manual or nation-specific allocation.

**Inspect starts** separates export validity, the legacy structural score, and analysis limitations. Compare potential graph connections with conservative dry/water-separated routes; inspect nearby population, authored guardians, thrones, competing starts, and realm entrances. Distances are graph hops, not turns, and unknown population or guardian difficulty remains unknown. These diagnostics do not simulate nation strength or certify multiplayer balance.

Optional game-patch and mod notes travel with project JSON and host reports. They never change generation or enable nation bonuses. Catalog versions are selector snapshots, not balance rulesets; patches and mods can invalidate nation-specific assumptions.

## Dominions engine boundaries

Generated maps use native game content. Keep these distinctions in mind:

- Provinces sharing a `#gate` number are connected in both directions; native map gates are not one-way.
- A map can define initial independent guardians and an owned province's numeric defence level. A new replenishing post-capture province-defence roster requires a nation or poptype supplied by a `.dm` mod.
- `#poptype` controls vanilla local recruitment but does not replace the independent army Dominions initially generates.
- Atlas's textures, terrain symbols, and realm backdrops appear in the editor and PNG previews. Playable exports carry the current terrain flags and geography; Dominions draws its own native scenery.
- Custom catalog imports supply editor metadata, not game content. Custom IDs may require a matching mod in Dominions.
- Referenced custom battle maps and skyboxes must be copied into the exported map folder separately.
- Steam Workshop publishing remains a Steam/Dominions workflow outside Pantokrator Atlas.

## Develop from source

For players, use the hosted GUI or Windows installer above. Source development requires **Node.js 22.13.0 or newer with npm**, plus Git for the clone method:

```powershell
git clone https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker.git
Set-Location "TLGs-Dom6-Map-Maker"
npm.cmd ci
npm.cmd run dev
```

Alternatively, choose **Code -> Download ZIP** on the [GitHub repository](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker), extract it, and open a terminal in the extracted folder before running the two npm commands. Open the address printed by the development server; it live-reloads source changes. On non-Windows systems, use `npm` instead of `npm.cmd`.

The root Windows launcher can also install locked dependencies and build a raw source checkout. That initial preparation requires network access; the Windows installer already contains a prepared build and runtime.

Before submitting a change, run:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint
npm.cmd run licenses:check
```

`npm test` includes a production build. CI additionally audits the locked dependencies and smoke-tests the local server and Windows launcher.

## Documentation and references

- [Complete user guide](docs/USER_GUIDE.md)
- [Bundled catalog coverage and post-manual IDs](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/CONTENT_CATALOG.md)
- [Artwork implementation and future asset-pack contract](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/ILLUSTRATED_ASSET_SPEC.md)
- [Artwork provenance](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/ASSET_PROVENANCE.md)

Historical verification records, not current issue lists: [August playtests](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/PLAYTEST_NOTES.md), [August audit](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/FULL_AUDIT_2026-08-11.md), and [September 5 bugfix review](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/BUGFIX_AUDIT_2026-09-05.md).

Official format references:

- [Official Dominions 6 map-making manual](https://illwinter.com/dom6/dom6mapman.pdf)
- [Official Dominions 6 file formats](https://illwinter.com/dom6/dom6fileformats.pdf)
- [Official Dominions 6 modding manual](https://illwinter.com/dom6/dom6modman.pdf)

The bundled population and fort tables come from the official map manual. Other selector indexes use a pinned Dom6 Inspector export; they do not automatically track later game updates.

## License

Pantokrator Atlas application code and original project materials use the permissive [0BSD license](LICENSE). Bundled dependencies retain their licenses and notices in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt). The generated Dominions selector catalog retains its separate [source notice](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/src/catalog/data/NOTICE.md) and [GPL-3.0 terms](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/src/catalog/data/LICENSE.dom6inspector.txt).

Offline catalog notices are in `licenses/dom6-catalog` in the installed Windows edition, or `src/catalog/data` in source checkouts and portable releases. Supplemental documentation links above open GitHub; the installer bundles this README and the user guide.
