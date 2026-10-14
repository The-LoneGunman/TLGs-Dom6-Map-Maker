# Release verification — 0.1.6

Prepared October 14, 2026 from merged application source `95bad97`, including [PR #15](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/pull/15). Version 0.1.6 collects the changes since the published 0.1.5 build; see the [release notes](RELEASE_NOTES_0.1.6.md). Source testing, hosted deployment and Windows publication are recorded separately below.

## Delivery

Release preparation is in progress. No new hosted or installer publication is claimed by this initial record. The tagged release workflow will test the exact downloadable packages before publishing; the hosted version will use the same versioned application source. Final source identifiers, deployment and download checks will be recorded after success.

## Baseline and release checks

The `95bad97` application baseline passed 1,141 local automated tests and [Linux/Windows PR checks](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/actions/runs/38567588641). The [October repair record](AUDIT_REPAIRS_2026-10-14.md) details the compatibility corpus, export/naming browser checks and local dependency patch.

The 0.1.6 candidate passed the production build, 1,142 automated tests (15 integration, 9 dependency-security and 1,118 TypeScript tests), typecheck, lint and third-party license checks. The complete registry dependency audit reported zero vulnerabilities. These local results precede the clean release pipeline and do not substitute for its Windows installer gate.

Browser QA used an isolated local production origin and the disposable `Atlas Release QA` project (seed `release-016-browser`): four planes, 182 provinces and six starts. Generation, cave/cloud/Underworld previews, the winter preview, export validation, resolution-reduction recovery, Undo/Redo, autosave/reload and narrow-screen navigation were exercised without browser console errors. The illustrated ready ZIP completed with 65 files, including 54 terrain/season artwork sheets whose headers all matched the selected 960×540 dimensions. The full render took several minutes; the conservative memory warning remained visible. No existing user project or game save was replaced.

The installer bundles Node.js **22.23.3** from the [official release](https://nodejs.org/en/blog/release/v22.23.3), with the Windows x64 ZIP pinned to SHA-256 `2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71`. The clean Windows gate verifies that checksum, the compiler attestation/signature, and installation, launch and uninstallation of the exact generated installer. The installer remains unsigned.

The `braces` local fork is tested explicitly in addition to the unchanged registry audit. Registry audit results alone do not certify a private fork; [maintenance and removal criteria](../vendor/braces/README.md) remain in force.

## Compatibility and acceptance limits

- Save editable JSON before upgrading. Stored projects are not automatically regenerated, and manual/locked names remain protected. Regeneration applies the latest geometry and start-placement rules.
- Native scenery remains the default. Illustrated export includes nine realm types, uses image-based province numbering, and requires a new game when changing artwork modes. Raw directives remain native-only.
- The catalog remains a Dominions 6.37 snapshot, and population-matched defenders retain their opt-in patch/era/terrain restrictions. This release does not claim automatic adaptation to later game patches or mods.
- Earlier native artwork and guardian/recruitment observations are documented in the [0.1.5 record](RELEASE_VERIFICATION_0.1.5.md) and [illustrated-export evidence](ILLUSTRATED_EXPORT_2026-09-22.md). The latest contour/river refinements still need a new native visual pass; no full multiplayer campaign or calibrated balance is certified.
- The September 23 1,000-map structural corpus retained three constrained continental export blockers and 328 experimental quality misses. The later 128-case check had no export errors and 40 quality misses. These are diagnostics, not universal map-playability claims.
