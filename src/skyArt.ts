import { effectiveProvinceTerrainFlags, type Plane, type PreviewCondition, type TerrainFlag } from "./domain";

/** Terrain/winter sheet variants shared by the preview and illustrated exporter. */
export const SKY_ART_VARIANTS = Object.freeze([
  "default", "winter", "forest", "forestw", "waste", "wastew", "farm", "farmw",
  "swamp", "swampw", "highland", "highlandw", "plain", "plainw", "kelp", "kelpw", "water", "waterw",
] as const);
export type SkyArtVariant = typeof SKY_ART_VARIANTS[number];
/** Apply previewProvinceTerrain first; preview policies differ from native sheets. */
export function skyVariantForPreview(condition: PreviewCondition): "default" | "winter" {
  return condition === "winter" ? "winter" : "default";
}
type Color = readonly [number, number, number];
type Motif = "grass" | "forest" | "farm" | "swamp" | "waste" | "mountain" | "water" | "kelp" | "cave" | "cavewall";
interface Style {
  color: Color;
  motifs: Motif[];
  snow: number;
  water: boolean;
}
interface Detail {
  x: number;
  y: number;
  owner: number;
  radius: number;
  random: number;
}
interface Prepared {
  key: string;
  /** Exact comparison costs 2 bytes/pixel (at most 15.82 MiB), avoiding hash collisions. */
  owners: Int16Array;
  scale: number;
  tile: number;
  columns: number;
  rows: number;
  clouds: Uint8Array;
  cloudLight: Int8Array;
  texture: Int8Array;
  coast: Uint8Array;
  details: Detail[];
}
// One preparation per live input buffer, replaced on edits. The cached value
// references neither its input key nor returned RGB buffers, so it becomes
// eligible for collection with that input; callers do not need an eviction API.
const preparedCache = new WeakMap<Int16Array, Prepared>();
const MAX_PIXELS = 3840 * 2160;
const SKY_DARK: Color = [113, 157, 188];
const SKY_LIGHT: Color = [237, 241, 240];

/**
 * Original, procedural floating-island artwork. RGB rows run from top to bottom.
 * Owners are zero-based province-array positions; -1 is unowned sky. Only this
 * input mask decides playable footprints. Decorative cloud shadows and cliff
 * faces may occupy unowned sky but never change ownership. This editor/PNG
 * renderer intentionally omits native white province-center markers.
 *
 * Small, quantized cloud/land fields intentionally produce horizontal color runs
 * suitable for 24-bit TGA RLE. No raster assets, Canvas or native dependencies.
 */
