# Pantokrator Atlas

Pantokrator Atlas is a local-first map maker for Dominions 6. It generates deterministic, multiplayer-oriented maps with up to eight linked planes and exports playable packages without requiring a mod. Native `.map`/`.d6m` scenery is the default; the development source also offers custom illustrated realm exports.

- [Open the hosted GUI](https://pantokrator-atlas.mbatlle7.chatgpt.site)
- [Download the latest Windows release](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/releases/latest)
- [Read the complete user guide](docs/USER_GUIDE.md)

Projects, imported catalogs, and generated packages remain in your browser profile or on your device. Pantokrator Atlas does not upload or synchronize them. Save **Editable project JSON** backups to move projects between browsers or app addresses.

## Versions and documentation

The package version remains **0.1.5**. Sections explicitly marked **Unreleased development** describe later source work that is not in the published hosted app or Windows v0.1.5 release; merging source does not deploy or publish either edition.

| Edition | Where to check the build | Availability |
| --- | --- | --- |
| Source checkout | Selected Git branch/commit and `package.json` | The package version is still 0.1.5; the selected commit determines whether unreleased features are present. A normal clone selects the default branch, not an unmerged development branch. |
| Hosted GUI | [Open app](https://pantokrator-atlas.mbatlle7.chatgpt.site) and [release verification](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/RELEASE_VERIFICATION_0.1.5.md) | Updated by a separate deployment; newer source documentation alone does not identify the deployed build. |
| Windows installer / portable release | [Latest release and its notes](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/releases/latest) | Contains the tagged build supplied by that release, not every later source change. |

The [release verification record](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/RELEASE_VERIFICATION_0.1.5.md) tracks 0.1.5 testing and delivery separately. Check the hosted deployment or release notes for the edition you use. Keep a pre-upgrade JSON backup: older builds may reject newer optional project fields.

**Published September 21, 2026:** the hosted GUI (Site version 13) and [Windows v0.1.5](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/releases/tag/v0.1.5) both use the tested `581b2b8` application source. Later documentation-only commits do not change that release build.

**Unreleased development:** sparse realms now automatically use [Connected regions & passages](docs/USER_GUIDE.md#province-layout): adjoining cave/realm provinces grouped into larger landforms, joined by substantial passage provinces. The classic selector has been removed. The Underworld retains its dedicated Styx geometry; incompatible authored maps retain explicitly identified compatibility geometry without losing their links. Original procedural landscapes cover Cloud/Air, Cave/Cavern, Underworld, Infernal/Abyss, Dream, and Elemental realms. In **Install / export**, choose **In-game artwork → Illustrated realms (custom artwork)** to include these landscapes in the playable package, with terrain/winter image sheets and province click areas. Surface and Custom planes retain native scenery. This work is not included in the published 0.1.5 app or installer; see the [illustrated-export status and evidence](docs/ILLUSTRATED_EXPORT_2026-09-22.md).

The 0.1.5 source includes smoother underground shapes and relief, the pinned 6.37 selector catalog, and opt-in population-matched initial defenders. The current v3 templates cover **76 population types in unmodded 6.37 Middle Age**, within their declared terrain scope; unsupported contexts retain native armies. See the [population-defender instructions](docs/USER_GUIDE.md#population-matched-initial-defenders) and [native acceptance evidence](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/research/NATIVE_POPULATION_DEFENDERS_2026-09-21.md).

## Run locally on Windows

1. Download `Pantokrator-Atlas-Setup-x64.exe` from the [latest release](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/releases/latest).
2. Run the setup and optionally select the Desktop shortcut.
3. Open **Pantokrator Atlas** from the Start Menu and leave its terminal window open while using the application.

The installer is per-user, needs no administrator access, and includes a private Node.js runtime plus the tested production build. It does not run npm, download dependencies, or need internet access after download. The launcher serves Atlas only on your computer, chooses a free port from 3000 through 3099, and opens the GUI automatically. Remove it later through **Windows Settings -> Apps -> Installed apps**.

The setup is not currently code-signed, so Windows may show an unknown-publisher warning. Download it only from this repository's release page; a `.sha256` file is supplied for verification. The portable `Pantokrator-Atlas-Windows.zip` is an alternative: it requires Node.js 22.13.0 or newer, extraction, and **Start Pantokrator Atlas.cmd**. GitHub's automatically generated source archives are not the portable release.

Where browser folder access is supported, use **Install directly**; otherwise use **Download ready ZIP**. See the [quick start](docs/USER_GUIDE.md#quick-start) for backups, updates, and troubleshooting.

## What it can generate

- Seeded terrain regions, varied province shapes, configurable wrapping, and movement borders derived from visible ownership. Unreleased temperate-biome tuning makes default terrain regions slightly smaller and more varied, without lowering saved cohesion settings.
- Natural oceans, one or several continents, island chains, or a central inland sea. Unreleased new generations add irregular shared coastlines, lobed inland basins, and less rigid continent/island separators; saved maps retain their prior outlines.
- Unreleased connected overland border rivers: terrain-guided channels and tributaries, safe bridge crossings, and an adjustable river share; the province-water Styx is separate.
- Surface, Cave, Great Cavern, Cloud, Air, Underworld, Infernal, Abyss, Dream, Elemental, and Custom realms, including sparse chambers, corridors, and hubs.
- Flooded caves, water-to-water interplane links, and an edge-to-edge River Styx with two banks and controlled crossings.
- Automatic or manually edited gate networks, scale-aware starts, per-plane start blocking, cave-start nations, throne recommendations, and fairness warnings.
- Fresh random seeds for new atlases, contextual province names with optional generated-name shuffling on reopen, themed populations/recruitment, random-site affinities, and powerful special-plane guardians.
- Searchable game-content catalogs and scenario editing for nations, commanders, squads, sites, buildings, battle settings, and advanced directives.
- Combined terrain-flag artwork in the editor and PNG previews: adding Farm, Forest, Cave, Water, and other flags changes the province's appearance immediately. Unreleased procedural landscapes add floating sky islands, textured caverns, tomb-like Underworld stone, infernal embers, abyssal obsidian, dream vegetation, and variant-led elemental accents.
- Editable custom border bitmasks with layered border styles, aspect-correct map framing, readable province details, and realm-aware illustrative condition previews.
- Browser autosave, Undo/Redo, editable JSON backups, direct folder installation, ZIP export, and structural/gameplay validation.
- Planned-versus-current province budgets, control-scope labels, cross-plane province search, and a per-start structural inspector with temporary region highlights.

Additional opt-in tools preserve inherited generation settings:

- **Iterate:** filtered province selections, named bookmarks, field/layout/start locks, previewed batch edits and content rerolls, settings recipes, and comparison of two or three generated candidates.
- **Plane preferences:** dry-terrain weights and regional plans, water preferences, eligible border mixes, guardian coverage/troop counts, and many-sites preferences.
- **Inspection and handoff:** read-only native-file inventories, separate guardian test maps, and player ZIPs that omit editable projects and host reports.
- **Structural review:** fractional expansion opportunity, hostile-frontier exposure, shared capital surroundings, separate objective distances, and optional patch-bound host terrain requirements. These requirements are checks, not automatic nation bonuses.

For every generator, plane, scenario, province, catalog, validation, and export control, use the [user guide](docs/USER_GUIDE.md).

## Typical workflow

1. Choose player count, provinces per player, start allocation, ocean style, and output size on **Generate**.
2. Add or customize planes, their sizes, start policies, terrain variants, and links on **Planes**.
3. Review the next-generation province budget, generate the atlas, then inspect current starts and validation notices.
4. Inspect or edit provinces, borders, gateways, starts, thrones, guardians, sites, and scenario settings. Use **Iterate** to preview larger changes or compare candidates.
5. Save **Editable project JSON** as a backup, choose the desired **In-game artwork** in development builds, then use **Install directly** or **Download ready ZIP**. **Download player ZIP** offers a reduced-spoiler handoff; playable map files remain inspectable.

`Players x provinces per player` sizes only core Surface, Cave, Cavern, and surface-like solid Custom realms. Auto-sized bonus planes are added as a configurable percentage of that core total; percentages above 100% are allowed. Manual plane sizes are preserved.

Start provinces and their directly connected neighbors are protected from generated thrones and guardians. Gates prefer endpoints farther from starts and produce a warning when a constrained map requires a closer fallback. Assigning a nation-specific start clears conflicting independent setup from its capital. Start-blocked planes remain available for later manual or nation-specific allocation.

**Inspect starts** separates export validity, the legacy structural score, and analysis limitations. Compare potential graph connections with conservative dry/water-separated routes; inspect nearby population, authored guardians, thrones, competing starts, and realm entrances. Distances are graph hops, not turns, and unknown population or guardian difficulty remains unknown. These diagnostics do not simulate nation strength or certify multiplayer balance.

Optional game-patch, era and mod declarations travel with project JSON and host reports. They never enable nation bonuses. When population-matched defenders are enabled, those declarations determine which verified templates may be exported; unsupported contexts retain native armies. Terrain-requirement checks are explicitly host-declared and become unverified when their declarations change. Catalog versions are selector snapshots, not balance rulesets; patches and mods can invalidate nation-specific assumptions.

## Dominions engine boundaries

Generated maps use native game content. Keep these distinctions in mind:

- Provinces sharing a `#gate` number are connected in both directions; native map gates are not one-way.
- A map can define initial independent guardians and an owned province's numeric defence level. A new replenishing post-capture province-defence roster requires a nation or poptype supplied by a `.dm` mod.
- `#poptype` controls vanilla local recruitment but does not replace the independent army Dominions initially generates.
- **Native scenery** uses `.d6m` geography and Dominions' own art. **Illustrated realms**, an unreleased option, bundles generated TGA landscapes for nine supported realm types while preserving native Surface/Custom planes. It does not export every editor badge, selection overlay, or bundled material texture. No manual image assembly is needed.
- Illustrated province numbers follow the image-marker order required by Dominions; structured starts, guardians, neighbors, and gates are remapped without changing the editable project. Advanced raw commands block this mode because arbitrary numeric references cannot be remapped safely; use Native scenery for those projects.
- Condition previews are illustrations, not game-event or temperature simulations. The illustrated exporter generates all 18 terrain/winter sheets independently of the selected preview. Cloud/Air receive eligible dry-island snow; other illustrated realms intentionally retain their winter palette. See [verification scope](docs/ILLUSTRATED_EXPORT_2026-09-22.md#verification-and-limits) before assuming every in-game transition has been visually tested.
- Custom catalog imports supply editor metadata, not game content. Custom IDs may require a matching mod in Dominions.
- Referenced custom battle maps and skyboxes must be copied into the exported map folder separately.
- Steam Workshop publishing remains a Steam/Dominions workflow outside Pantokrator Atlas.

## Develop from source

Use source for the controls and corrections on your selected branch; use the hosted GUI or Windows installer for the simpler setup paths above. A normal clone opens the default branch. Check the [version table](#versions-and-documentation) before expecting unreleased features. Source development requires **Node.js 22.13.0 or newer with npm**, plus Git for the clone method:

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

The 0.1.5 source passed **743 automated tests**, type checking, lint, license checks, and local-server/launcher checks. Native 6.37 checks loaded and visually inspected all eight planes, exercised all **161 released population-template terrain cases**, and completed one [generated Inferno guardian battle, capture, recruitment and PD inspection](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/research/NATIVE_GUARDIAN_CAPTURE_2026-09-21.md). The same eight-plane fixture also reached winter, with surface snow and intact cave waterways. See [release verification](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/RELEASE_VERIFICATION_0.1.5.md) for remaining limits, packaging and publication. These are scoped functional checks, not universal seasonal/PD verification or multiplayer balance certification. The earlier [1,000-map structural evaluation](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/IMPLEMENTATION_ROUND_2026-09-20.md) had no export errors but retained 243 experimental quality-target misses.

## Documentation and references

- [Complete user guide](docs/USER_GUIDE.md)
- [Documentation index and dated verification records](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/README.md)
- [Implemented multiplayer controls and remaining roadmap](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/MULTIPLAYER_IMPLEMENTATION_STATUS.md)
- [Bundled catalog coverage and post-manual IDs](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/CONTENT_CATALOG.md)
- [Artwork implementation and future asset-pack contract](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/ILLUSTRATED_ASSET_SPEC.md)
- [Artwork provenance](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/ASSET_PROVENANCE.md)
- [Unreleased procedural realm artwork](docs/REALM_ARTWORK_2026-09-21.md)
- [Unreleased in-game illustrated export and native evidence](docs/ILLUSTRATED_EXPORT_2026-09-22.md)
- [Unreleased natural province and water shapes](docs/NATURAL_LANDFORMS_2026-09-22.md)

The documentation index separates current references, unfinished proposals, and historical evidence. Old test counts and audit findings are not current release status.

Official format references:

- [Official Dominions 6 map-making manual](https://illwinter.com/dom6/dom6mapman.pdf)
- [Official Dominions 6 file formats](https://illwinter.com/dom6/dom6fileformats.pdf)
- [Official Dominions 6 modding manual](https://illwinter.com/dom6/dom6modman.pdf)

The bundled population and fort tables come from the official map manual. Other selector indexes use a pinned Dom6 Inspector export; they do not automatically track later game updates.

## License

Pantokrator Atlas application code and original project materials use the permissive [0BSD license](LICENSE). Bundled dependencies retain their licenses and notices in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt). The generated Dominions selector catalog retains its separate [source notice](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/src/catalog/data/NOTICE.md) and [GPL-3.0 terms](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/src/catalog/data/LICENSE.dom6inspector.txt).

Offline catalog notices are in `licenses/dom6-catalog` in the installed Windows edition, or `src/catalog/data` in source checkouts and portable releases. Supplemental documentation links above open GitHub; the installer bundles this README and the user guide.
