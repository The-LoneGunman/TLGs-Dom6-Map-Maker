# Pantokrator Atlas 0.1.6

This release brings the accumulated realm-artwork, natural-geography and usability improvements to the hosted app and Windows distribution.

## Highlights

- **Illustrated realms:** optional custom in-game landscapes for sky, caves, Underworld, Hell/Abyss, Dreamlands and Elemental planes, including terrain/winter sheets. Native scenery remains the default; Surface and Custom planes stay native.
- **More natural maps:** connected cavern groups with broad passages, varied province and shoreline contours, connected border rivers, and smaller default temperate biomes.
- **Safer editing:** consistent cave-wall cleanup, aquatic/wooded-swamp relief, improved island-start placement, stable seeded recipes, and single-step numeric Undo.
- **Easier export:** browser-aware installation options and a validated, Undoable resolution reduction for oversized ZIPs. Provinces and connections are preserved.
- **Polish and maintenance:** repeated-word generated names are corrected, a second Windows launch reuses the running Atlas, and dependency security updates include a tested local nesting-limit patch.

## Install and update

Download **Pantokrator-Atlas-Setup-x64.exe** for the per-user installer with its own Node.js 22.23.3 runtime. No separate Node.js installation or internet connection is needed after download. The setup is unsigned; obtain it from this release and compare its SHA-256 sidecar if Windows shows an unknown-publisher warning.

**Pantokrator-Atlas-Windows.zip** is the portable alternative and requires Node.js 22.13.0 or newer. Extract it before running **Start Pantokrator Atlas.cmd**. GitHub's automatic source archives are not the portable application.

Before upgrading, export important work as **Editable project JSON** and close the old launcher. Browser storage belongs to the exact address and profile; a different port or browser may require importing your backup. Older builds may reject newer project fields.

For illustrated artwork, choose **Install / export → In-game artwork → Illustrated realms**. Use a complete new package and start a new game when changing artwork modes: province numbering can differ. Active raw commands require Native scenery.

## Verification and limits

Publication is gated by the full automated suite, dependency security checks, exact portable-ZIP smoke tests, and installer compilation, installation, launch and uninstallation on a clean Windows runner. See the [release verification record](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/blob/main/docs/RELEASE_VERIFICATION_0.1.6.md) for source and delivery evidence.

The Dominions selector catalog and population-defender templates remain pinned to their documented 6.37 scope. Native visual checks cover the specific fixtures recorded in the guides; the latest contour/river refinements still need a fresh in-game visual pass. Structural diagnostics are not a multiplayer-balance certificate.
