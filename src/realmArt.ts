import { effectiveProvinceTerrainFlags, type Plane, type PlaneKind, type PlaneVariant, type TerrainFlag } from "./domain";

type RealmKind = "cave" | "cavern" | "underworld" | "hell" | "abyss" | "dream" | "elemental";
type Color = readonly [number, number, number];
type Motif = "fungus" | "crystal" | "tomb" | "ember" | "obsidian" | "bloom" | "forest" | "farm"
  | "swamp" | "waste" | "mountain" | "water" | "spring" | "kelp" | "cave" | "wall" | "stone";
interface Theme {
  background: Color;
  wall: Color;
  floor: Color;
  accent: Color;
  ambient: Motif;
  mist: number;
}
interface Style {
  color: Color;
  accent: Color;
  features: Motif[];
  ambient: Motif;
  water: boolean;
  blocked: boolean;
}
interface Placement { owner: number; x: number; y: number; radius: number; random: number }
interface Prepared {
  key: string;
  owners: Int16Array;
  scale: number;
  columns: number;
  rows: number;
  stone: Uint8Array;
  grain: Uint8Array;
  rim: Uint8Array;
  details: Placement[];
  anchors: Array<Placement | undefined>;
}

const MAX_PIXELS = 8_294_400;
const THEMES: Record<RealmKind, Theme> = {
  cave: { background: [25, 31, 34], wall: [63, 74, 75], floor: [121, 132, 115], accent: [121, 189, 165], ambient: "fungus", mist: 0 },
  cavern: { background: [24, 29, 41], wall: [65, 76, 92], floor: [122, 141, 153], accent: [155, 201, 222], ambient: "crystal", mist: 0 },
  underworld: { background: [29, 27, 39], wall: [76, 69, 84], floor: [144, 139, 149], accent: [182, 180, 206], ambient: "tomb", mist: .08 },
  hell: { background: [38, 26, 27], wall: [86, 62, 53], floor: [122, 102, 99], accent: [222, 144, 88], ambient: "ember", mist: 0 },
  abyss: { background: [19, 22, 34], wall: [53, 57, 80], floor: [114, 115, 144], accent: [160, 142, 200], ambient: "obsidian", mist: .03 },
  dream: { background: [38, 45, 66], wall: [77, 95, 117], floor: [144, 172, 153], accent: [194, 166, 214], ambient: "bloom", mist: .2 },
  elemental: { background: [34, 39, 47], wall: [76, 82, 84], floor: [153, 147, 121], accent: [201, 175, 126], ambient: "crystal", mist: .02 },
};

// One entry per live caller-owned mask. Exact snapshots cost at most 15.82 MiB
// each and avoid mutable-buffer/hash collisions. Neither key masks nor output
// RGB buffers are retained by the values, allowing ordinary weak collection.
const preparedCache = new WeakMap<Int16Array, Prepared>();

export function isRealmArtworkKind(kind: PlaneKind): boolean {
  return Object.prototype.hasOwnProperty.call(THEMES, kind);
}

/**
 * Procedural editor/PNG landscape art, not a native Dominions image exporter.
 * RGB is top-down. The caller applies previewProvinceTerrain before rendering;
 * this function does not transform terrain, simulate seasons or alter gameplay.
 * Owners are zero-based province positions, with -1 meaning unowned background.
 */
