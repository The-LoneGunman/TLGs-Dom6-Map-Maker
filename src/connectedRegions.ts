import { planeGenerationKey, type Plane } from "./domain";
import { usesConnectedRegions } from "./geometry";
import type { BorderSegment, Point, ProvinceChamberPrimitive, ProvinceCorridorPrimitive, ProvinceOwnershipModel, SparseSilhouette } from "./geometry";

interface RegionPair { a: number; b: number; key: string }
interface TreePair { a: number; b: number; distance: number }
interface Vertex extends Point { incoming?: number }
interface Contact { neighbour: number; from: Point; to: Point; nx: number; ny: number; limit: number }
interface RealmContour {
  radiusX: number;
  radiusY: number;
  rotation: number;
  cos: number;
  sin: number;
  organicPower: number;
  outlineWaves: readonly [number, number, number, number];
  warpX: number;
  warpY: number;
  lobeX: number;
  lobeY: number;
  lobeScale: number;
  outerRadius: number;
}

interface RealmContourProfile {
  aspect: readonly [number, number];
  power: readonly [number, number];
  primaryWave: readonly [number, number];
  secondaryWaveRatio: readonly [number, number];
  warp: number;
  lobeChance: number;
  lobeScale: readonly [number, number];
  lobeDistance: readonly [number, number];
  /** Group-coherent orientation with bounded local variation. */
  groupedRotation: boolean;
}

export interface ConnectedRegionPlan {
  groups: readonly (readonly number[])[];
  groupByOwner: readonly number[];
  passageOwners: ReadonlySet<number>;
  treePairs: readonly TreePair[];
  regionPairs: readonly RegionPair[];
  voronoiPairs: readonly RegionPair[];
  contacts: readonly (readonly Contact[])[];
  spacing: number;
  localSpacings: readonly number[];
  aspect: number;
}

const EPS = 1e-10;
const plans = new Map<string, ConnectedRegionPlan>();
interface RegionOwnershipResult { model?: ProvinceOwnershipModel; notice?: string }
const ownershipResults = new Map<string, RegionOwnershipResult>();
const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const periodic = (v: number, wrap: boolean) => wrap ? v - Math.round(v) : v;
const unit = (v: number, wrap: boolean) => wrap ? ((v % 1) + 1) % 1 : v;
const naturalRealmKinds = new Set<Plane["kind"]>(["cave","cavern","hell","abyss","dream","elemental"]);
function roll(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function usesNaturalRealmContours(plane: Plane): boolean {
  // Keep old saved maps byte-for-byte compatible when the opt-in metadata is absent.
  return plane.landformStyle === "natural-v1"
    && naturalRealmKinds.has(plane.kind);
}

/** Geometry-only planning: edits to armies, starts, terrain or edges cannot move the groups. */
export function buildConnectedRegionPlan(plane: Plane): ConnectedRegionPlan {
  const signature = `${plane.kind}:${plane.width}:${plane.height}:${plane.wrapX}:${plane.wrapY}:` + plane.provinces
    .map(p => `${p.id}:${p.index}:${p.x}:${p.y}`).join(";");
  const cached = plans.get(signature);
  if (cached) return cached;
  const count = plane.provinces.length;
  const aspect = clamp(plane.width / Math.max(1, plane.height), .08, 12);
  const distances = Array.from({ length: count }, () => new Float64Array(count));
  const localSpacings = Array<number>(count).fill(Infinity);
  for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) {
    const p = plane.provinces[a]!, q = plane.provinces[b]!;
    const d = Math.hypot(periodic(q.x - p.x, plane.wrapX) * aspect, periodic(q.y - p.y, plane.wrapY));
    distances[a]![b] = distances[b]![a] = d;
    localSpacings[a] = Math.min(localSpacings[a]!, d);
    localSpacings[b] = Math.min(localSpacings[b]!, d);
  }
  const finite = localSpacings.filter(Number.isFinite).sort((a,b) => a-b);
  const spacing = Math.max(1e-5, finite[Math.floor(finite.length / 2)] ?? .25);
  for (let i = 0; i < count; i++) if (!Number.isFinite(localSpacings[i])) localSpacings[i] = spacing;
  const order = Array.from({ length: count }, (_, i) => i).sort((a,b) => plane.provinces[a]!.index - plane.provinces[b]!.index
    || plane.provinces[a]!.id.localeCompare(plane.provinces[b]!.id));
  const used = new Set<number>();
  const nearest = Array<number>(count).fill(Infinity), parent = Array<number>(count).fill(-1);
  const treePairs: TreePair[] = [];
  if (count) nearest[order[0]!] = 0;
  for (let step = 0; step < count; step++) {
    let next = -1;
    for (const owner of order) if (!used.has(owner) && (next < 0 || nearest[owner]! < nearest[next]! - EPS)) next = owner;
    if (next < 0) break;
    used.add(next);
    if (parent[next]! >= 0) treePairs.push({ a: parent[next]!, b: next, distance: nearest[next]! });
    for (const other of order) if (!used.has(other) && distances[next]![other]! < nearest[other]! - EPS) {
      nearest[other] = distances[next]![other]!; parent[other] = next;
    }
  }
  const targetSize = plane.kind === "cavern" ? 9 : plane.kind === "cloud" || plane.kind === "air" ? 6 : 8;
  const targetGroups = count < 12 ? 1 : Math.max(2, Math.round(count / targetSize));
  const groups: number[][] = count ? [[...order]] : [];
  const cuts: TreePair[] = [];
  const treeAdj = Array.from({ length: count }, () => [] as number[]);
  for (const edge of treePairs) { treeAdj[edge.a]!.push(edge.b); treeAdj[edge.b]!.push(edge.a); }
  while (groups.length < targetGroups) {
    let selected: { group: number; edge: TreePair; side: number[]; score: number } | undefined;
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]!;
      if (group.length < 6) continue;
      const members = new Set(group);
      const root = group[0]!;
      const walk = [root], parents = new Map<number,number>([[root,-1]]);
      for (let cursor = 0; cursor < walk.length; cursor++) for (const n of treeAdj[walk[cursor]!]!) {
        if (members.has(n) && !parents.has(n)) { parents.set(n,walk[cursor]!); walk.push(n); }
      }
      const sizes = new Map(group.map(i => [i,1]));
      for (const node of [...walk].reverse()) {
        const p = parents.get(node)!;
        if (p >= 0) sizes.set(p, sizes.get(p)! + sizes.get(node)!);
      }
      for (const node of walk.slice(1)) {
        const size = sizes.get(node)!;
        if (size < 3 || group.length - size < 3) continue;
        const p = parents.get(node)!;
        const balance = Math.min(size,group.length-size) / group.length;
        const score = group.length * distances[p]![node]! * (.5 + balance);
        if (selected && selected.score >= score - EPS) continue;
        const side = [node];
        for (let cursor=0;cursor<side.length;cursor++) for (const n of treeAdj[side[cursor]!]!) {
          if (parents.get(n) === side[cursor]) side.push(n);
        }
        selected = { group:gi, edge:{a:p,b:node,distance:distances[p]![node]!}, side, score };
      }
    }
    if (!selected) break;
    const side = new Set(selected.side);
    const remaining = groups[selected.group]!.filter(i => !side.has(i));
    groups.splice(selected.group, 1, remaining, selected.side);
    cuts.push(selected.edge);
  }
  const groupByOwner = Array<number>(count).fill(-1);
  groups.forEach((g,i) => g.forEach(owner => { groupByOwner[owner] = i; }));
  const passageOwners = new Set<number>();
  // A degree-two endpoint is a leaf inside its regional tree. Reserving it as
  // a real passage province cannot cut the remaining region into fragments.
  for (const cut of cuts) {
    const candidates = [cut.a,cut.b].filter(i => treeAdj[i]!.length === 2 && !passageOwners.has(i)
      && groups[groupByOwner[i]!]!.length > 3).sort((a,b) => groups[groupByOwner[b]!]!.length - groups[groupByOwner[a]!]!.length
        || plane.provinces[a]!.index - plane.provinces[b]!.index);
    const owner = candidates[0];
    if (owner === undefined) continue;
    const group = groups[groupByOwner[owner]!]!;
    group.splice(group.indexOf(owner),1);
    groupByOwner[owner] = -1;
    passageOwners.add(owner);
  }
  const contacts = metricContacts(plane,aspect);
  const pairs = new Map<string,RegionPair>();
  const pixel = Math.max(aspect / Math.max(1,plane.width),1 / Math.max(1,plane.height));
  for (let a=0;a<count;a++) for (const contact of contacts[a]!) {
    const b = contact.neighbour;
    // Corner slivers are mathematical neighbours but cannot form a readable
    // two-sided native doorway after rasterization and adjacent rock seams.
    const minimumFrontier = Math.min(Math.min(localSpacings[a]!,localSpacings[b]!) * .32,Math.max(pixel*4,spacing*.12));
    if (Math.hypot(contact.to.x-contact.from.x,contact.to.y-contact.from.y) < minimumFrontier) continue;
    const key = pairKey(plane.provinces[a]!.id,plane.provinces[b]!.id);
    if (!pairs.has(key)) pairs.set(key,{a:Math.min(a,b),b:Math.max(a,b),key});
  }
  const voronoiPairs = [...pairs.values()].sort((a,b) => a.a-b.a || a.b-b.b);
  const regionPairs = voronoiPairs.filter(({a,b}) => groupByOwner[a]! >= 0 && groupByOwner[a] === groupByOwner[b]);
  const plan = { groups,groupByOwner,passageOwners,treePairs,regionPairs,voronoiPairs,contacts,spacing,localSpacings,aspect };
  if (plans.size >= 16) plans.delete(plans.keys().next().value!);
  plans.set(signature,plan);
  return plan;
}