export function renderSkyRgb(plane: Plane, owners: Int16Array, variant: SkyArtVariant, seed: string): Uint8Array {
  const { width, height } = plane;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 256 || height < 256
    || width > 3840 || height > 3840 || width * height > MAX_PIXELS) {
    throw new RangeError("Sky artwork dimensions exceed the supported 256-pixel to 8.29-megapixel envelope.");
  }
  if (!(owners instanceof Int16Array) || owners.length !== width * height) {
    throw new RangeError("Sky artwork requires one ownership value per native pixel.");
  }
  if (!(SKY_ART_VARIANTS as readonly string[]).includes(variant)) {
    throw new RangeError("Unknown sky artwork variant.");
  }
  // Seed/ID strings can contain delimiters, so concatenation is not a safe key.
  const key = JSON.stringify([width, height, plane.wrapX, plane.wrapY, seed, plane.provinces.map(p => p.id)]);
  let prepared = preparedCache.get(owners);
  let unchanged = prepared?.key === key;
  for (let pixel = 0; pixel < owners.length; pixel++) {
    const owner = owners[pixel]!;
    if (owner < -1 || owner >= plane.provinces.length) throw new RangeError("Sky artwork contains an invalid province owner.");
    if (unchanged && prepared!.owners[pixel] !== owner) unchanged = false;
  }
  if (!prepared || !unchanged) {
    prepared = prepare(plane, owners, key, hash(seed));
    preparedCache.set(owners, prepared);
  }
  const styles = plane.provinces.map(province => {
    const snowStrength = province.warmer && !province.colder ? .35 : province.colder && !province.warmer ? 1 : .8;
    return styleFor(effectiveProvinceTerrainFlags(province), variant, snowStrength);
  });
  const out = new Uint8Array(width * height * 3);
  const { scale, tile, columns, rows, clouds, cloudLight, texture, coast } = prepared;
  const cliffDepth = Math.max(2, Math.round(scale * 7));
  const shadowX = Math.max(2, Math.round(scale * 7)), shadowY = Math.max(3, Math.round(scale * 14));
  const ownerAt = (x: number, y: number) => {
    if (plane.wrapX) x = modulo(x, width);
    if (plane.wrapY) y = modulo(y, height);
    return x < 0 || y < 0 || x >= width || y >= height ? -1 : owners[y * width + x]!;
  };
  for (let y = 0; y < height; y++) {
    const fieldRow = Math.floor(y / tile) * columns;
    const cloudY = y / (plane.wrapY ? height - 1 : height) * (rows - 1);
    const cloudCellY = Math.min(rows - 2, Math.floor(cloudY));
    const cloudRow = cloudCellY * columns, fy = cloudY - cloudCellY;
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x, owner = owners[pixel]!, at = pixel * 3;
      const field = fieldRow + Math.floor(x / tile);
      if (owner < 0) {
        const cloudX = x / (plane.wrapX ? width - 1 : width) * (columns - 1);
        const cloudCellX = Math.min(columns - 2, Math.floor(cloudX));
        const cloudAt = cloudRow + cloudCellX, fx = cloudX - cloudCellX;
        // Interpolate the reusable low-resolution field; do not stamp its cells
        // directly into the image. Quantized final colors still form RLE runs.
        const light = Math.round(sampleField(clouds, cloudAt, columns, fx, fy) / 255 * 31) / 31;
        const illumination = Math.round(sampleField(cloudLight, cloudAt, columns, fx, fy) / 8) * 8 * light;
        let red = lerp(SKY_DARK[0], SKY_LIGHT[0], light) + illumination;
        let green = lerp(SKY_DARK[1], SKY_LIGHT[1], light) + illumination * .8;
        let blue = lerp(SKY_DARK[2], SKY_LIGHT[2], light) + illumination * .6;
        // A diffuse offset cast shadow and downward cliff extrusion make the
        // silhouettes read as floating land, rather than islands in water.
        if (ownerAt(x - shadowX, y - shadowY) >= 0) { red -= 23; green -= 22; blue -= 17; }
        else if (ownerAt(x - Math.round(shadowX * .65), y - Math.round(shadowY * .65)) >= 0) { red -= 12; green -= 11; blue -= 8; }
        if (ownerAt(x, y - cliffDepth) >= 0) {
          const stratum = (Math.floor(y / Math.max(1, scale * 2)) + Math.floor(x / Math.max(2, scale * 9))) % 3;
          red = 102 + stratum * 6; green = 103 + stratum * 6; blue = 104 + stratum * 7;
        }
        out[at] = quantize(red); out[at + 1] = quantize(green); out[at + 2] = quantize(blue);
        continue;
      }
      const style = styles[owner]!;
      const shade = texture[field]!;
      // Only the outside of a landmass gets a bright rim. Province boundaries
      // inside a group remain a restrained cartographic ink line.
      const edge = coast[pixel]! <= Math.max(1, Math.round(scale * 1.25));
      const border = (x > 0 || plane.wrapX) && ownerAt(x - 1, y) >= 0 && ownerAt(x - 1, y) !== owner
        || (y > 0 || plane.wrapY) && ownerAt(x, y - 1) >= 0 && ownerAt(x, y - 1) !== owner;
      const rim = edge ? style.water ? 17 : 21 : 0;
      const darken = border ? 23 : 0;
      out[at] = quantize(style.color[0] + shade + rim - darken);
      out[at + 1] = quantize(style.color[1] + shade + rim - darken);
      out[at + 2] = quantize(style.color[2] + shade + rim - darken);
    }
  }
  const paint = painter(plane, owners, out);
  for (const detail of prepared.details) {
    const style = styles[detail.owner]!;
    const choice = Math.floor(detail.random * style.motifs.length) % style.motifs.length;
    const motif = style.motifs[choice]!;
    if (motif === "grass" && detail.random > .24) continue;
    drawMotif(paint, detail, motif, style);
  }
  return out;
}