export function renderRealmRgb(plane: Plane, owners: Int16Array, seed: string): Uint8Array {
  const { width, height } = plane;
  if (!isRealmArtworkKind(plane.kind)) throw new RangeError("Unsupported realm artwork kind.");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 256 || height < 256
    || width > 3840 || height > 3840 || width * height > MAX_PIXELS) {
    throw new RangeError("Realm artwork dimensions exceed the supported 256-pixel to 8.29-megapixel envelope.");
  }
  if (!(owners instanceof Int16Array) || owners.length !== width * height) {
    throw new RangeError("Realm artwork requires one ownership value per native pixel.");
  }
  const key = JSON.stringify([width, height, plane.wrapX, plane.wrapY, plane.kind, plane.variant, seed, plane.provinces.map(p => p.id)]);
  let prepared = preparedCache.get(owners);
  let unchanged = prepared?.key === key;
  for (let pixel = 0; pixel < owners.length; pixel++) {
    const owner = owners[pixel]!;
    if (owner < -1 || owner >= plane.provinces.length) throw new RangeError("Realm artwork contains an invalid province owner.");
    if (unchanged && prepared!.owners[pixel] !== owner) unchanged = false;
  }
  if (!prepared || !unchanged) {
    prepared = prepare(plane, owners, key, hash(seed));
    preparedCache.set(owners, prepared);
  }
  const theme = realmTheme(plane.kind as RealmKind, plane.variant);
  const styles = plane.provinces.map(p => provinceStyle(effectiveProvinceTerrainFlags(p), theme, plane.kind as RealmKind));
  const out = new Uint8Array(width * height * 3);
  const { columns, rows, scale, stone, grain, rim } = prepared;
  const wallWidth = Math.max(3, scale * 12);
  const atmosphereColor: Color = plane.kind === "dream" ? [92, 84, 132] : [58, 74, 100];
  const lastRow = (height - 1) * width;

  for (let y = 0; y < height; y++) {
    const sy = y / (plane.wrapY ? height - 1 : height) * (rows - 1);
    const iy = Math.min(rows - 2, Math.floor(sy)), fy = sy - iy;
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x, owner = owners[pixel]!, target = pixel * 3;
      const sx = x / (plane.wrapX ? width - 1 : width) * (columns - 1);
      const ix = Math.min(columns - 2, Math.floor(sx)), fx = sx - ix, sample = iy * columns + ix;
      const broad = sampleField(stone, sample, columns, fx, fy) / 255;
      const fine = sampleField(grain, sample, columns, fx, fy) / 255;
      if (owner < 0) {
        // Wall relief remains subdued and darker than traversable floors.
        // It is never given a floor fill, a province border, or a terrain motif.
        const nearFloor = Math.max(0, 1 - rim[pixel]! / wallWidth);
        const stratum = nearFloor * (6 + Math.sin(rim[pixel]! / Math.max(1, scale * 2) + broad * 4) * 3);
        const mist = theme.mist * broad * 22;
        const atmosphere = plane.kind === "dream" ? Math.pow(broad * .65 + fine * .35, 1.6) * .8
          : plane.kind === "elemental" ? fine * fine * .8 : 0;
        for (let channel = 0; channel < 3; channel++) {
          const background = lerp(theme.background[channel]!, atmosphereColor[channel]!, atmosphere);
          out[target + channel] = quantize(lerp(background, theme.wall[channel]!, nearFloor * .7)
            + (broad - .5) * 10 + (fine - .5) * 5 + stratum + mist);
        }
        continue;
      }
      const style = styles[owner]!;
      const left = x > 0 ? pixel - 1 : plane.wrapX ? pixel + width - 1 : -1;
      const up = y > 0 ? pixel - width : plane.wrapY ? pixel + lastRow : -1;
      const nearWall = Math.max(0, 1 - rim[pixel]! / Math.max(2, scale * 3));
      let direction = 0;
      if (nearWall > 0) {
        const right = x < width - 1 ? pixel + 1 : plane.wrapX ? pixel - width + 1 : -1;
        const down = y < height - 1 ? pixel + width : plane.wrapY ? pixel - lastRow : -1;
        direction = (left < 0 || up < 0 || owners[left]! < 0 || owners[up]! < 0 ? 8 : 0)
          - (right < 0 || down < 0 || owners[right]! < 0 || owners[down]! < 0 ? 9 : 0);
      }
      const border = left >= 0 && owners[left]! >= 0 && owners[left] !== owner
        || up >= 0 && owners[up]! >= 0 && owners[up] !== owner;
      const relief = (broad - .5) * (style.water ? 12 : 19) + (fine - .5) * (style.water ? 4 : 8);
      const shade = relief + nearWall * (direction - 7) - (border ? 23 : 0);
      for (let channel = 0; channel < 3; channel++) out[target + channel] = quantize(style.color[channel]! + shade);
    }
  }

  const paint = painter(plane, owners, out);
  for (const detail of prepared.details) {
    const style = styles[detail.owner]!;
    // Feature-specific colors/marks always win over ambient fire or crystals.
    // Water never receives ember/fissure motifs, including Sea + Cave.
    const candidates = style.features.filter(feature => feature !== "cave");
    const motif = candidates.length && detail.random < .75
      ? candidates[Math.floor(detail.random / .75 * candidates.length)]!
      : style.ambient;
    if (detail.random > .8 && !style.water && !style.blocked) continue;
    drawMotif(paint, detail, motif, style);
  }
  // Reserve safely fitting slots for every additive terrain feature. A narrow
  // passage can omit glyphs without stretching them; its material still changes.
  prepared.anchors.forEach((anchor, owner) => {
    if (!anchor) return;
    const style = styles[owner]!;
    const count = style.features.length;
    for (let index = 0; index < count; index++) {
      const angle = (index / Math.max(1, count) + .125) * Math.PI * 2;
      const orbit = count > 1 ? anchor.radius * .47 : 0;
      const radius = count > 1 ? Math.min(anchor.radius * .35, Math.PI * orbit / count * .75) : anchor.radius * .65;
      if (radius < 2) continue;
      drawMotif(paint, { ...anchor, x: anchor.x + Math.cos(angle) * orbit, y: anchor.y + Math.sin(angle) * orbit, radius }, style.features[index]!, style);
    }
  });
  return out;
}

