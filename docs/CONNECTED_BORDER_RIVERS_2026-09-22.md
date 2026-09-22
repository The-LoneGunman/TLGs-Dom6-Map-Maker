# Connected border rivers — September 22, 2026

Source-stage verification from `codex/terrain-edit-safety-sep22`, following the terrain-edit repairs. These changes are unreleased: merging the source does not deploy the hosted app or update the Windows installer.

## Behavior

Newly generated solid Surface and surface-like Custom planes use continuous border-watercourses rather than independent river rolls. Existing saves, authored borders, sparse realms, the province-water River Styx, water quotas and ocean/cave connections are not rerouted.

- Routing uses the endpoints of actual shared province borders. Sharing a province alone does not establish continuity. Enabled wrap seams are joined; disabled seams are not. A native border whose fragments form multiple disconnected physical arcs is excluded from automatic routing.
- A deterministic drainage forest favors upland, freshwater and lake headwaters, low valleys and larger water-body outlets. Tributaries join existing downstream trunks without loops. If a component cannot reach a major coast, it uses other water, an unwrapped boundary, or a low inland basin. No water provinces or freshwater terrain flags are invented.
- A complete route takes priority over an exact edge quota. Standalone single-border rivers are not generated. The existing River share control budgets watercourse borders including bridges; zero disables them, and constrained explicit requests produce a notice. Very small positive quotas may require a two-border minimum.
- Capital and road crossings become bridges. Open movement uses bridged channels unless an explicit route mix overrides that policy. Bridge artwork now includes a continuous blue base beneath crossing marks. This does not add native river bit 2 to the bridge command.
- Routing is the final generated edge-kind pass, after start protection, route preferences and locked terrain restoration. No later road/pass roll can break the watercourse. Imported/custom border masks and mountain/impassable barriers are not used as automatic routes. Requested road shares are approximate because some crossings become bridges.

The [official map manual](https://www.illwinter.com/dom6/dom6mapman.pdf), “Basic Map Commands / #neighbourspec,” documents river borders separately from water-province terrain. Atlas retains its existing native river and bridge encoding, while D6M ownership and elevations remain unchanged by river routing. This is terrain-guided cartography, not a physical hydraulic simulation or a claim of native art parity.

## Verification evidence

Seventeen new regression tests independently inspect shared-border geometry, wrapped endpoint continuity, acyclic multi-border networks, upland/coastal routing, high and zero quotas, start/road bridge safety, native directives, unchanged D6M bytes, and preservation of sparse/authored maps. A twelve-map real-generation corpus spans ocean layouts, all wrap combinations, topology policies and river shares of 0/30/100%.

The five existing complete-generation snapshots were compared with main `c4ee2d7` before updating their expected hashes. Excluding timestamps, their only differences were Surface border kinds: default 19, islands 12, continents 19, caves 8, eight-plane atlas 12. Province content, IDs, coordinates, terrain, starts, gateways, and every non-Surface plane were identical. The original hashes were reproduced by the comparison.

An 800-province full-generation stress case completed with 1,252 connected-route border selections and an explicit notice that the requested 100% share could not be met without violating route constraints. A separate regular 800-province wrapped geometry fixture took about 0.43 seconds to build topology and 0.17 seconds for the river pass on this machine; these are observations, not performance guarantees.

Final verification passed: production build, 14 integration tests and 957 TypeScript tests (971 total, zero failures or skips), typecheck, ESLint, license checks, and diff whitespace checks. Independent sub-agent review found no further in-scope blocker.

Interactive browser checks passed on the isolated `127.0.0.1:3027` build using seed `river-review-0`, 96 provinces and 2048×1152 output. Actual UI generation was checked at inherited density, explicit 25%, and 0%. The denser map displayed joined blue channels and bridge underlays; zero removed border rivers without changing the province-water layout. Pending-setting labels, generation confirmation/progress, and the new preference help worked, with no captured browser warnings/errors. The initial navigation failure was resolved by restarting the local preview server after a build had replaced its cached output files; no alternate browser was needed.

No new Dominions 6 in-game visual acceptance is claimed. Native river/bridge drawing, especially at wrap seams, remains engine-controlled. Native export flags and unchanged D6M geography are covered by automated tests.