export function connectedRegionLayoutNotice(plane: Plane): string | undefined {
  if (!usesConnectedRegions(plane)) return undefined;
  return connectedRegionOwnershipResult(plane).notice;
}

/** Metric Voronoi ownership prevents wide rooms from inventing movement contacts. */
export function createConnectedRegionOwnership(plane: Plane): ProvinceOwnershipModel | undefined {
  if (!usesConnectedRegions(plane)) return undefined;
  return connectedRegionOwnershipResult(plane).model;
}

function connectedRegionOwnershipResult(plane: Plane): RegionOwnershipResult {
  // Validation and rendering share this cache: a native-resolution safety scan
  // is paid once per geometry edit, not again for terrain, armies or each render.
  const signature = JSON.stringify([planeGenerationKey(plane), plane.kind, plane.landformStyle, plane.width, plane.height, plane.wrapX, plane.wrapY,
    plane.provinces.map(p => [p.id,p.index,p.x,p.y,!!p.small,!!p.large]),
    plane.edges.map(e => pairKey(e.a,e.b)).sort()]);
  const cached = ownershipResults.get(signature);
  if (cached) return cached;
  const result = buildConnectedRegionOwnership(plane);
  if (ownershipResults.size >= 16) ownershipResults.delete(ownershipResults.keys().next().value!);
  ownershipResults.set(signature,result);
  return result;
}

function buildConnectedRegionOwnership(plane: Plane): RegionOwnershipResult {
  if (plane.provinces.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x<0 || p.x>1 || p.y<0 || p.y>1)) {
    return { notice:"Connected regions require valid province positions; compatibility geometry is retained without changing the map's links." };
  }
  // Bound the temporary audit buffers by the existing native-export envelope.
  if (!Number.isInteger(plane.width) || !Number.isInteger(plane.height) || plane.width < 1 || plane.height < 1
    || plane.width > 3840 || plane.height > 3840 || plane.width * plane.height > 8_294_400) {
    return { notice:"Connected regions require supported whole-pixel dimensions (at most 3840 per side and 8.29 megapixels); compatibility geometry is retained without changing the map's links." };
  }
  if (!plane.provinces.length) return { model:{mode:"sparse",metricAspect:clamp(plane.width/plane.height,.08,12),
    columns:3,rows:2,primitives:[],ownerAt:()=>-1,regionBorders:new Map()} };
  const plan = buildConnectedRegionPlan(plane);
  const keys = new Set(plan.voronoiPairs.map(p => p.key));
  const ids = new Set(plane.provinces.map(p => p.id));
  if (plane.edges.some(e => ids.has(e.a) && ids.has(e.b) && e.a !== e.b && !keys.has(pairKey(e.a,e.b)))) {
    return { notice:"Compatibility geometry is retained because this map has nonlocal authored links or very short frontiers that cannot share regional borders safely. Back up the project and Generate to create a connected-region layout, or keep the existing authored map. Existing links and provinces have not been changed." };
  }
  return buildRegionalModel(plane,plan);
}