function realmTheme(kind: RealmKind, variant: PlaneVariant | undefined): Theme {
  const base = THEMES[kind];
  const variantColors: Partial<Record<PlaneVariant, Color>> = {
    temperate: [149, 150, 124], wild: [122, 159, 137], frozen: [147, 168, 187], arid: [169, 145, 112],
    oceanic: [112, 154, 164], fungal: [135, 150, 123], crystal: [145, 164, 185], volcanic: [177, 125, 91],
    storm: [121, 137, 165], infernal: [177, 114, 92], void: [128, 118, 158],
  };
  if (!variant) return base;
  const tint = variantColors[variant]!;
  const ambient = kind === "cave" || kind === "cavern" ? variant === "crystal" || variant === "frozen" ? "crystal" : "fungus"
    : kind === "elemental" ? variant === "volcanic" || variant === "infernal" ? "ember" : variant === "wild" || variant === "fungal" ? "fungus" : "crystal"
      : base.ambient;
  return { ...base, floor: mix(base.floor, tint, .24), accent: mix(base.accent, tint, .18), ambient };
}

function provinceStyle(flags: ReadonlySet<TerrainFlag>, theme: Theme, kind: RealmKind): Style {
  if (flags.has("cavewall")) return { color: [78, 86, 99], accent: [123, 141, 155], features: ["wall"], ambient: "wall", water: false, blocked: true };
  const water = flags.has("sea"), cave = flags.has("cave");
  const features: Motif[] = [];
  if (water) {
    if (flags.has("forest")) features.push("kelp");
    if (cave) features.push("cave");
    // Sea controls the material, not the visibility of additional physical
    // terrain flags. The motifs below use an aquatic palette in drawMotif.
    if (flags.has("farm")) features.push("farm");
    if (flags.has("swamp")) features.push("swamp");
    if (flags.has("waste")) features.push("waste");
    if (flags.has("highland")) features.push("stone");
    if (flags.has("mountains")) features.push("mountain");
    if (flags.has("freshwater")) features.push("spring");
    features.push("water");
    return { color: flags.has("deep") ? [49, 88, 130] : kind === "underworld" ? [90, 142, 176] : [70, 130, 159],
      accent: [169, 208, 224], features, ambient: "water", water: true, blocked: false };
  }
  let color = theme.floor;
  const add = (flag: TerrainFlag, motif: Motif, tint: Color, amount: number) => {
    if (!flags.has(flag)) return;
    color = mix(color, tint, amount);
    features.push(motif);
  };
  add("cave", "cave", [127, 141, 146], .12);
  add("forest", cave ? "fungus" : kind === "dream" ? "bloom" : "forest", [96, 147, 117], .35);
  add("farm", "farm", [185, 169, 111], .34);
  add("swamp", "swamp", [107, 143, 139], .3);
  add("waste", "waste", [165, 137, 111], .3);
  add("highland", "stone", [147, 149, 151], .3);
  add("mountains", "mountain", [143, 149, 162], .32);
  add("freshwater", "spring", [115, 151, 153], .035);
  return { color, accent: theme.accent, features, ambient: theme.ambient, water: false, blocked: false };
}

