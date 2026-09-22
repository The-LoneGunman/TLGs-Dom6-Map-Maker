import { landformWaterError, type Plane } from "./domain";

export interface WaterLandformSample {
  shore: number;
  water: number;
  normalX: number;
  normalY: number;
  roundingX: number;
  roundingY: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const periodic = (distance: number, wrap: boolean) => wrap ? distance - Math.round(distance) : distance;

/**
 * Shape hints use the water bodies captured at generation, never live terrain.
 * Shore profiles influence one shared deformation field on both sides of the
 * coastline; they cannot paint a bay over a different clickable province.
 */
export function createWaterLandformProfile(plane: Plane): ((x: number, y: number) => WaterLandformSample) | undefined {
  if (landformWaterError(plane) || !plane.landformWater?.length) return undefined;
  const bodyById = new Map(plane.landformWater.flatMap((body, index) => body.provinceIds.map(id => [id, index] as const)));
  const groupForOwner = plane.provinces.map(p => bodyById.get(p.id) ?? -1);
  const pitch = 1 / Math.sqrt(Math.max(1, plane.provinces.length));
  const basins = plane.landformWater.map(body => {
    const members = plane.provinces.filter(p => body.provinceIds.includes(p.id));
    if (!body.enclosed || !members.length || members.length > 6) return undefined;
    const anchor = members[0]!;
    const xs = members.map(p => anchor.x + periodic(p.x - anchor.x, plane.wrapX));
    const ys = members.map(p => anchor.y + periodic(p.y - anchor.y, plane.wrapY));
    const x = xs.reduce((sum, v) => sum + v, 0) / xs.length, y = ys.reduce((sum, v) => sum + v, 0) / ys.length;
    // Preserve an elongated lake's orientation/extent instead of forcing every
    // basin into a circle. Only its sharper corners receive the rounding hint.
    const rx = Math.max(pitch * .48, (Math.max(...xs) - Math.min(...xs)) * .5 + pitch * .45);
    const ry = Math.max(pitch * .48, (Math.max(...ys) - Math.min(...ys)) * .5 + pitch * .45);
    return { x, y, rx, ry };
  });
  return (x, y) => {
    let waterDistance = Infinity, dryDistance = Infinity, waterOwner = -1, dryOwner = -1;
    for (let owner = 0; owner < plane.provinces.length; owner++) {
      const p = plane.provinces[owner]!, dx = periodic(x - p.x, plane.wrapX), dy = periodic(y - p.y, plane.wrapY);
      const distance = dx * dx + dy * dy;
      if (groupForOwner[owner]! >= 0) {
        if (distance < waterDistance) { waterDistance = distance; waterOwner = owner; }
      } else if (distance < dryDistance) { dryDistance = distance; dryOwner = owner; }
    }
    if (waterOwner < 0) return { shore: 0, water: 0, normalX: 0, normalY: 0, roundingX: 0, roundingY: 0 };
    if (dryOwner < 0) return { shore: 0, water: 1, normalX: 0, normalY: 0, roundingX: 0, roundingY: 0 };
    const wet = plane.provinces[waterOwner]!, dry = plane.provinces[dryOwner]!;
    const nx = periodic(dry.x - wet.x, plane.wrapX), ny = periodic(dry.y - wet.y, plane.wrapY);
    const length = Math.max(1e-9, Math.hypot(nx, ny));
    const difference = (Math.sqrt(waterDistance) - Math.sqrt(dryDistance)) / length;
    const shore = Math.max(0, 1 - Math.abs(difference) / .72) ** 2;
    const water = clamp(.5 - difference, 0, 1);
    const basin = basins[groupForOwner[waterOwner]!];
    let roundingX = 0, roundingY = 0;
    if (basin) {
      const dx = periodic(x - basin.x, plane.wrapX), dy = periodic(y - basin.y, plane.wrapY);
      const radius = Math.hypot(dx / basin.rx, dy / basin.ry);
      if (radius > .3) {
        roundingX = clamp(dx * (1 / radius - 1) / pitch * 3, -1, 1);
        roundingY = clamp(dy * (1 / radius - 1) / pitch * 3, -1, 1);
      }
    }
    return { shore, water, normalX: nx / length, normalY: ny / length, roundingX, roundingY };
  };
}
