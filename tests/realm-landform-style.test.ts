import assert from "node:assert/strict";
import test from "node:test";
import type { Plane, PlaneKind } from "../src/domain";
import { buildConnectedRegionPlan, connectedRegionLayoutNotice, createConnectedRegionOwnership } from "../src/connectedRegions";
import { encodeD6m, inspectD6m } from "../src/dom6";
import { createDefaultProject, generatePlane } from "../src/generator";
import { connectionKey, type ProvinceChamberPrimitive, type ProvinceOwnershipModel } from "../src/geometry";
import { samplePlaneOwnership } from "../src/MapCanvas";

type NaturalPlane = Plane & { landformStyle?: "natural-v1" };
const REALMS = ["cave","cavern","hell","abyss","dream","elemental"] as const;

function fixture(kind:PlaneKind,seed:string,natural:boolean,width=320,height=224,wrapX=false,wrapY=false,count=36):NaturalPlane {
  const project=createDefaultProject(seed,{generate:false});
  const source:Plane={...project.planes[0]!,id:`${seed}-${kind}`,kind,ownershipMode:"sparse",provinceTarget:count,
    width,height,wrapX,wrapY,noGeneratedStarts:true};
  const plane=generatePlane(source,project.settings,`${seed}-${kind}`,1,{deferStrategicFeatures:true}) as NaturalPlane;
  if(natural)plane.landformStyle="natural-v1";else delete plane.landformStyle;
  return plane;
}

function chambers(model:ProvinceOwnershipModel):ProvinceChamberPrimitive[] {
  return model.primitives.filter((primitive):primitive is ProvinceChamberPrimitive=>primitive.kind==="chamber");
}

function rasterAudit(plane:Plane,model:ProvinceOwnershipModel) {
  const owners=new Int16Array(plane.width*plane.height);
  const seen=new Uint8Array(owners.length);
  const components=Array.from({length:plane.provinces.length},()=>0);
  const contacts=new Set<string>();
  let blank=0;
  const neighbours=(pixel:number) => {
    const x=pixel%plane.width,y=Math.floor(pixel/plane.width),result:number[]=[];
    if(x>0)result.push(pixel-1);else if(plane.wrapX)result.push(pixel+plane.width-1);
    if(x<plane.width-1)result.push(pixel+1);else if(plane.wrapX)result.push(pixel-plane.width+1);
    if(y>0)result.push(pixel-plane.width);else if(plane.wrapY)result.push(pixel+(plane.height-1)*plane.width);
    if(y<plane.height-1)result.push(pixel+plane.width);else if(plane.wrapY)result.push(x);
    return result;
  };
  for(let y=0;y<plane.height;y++)for(let x=0;x<plane.width;x++) {
    const pixel=y*plane.width+x,owner=model.ownerAt((x+.5)/plane.width,(y+.5)/plane.height);
    owners[pixel]=owner;
    if(owner<0){blank++;continue;}
    for(const next of neighbours(pixel)) {
      const other=owners[next] ?? -1;
      if(other>=0&&other!==owner)contacts.add(connectionKey(plane.provinces[owner]!.id,plane.provinces[other]!.id));
    }
  }
  // The first pass has already populated every pixel; audit contacts again so
  // row order cannot hide left/up or wrapped neighbours.
  contacts.clear();
  for(let pixel=0;pixel<owners.length;pixel++) {
    const owner=owners[pixel]!;
    if(owner<0)continue;
    for(const next of neighbours(pixel)) {
      const other=owners[next]!;
      if(other>=0&&other!==owner)contacts.add(connectionKey(plane.provinces[owner]!.id,plane.provinces[other]!.id));
    }
    if(seen[pixel])continue;
    seen[pixel]=1;components[owner]++;
    const queue=[pixel];
    for(let cursor=0;cursor<queue.length;cursor++)for(const next of neighbours(queue[cursor]!)) {
      if(!seen[next]&&owners[next]===owner){seen[next]=1;queue.push(next);}
    }
  }
  return {owners,components,contacts,blank};
}