function prepare(plane: Plane, owners: Int16Array, key: string, seed: number): Prepared {
  const { width, height } = plane;
  const scale = Math.max(.6, Math.min(width, height) / 768);
  const tile = Math.max(2, Math.round(scale * 5));
  const columns = Math.ceil(width / tile) + 1, rows = Math.ceil(height / tile) + 1;
  const clouds = new Uint8Array(columns * rows), cloudLight = new Int8Array(columns * rows), texture = new Int8Array(columns * rows);
  const broad = noiseSampler(width, height, Math.max(3, width / (scale * 155)), Math.max(3, height / (scale * 155)), seed);
  const medium = noiseSampler(width, height, Math.max(5, width / (scale * 56)), Math.max(5, height / (scale * 56)), seed ^ 0x71fa95);
  const puffs = puffSampler(width, height, Math.max(3, width / (scale * 104)), Math.max(3, height / (scale * 76)), seed ^ 0x574f8);
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const px = x / (columns - 1) * width, py = y / (rows - 1) * height;
    const a = broad(px, py), b = medium(px, py);
    const mass = clamp((puffs(px, py) * .6 + a * .3 + b * .1 - .28) * 2.2, 0, 1);
    const wisp = Math.max(0, 1 - Math.abs(Math.sin(py / height * Math.PI * 2 * 7 + a * 2.5))) ** 5 * .18;
    const soft = Math.max(wisp, mass * mass * (3 - 2 * mass));
    clouds[y * columns + x] = Math.round(soft * 255);
    texture[y * columns + x] = Math.round((b - .5) * 12) * 2;
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const before = clouds[modulo(y - 1, rows - 1) * columns + modulo(x - 1, columns - 1)]!;
    const after = clouds[modulo(y + 1, rows - 1) * columns + modulo(x + 1, columns - 1)]!;
    cloudLight[y * columns + x] = Math.round((after - before) * .15);
  }
  const coast = distances(plane, owners, false), safe = distances(plane, owners, true);
  const spacing = 24 * scale, cellsX = Math.max(1, Math.round(width / spacing)), cellsY = Math.max(1, Math.round(height / spacing));
  const details: Detail[] = [];
  for (let row = 0; row < cellsY; row++) for (let column = 0; column < cellsX; column++) {
    const random = randomAt(column, row, seed ^ 0x9e374);
    const x = Math.floor((column + .25 + random * .5) * width / cellsX);
    const y = Math.floor((row + .25 + randomAt(row, column, seed ^ 0x8c637) * .5) * height / cellsY);
    const pixel = y * width + x, owner = owners[pixel]!;
    if (owner < 0 || safe[pixel]! < Math.max(3, 5 * scale)) continue;
    // Distance is Manhattan, so sqrt(2) bounds guarantee the entire circular
    // motif footprint fits in the same province, including across wrap seams.
    const radius = Math.min(10 * scale, safe[pixel]! / Math.SQRT2 * .8);
    details.push({ x, y, owner, radius, random: randomAt(column, row, seed ^ hash(plane.provinces[owner]!.id)) });
  }
  return { key, owners: owners.slice(), scale, tile, columns, rows, clouds, cloudLight, texture, coast, details };
}

function sampleField(field: Uint8Array | Int8Array, offset: number, stride: number, x: number, y: number): number {
  return lerp(
    lerp(field[offset]!, field[offset + 1]!, x),
    lerp(field[offset + stride]!, field[offset + stride + 1]!, x),
    y,
  );
}

function distances(plane: Plane, owners: Int16Array, internal: boolean): Uint8Array {
  const { width, height } = plane, out = new Uint8Array(owners.length);
  const at = (x: number, y: number) => {
    if (plane.wrapX) x = modulo(x, width);
    if (plane.wrapY) y = modulo(y, height);
    return x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x, owner = owners[pixel]!;
    if (owner < 0) continue;
    const boundary = (neighbor: number) => neighbor < 0 || (internal ? owners[neighbor] !== owner : owners[neighbor]! < 0);
    out[pixel] = boundary(at(x - 1, y)) || boundary(at(x + 1, y)) || boundary(at(x, y - 1)) || boundary(at(x, y + 1)) ? 1 : 255;
  }
  const passes = plane.wrapX || plane.wrapY ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (out[p]! <= 1) continue;
      const left = at(x - 1, y), up = at(x, y - 1);
      out[p] = Math.min(out[p]!, left >= 0 ? out[left]! + 1 : 1, up >= 0 ? out[up]! + 1 : 1);
    }
    for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
      const p = y * width + x;
      if (out[p]! <= 1) continue;
      const right = at(x + 1, y), down = at(x, y + 1);
      out[p] = Math.min(out[p]!, right >= 0 ? out[right]! + 1 : 1, down >= 0 ? out[down]! + 1 : 1);
    }
  }
  return out;
}

