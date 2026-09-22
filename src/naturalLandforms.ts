import type { Plane } from "./domain";
import type { BorderSegment, Point } from "./geometry";
import { createWaterLandformProfile } from "./waterLandforms";

export interface NaturalLandformWarp {
  forward(point: Point): Point;
  inverse(x: number, y: number): Point;
  border(from: Point, to: Point): BorderSegment[];
}
const cache = new Map<string, NaturalLandformWarp | undefined>();
const TAU = Math.PI * 2;

function roll(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 4294967296;
}

/**
 * A shared, piecewise-affine deformation of the whole partition, not separate
 * noisy polygons. Every triangle retains a positive, bounded Jacobian, checked
 * before accepting coastal deformation. Together with a one-to-one boundary
 * this preserves existing contacts, ownership and connected regions.
 * Normal motion is pinned at frame seams; tangential motion is periodic.
 */
export function createNaturalLandformWarp(plane: Plane): NaturalLandformWarp | undefined {
  if (plane.landformStyle !== "natural-v1" || plane.provinces.length < 2) return undefined;
  const signature = `${plane.id}:${plane.width}:${plane.height}:${plane.wrapX}:${plane.wrapY}:`
    + plane.provinces.map(p => `${p.id}:${p.x},${p.y}`).join(";") + JSON.stringify(plane.landformWater ?? null);
  if (cache.has(signature)) return cache.get(signature);
  const result = buildWarp(plane);
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(signature, result);
  return result;
}