function buildRegionalModel(source: Plane, plan: ConnectedRegionPlan): RegionOwnershipResult {
  // Cached ownership must describe the geometry captured by its cache key.
  // Draft helpers can mutate their input in place; retaining that object in
  // ownerAt would otherwise combine moved centres/wrapping with old contours
  // and poison a later lookup of an untouched or restored geometry snapshot.
  const plane: Plane = {
    ...source,
    provinces: source.provinces.map(province => ({ ...province })),
    edges: source.edges.map(edge => ({ ...edge })),
  };
  const aspect = plan.aspect;
  const columns = Math.max(3,Math.ceil(Math.sqrt(Math.max(1,plane.provinces.length)*aspect)));
  const rows = Math.max(2,Math.ceil(Math.max(1,plane.provinces.length)/columns));
  const keys = new Set(plane.edges.map(e => pairKey(e.a,e.b)));
  const pixel = Math.max(aspect / Math.max(1,plane.width), 1 / Math.max(1,plane.height));
  const centres = plane.provinces.map(p => ({x:p.x*aspect,y:p.y}));
  const sky = plane.kind === "cloud" || plane.kind === "air";
  const radii = plane.provinces.map((p,i) => {
    const passage = plan.passageOwners.has(i);
    const size = p.small ? .84 : p.large ? 1.13 : 1;
    const scale = passage ? sky ? .32 : .235 : sky ? .64 : plane.kind === "cavern" ? .65 : .59;
    return Math.max(pixel*1.6,plan.localSpacings[i]! * scale * size * (.93 + roll(`${p.id}:region-size`)*.14));
  });
  const phases = plane.provinces.map(p => roll(`${p.id}:region-outline`)*Math.PI*2);
  // Sky groups share a prevailing direction, with varied individual headlands.
  // Only the contour changes: centres, group membership and movement stay put.
  const skyContours = sky ? plane.provinces.map((p,owner) => {
    const group = plan.groups[plan.groupByOwner[owner]!] ?? [owner];
    const anchor = plane.provinces[group[0]!]!.id;
    const rotation = roll(`${anchor}:sky-wind`)*Math.PI + (roll(`${p.id}:sky-tilt`) - .5)*.7;
    const stretch = (plane.kind === "air" ? 1.22 : 1.08) + roll(`${p.id}:sky-stretch`)*.3;
    return { radiusX:radii[owner]!*Math.sqrt(stretch), radiusY:radii[owner]!/Math.sqrt(stretch),
      rotation, cos:Math.cos(rotation), sin:Math.sin(rotation) };
  }) : undefined;
  const realmContours = usesNaturalRealmContours(plane)
    ? buildNaturalRealmContours(plane,plan,radii,pixel)
    : undefined;
  const silhouette: SparseSilhouette = plane.kind === "cloud" ? "cloud-island" : plane.kind === "air" ? "air-stream"
    : plane.kind === "cavern" ? "cavern-vault" : plane.kind === "hell" ? "infernal-fracture"
      : plane.kind === "abyss" ? "abyss-pocket" : plane.kind === "dream" ? "dream-lobe"
        : plane.kind === "elemental" ? "elemental-shard" : "cave-chamber";
  const chambers: ProvinceChamberPrimitive[] = plane.provinces.map((p,i) => {
    const contour = skyContours?.[i], realm = realmContours?.[i];
    return {
      kind:"chamber",owner:i,center:{x:p.x,y:p.y},radius:realm?.outerRadius ?? (contour ? contour.radiusX*1.23 : radii[i]!*1.12),
      radiusX:realm?.radiusX ?? contour?.radiusX ?? radii[i]!,radiusY:realm?.radiusY ?? contour?.radiusY ?? radii[i]!,
      rotation:realm?.rotation ?? contour?.rotation ?? 0,rotationCos:realm?.cos ?? contour?.cos ?? 1,
      rotationSin:realm?.sin ?? contour?.sin ?? 0,
      contourPower:realm ? realm.organicPower < 1.98 ? 1 : realm.organicPower > 2.55 ? 4 : 2 : 2,
      organicPower:realm?.organicPower ?? 2,outlineWaves:realm?.outlineWaves,
      warpX:realm?.warpX ?? 0,warpY:realm?.warpY ?? 0,
      lobeX:realm?.lobeX ?? 0,lobeY:realm?.lobeY ?? 0,lobeScale:realm?.lobeScale ?? 0,
      hub:!plan.passageOwners.has(i),silhouette,
    };
  });
  const frontierDistance=(owner:number,c:Contact)=>c.limit-c.nx*centres[owner]!.x-c.ny*centres[owner]!.y;
  const closestFrontiers=plan.contacts.map((contacts,owner)=>{
    const nearest=new Map<number,number>();
    for(const c of contacts)nearest.set(c.neighbour,Math.min(nearest.get(c.neighbour)??Infinity,frontierDistance(owner,c)));
    return nearest;
  });
  const outlets = plan.contacts.map((contacts,owner) => contacts.filter(c => {
    if (!keys.has(pairKey(plane.provinces[owner]!.id,plane.provinces[c.neighbour]!.id))) return false;
    // A wrapped pair can have two separated frontiers. Open its nearest
    // actual frontier, not a second distant passage through the map center.
    // The absolute nearest image is not always a Voronoi neighbour at all.
    return frontierDistance(owner,c)<=closestFrontiers[owner]!.get(c.neighbour)!+EPS;
  })
    .map(c => {
      const regional = plan.groupByOwner[owner]! >= 0 && plan.groupByOwner[owner] === plan.groupByOwner[c.neighbour];
      const key = pairKey(plane.provinces[owner]!.id,plane.provinces[c.neighbour]!.id);
      const width = Math.max(pixel*1.6,Math.min(plan.localSpacings[owner]!,plan.localSpacings[c.neighbour]!)
        * (regional ? sky ? .51 : .48 : sky ? .30 : .235) * (.94 + roll(key)*.12));
      const portal = {x:(c.from.x+c.to.x)/2,y:(c.from.y+c.to.y)/2};
      const route = sky ? skyPassage(centres[owner]!,portal,width,pixel,key,regional) : undefined;
      return {contact:c,portal,width,route};
    }));
  const walls = plan.contacts.map((contacts,owner) => contacts.filter(c => !keys.has(pairKey(plane.provinces[owner]!.id,plane.provinces[c.neighbour]!.id)))
    .map(c => ({...c,shoreLimit:Math.min(...outlets[owner]!.map(outlet =>
      (c.limit-c.nx*outlet.portal.x-c.ny*outlet.portal.y)*.5))})));
  let removedPixels: ReadonlySet<number> | undefined;
  const contains = (owner:number,x:number,y:number) => {
    if (removedPixels?.has(nativePixel(plane,x,y))) return false;
    // PERF: the owner-frame point is inlined as scalars; this runs once per
    // sampled pixel, so it must not allocate. Same arithmetic as before.
    const centre = centres[owner]!, source = plane.provinces[owner]!;
    const pointX = centre.x + periodic(x-source.x,plane.wrapX)*aspect;
    const pointY = centre.y + periodic(y-source.y,plane.wrapY);
    // Two-sided rock seams at omitted contacts preserve an edited movement
    // graph. A bounded margin keeps even small/high-density centres intact.
    const margin = Math.min(plan.localSpacings[owner]!* .18,Math.max(pixel*1.1,plan.spacing*.025));
    for (const wall of walls[owner]!) {
      // Omitted sky frontiers are open air, not straight cuts through stone.
      // Keep the existing gap floor, and bound the extra setback by nearby
      // doorway clearance so a short, valid frontier cannot be swallowed.
      const shore = sky ? Math.max(margin,Math.min(wall.shoreLimit,plan.localSpacings[owner]!*.22,
        Math.max(pixel*1.1,plan.spacing*.045)*(1+.35*Math.sin(
        (-wall.ny*pointX+wall.nx*pointY)/plan.spacing*4+phases[owner]!,
      )))) : margin;
      if (wall.limit-wall.nx*pointX-wall.ny*pointY < shore-EPS) return false;
    }
    const dx=pointX-centre.x,dy=pointY-centre.y;
    const phase=phases[owner]!,contour=skyContours?.[owner],realm=realmContours?.[owner];
    if (contour) {
      const u=(dx*contour.cos+dy*contour.sin)/contour.radiusX;
      const v=(-dx*contour.sin+dy*contour.cos)/contour.radiusY;
      const angle=Math.atan2(v,u);
      const coast=1+.11*Math.sin(angle*2+phase)+.075*Math.sin(angle*3-phase)+.04*Math.sin(angle*5+phase);
      if(u*u+v*v<=coast*coast)return true;
    } else if (realm) {
      if(insideRealmContour(dx,dy,realm))return true;
    } else {
      const angle=Math.atan2(dy,dx);
      const radius=radii[owner]!*(1+.065*Math.sin(angle*3+phase)+.035*Math.sin(angle*5-phase));
      if(dx*dx+dy*dy<=radius*radius)return true;
    }
    for(const outlet of outlets[owner]!) {
      if(outlet.route ? insideSkyPassage(pointX,pointY,outlet.route)
        : segmentDistanceSquared(pointX,pointY,centre,outlet.portal)<=outlet.width*outlet.width)return true;
    }
    return false;
  };
  const {offsets:candidateOffsets,owners:candidateOwners} = refineCandidateBuckets(
    plane,exactCandidateBuckets(plane,columns,rows,aspect),columns,rows,aspect);
  const fineColumns = columns*CANDIDATE_REFINEMENT, fineRows = rows*CANDIDATE_REFINEMENT;
  const ownerAt = (x:number,y:number) => {
    if(!Number.isFinite(x)||!Number.isFinite(y)||(!plane.wrapX&&(x<0||x>1))||(!plane.wrapY&&(y<0||y>1)))return -1;
    x=unit(x,plane.wrapX);y=unit(y,plane.wrapY);
    // Scaling by a power of two is exact, so each fine cell lies inside the
    // coarse cell the former Math.floor(x*columns) lookup selected.
    const bx=clamp(Math.floor(x*fineColumns),0,fineColumns-1),by=clamp(Math.floor(y*fineRows),0,fineRows-1);
    const bucket=by*fineColumns+bx,end=candidateOffsets[bucket+1]!;
    let owner=-1,distance=Infinity;
    for(let k=candidateOffsets[bucket]!;k<end;k++) {
      const i=candidateOwners[k]!;
      const p=plane.provinces[i]!,dx=periodic(x-p.x,plane.wrapX)*aspect,dy=periodic(y-p.y,plane.wrapY);
      const d=dx*dx+dy*dy;
      if(d<distance-EPS||(Math.abs(d-distance)<=EPS&&(owner<0||p.index<plane.provinces[owner]!.index))) {owner=i;distance=d;}
    }
    return owner>=0&&contains(owner,x,y)?owner:-1;
  };
  const safety = stabilizeNativeOwnership(plane,ownerAt);
  if (safety.notice) return { notice:safety.notice };
  if (safety.removed.size) removedPixels = safety.removed;
  const regionBorders = new Map<string,BorderSegment[]>();
  const corridors: ProvinceCorridorPrimitive[] = [];
  for(let owner=0;owner<plane.provinces.length;owner++) for(const outlet of outlets[owner]!) {
    const c=outlet.contact,other=c.neighbour;
    if(owner>other)continue;
    const key=pairKey(plane.provinces[owner]!.id,plane.provinces[other]!.id);
    const p=plane.provinces[owner]!;
    const imageDistance=frontierDistance(owner,c)*2;
    const end={x:p.x+c.nx*imageDistance/aspect,y:p.y+c.ny*imageDistance};
    const reverse = outlet.route && outlets[other]!.find(candidate => candidate.contact.neighbour===owner
      && Math.abs(periodic(candidate.portal.x/aspect-outlet.portal.x/aspect,plane.wrapX))<EPS
      && Math.abs(periodic(candidate.portal.y-outlet.portal.y,plane.wrapY))<EPS);
    const route = outlet.route && reverse?.route ? [
      ...outlet.route,
      ...reverse.route.slice(0,-1).reverse().map(point => ({
        x:point.x+outlet.portal.x-reverse.portal.x,y:point.y+outlet.portal.y-reverse.portal.y,width:point.width,
      })),
    ] : undefined;
    corridors.push({kind:"corridor",owners:[owner,other],key,from:{x:p.x,y:p.y},to:end,
      halfWidth:outlet.width,path:route?.map(point=>({x:point.x/aspect,y:point.y}))
        ?? [{x:p.x,y:p.y},{x:outlet.portal.x/aspect,y:outlet.portal.y},end],
      halfWidths:route?.map(point=>point.width) ?? [outlet.width,outlet.width,outlet.width]});
    const length=Math.hypot(c.to.x-c.from.x,c.to.y-c.from.y);
    const steps=Math.max(32,Math.min(1024,Math.ceil(length/pixel*2)));
    const pointAt=(t:number)=>({x:(c.from.x+(c.to.x-c.from.x)*t)/aspect,y:c.from.y+(c.to.y-c.from.y)*t});
    const valid=(t:number)=>{const v=pointAt(t);return contains(owner,v.x,v.y)&&contains(other,v.x,v.y);};
    let start:number|undefined;
    const boundary=(a:number,b:number,insideAtB:boolean)=>{
      for(let k=0;k<12;k++){const m=(a+b)/2;if(valid(m)===insideAtB)b=m;else a=m;}return (a+b)/2;
    };
    for(let s=0;s<=steps;s++) {
      const t=s/steps,inside=valid(t);
      if(inside&&start===undefined)start=s===0?0:boundary((s-1)/steps,t,true);
      if(start!==undefined&&(!inside||s===steps)) {
        const finish=inside?t:boundary((s-1)/steps,t,false);
        if(finish-start>EPS)appendWrappedSegments(regionBorders,key,pointAt(start),pointAt(finish),plane);
        start=undefined;
      }
    }
  }
  return { model:{mode:"sparse",metricAspect:aspect,columns,rows,primitives:[...chambers,...corridors],ownerAt,regionBorders} };
}