function styleFor(original: ReadonlySet<TerrainFlag>, variant: SkyArtVariant, winterStrength: number): Style {
  // A Cave Wall is blocked rock, not a traversable cave entrance. It takes
  // precedence over all additive terrain flags and condition transformations.
  if (original.has("cavewall")) return { color: [94, 107, 121], motifs: ["cavewall"], snow: 0, water: false };
  const flags = new Set(original);
  const winter = variant === "winter" || variant.endsWith("w");
  const cover = variant === "winter" ? "default" : variant.replace(/w$/, "");
  if (cover !== "default" && !flags.has("sea")) {
    for (const flag of ["forest", "farm", "swamp", "waste"] as const) flags.delete(flag);
    if (cover === "water" || cover === "kelp") { flags.add("sea"); flags.delete("freshwater"); }
    if (cover === "kelp") flags.add("forest");
    if (["forest", "farm", "swamp", "waste", "highland"].includes(cover)) flags.add(cover as TerrainFlag);
  }
  const water = flags.has("sea"), cave = flags.has("cave") || flags.has("cavewall");
  let color: Color = water ? flags.has("deep") ? [49, 101, 139] : [80, 145, 167]
    : cave ? [125, 142, 150] : flags.has("waste") ? [177, 153, 123]
      : flags.has("swamp") ? [117, 144, 135] : flags.has("forest") ? [114, 147, 119]
        : flags.has("farm") ? [177, 168, 125] : [144, 166, 140];
  if (!water && !cave && (flags.has("mountains") || flags.has("highland"))) color = mix(color, [162, 166, 157], .5);
  const snow = winter && !water && !cave ? winterStrength : 0;
  if (snow) color = mix(color, [229, 234, 229], snow);
  const motifs: Motif[] = [];
  if (flags.has("forest")) motifs.push(water ? "kelp" : "forest");
  if (flags.has("farm") && !water) motifs.push("farm");
  if (flags.has("swamp") && !water) motifs.push("swamp");
  if (flags.has("waste") && !water) motifs.push("waste");
  if ((flags.has("mountains") || flags.has("highland")) && !water) motifs.push("mountain");
  if (cave) motifs.push("cave");
  if (water || flags.has("freshwater")) motifs.push("water");
  if (!motifs.length) motifs.push("grass");
  return { color, motifs, snow, water };
}

interface Painter {
  ellipse(owner: number, x: number, y: number, rx: number, ry: number, color: Color): void;
  triangle(owner: number, a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], color: Color): void;
  line(owner: number, x1: number, y1: number, x2: number, y2: number, color: Color): void;
}
function painter(plane: Plane, owners: Int16Array, out: Uint8Array): Painter {
  const { width, height } = plane;
  const pixel = (owner: number, x: number, y: number, color: Color) => {
    x = Math.round(x); y = Math.round(y);
    if (plane.wrapX) x = modulo(x, width);
    if (plane.wrapY) y = modulo(y, height);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (owners[p] !== owner) return;
    out[p * 3] = quantize(color[0]); out[p * 3 + 1] = quantize(color[1]); out[p * 3 + 2] = quantize(color[2]);
  };
  return {
    ellipse(owner, x, y, rx, ry, color) {
      for (let py = Math.ceil(y - ry); py <= Math.floor(y + ry); py++) {
        const extent = rx * Math.sqrt(Math.max(0, 1 - ((py - y) / ry) ** 2));
        for (let px = Math.ceil(x - extent); px <= Math.floor(x + extent); px++) pixel(owner, px, py, color);
      }
    },
    triangle(owner, a, b, c, color) {
      const vertices = [a, b, c];
      for (let y = Math.ceil(Math.min(a[1], b[1], c[1])); y <= Math.floor(Math.max(a[1], b[1], c[1])); y++) {
        const intersections: number[] = [];
        for (let i = 0; i < 3; i++) {
          const v = vertices[i]!, next = vertices[(i + 1) % 3]!;
          if (v[1] === next[1] || y < Math.min(v[1], next[1]) || y >= Math.max(v[1], next[1])) continue;
          intersections.push(v[0] + (next[0] - v[0]) * (y - v[1]) / (next[1] - v[1]));
        }
        if (intersections.length >= 2) for (let x = Math.ceil(Math.min(...intersections)); x <= Math.floor(Math.max(...intersections)); x++) pixel(owner, x, y, color);
      }
    },
    line(owner, x1, y1, x2, y2, color) {
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))));
      for (let step = 0; step <= steps; step++) pixel(owner, lerp(x1, x2, step / steps), lerp(y1, y2, step / steps), color);
    },
  };
}