function prepare(plane: Plane, owners: Int16Array, key: string, seed: number): Prepared {
  const { width, height } = plane;
  const scale = Math.max(.6, Math.min(width, height) / 768);
  const tile = Math.max(2, Math.round(scale * 4));
  const columns = Math.ceil(width / tile) + 1, rows = Math.ceil(height / tile) + 1;
  const stone = new Uint8Array(columns * rows), grain = new Uint8Array(columns * rows);
  const broad = noiseSampler(width, height, scale * 88, seed);
  const fine = noiseSampler(width, height, scale * 25, seed ^ 0x671abc);
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const px = x / (columns - 1) * width, py = y / (rows - 1) * height;
    stone[y * columns + x] = Math.round(broad(px, py) * 255);
    grain[y * columns + x] = Math.round(fine(px, py) * 255);
  }
  const rim = boundaryDistance(plane, owners, false);
  const safe = boundaryDistance(plane, owners, true);
  const details: Placement[] = [];
  const anchors: Array<Placement | undefined> = Array(plane.provinces.length).fill(undefined);
  const best = new Uint8Array(plane.provinces.length);
  for (let pixel = 0; pixel < owners.length; pixel++) {
    const owner = owners[pixel]!;
    if (owner < 0 || safe[pixel]! <= best[owner]!) continue;
    best[owner] = safe[pixel]!;
    const radius = Math.min(scale * 24, safe[pixel]! / Math.SQRT2 * .72);
    if (radius >= 4) anchors[owner] = { owner, x: pixel % width, y: Math.floor(pixel / width), radius, random: .5 };
  }
  const cellsX = Math.max(1, Math.round(width / (scale * 28))), cellsY = Math.max(1, Math.round(height / (scale * 28)));
  for (let row = 0; row < cellsY; row++) for (let column = 0; column < cellsX; column++) {
    const jitterX = randomAt(column, row, seed), jitterY = randomAt(row, column, seed ^ 0x912caf);
    const x = Math.floor((column + .13 + jitterX * .74) * width / cellsX);
    const y = Math.floor((row + .13 + jitterY * .74) * height / cellsY);
    const pixel = y * width + x, owner = owners[pixel]!;
    if (owner < 0 || safe[pixel]! < Math.max(3, scale * 5)) continue;
    const random = randomAt(column, row, seed ^ hash(plane.provinces[owner]!.id));
    const radius = Math.min(scale * (7 + random * 4), safe[pixel]! / Math.SQRT2 * .72);
    details.push({ owner, x, y, radius, random });
  }
  return { key, owners: owners.slice(), scale, columns, rows, stone, grain, rim, details, anchors };
}

function pixelLookup(plane: Pick<Plane, "width" | "height" | "wrapX" | "wrapY">) {
  return (x: number, y: number): number => {
    if (plane.wrapX) x = modulo(x, plane.width);
    if (plane.wrapY) y = modulo(y, plane.height);
    return x < 0 || y < 0 || x >= plane.width || y >= plane.height ? -1 : y * plane.width + x;
  };
}