function naturalRealmProfile(kind: Plane["kind"]): RealmContourProfile {
  if (kind === "cavern") return {
    aspect:[1.32,1.92],power:[2.12,2.78],primaryWave:[.085,.145],secondaryWaveRatio:[.28,.43],
    warp:.085,lobeChance:.58,lobeScale:[.27,.42],lobeDistance:[.38,.51],groupedRotation:true,
  };
  if (kind === "hell") return {
    aspect:[1.08,1.48],power:[1.64,1.92],primaryWave:[.07,.125],secondaryWaveRatio:[.34,.52],
    warp:.1,lobeChance:.18,lobeScale:[.22,.34],lobeDistance:[.42,.52],groupedRotation:false,
  };
  if (kind === "abyss") return {
    aspect:[1.14,1.7],power:[1.78,2.2],primaryWave:[.13,.2],secondaryWaveRatio:[.36,.55],
    warp:.115,lobeChance:.46,lobeScale:[.25,.4],lobeDistance:[.39,.53],groupedRotation:false,
  };
  if (kind === "dream") return {
    aspect:[1.1,1.52],power:[2.06,2.56],primaryWave:[.12,.19],secondaryWaveRatio:[.28,.47],
    warp:.105,lobeChance:.82,lobeScale:[.34,.5],lobeDistance:[.34,.48],groupedRotation:false,
  };
  if (kind === "elemental") return {
    aspect:[1.08,1.52],power:[2.62,3.28],primaryWave:[.08,.145],secondaryWaveRatio:[.35,.54],
    warp:.08,lobeChance:.16,lobeScale:[.21,.32],lobeDistance:[.42,.51],groupedRotation:false,
  };
  return {
    aspect:[1.08,1.46],power:[1.86,2.34],primaryWave:[.1,.165],secondaryWaveRatio:[.27,.43],
    warp:.075,lobeChance:.34,lobeScale:[.24,.37],lobeDistance:[.4,.53],groupedRotation:false,
  };
}