function drawMotif(p: Painter, d: Detail, motif: Motif, style: Style): void {
  const { x, y, owner: o, radius: r } = d;
  const dark = mix([83, 111, 96], [160, 183, 179], style.snow);
  const light = mix([172, 188, 155], [239, 242, 237], style.snow);
  if (motif === "forest") {
    p.ellipse(o, x + r * .1, y + r * .55, r * .64, r * .24, dark);
    p.line(o, x, y + r * .55, x, y - r * .15, [111, 109, 91]);
    for (const level of [0, .32, .6]) {
      const half = r * (.61 - level * .42), top = y - r * (.9 - level * .74), bottom = y + r * (.5 - level * .74);
      p.triangle(o, [x, top], [x - half, bottom], [x + half, bottom], level === 0 ? [65, 111, 92] : [83, 134, 109]);
      p.triangle(o, [x, top], [x - half * .75, bottom - r * .1], [x, bottom - r * .1], mix([121, 159, 127], [239, 242, 237], style.snow));
    }
  } else if (motif === "mountain") {
    p.ellipse(o, x, y + r * .55, r * .92, r * .21, [123, 135, 135]);
    p.triangle(o, [x - r * .86, y + r * .6], [x - r * .08, y - r * .88], [x + r * .85, y + r * .6], [127, 143, 148]);
    p.triangle(o, [x - r * .86, y + r * .6], [x - r * .08, y - r * .88], [x + r * .15, y + r * .6], [185, 192, 182]);
    p.triangle(o, [x - r * .33, y - r * .38], [x - r * .08, y - r * .88], [x + r * .22, y - r * .38], [234, 237, 230]);
  } else if (motif === "farm") {
    p.ellipse(o, x, y, r * .85, r * .59, mix([193, 179, 126], [205, 212, 194], style.snow));
    for (let row = -2; row <= 2; row++) p.line(o, x - r * .65, y + row * r * .2 - r * .15, x + r * .65, y + row * r * .2 + r * .15, mix([147, 141, 93], [177, 190, 176], style.snow));
  } else if (motif === "cavewall") {
    p.triangle(o, [x - r * .86, y + r * .66], [x - r * .38, y - r * .8], [x + r * .12, y + r * .66], [139, 155, 165]);
    p.triangle(o, [x - r * .38, y - r * .8], [x + r * .64, y - r * .45], [x + r * .82, y + r * .66], [113, 132, 151]);
    p.triangle(o, [x - r * .38, y - r * .8], [x + r * .82, y + r * .66], [x + r * .12, y + r * .66], [88, 106, 126]);
    p.line(o, x - r * .38, y - r * .8, x - r * .12, y + r * .53, [69, 85, 106]);
    p.line(o, x + r * .42, y - r * .5, x + r * .55, y + r * .44, [80, 97, 116]);
    p.line(o, x - r * .8, y + r * .66, x + r * .82, y + r * .66, [64, 81, 101]);
  } else if (motif === "cave") {
    p.ellipse(o, x, y + r * .2, r * .82, r * .56, [94, 112, 125]);
    p.ellipse(o, x, y + r * .14, r * .61, r * .62, [173, 185, 183]);
    p.ellipse(o, x + r * .03, y + r * .29, r * .38, r * .45, [58, 76, 89]);
    p.line(o, x - r * .61, y + r * .61, x + r * .61, y + r * .61, [132, 158, 160]);
    p.line(o, x - r * .52, y - r * .03, x - r * .33, y - r * .31, [224, 227, 210]);
  } else if (motif === "water" || motif === "kelp") {
    if (!style.water) p.ellipse(o, x, y + r * .15, r * .86, r * .43, [87, 148, 170]);
    if (motif === "kelp") for (const offset of [-.4, 0, .4]) {
      p.line(o, x + offset * r, y + r * .7, x + (offset - .16) * r, y, [74, 122, 111]);
      p.line(o, x + (offset - .16) * r, y, x + (offset + .12) * r, y - r * .6, [120, 170, 133]);
    }
    else for (const row of [-.25, .16, .54]) p.line(o, x - r * .55, y + row * r, x + r * .55, y + row * r, [164, 204, 208]);
  } else if (motif === "swamp") {
    p.ellipse(o, x, y + r * .35, r * .78, r * .36, mix([94, 139, 140], [163, 193, 195], style.snow));
    for (const offset of [-.55, -.14, .4]) {
      p.line(o, x + offset * r, y + r * .3, x + offset * r, y - r * .65, dark);
      p.line(o, x + offset * r, y - r * .2, x + (offset + .22) * r, y - r * .55, light);
    }
  } else if (motif === "waste") {
    p.line(o, x - r * .7, y + r * .3, x - r * .05, y - r * .2, [144, 124, 106]);
    p.line(o, x - r * .05, y - r * .2, x + r * .6, y + r * .45, [144, 124, 106]);
    p.line(o, x - r * .05, y - r * .2, x + r * .35, y - r * .64, mix([194, 169, 134], dark, style.snow));
  } else {
    for (const offset of [-.34, .13, .4]) p.line(o, x + offset * r, y + r * .25, x + (offset - .13) * r, y - r * .16, dark);
  }
}