/** Bounded Manhattan distance to the silhouette or to another province. */
function boundaryDistance(plane: Plane, owners: Int16Array, internal: boolean): Uint8Array {
  const { width, height } = plane, out = new Uint8Array(owners.length), lastRow = (height - 1) * width;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x, owner = owners[pixel]!;
    if (internal && owner < 0) continue;
    const left = x > 0 ? pixel - 1 : plane.wrapX ? pixel + width - 1 : -1;
    const right = x < width - 1 ? pixel + 1 : plane.wrapX ? pixel - width + 1 : -1;
    const up = y > 0 ? pixel - width : plane.wrapY ? pixel + lastRow : -1;
    const down = y < height - 1 ? pixel + width : plane.wrapY ? pixel - lastRow : -1;
    const owned = owner >= 0;
    const sameLeft = left < 0 ? !owned : internal ? owners[left] === owner : (owners[left]! >= 0) === owned;
    const sameRight = right < 0 ? !owned : internal ? owners[right] === owner : (owners[right]! >= 0) === owned;
    const sameUp = up < 0 ? !owned : internal ? owners[up] === owner : (owners[up]! >= 0) === owned;
    const sameDown = down < 0 ? !owned : internal ? owners[down] === owner : (owners[down]! >= 0) === owned;
    out[pixel] = sameLeft && sameRight && sameUp && sameDown ? 255 : 1;
  }
  for (let pass = 0; pass < (plane.wrapX || plane.wrapY ? 2 : 1); pass++) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (out[pixel]! <= 1) continue;
      const left = x > 0 ? pixel - 1 : plane.wrapX ? pixel + width - 1 : -1;
      const up = y > 0 ? pixel - width : plane.wrapY ? pixel + lastRow : -1;
      out[pixel] = Math.min(out[pixel]!, left >= 0 ? out[left]! + 1 : 255, up >= 0 ? out[up]! + 1 : 255);
    }
    for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
      const pixel = y * width + x;
      if (out[pixel]! <= 1) continue;
      const right = x < width - 1 ? pixel + 1 : plane.wrapX ? pixel - width + 1 : -1;
      const down = y < height - 1 ? pixel + width : plane.wrapY ? pixel - lastRow : -1;
      out[pixel] = Math.min(out[pixel]!, right >= 0 ? out[right]! + 1 : 255, down >= 0 ? out[down]! + 1 : 255);
    }
  }
  return out;
}

interface Painter {
  ellipse(owner: number, x: number, y: number, rx: number, ry: number, color: Color): void;
  triangle(owner: number, a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], color: Color): void;
  line(owner: number, x1: number, y1: number, x2: number, y2: number, color: Color): void;
}
function painter(plane: Plane, owners: Int16Array, rgb: Uint8Array): Painter {
  const at = pixelLookup(plane);
  const pixel = (owner: number, x: number, y: number, color: Color) => {
    const target = at(Math.round(x), Math.round(y));
    if (target < 0 || owners[target] !== owner) return;
    for (let channel = 0; channel < 3; channel++) rgb[target * 3 + channel] = quantize(color[channel]!);
  };
  return {
    ellipse(owner, x, y, rx, ry, color) {
      for (let py = Math.ceil(y - ry); py <= Math.floor(y + ry); py++) {
        const extent = rx * Math.sqrt(Math.max(0, 1 - ((py - y) / ry) ** 2));
        for (let px = Math.ceil(x - extent); px <= Math.floor(x + extent); px++) pixel(owner, px, py, color);
      }
    },
    triangle(owner, a, b, c, color) {
      const points = [a, b, c];
      for (let y = Math.ceil(Math.min(a[1], b[1], c[1])); y <= Math.floor(Math.max(a[1], b[1], c[1])); y++) {
        const intersections: number[] = [];
        for (let i = 0; i < 3; i++) {
          const p = points[i]!, q = points[(i + 1) % 3]!;
          if (p[1] === q[1] || y < Math.min(p[1], q[1]) || y >= Math.max(p[1], q[1])) continue;
          intersections.push(p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]));
        }
        if (intersections.length < 2) continue;
        for (let x = Math.ceil(Math.min(...intersections)); x <= Math.floor(Math.max(...intersections)); x++) pixel(owner, x, y, color);
      }
    },
    line(owner, x1, y1, x2, y2, color) {
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))));
      for (let step = 0; step <= steps; step++) pixel(owner, lerp(x1, x2, step / steps), lerp(y1, y2, step / steps), color);
    },
  };
}