function buildNaturalRealmContours(
  plane: Plane,
  plan: ConnectedRegionPlan,
  radii: readonly number[],
  pixel: number,
): RealmContour[] {
  const profile = naturalRealmProfile(plane.kind);
  return plane.provinces.map((province,owner) => {
    const key=`${planeGenerationKey(plane)}:${plane.kind}:${province.id}:natural-v1`;
    const passage=plan.passageOwners.has(owner);
    let aspect=profile.aspect[0]+(profile.aspect[1]-profile.aspect[0])*roll(`${key}:aspect`);
    if(passage)aspect=1+(aspect-1)*.36;
    const root=Math.sqrt(aspect);
    let radiusX=radii[owner]!*root,radiusY=radii[owner]!/root;
    const group=plan.groups[plan.groupByOwner[owner]!] ?? [owner];
    const groupAnchor=plane.provinces[group[0]!]!.id;
    const rotation=profile.groupedRotation
      ? roll(`${planeGenerationKey(plane)}:${plane.kind}:${groupAnchor}:natural-v1-axis`)*Math.PI+(roll(`${key}:tilt`)-.5)*.58
      : roll(`${key}:rotation`)*Math.PI*2;
    const organicPower=profile.power[0]+(profile.power[1]-profile.power[0])*roll(`${key}:power`);
    const phase=roll(`${key}:wave-phase`)*Math.PI*2;
    const secondary=roll(`${key}:wave-secondary`)*Math.PI*2;
    const amplitude=profile.primaryWave[0]+(profile.primaryWave[1]-profile.primaryWave[0])
      * roll(`${key}:wave-amplitude`);
    const secondaryRatio=profile.secondaryWaveRatio[0]+(profile.secondaryWaveRatio[1]-profile.secondaryWaveRatio[0])
      * roll(`${key}:wave-ratio`);
    const outlineWaves:[number,number,number,number]=[
      Math.cos(phase)*amplitude,Math.sin(phase)*amplitude,
      Math.cos(secondary)*amplitude*secondaryRatio,Math.sin(secondary)*amplitude*secondaryRatio,
    ];
    const warpX=(roll(`${key}:warp-x`)*2-1)*profile.warp;
    const warpY=(roll(`${key}:warp-y`)*2-1)*profile.warp;
    const hasLobe=!passage&&roll(`${key}:lobe`) < profile.lobeChance;
    const lobeAngle=roll(`${key}:lobe-angle`)*Math.PI*2;
    const lobeDistance=hasLobe
      ? profile.lobeDistance[0]+(profile.lobeDistance[1]-profile.lobeDistance[0])*roll(`${key}:lobe-distance`)
      : 0;
    const lobeX=Math.cos(lobeAngle)*lobeDistance,lobeY=Math.sin(lobeAngle)*lobeDistance;
    const lobeScale=hasLobe
      ? profile.lobeScale[0]+(profile.lobeScale[1]-profile.lobeScale[0])*roll(`${key}:lobe-scale`)
      : 0;
    const contourLimit=1+Math.abs(warpX)+Math.abs(warpY)+outlineWaves.reduce((sum,wave)=>sum+Math.abs(wave),0);
    const squircleFactor=organicPower>2 ? Math.pow(2,.5-1/organicPower) : 1;
    const contourOuterFactor=Math.pow(contourLimit,1/organicPower)*squircleFactor;
    const lobeOuterFactor=lobeScale>0?lobeDistance+lobeScale:1;
    const outerFactor=Math.max(contourOuterFactor,lobeOuterFactor);
    // Preserve broad rooms without allowing an irregular tip to reach a
    // non-neighbour before the Voronoi wall guard can clip it.
    const safeFraction=passage
      ? .385+roll(`${key}:outer-bound`)*.045
      : .615+roll(`${key}:outer-bound`)*.085;
    const safeOuterRadius=Math.max(pixel*2.05,plan.localSpacings[owner]!*safeFraction);
    const rawOuterRadius=Math.max(radiusX,radiusY)*outerFactor;
    if(rawOuterRadius>safeOuterRadius) {
      const shrink=safeOuterRadius/rawOuterRadius;
      radiusX*=shrink;radiusY*=shrink;
    }
    radiusX=Math.max(pixel*1.6,radiusX);radiusY=Math.max(pixel*1.6,radiusY);
    return {
      radiusX,radiusY,rotation,cos:Math.cos(rotation),sin:Math.sin(rotation),organicPower,outlineWaves,
      warpX,warpY,lobeX,lobeY,lobeScale,outerRadius:Math.max(radiusX,radiusY)*outerFactor,
    };
  });
}

