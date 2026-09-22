import assert from "node:assert/strict";
import test from "node:test";
import { skyPreviewSize } from "../src/MapCanvas";

test("sky preview sizing preserves wide and portrait aspect ratios at display density", () => {
  assert.deepEqual(skyPreviewSize({ width: 3840, height: 2160 }, 960, 540), { width: 960, height: 540 });
  assert.deepEqual(skyPreviewSize({ width: 2160, height: 3840 }, 540, 960), { width: 540, height: 960 });
});

test("sky preview sizing keeps both axes renderer-compatible and respects the pixel envelope", () => {
  assert.deepEqual(skyPreviewSize({ width: 3840, height: 256 }, 320, 100), { width: 3840, height: 256 },
    "a 256-pixel source axis prevents unsafe sub-minimum downscaling");
  assert.deepEqual(skyPreviewSize({ width: 2880, height: 2880 }, 720, 720), { width: 720, height: 720 });
  assert.equal(skyPreviewSize({ width: 2881, height: 2880 }, 720, 720), undefined,
    "a source above the 8.29-megapixel envelope is rejected before allocation");
  assert.equal(skyPreviewSize({ width: 3841, height: 256 }, 960, 256), undefined);
  assert.equal(skyPreviewSize({ width: 255, height: 256 }, 255, 256), undefined);
});

test("invalid source and offscreen display dimensions fall through safely", () => {
  for (const [plane, width, height] of [
    [{ width: Number.NaN, height: 256 }, 500, 500],
    [{ width: 256, height: Number.POSITIVE_INFINITY }, 500, 500],
    [{ width: 256.5, height: 256 }, 500, 500],
    [{ width: 256, height: 256 }, Number.NaN, 500],
    [{ width: 256, height: 256 }, 500, Number.POSITIVE_INFINITY],
    [{ width: 256, height: 256 }, 0, 500],
    [{ width: 256, height: 256 }, -1, 500],
    [{ width: 256, height: 256 }, 500, -1],
  ] as const) assert.equal(skyPreviewSize(plane, width, height), undefined);
});

test("native-resolution PNG requests remain exact while fractional display sizes round within bounds", () => {
  const plane = { width: 1001, height: 777 };
  assert.deepEqual(skyPreviewSize(plane, plane.width, plane.height), plane);
  assert.deepEqual(skyPreviewSize(plane, 500.4, 333.3), { width: 500, height: 388 });
  assert.deepEqual(skyPreviewSize(plane, 5000, 5000), plane, "preview scaling never exceeds native resolution");
  const rounded = skyPreviewSize(plane, 413.7, 290.2)!;
  assert.ok(Number.isSafeInteger(rounded.width) && Number.isSafeInteger(rounded.height));
  assert.ok(rounded.width >= 256 && rounded.height >= 256);
  assert.ok(rounded.width <= plane.width && rounded.height <= plane.height);
});