function drawMotif(p: Painter, detail: Placement, motif: Motif, style: Style): void {
  const { owner: o, x, y, radius: r } = detail;
  const dark: Color = style.water ? [38, 77, 101] : mix(style.color, [34, 40, 49], .53);
  const light = mix(style.accent, [224, 230, 220], .35);
  if (motif === "fungus") {
    for (const [dx, dy, size] of [[-.36, .12, .72], [.37, .35, .52]]) {
      p.line(o, x + dx! * r, y + dy! * r + size! * r * .45, x + dx! * r, y + dy! * r - size! * r * .4, light);
      p.ellipse(o, x + dx! * r, y + dy! * r - size! * r * .35, size! * r * .68, size! * r * .32, dark);
      p.ellipse(o, x + dx! * r, y + dy! * r - size! * r * .47, size! * r * .6, size! * r * .24, style.accent);
      p.line(o, x + dx! * r - size! * r * .24, y + dy! * r - size! * r * .55, x + dx! * r + size! * r * .2, y + dy! * r - size! * r * .55, light);
    }
  } else if (motif === "crystal" || motif === "obsidian") {
    const base = motif === "obsidian" ? dark : style.accent;
    for (const [dx, top, spread] of [[-.42, -.32, .22], [0, -.9, .25], [.43, -.5, .2]]) {
      p.triangle(o, [x + (dx! - spread!) * r, y + r * .63], [x + dx! * r, y + top! * r], [x + (dx! + spread!) * r, y + r * .63], base);
      p.triangle(o, [x + (dx! - spread!) * r, y + r * .63], [x + dx! * r, y + top! * r], [x + dx! * r, y + r * .63], motif === "obsidian" ? style.accent : light);
    }
  } else if (motif === "tomb" || motif === "wall" || motif === "stone" || motif === "mountain") {
    const peak = motif === "mountain" ? -.95 : motif === "tomb" ? -.55 : -.72;
    p.triangle(o, [x - r * .8, y + r * .65], [x - r * .17, y + peak * r], [x + r * .8, y + r * .65], dark);
    p.triangle(o, [x - r * .8, y + r * .65], [x - r * .17, y + peak * r], [x + r * .05, y + r * .65], mix(style.color, light, .34));
    if (motif === "tomb") {
      p.line(o, x - r * .12, y - r * .21, x + r * .12, y - r * .21, light);
      p.line(o, x, y - r * .37, x, y + r * .2, light);
    } else p.line(o, x - r * .17, y + peak * r, x + r * .05, y + r * .58, mix(dark, style.accent, .22));
  } else if (motif === "ember" || motif === "waste") {
    const glow: Color = motif === "ember" ? [226, 119, 62] : style.water ? [75, 116, 139] : mix(style.color, [88, 77, 72], .65);
    const points = [[-.82, -.28], [-.35, -.12], [-.1, .34], [.36, .08], [.78, .38]];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      p.line(o, x + a[0]! * r, y + a[1]! * r, x + b[0]! * r, y + b[1]! * r, dark);
      p.line(o, x + a[0]! * r, y + a[1]! * r - 1, x + b[0]! * r, y + b[1]! * r - 1, glow);
      if (motif === "ember" && i === 2) p.line(o, x + a[0]! * r, y + a[1]! * r - 2, x + b[0]! * r, y + b[1]! * r - 2, [242, 170, 89]);
    }
  } else if (motif === "forest" || motif === "bloom") {
    p.line(o, x, y + r * .76, x, y - r * .45, dark);
    p.line(o, x, y + r * .3, x - r * .47, y - r * .03, dark);
    p.line(o, x, y + r * .2, x + r * .46, y - r * .14, dark);
    const leaf = motif === "bloom" ? mix([87, 156, 133], style.accent, .32) : [85, 126, 102] as const;
    p.ellipse(o, x - r * .36, y - r * .08, r * .43, r * .33, leaf);
    p.ellipse(o, x + r * .32, y - r * .18, r * .45, r * .36, mix(leaf, light, .15));
    p.ellipse(o, x - r * .05, y - r * .53, r * .48, r * .38, mix(leaf, light, .27));
    if (motif === "bloom") p.ellipse(o, x - r * .28, y - r * .62, r * .12, r * .12, light);
  } else if (motif === "farm") {
    p.ellipse(o, x, y, r * .87, r * .62, mix(style.color, style.water ? [104, 159, 171] : [190, 171, 119], .5));
    for (let row = -2; row <= 2; row++) p.line(o, x - r * .63, y + row * r * .19 - r * .15, x + r * .63, y + row * r * .19 + r * .15, style.water ? [63, 107, 126] : [118, 114, 82]);
  } else if (motif === "spring") {
    p.ellipse(o, x, y + r * .12, r * .85, r * .48, [147, 190, 206]);
    p.ellipse(o, x, y + r * .12, r * .67, r * .33, [69, 122, 152]);
    p.ellipse(o, x - r * .05, y + r * .07, r * .26, r * .12, [129, 179, 201]);
  } else if (motif === "water" || motif === "swamp" || motif === "kelp") {
    if (!style.water) p.ellipse(o, x, y + r * .15, r * .88, r * .45, [74, 128, 151]);
    if (motif === "water") {
      for (const row of [-.24, .17, .53]) p.line(o, x - r * .58, y + row * r, x + r * .5, y + row * r, [159, 197, 213]);
    } else for (const dx of [-.45, 0, .43]) {
      p.line(o, x + dx * r, y + r * .58, x + (dx - .15) * r, y - r * .42, [52, 100, 91]);
      p.line(o, x + (dx - .08) * r, y, x + (dx + .2) * r, y - r * .36, [129, 170, 153]);
    }
  } else if (motif === "cave") {
    p.ellipse(o, x, y + r * .15, r * .72, r * .63, style.water ? [122, 160, 177] : mix(style.color, light, .35));
    p.ellipse(o, x + r * .02, y + r * .29, r * .43, r * .45, dark);
    p.line(o, x - r * .68, y + r * .67, x + r * .69, y + r * .67, style.water ? [140, 180, 194] : mix(style.color, dark, .2));
  }
}

