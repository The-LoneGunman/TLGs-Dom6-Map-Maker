# September 19, 2026 repair notes

This dated record describes the corrective pass committed as `c0ab14a`, not completion of the [multiplayer feature roadmap](MULTIPLAYER_IMPLEMENTATION_STATUS.md). The [September 20 verification](REPAIR_VERIFICATION_2026-09-20.md) records subsequent corrections. See the root [version table](../README.md#versions-and-documentation) for which delivery channels include them.

## Corrected

- Removing a middle plane and adding another no longer reuses a surviving plane ID.
- Start-basin repair preserves the Underworld's two dry Styx banks and designated bridges.
- Small/Large generation flags are disjoint and recomputed from final topology; layers below 17 provinces no longer become entirely Large.
- Resetting wrap defaults or changing archetypes synchronizes current borders while retaining province content and surviving border metadata.
- Map tools require a matching primary-pointer click; right/middle clicks, orphan releases, canceled gestures and panning do not apply tools.
- ID-only catalog fields resolve explicit IDs and unique names. Ambiguous or invalid names preserve prior values, and equivalent IDs create no edit.
- Late project imports cannot replace newer imports, edits, Undo/Redo, a new atlas or a restored recovery copy.
- Direct installs exclude competing same-origin tabs, check target and backup bytes, preserve detected outside writes, and safely retry stage-only interrupted first installs without deleting old staging files.
- Start validation and legacy fairness no longer retain a full per-start distance matrix or allocate all pairwise throne differences. Oversized start sets retain exact spacing checks with bounded diagnostics; malformed duplicate-ID drafts produce finite scores and validation errors.
- Compatible Cloudflare tooling and YAML dependency updates remove the high-severity dependency-audit findings.

## Verification and boundaries

Regression coverage includes the original failure seeds, pointer callbacks, catalog blur, reversed import completion, install conflicts/rollback, graph-helper differential tests and a 6,400-start imported draft. Independent reviewers compared fairness and validation with the prior implementation on generated and randomized maps. Local browser checks covered nation assignment/ambiguous blur, wrap reset and archetype changes. Production build, launcher/server smoke, type checking, lint and license checks passed; the dependency audit reported zero vulnerabilities.

Browser Web Locks cover one app address within a browser profile, not different profiles, applications or app addresses. Fingerprint checks are not an atomic filesystem transaction. No real Dominions map folder was used for destructive failure simulations; those tests use an in-memory filesystem. A fresh in-engine multiplayer playtest and full touch/assistive-technology pass remain outside this repair verification.

The bundled selector catalog remains honestly labeled 6.35. Official [6.36](https://steamcommunity.com/games/2511500/announcements/detail/693143486970465343) and [6.37](https://steamcommunity.com/games/2511500/announcements/detail/717915822014595135) announcements list no new nation/unit IDs; full later-patch data equivalence is not certified. No guessed IDs or patch-sensitive nation-strength compensation were added.