function assertSafeNaturalRealm(plane:NaturalPlane) {
  assert.equal(connectedRegionLayoutNotice(plane),undefined);
  const model=createConnectedRegionOwnership(plane);
  assert.ok(model,"natural contours should pass native-resolution safety");
  const audit=rasterAudit(plane,model);
  const expected=new Set(plane.edges.map(edge=>connectionKey(edge.a,edge.b)));
  assert.deepEqual([...audit.contacts].sort(),[...expected].sort(),"visible frontiers must equal movement links exactly");
  assert.ok(audit.blank>plane.width*plane.height*.025,"realm groups retain visible owner-0 seams");
  for(const [owner,province] of plane.provinces.entries()) {
    assert.equal(model.ownerAt(province.x,province.y),owner,`${province.index}: exact center remains owned`);
    assert.equal(audit.components[owner],1,`${province.index}: contour must remain one connected footprint`);
  }
  return {model,audit};
}

test("natural-v1 realm families are distinct, bounded rooms rather than narrow threads",()=>{
  const statistics=new Map<PlaneKind,{meanAspect:number;meanPower:number;lobeRate:number}>();
  for(const kind of REALMS) {
    const plane=fixture(kind,`natural-family-${kind}`,true),before=JSON.stringify(plane);
    const {model}=assertSafeNaturalRealm(plane),rooms=chambers(model),plan=buildConnectedRegionPlan(plane);
    assert.equal(rooms.length,plane.provinces.length);
    for(const [owner,room] of rooms.entries()) {
      assert.deepEqual(room.center,{x:plane.provinces[owner]!.x,y:plane.provinces[owner]!.y});
      const aspect=Math.max(room.radiusX,room.radiusY)/Math.min(room.radiusX,room.radiusY);
      assert.ok(aspect<=1.93,`${kind}/${owner}: room aspect ${aspect} must stay broad`);
      assert.ok(Math.min(room.radiusX,room.radiusY)>plan.localSpacings[owner]!*.2,
        `${kind}/${owner}: chamber floor must remain substantial`);
      assert.ok(room.radius<=plan.localSpacings[owner]!*.71+1e-9,`${kind}/${owner}: contour stays locally bounded`);
      assert.ok(room.outlineWaves?.some(value=>Math.abs(value)>1e-5),`${kind}: natural outlines use smooth asymmetry`);
    }
    statistics.set(kind,{
      meanAspect:rooms.reduce((sum,room)=>sum+room.radiusX/room.radiusY,0)/rooms.length,
      meanPower:rooms.reduce((sum,room)=>sum+(room.organicPower??2),0)/rooms.length,
      lobeRate:rooms.filter(room=>room.lobeScale>0).length/rooms.length,
    });
    assert.equal(JSON.stringify(plane),before,"shape sampling cannot mutate gameplay geography or content");
  }
  assert.ok(statistics.get("cavern")!.meanAspect>statistics.get("cave")!.meanAspect+.15,
    "Caverns use more elongated vaults than Cave rooms");
  assert.ok(statistics.get("hell")!.meanPower<1.93,"Hell uses rounded infernal facets rather than circles");
  assert.ok(statistics.get("elemental")!.meanPower>2.6,"Elemental rooms use a distinct rounded shard grammar");
  assert.ok(statistics.get("dream")!.lobeRate>.55,"Dream basins are predominantly lobed");
  const fingerprints=[...statistics.values()].map(value=>
    `${value.meanAspect.toFixed(2)}:${value.meanPower.toFixed(2)}:${value.lobeRate.toFixed(2)}`);
  assert.equal(new Set(fingerprints).size,REALMS.length,"each realm family has a measurably distinct contour profile");
});

test("natural realm contours preserve exact ownership on horizontal, vertical, and toroidal seams",()=>{
  const layouts=[[256,192,true,false],[192,256,false,true],[256,192,true,true]] as const;
  for(const kind of REALMS)for(const [width,height,wrapX,wrapY] of layouts) {
    const plane=fixture(kind,`natural-wrap-${kind}-${width}-${height}-${wrapX}-${wrapY}`,true,width,height,wrapX,wrapY,28);
    const {model}=assertSafeNaturalRealm(plane);
    for(const room of chambers(model)) {
      assert.equal(room.center.x,plane.provinces[room.owner]!.x);
      assert.equal(room.center.y,plane.provinces[room.owner]!.y);
    }
  }
});

test("natural realm contours pass native safety from minimum realms through dense 256px maps",()=>{
  for(const kind of REALMS)for(const count of [8,80,240]) {
    const plane=fixture(kind,`natural-density-${kind}-${count}`,true,256,256,true,true,count);
    assert.equal(connectedRegionLayoutNotice(plane),undefined,`${kind}/${count}: dense shapes must remain representable`);
    const model=createConnectedRegionOwnership(plane);
    assert.ok(model);
    for(const [owner,province] of plane.provinces.entries())assert.equal(model.ownerAt(province.x,province.y),owner);
  }
});

