# Release verification — 0.1.6

Release date: October 14, 2026. Version 0.1.6 collects the changes since the published 0.1.5 build, including [PR #15](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/pull/15) and [release preparation PR #16](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/pull/16); see the [release notes](RELEASE_NOTES_0.1.6.md). Source testing, hosted deployment and Windows publication are recorded separately below.

## Delivery

The release tag `v0.1.6` and saved hosted Site version 14 both use source commit `e55fa6d5de4b71a91a08feffaa209ccbb6fc2fd5`. That source was merged into `main` as `846c8682646127518129316e95ba57ec2248f16b`; the trees are identical. The hosted package contains build output from that exact source, not a separate implementation.

Both editions are published:

- **Hosted app:** [Pantokrator Atlas](https://pantokrator-atlas.mbatlle7.chatgpt.site), Site version **14**, successfully deployed at **2026-10-14 15:18 UTC**. Site ID: `appgprj_6a7a3e04e5748191af74a9c6d77420fe`; saved version: `appgprj_6a7a3e04e5748191af74a9c6d77420fe~appgver_97b18627772481919a31c96ece788653`; deployment: `appgdep_6acf9d236adc8191a023f10e1d2fff8c`. Existing public access was preserved.
- **Windows:** [v0.1.6 release](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/releases/tag/v0.1.6), published at **2026-10-14 15:17 UTC**, after all three jobs in the [tagged release run](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/actions/runs/38586622538) passed. The exact installer was compiled, installed into an isolated clean-runner directory, launched with its bundled runtime, and uninstalled; the gate verified removal of the private runtime.
- **Public delivery checks:** downloaded both public assets and their checksum sidecars, checked file sizes and SHA-256 against the GitHub asset metadata, and confirmed the portable ZIP's version and source marker. The live hosted UI loaded without console warnings/errors and exposed the new artwork selector; its entry/framework bundle names matched the packaged source build. Existing browser project settings were preserved; the live check did not regenerate a user's map.

| Public asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `Pantokrator-Atlas-Setup-x64.exe` | 46,111,926 | `2c9c61be63855bb1373aeb44273032474202c6662985a87f3d7a3f0dbeb19dbc` |
| `Pantokrator-Atlas-Windows.zip` | 47,097,434 | `32621ae9083bcfd3fd12f5001ff64d8e5c29c0a6cbf8fbbdeb941da15b218abc` |

This final delivery record is a documentation-only follow-up to the tagged source. It does not change the released application or replace its artifacts.

## Baseline and release checks

The `95bad97` application baseline passed 1,141 local automated tests and [Linux/Windows PR checks](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/actions/runs/38567588641). The [October repair record](AUDIT_REPAIRS_2026-10-14.md) details the compatibility corpus, export/naming browser checks and local dependency patch.

The 0.1.6 candidate passed the production build, 1,142 automated tests (15 integration, 9 dependency-security and 1,118 TypeScript tests), typecheck, lint and third-party license checks. The complete registry dependency audit reported zero vulnerabilities. [Linux/Windows PR checks](https://github.com/The-LoneGunman/TLGs-Dom6-Map-Maker/actions/runs/38585608677) passed. The tagged release build independently repeated the complete suite and verified its dependency-free portable package; these source checks do not substitute for the Windows installer gate.

Browser QA used an isolated local production origin and the disposable `Atlas Release QA` project (seed `release-016-browser`): four planes, 182 provinces and six starts. Generation, cave/cloud/Underworld previews, the winter preview, export validation, resolution-reduction recovery, Undo/Redo, autosave/reload and narrow-screen navigation were exercised without browser console errors. The illustrated ready ZIP completed with 65 files, including 54 terrain/season artwork sheets whose headers all matched the selected 960×540 dimensions. The full render took several minutes; the conservative memory warning remained visible. No existing user project or game save was replaced.

The installer bundles Node.js **22.23.3** from the [official release](https://nodejs.org/en/blog/release/v22.23.3), with the Windows x64 ZIP pinned to SHA-256 `2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71`. The clean Windows gate verifies that checksum, the compiler attestation/signature, and installation, launch and uninstallation of the exact generated installer. The installer remains unsigned.

The `braces` local fork is tested explicitly in addition to the unchanged registry audit. Registry audit results alone do not certify a private fork; [maintenance and removal criteria](../vendor/braces/README.md) remain in force.

## Compatibility and acceptance limits

- Save editable JSON before upgrading. Stored projects are not automatically regenerated, and manual/locked names remain protected. Regeneration applies the latest geometry and start-placement rules.
- Native scenery remains the default. Illustrated export includes nine realm types, uses image-based province numbering, and requires a new game when changing artwork modes. Raw directives remain native-only.
- The catalog remains a Dominions 6.37 snapshot, and population-matched defenders retain their opt-in patch/era/terrain restrictions. This release does not claim automatic adaptation to later game patches or mods.
- Earlier native artwork and guardian/recruitment observations are documented in the [0.1.5 record](RELEASE_VERIFICATION_0.1.5.md) and [illustrated-export evidence](ILLUSTRATED_EXPORT_2026-09-22.md). The latest contour/river refinements still need a new native visual pass; no full multiplayer campaign or calibrated balance is certified.
- The September 23 1,000-map structural corpus retained three constrained continental export blockers and 328 experimental quality misses. The later 128-case check had no export errors and 40 quality misses. These are diagnostics, not universal map-playability claims.