function insideRealmContour(dx:number,dy:number,contour:RealmContour):boolean {
  if(dx*dx+dy*dy>contour.outerRadius*contour.outerRadius+EPS)return false;
  const x=(dx*contour.cos+dy*contour.sin)/contour.radiusX;
  const y=(-dx*contour.sin+dy*contour.cos)/contour.radiusY;
  const bias=contour.warpX*x/(1+Math.abs(x))+contour.warpY*y/(1+Math.abs(y));
  const measure=Math.pow(Math.abs(x),contour.organicPower)+Math.pow(Math.abs(y),contour.organicPower);
  if(measure<=1+bias+angularContourWave(x,y,contour.outlineWaves)+EPS)return true;
  if(contour.lobeScale<=0)return false;
  const lx=(x-contour.lobeX)/contour.lobeScale,ly=(y-contour.lobeY)/contour.lobeScale;
  return lx*lx+ly*ly<=1+EPS;
}

/** Polynomial third/fifth harmonics keep owner sampling deterministic and cheap. */
function angularContourWave(x:number,y:number,waves:readonly[number,number,number,number]):number {
  const length=Math.hypot(x,y);
  if(length<=EPS)return 0;
  const ux=x/length,uy=y/length,x2=ux*ux,y2=uy*uy;
  return waves[0]*ux*(4*x2-3)+waves[1]*uy*(3-4*y2)
    +waves[2]*ux*(16*x2*x2-20*x2+5)+waves[3]*uy*(16*y2*y2-20*y2+5);
}

function nativePixel(plane: Plane, x: number, y: number): number {
  const px = clamp(Math.floor(unit(x,plane.wrapX)*plane.width),0,plane.width-1);
  const py = clamp(Math.floor(unit(y,plane.wrapY)*plane.height),0,plane.height-1);
  return py*plane.width+px;
}