test("missing style metadata retains legacy contours, while style changes invalidate only contour ownership",()=>{
  const legacy=fixture("cavern","natural-style-gate",false),snapshot=JSON.stringify(legacy);
  const legacyModel=createConnectedRegionOwnership(legacy)!;
  for(const room of chambers(legacyModel)) {
    assert.equal(room.radiusX,room.radiusY);
    assert.equal(room.rotation,0);
    assert.equal(room.warpX,0);
    assert.equal(room.warpY,0);
    assert.equal(room.lobeScale,0);
    assert.equal(room.outlineWaves,undefined);
  }
  const styled=structuredClone(legacy) as NaturalPlane;
  styled.landformStyle="natural-v1";
  const styledModel=createConnectedRegionOwnership(styled)!;
  assert.notEqual(styledModel,legacyModel,"landform style belongs in the ownership cache key");
  const legacyOwners=rasterAudit(legacy,legacyModel).owners,styledOwners=rasterAudit(styled,styledModel).owners;
  assert.ok(legacyOwners.some((owner,index)=>owner!==styledOwners[index]),"opt-in style materially changes the contour mask");
  assert.equal(createConnectedRegionOwnership(legacy),legacyModel,"returning to absent metadata recovers the legacy snapshot");
  assert.equal(JSON.stringify(legacy),snapshot);
});

test("Cloud/Air polish and the Underworld Styx ignore the non-sky realm contour flag",()=>{
  for(const kind of ["cloud","air"] as const) {
    const legacy=fixture(kind,`natural-ignore-${kind}`,false),styled=structuredClone(legacy) as NaturalPlane;
    styled.landformStyle="natural-v1";
    const a=createConnectedRegionOwnership(legacy)!,b=createConnectedRegionOwnership(styled)!;
    assert.deepEqual(rasterAudit(legacy,a).owners,rasterAudit(styled,b).owners,`${kind} keeps its existing sky contour polish`);
  }
  const underworld=fixture("underworld","natural-ignore-styx",false),styled=structuredClone(underworld) as NaturalPlane;
  styled.landformStyle="natural-v1";
  assert.equal(createConnectedRegionOwnership(underworld),undefined);
  assert.equal(createConnectedRegionOwnership(styled),undefined,"Styx remains on its dedicated ownership system");
});

test("natural contour owners are identical in editor sampling and native D6M",async()=>{
  const plane=fixture("dream","natural-native-parity",true,384,256,true,true,32),before=JSON.stringify(plane);
  const model=createConnectedRegionOwnership(plane)!;
  const editor=samplePlaneOwnership(plane,plane.width,plane.height,model);
  const bytes=await encodeD6m(plane,"natural_native_parity"),header=inspectD6m(bytes);
  assert.equal(header.provinceCount,plane.provinces.length);
  const offset=34+plane.provinces.length*12+plane.width*plane.height*2;
  const binary=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let pixel=0;pixel<editor.length;pixel++) {
    assert.equal(binary.getInt16(offset+pixel*2,true)-1,editor[pixel],`native/editor mismatch at pixel ${pixel}`);
  }
  assert.equal(JSON.stringify(plane),before);
});

test("natural contours retain the explicit compatibility fallback for an impossible authored frontier",()=>{
  const plane=fixture("abyss","natural-compatibility-fallback",true,256,192,false,false,24);
  const local=new Set(buildConnectedRegionPlan(plane).voronoiPairs.map(pair=>pair.key));
  let endpoints:readonly[number,number]|undefined;
  for(let a=0;a<plane.provinces.length&&!endpoints;a++)for(let b=a+1;b<plane.provinces.length;b++) {
    if(!local.has(connectionKey(plane.provinces[a]!.id,plane.provinces[b]!.id))){endpoints=[a,b];break;}
  }
  assert.ok(endpoints);
  plane.edges.push({id:"nonlocal-natural-link",a:plane.provinces[endpoints[0]]!.id,b:plane.provinces[endpoints[1]]!.id,kind:"standard"});
  assert.match(connectedRegionLayoutNotice(plane)!,/Compatibility geometry is retained/);
  assert.equal(createConnectedRegionOwnership(plane),undefined,"unsafe contours must fall back instead of altering the graph");
});