function noiseSampler(width: number, height: number, requestedX: number, requestedY: number, seed: number) {
  const columns = Math.ceil(requestedX), rows = Math.ceil(requestedY);
  return (x: number, y: number) => {
    const sx = x / width * columns, sy = y / height * rows, ix = Math.floor(sx), iy = Math.floor(sy);
    const fx = sx - ix, fy = sy - iy, tx = fx * fx * (3 - 2 * fx), ty = fy * fy * (3 - 2 * fy);
    const at = (a: number, b: number) => randomAt(modulo(a, columns), modulo(b, rows), seed);
    return lerp(lerp(at(ix, iy), at(ix + 1, iy), tx), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), tx), ty);
  };
}
/** Overlapping elliptical puffs give cloud banks scalloped, billowing outlines. */
function puffSampler(width: number, height: number, requestedX: number, requestedY: number, seed: number) {
  const columns = Math.ceil(requestedX), rows = Math.ceil(requestedY);
  return (x: number, y: number) => {
    const sx = x / width * columns, sy = y / height * rows, ix = Math.floor(sx), iy = Math.floor(sy);
    let strongest = 0, second = 0;
    for (let cy = iy - 1; cy <= iy + 1; cy++) for (let cx = ix - 1; cx <= ix + 1; cx++) {
      const hx = modulo(cx, columns), hy = modulo(cy, rows), a = randomAt(hx, hy, seed), b = randomAt(hy, hx, seed ^ 0x9e3779);
      const dx = (sx - cx - .2 - a * .6) / (.57 + b * .4), dy = (sy - cy - .2 - b * .6) / (.5 + a * .35);
      const density = Math.max(0, 1 - dx * dx - dy * dy);
      if (density > strongest) { second = strongest; strongest = density; } else second = Math.max(second, density);
    }
    return Math.min(1, strongest + second * .3);
  };
}
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h;
}
function randomAt(x: number, y: number, seed: number): number {
  let n = seed ^ Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
function modulo(value: number, size: number): number { return (value % size + size) % size; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function mix(a: Color, b: Color, t: number): Color { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
function quantize(value: number): number { return clamp(Math.round(value / 3) * 3, 0, 252); }