/** Keep each capital's four-connected component; never redraw graph edges. */
function stabilizeNativeOwnership(plane: Plane, ownerAt: (x:number,y:number)=>number): {removed:Set<number>;notice?:string} {
  const width=plane.width,height=plane.height,count=plane.provinces.length;
  const owners=new Int16Array(width*height),sizes=new Uint32Array(count),capitals:number[]=[];
  const removed=new Set<number>();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const owner=ownerAt((x+.5)/width,(y+.5)/height);
    owners[y*width+x]=owner;
    if(owner>=0)sizes[owner]++;
  }
  // Match the exact capital-pixel guarantee shared by preview and D6M export.
  for(const [owner,p] of plane.provinces.entries()) {
    const pixel=clamp(Math.round(p.y*(height-1)),0,height-1)*width+clamp(Math.round(p.x*(width-1)),0,width-1);
    capitals.push(pixel);
    const previous=owners[pixel]!;
    if(previous>=0)sizes[previous]--;
    owners[pixel]=owner;sizes[owner]++;
  }
  if(new Set(capitals).size!==count) return {removed,notice:"Compatibility geometry is retained because multiple province centres share a native pixel. Increase this plane's resolution or separate its province centres. Existing links and provinces have not been changed."};
  const seen=new Uint8Array(owners.length),queue=new Uint32Array(Math.max(1,...sizes));
  for(let owner=0;owner<count;owner++) {
    let length=1;queue[0]=capitals[owner]!;seen[queue[0]!]=1;
    const visit=(pixel:number)=>{
      if(pixel>=0&&!seen[pixel]&&owners[pixel]===owner){seen[pixel]=1;queue[length++]=pixel;}
    };
    for(let cursor=0;cursor<length;cursor++) {
      const pixel=queue[cursor]!,x=pixel%width,y=Math.floor(pixel/width);
      visit(x>0?pixel-1:plane.wrapX?pixel+width-1:-1);
      visit(x<width-1?pixel+1:plane.wrapX?pixel-width+1:-1);
      visit(y>0?pixel-width:plane.wrapY?pixel+(height-1)*width:-1);
      visit(y<height-1?pixel+width:plane.wrapY?x:-1);
    }
  }
  for(let pixel=0;pixel<owners.length;pixel++)if(owners[pixel]!>=0&&!seen[pixel]) {
    removed.add(pixel);owners[pixel]=-1;
  }
  if(plane.provinces.some((p,owner)=>removed.has(nativePixel(plane,p.x,p.y))||ownerAt(p.x,p.y)!==owner)) {
    return {removed,notice:"Compatibility geometry is retained because native pixel quantization cannot safely preserve all regional province centres. Increase this plane's resolution or separate its province centres. Existing links and provinces have not been changed."};
  }
  const indexes=new Map(plane.provinces.map((p,i)=>[p.id,i]));
  const code=(a:number,b:number)=>Math.min(a,b)*count+Math.max(a,b);
  const expected=new Set<number>();
  for(const edge of plane.edges) {
    const a=indexes.get(edge.a),b=indexes.get(edge.b);
    if(a!==undefined&&b!==undefined&&a!==b)expected.add(code(a,b));
  }
  const actual=new Set<number>();
  const contact=(owner:number,pixel:number)=>{
    const other=owners[pixel]!;
    if(other>=0&&other!==owner)actual.add(code(owner,other));
  };
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const pixel=y*width+x,owner=owners[pixel]!;
    if(owner<0)continue;
    if(x<width-1)contact(owner,pixel+1);else if(plane.wrapX)contact(owner,pixel-width+1);
    if(y<height-1)contact(owner,pixel+width);else if(plane.wrapY)contact(owner,x);
  }
  const missing=[...expected].filter(key=>!actual.has(key)).length;
  const extra=[...actual].filter(key=>!expected.has(key)).length;
  if(missing||extra) return {removed,notice:`Compatibility geometry is retained because connected regions cannot represent all movement links faithfully at ${width}×${height} (${missing} missing frontiers; ${extra} unintended contacts). Increase this plane's resolution or reduce province density. Existing links and provinces have not been changed.`};
  return {removed};
}

function metricContacts(plane:Plane,aspect:number):Contact[][] {
  return plane.provinces.map((p,owner)=>{
    const x=p.x*aspect,y=p.y;
    let polygon:Vertex[]=[{x:plane.wrapX?x-aspect/2:0,y:plane.wrapY?y-.5:0},
      {x:plane.wrapX?x+aspect/2:aspect,y:plane.wrapY?y-.5:0},{x:plane.wrapX?x+aspect/2:aspect,y:plane.wrapY?y+.5:1},
      {x:plane.wrapX?x-aspect/2:0,y:plane.wrapY?y+.5:1}];
    const images = plane.provinces.flatMap((q,i)=>i===owner?[]:(plane.wrapY?[-1,0,1]:[0]).flatMap(oy=>(plane.wrapX?[-1,0,1]:[0])
      .map(ox=>({i,x:(q.x+ox)*aspect,y:q.y+oy,d:((q.x+ox)*aspect-x)**2+(q.y+oy-y)**2})))).sort((a,b)=>a.d-b.d||a.i-b.i);
    for(const q of images) {
      if(!polygon.length)break;
      const maxRadius=Math.max(...polygon.map(v=>Math.hypot(v.x-x,v.y-y)));
      if(q.d>4*maxRadius*maxRadius+EPS)break;
      polygon=clip(polygon,2*(q.x-x),2*(q.y-y),q.x*q.x+q.y*q.y-x*x-y*y,q.i);
    }
    const contacts:Contact[]=[];
    for(let j=0;j<polygon.length;j++) {
      const to=polygon[j]!,from=polygon[(j+polygon.length-1)%polygon.length]!;
      if(to.incoming===undefined)continue;
      const length=Math.hypot(to.x-from.x,to.y-from.y);
      if(length<1e-8)continue;
      // Counter-clockwise polygon: the outward normal points to the right.
      const nx=(to.y-from.y)/length,ny=-(to.x-from.x)/length;
      contacts.push({neighbour:to.incoming,from:{x:from.x,y:from.y},to:{x:to.x,y:to.y},nx,ny,limit:nx*to.x+ny*to.y});
    }
    return contacts;
  });
}

function clip(polygon:Vertex[],a:number,b:number,c:number,owner:number):Vertex[] {
  const result:Vertex[]=[];
  for(let i=0;i<polygon.length;i++) {
    const v=polygon[i]!,u=polygon[(i+polygon.length-1)%polygon.length]!;
    const vin=a*v.x+b*v.y<=c+EPS,uin=a*u.x+b*u.y<=c+EPS;
    if(vin!==uin) {
      const denominator=a*(v.x-u.x)+b*(v.y-u.y);
      if(Math.abs(denominator)>1e-14){const t=(c-a*u.x-b*u.y)/denominator;result.push({x:u.x+(v.x-u.x)*t,y:u.y+(v.y-u.y)*t,incoming:uin?v.incoming:owner});}
    }
    if(vin)result.push({...v});
  }
  return result.filter((v,i)=>i===0||Math.hypot(v.x-result[i-1]!.x,v.y-result[i-1]!.y)>EPS);
}

