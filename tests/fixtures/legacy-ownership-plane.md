# Legacy ownership fixture

`legacy-ownership-plane.json` freezes the `underground-isolation-baseline` Surface plane before the September22 natural-shape and biome changes. It was replayed with the `c4ee2d7` climate/terrain sampler and 68% cohesion, with the separately verified September22 border-river pass. River/bridge kind changes do not affect the six ownership digests used by `underground-geometry.test.ts`.

This fixture deliberately has no `landformStyle` or `landformWater` metadata. Keep its historical ownership digests unchanged: regenerating its input through current defaults would test a different map, not saved-map compatibility. New generated shapes and biome distributions have separate test suites.