function buildWarp(plane: Plane): NaturalLandformWarp | undefined {
  if (!Number.isFinite(plane.width) || !Number.isFinite(plane.height) || plane.width <= 0 || plane.height <= 0
    || plane.provinces.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return undefined;
  let minimum = Infinity;
  for (let i = 0; i < plane.provinces.length; i++) for (let j = i + 1; j < plane.provinces.length; j++) {
    const a = plane.provinces[i]!, b = plane.provinces[j]!;
    let dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    if (plane.wrapX) dx = Math.min(dx, Math.abs(1 - dx));
    if (plane.wrapY) dy = Math.min(dy, Math.abs(1 - dy));
    minimum = Math.min(minimum, Math.hypot(dx, dy));
  }
  // Coincident/unfinished drafts keep their previous ownership semantics.
  if (minimum < 1e-8) return undefined;
  const aspect = Math.max(.08, Math.min(12, plane.width / plane.height));
  const baseColumns = Math.max(3, Math.ceil(Math.sqrt(plane.provinces.length * aspect)));
  const baseRows = Math.max(2, Math.ceil(plane.provinces.length / baseColumns));
  const columns = Math.min(256, baseColumns * 4), rows = Math.min(256, baseRows * 4);
  // This additional bound keeps the original capital coordinate inside its
  // province: inverse motion is well below half the closest centre separation.
  const amplitudeX = Math.min(.195 / columns, minimum * .11 * Math.min(1, 1 / aspect));
  const amplitudeY = Math.min(.195 / rows, minimum * .11 * Math.min(1, aspect));
  const frequencyX = Math.max(2, Math.round(baseColumns * .7)), frequencyY = Math.max(2, Math.round(baseRows * .7));
  const phase = roll(`${plane.id}:natural-landform-1`) * TAU, phase2 = roll(`${plane.id}:natural-landform-2`) * TAU;
  const pointColumns = columns + 1;
  const points = new Float64Array((rows + 1) * pointColumns * 2);
  const waterProfile = createWaterLandformProfile(plane);
  const seaFrequencyX = Math.max(1, Math.round(baseColumns * .32)), seaFrequencyY = Math.max(1, Math.round(baseRows * .32));
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const x = column / columns, y = row / rows;
    const waveX = .68 * Math.sin(TAU * (frequencyX * x + frequencyY * y) + phase)
      + .32 * Math.sin(TAU * ((frequencyX + 2) * x - (frequencyY - 1) * y) + phase2);
    const waveY = .68 * Math.cos(TAU * (frequencyX * x - frequencyY * y) + phase2)
      + .32 * Math.sin(TAU * ((frequencyX - 1) * x + (frequencyY + 2) * y) + phase);
    const profile = waterProfile?.(x, y);
    let shiftX = amplitudeX * waveX, shiftY = amplitudeY * waveY;
    if (profile) {
      const swell = Math.sin(TAU * (seaFrequencyX * x + seaFrequencyY * y) + phase);
      const sweep = Math.cos(TAU * (seaFrequencyX * x - seaFrequencyY * y) + phase2);
      // Offshore divisions have long, quiet sweeps. Coasts bend more strongly
      // normal to the shore into bays/headlands; small enclosed basins round.
      const seaX = .82 * swell + .18 * sweep, seaY = .82 * sweep - .18 * swell;
      const bays = .78 * Math.sin(TAU * (frequencyX * x + frequencyY * y) + phase2) + .22 * swell;
      const coastalX = .86 * bays * profile.normalX + .14 * seaX + .65 * profile.roundingX;
      const coastalY = .86 * bays * profile.normalY + .14 * seaY + .65 * profile.roundingY;
      const mixedX = waveX * (1 - profile.water) + seaX * profile.water;
      const mixedY = waveY * (1 - profile.water) + seaY * profile.water;
      const shoreAmplitudeX = Math.min(.56 / columns, minimum * .23 * Math.min(1, 1 / aspect));
      const shoreAmplitudeY = Math.min(.56 / rows, minimum * .23 * Math.min(1, aspect));
      shiftX = amplitudeX * mixedX * (1 - profile.shore) + shoreAmplitudeX * Math.max(-1, Math.min(1, coastalX)) * profile.shore;
      shiftY = amplitudeY * mixedY * (1 - profile.shore) + shoreAmplitudeY * Math.max(-1, Math.min(1, coastalY)) * profile.shore;
    }
    const offset = (row * pointColumns + column) * 2;
    points[offset] = column === 0 || column === columns ? x : x + shiftX * Math.sin(Math.PI * x) ** 2;
    points[offset + 1] = row === 0 || row === rows ? y : y + shiftY * Math.sin(Math.PI * y) ** 2;
  }
  const pointX = (row: number, column: number) => points[(row * pointColumns + column) * 2]!;
  const pointY = (row: number, column: number) => points[(row * pointColumns + column) * 2 + 1]!;
  const safeMesh = () => {
    const minimumArea = .18 / (columns * rows);
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const ax = pointX(row, column), ay = pointY(row, column), bx = pointX(row, column + 1), by = pointY(row, column + 1);
      const cx = pointX(row + 1, column), cy = pointY(row + 1, column), dx = pointX(row + 1, column + 1), dy = pointY(row + 1, column + 1);
      if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < minimumArea
        || (cx - dx) * (by - dy) - (cy - dy) * (bx - dx) < minimumArea) return false;
    }
    return true;
  };
  // Conservative, deterministic attenuation protects crowded/elongated maps.
  // It changes only visual geometry, never the graph or province centres.
  for (let attempt = 0; !safeMesh(); attempt++) {
    if (attempt === 8) return undefined;
    for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
      const offset = (row * pointColumns + column) * 2;
      points[offset] = (points[offset]! + column / columns) / 2;
      points[offset + 1] = (points[offset + 1]! + row / rows) / 2;
    }
  }
  const triangleCount = columns * rows * 2;
  // Target origin, U/V basis and determinant. Source coefficients are an
  // exact regular lattice and are reconstructed from the triangle index.
  const triangleStride = 7;
  const triangles = new Float64Array(triangleCount * triangleStride);
  const writeTriangle = (index: number, x: number, y: number, ux: number, uy: number, vx: number, vy: number) => {
    const offset = index * triangleStride;
    triangles[offset] = x; triangles[offset + 1] = y;
    triangles[offset + 2] = ux; triangles[offset + 3] = uy;
    triangles[offset + 4] = vx; triangles[offset + 5] = vy;
    triangles[offset + 6] = ux * vy - uy * vx;
  };
  for (let row=0;row<rows;row++) for (let column=0;column<columns;column++) {
    const cell=row*columns+column,first=cell*2,second=first+1;
    const ax=pointX(row,column),ay=pointY(row,column),bx=pointX(row,column+1),by=pointY(row,column+1);
    const cx=pointX(row+1,column),cy=pointY(row+1,column),dx=pointX(row+1,column+1),dy=pointY(row+1,column+1);
    writeTriangle(first,ax,ay,bx-ax,by-ay,cx-ax,cy-ay);
    writeTriangle(second,dx,dy,cx-dx,cy-dy,bx-dx,by-dy);
  }
  const bucketCount = columns * rows;
  const bucketOffsets = new Uint32Array(bucketCount + 1);
  const visitTriangleBuckets = (index: number, visit: (bucket: number) => void) => {
    const offset=index*triangleStride,x=triangles[offset]!,y=triangles[offset+1]!;
    const bx=x+triangles[offset+2]!,by=y+triangles[offset+3]!;
    const cx=x+triangles[offset+4]!,cy=y+triangles[offset+5]!;
    const loX = Math.max(0, Math.floor(Math.min(x,bx,cx)*columns));
    const hiX = Math.min(columns-1,Math.floor(Math.max(x,bx,cx)*columns));
    const loY = Math.max(0,Math.floor(Math.min(y,by,cy)*rows));
    const hiY = Math.min(rows-1,Math.floor(Math.max(y,by,cy)*rows));
    for (let row=loY;row<=hiY;row++) for (let column=loX;column<=hiX;column++) visit(row*columns+column);
  };
  for (let index=0;index<triangleCount;index++) {
    if (triangles[index*triangleStride+6]!<=0) return undefined;
    visitTriangleBuckets(index,bucket=>{bucketOffsets[bucket+1]++;});
  }
  for (let bucket=0;bucket<bucketCount;bucket++) bucketOffsets[bucket+1]+=bucketOffsets[bucket]!;
  const bucketIndices=new Uint32Array(bucketOffsets[bucketCount]!);
  const bucketCursors=bucketOffsets.slice(0,bucketCount);
  for (let index=0;index<triangleCount;index++) visitTriangleBuckets(index,bucket=>{
    bucketIndices[bucketCursors[bucket]++]=index;
  });
  const forward = (point: Point): Point => {
    const column = Math.max(0, Math.min(columns - 1, Math.floor(point.x * columns)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(point.y * rows)));
    const u = point.x * columns - column, v = point.y * rows - row;
    const ax=pointX(row,column),ay=pointY(row,column),bx=pointX(row,column+1),by=pointY(row,column+1);
    const cx=pointX(row+1,column),cy=pointY(row+1,column),dx=pointX(row+1,column+1),dy=pointY(row+1,column+1);
    return u+v<=1?{x:ax+u*(bx-ax)+v*(cx-ax),y:ay+u*(by-ay)+v*(cy-ay)}
      :{x:dx+(1-u)*(cx-dx)+(1-v)*(bx-dx),y:dy+(1-u)*(cy-dy)+(1-v)*(by-dy)};
  };
  const inverse = (x: number, y: number): Point => {
    const column = Math.max(0, Math.min(columns - 1, Math.floor(x * columns)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(y * rows)));
    const bucket=row*columns+column;
    for (let cursor=bucketOffsets[bucket]!;cursor<bucketOffsets[bucket+1]!;cursor++) {
      const index=bucketIndices[cursor]!,offset=index*triangleStride;
      const tx=triangles[offset]!,ty=triangles[offset+1]!,ux=triangles[offset+2]!,uy=triangles[offset+3]!;
      const vx=triangles[offset+4]!,vy=triangles[offset+5]!,determinant=triangles[offset+6]!;
      const dx=x-tx,dy=y-ty,u=(dx*vy-dy*vx)/determinant,v=(ux*dy-uy*dx)/determinant;
      if (u >= -1e-10 && v >= -1e-10 && u + v <= 1 + 1e-10) {
        const cell=index>>>1,sourceRow=Math.floor(cell/columns),sourceColumn=cell%columns;
        const sx=(index&1)===0?sourceColumn/columns:(sourceColumn+1)/columns;
        const sy=(index&1)===0?sourceRow/rows:(sourceRow+1)/rows;
        const sux=(index&1)===0?(sourceColumn+1)/columns-sx:sourceColumn/columns-sx;
        const suy=0;
        const svx=0;
        const svy=(index&1)===0?(sourceRow+1)/rows-sy:sourceRow/rows-sy;
        return {x:Math.max(0,Math.min(1,sx+u*sux+v*svx)),y:Math.max(0,Math.min(1,sy+u*suy+v*svy))};
      }
    }
    // Inputs outside the frame are normalized by the ownership caller.
    return { x, y };
  };
  const border = (from: Point, to: Point): BorderSegment[] => {
    const cuts = [0, 1];
    const split = (a: number, b: number) => {
      if (Math.abs(b - a) < 1e-12) return;
      for (let line = Math.floor(Math.min(a, b)) + 1; line < Math.max(a, b); line++) {
        const t = (line - a) / (b - a);
        if (t > 1e-10 && t < 1 - 1e-10) cuts.push(t);
      }
    };
    // A straight edge is split exactly at lattice and triangle boundaries;
    // every returned segment is the same affine geometry inverse() samples.
    split(from.x * columns, to.x * columns); split(from.y * rows, to.y * rows);
    split(from.x * columns + from.y * rows, to.x * columns + to.y * rows);
    cuts.sort((a, b) => a - b);
    const ordered = cuts.filter((value, index) => index === 0 || value - cuts[index - 1]! > 1e-10);
    const outline = ordered.map(t => forward({ x: from.x + t * (to.x - from.x), y: from.y + t * (to.y - from.y) }));
    return outline.slice(1).map((to, index) => ({ from: outline[index]!, to }));
  };
  return { forward, inverse, border };
}