function exactCandidateBuckets(plane:Plane,columns:number,rows:number,aspect:number):number[][] {
  const radius=Math.hypot(aspect/columns,1/rows)/2;
  return Array.from({length:columns*rows},(_,bucket)=>{
    const x=(bucket%columns+.5)/columns,y=(Math.floor(bucket/columns)+.5)/rows;
    const distances=plane.provinces.map((p,i)=>({i,d:Math.hypot(periodic(x-p.x,plane.wrapX)*aspect,periodic(y-p.y,plane.wrapY))}));
    const best=Math.min(...distances.map(p=>p.d));
    // Triangle-inequality bound, unlike a fixed number of neighbouring buckets.
    return distances.filter(p=>p.d<=best+2*radius+EPS).map(p=>p.i);
  });
}

/** Fine lookup cells per coarse candidate-bucket axis. */
const CANDIDATE_REFINEMENT = 4;

/**
 * PERF: split each exact candidate bucket into 4×4 finer lookup cells, stored
 * flat (offsets/owners) so a lookup allocates nothing. A fine cell keeps, in
 * the same ascending order, every candidate of its enclosing coarse bucket
 * that could come within ownerAt's tie tolerance of the nearest centre
 * anywhere in the cell. Farther candidates can never change ownerAt's
 * sequential nearest/EPS-tie scan (a tie chain from the minimum grows by at
 * most EPS per candidate), so lookups return exactly the former owner while
 * testing far fewer centres per sample.
 */
function refineCandidateBuckets(plane:Plane,coarse:readonly (readonly number[])[],columns:number,rows:number,aspect:number)
  :{offsets:Int32Array;owners:Int32Array} {
  const fineColumns=columns*CANDIDATE_REFINEMENT,fineRows=rows*CANDIDATE_REFINEMENT;
  const radius=Math.hypot(aspect/fineColumns,1/fineRows)/2;
  // Squared-distance slack: one EPS per possible chained tie plus a rounding margin.
  const tolerance=(plane.provinces.length+1)*EPS+1e-12;
  const offsets=new Int32Array(fineColumns*fineRows+1),owners:number[]=[];
  for(let bucket=0;bucket<fineColumns*fineRows;bucket++) {
    const column=bucket%fineColumns,row=Math.floor(bucket/fineColumns);
    const x=(column+.5)/fineColumns,y=(row+.5)/fineRows;
    const parent=coarse[Math.floor(row/CANDIDATE_REFINEMENT)*columns+Math.floor(column/CANDIDATE_REFINEMENT)]!;
    const distances=parent.map(i=>{
      const p=plane.provinces[i]!;
      return Math.hypot(periodic(x-p.x,plane.wrapX)*aspect,periodic(y-p.y,plane.wrapY));
    });
    // Triangle inequality: any sample in this cell is within `radius` of its centre.
    const reach=(Math.min(...distances)+radius)**2+tolerance;
    parent.forEach((owner,k)=>{
      const nearest=Math.max(0,distances[k]!-radius);
      if(nearest*nearest<=reach)owners.push(owner);
    });
    offsets[bucket+1]=owners.length;
  }
  return {offsets,owners:Int32Array.from(owners)};
}

/** Scalar point arguments keep per-pixel ownership tests allocation-free. */
function segmentDistanceSquared(px:number,py:number,a:Point,b:Point):number {
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length>EPS?clamp(((px-a.x)*dx+(py-a.y)*dy)/length,0,1):0;
  return (px-a.x-dx*t)**2+(py-a.y-dy*t)**2;
}

interface SkyPassagePoint extends Point { width: number }

/** A shallow, tapered sweep replaces straight, constant-width sky causeways. */
function skyPassage(from:Point,to:Point,width:number,pixel:number,key:string,regional:boolean):SkyPassagePoint[] {
  const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);
  const bend=Math.min(length*.18,width*.45)*(roll(`${key}:sky-bend`)*2-1)*(regional ? .4 : 1);
  const swell=.1+roll(`${key}:sky-swell`)*.18;
  return Array.from({length:5},(_,i)=>{
    const t=i/4,wave=Math.sin(t*Math.PI);
    return {x:from.x+dx*t-(length>EPS ? dy/length*bend*wave : 0),
      y:from.y+dy*t+(length>EPS ? dx/length*bend*wave : 0),
      width:Math.max(pixel*1.6,width*(1+swell*wave))};
  });
}

function insideSkyPassage(px:number,py:number,route:readonly SkyPassagePoint[]):boolean {
  for(let i=1;i<route.length;i++) {
    const a=route[i-1]!,b=route[i]!,dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    const t=length>EPS ? clamp(((px-a.x)*dx+(py-a.y)*dy)/length,0,1) : 0;
    const width=a.width+(b.width-a.width)*t;
    if((px-a.x-dx*t)**2+(py-a.y-dy*t)**2<=width*width)return true;
  }
  return false;
}

function appendWrappedSegments(target:Map<string,BorderSegment[]>,key:string,a:Point,b:Point,plane:Plane) {
  for(const oy of plane.wrapY?[-1,0,1]:[0])for(const ox of plane.wrapX?[-1,0,1]:[0]) {
    const from={x:a.x+ox,y:a.y+oy},dx=b.x-a.x,dy=b.y-a.y;
    let lo=0,hi=1;
    for(const [p,q] of [[-dx,from.x],[dx,1-from.x],[-dy,from.y],[dy,1-from.y]]) {
      if(Math.abs(p!)<1e-14){if(q!<-EPS){lo=1;hi=0;break;}continue;}
      const t=q!/p!;if(p!<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
    }
    if(hi-lo<EPS)continue;
    const list=target.get(key)??[];
    list.push({from:{x:from.x+dx*lo,y:from.y+dy*lo},to:{x:from.x+dx*hi,y:from.y+dy*hi}});
    target.set(key,list);
  }
}