function noiseSampler(width: number, height: number, spacing: number, seed: number) {
  const columns = Math.max(2, Math.ceil(width / spacing)), rows = Math.max(2, Math.ceil(height / spacing));
  return (x: number, y: number) => {
    const sx = x / width * columns, sy = y / height * rows, ix = Math.floor(sx), iy = Math.floor(sy);
    const dx = sx - ix, dy = sy - iy, tx = dx * dx * (3 - 2 * dx), ty = dy * dy * (3 - 2 * dy);
    const at = (a: number, b: number) => randomAt(modulo(a, columns), modulo(b, rows), seed);
    return lerp(lerp(at(ix, iy), at(ix + 1, iy), tx), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), tx), ty);
  };
}
function sampleField(field: Uint8Array, at: number, stride: number, x: number, y: number): number {
  return lerp(lerp(field[at]!, field[at + 1]!, x), lerp(field[at + stride]!, field[at + stride + 1]!, x), y);
}
function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result;
}
function randomAt(x: number, y: number, seed: number): number {
  let n = seed ^ Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
function modulo(value: number, size: number): number { return (value % size + size) % size; }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function mix(a: Color, b: Color, t: number): Color { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
function quantize(value: number): number { return Math.max(0, Math.min(252, Math.round(value / 2) * 2)); }
