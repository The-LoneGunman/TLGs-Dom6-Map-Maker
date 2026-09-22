# Terrain-edit repairs — September 22, 2026

Source-stage verification from `codex/terrain-edit-safety-sep22`, based on main `c4ee2d7`. Package version remains 0.1.5. These changes are unreleased: merging the source does not deploy the hosted app or update the Windows installer.

## Corrections

| Finding | Corrected behavior |
| --- | --- |
| Additional Cave Wall retained thrones/guardians | Primary and additive edits share cleanup for generic/team/nation starts, throne setup, catalogued throne sites, and guardian groups. The active custom catalog is respected. |
| Sea + Cave Wall produced +1250 native relief | Both flags remain intact and the province stays blocked. Sea/Deep relief now takes precedence, using the same submerged elevations as other aquatic combinations. Validation warns that this combination's native appearance is unverified. |
| Swamp + Forest used forest elevation | Marsh relief is 18, or 35 with Cave, regardless of preset/flag order. Sea, dry Cave Wall, explicit Mountains and Highland retain their established priority. Forest and swamp art layers remain present. |

Cave-wall cleanup also runs when a different primary preset retains an additional wall flag. It is one Undo-able edit; removing the flag alone does not resurrect cleared contents. Economy, unrelated sites, battle settings, raw text, identity, geometry and other provinces are preserved. Global start locks can refuse the commit; batch edits preserve field locks, while manual inspector edits retain their documented intentional override.

Validation catches imported or subsequently authored blocked-province throne/guardian conflicts. Native and illustrated package construction, including direct installation, refuse these conflicts before rendering or filesystem access. Diagnostic map-text inspection and editable project saving remain available for repair.

## Protocol and scope

The [official map manual](https://www.illwinter.com/dom6/dom6mapman.pdf) describes additive terrain flags but does not expressly prohibit Sea + Cave Wall. The [official D6M format](https://www.illwinter.com/dom6/dom6fileformats.pdf) separately specifies aquatic province flags and signed heights. Consequently this repair is an Atlas consistency policy, not a claim that the prior positive height violated the binary format. No new native-game visual acceptance is claimed for the mixed Sea + Cave Wall case; the preview still portrays it as sealed rock.

Only catalogued throne sites are identified; unknown mod sites are not guessed away. Recognized province-level raw guardian commands and `#feature`/`#knownfeature` throne references cause an error rather than being silently deleted. This is not a general raw-command interpreter: plane/project-level commands can override province selections, terrain and content and still require host review. Illustrated export retains its existing rejection of active advanced raw commands.

## Verification

- Regression tests cover both edit paths, all start types, custom catalogs, collateral lock protection, Undo snapshots, imported conflicts, raw province-command refusal, and early native/illustrated package refusal.
- Binary checks verify aquatic specs and center heights, low swamp relief, unchanged ownership, and identical playable files for equivalent primary/additive wall edits.
- Local browser testing on the isolated `127.0.0.1:3026` origin reproduced a Forest province with a preferred throne and a guardian group; additional Cave Wall cleared both, Undo restored both, and reintroducing a throne blocked playable export. Sea + Cave Wall displayed the new warning. Reload preserved the edited project, Forest + Swamp retained both flags, inspector help remained readable, and no browser warnings/errors were captured.
- `npm test`: production build passed; 14 integration and 940 TypeScript tests passed (954 total, including 34 new terrain regressions), zero failures or skips.
- `npm run typecheck`, `npm run lint`, `npm run licenses:check`, and `git diff --check` passed. An independent sub-agent review found no further in-scope blocker; the raw-command scope and native mixed-terrain visual limit above remain explicit.
