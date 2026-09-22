import assert from "node:assert/strict";
import test from "node:test";
import type { Plane, PlaneKind } from "../src/domain";
import { createDefaultProject, generatePlane } from "../src/generator";
import { buildConnectedRegionPlan, connectedRegionLayoutNotice } from "../src/connectedRegions";
import { computeProvinceTopology, connectionKey, createProvinceOwnershipModel } from "../src/geometry";
import { encodeD6m, inspectD6m } from "../src/dom6";
import { samplePlaneOwnership } from "../src/MapCanvas";

function fixture(kind:PlaneKind="cave",width=384,height=256,count=40,wrapX=false,wrapY=false,seed="region-raster") {
  const project=createDefaultProject(seed,{generate:false});
  const source:Plane={...project.planes[0]!,id:`${seed}-${kind}`,kind,ownershipMode:"sparse",sparseLayout:"regions",
    provinceTarget:count,width,height,wrapX,wrapY,noGeneratedStarts:true};
  return generatePlane(source,project.settings,`${seed}-${kind}`,1,{deferStrategicFeatures:true});
}

function auditRaster(plane:Plane) {
  const width=plane.width,height=plane.height,model=createProvinceOwnershipModel(plane);
  const owners=new Int32Array(width*height),seen=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)owners[y*width+x]=model.ownerAt((x+.5)/width,(y+.5)/height);
  const neighbours=(pixel:number)=>{
    const x=pixel%width,y=Math.floor(pixel/width),result:number[]=[];
    if(x>0)result.push(pixel-1);else if(plane.wrapX)result.push(pixel+width-1);
    if(x<width-1)result.push(pixel+1);else if(plane.wrapX)result.push(pixel-width+1);
    if(y>0)result.push(pixel-width);else if(plane.wrapY)result.push(pixel+(height-1)*width);
    if(y<height-1)result.push(pixel+width);else if(plane.wrapY)result.push(x);
    return result;
  };
  const contacts=new Map<string,number>(),components=Array.from({length:plane.provinces.length},()=>[] as number[]);
  for(let i=0;i<owners.length;i++) {
    const owner=owners[i]!;if(owner<0)continue;
    for(const n of neighbours(i)) {
      const other=owners[n]!;
      if(other>=0&&other!==owner){const key=connectionKey(plane.provinces[owner]!.id,plane.provinces[other]!.id);contacts.set(key,(contacts.get(key)??0)+1);}
    }
    if(seen[i])continue;
    seen[i]=1;const queue=[i];
    for(let q=0;q<queue.length;q++)for(const n of neighbours(queue[q]!))if(!seen[n]&&owners[n]===owner){seen[n]=1;queue.push(n);}
    components[owner]!.push(queue.length);
  }
  return {owners,contacts,components,model};
}

for(const kind of ["cave","cavern","cloud","air","hell","abyss","dream","elemental"] as const) {
  for(const [label,width,height,wrapX,wrapY] of [["square",256,256,false,false],["wrap-x",384,256,true,false],
    ["portrait-wrap-y",256,384,false,true],["torus",384,256,true,true]] as const) {
    test(`${kind}/${label}: actual native-resolution contacts match movement and every footprint is connected`,()=>{
      const plane=fixture(kind,width,height,40,wrapX,wrapY);
      assert.equal(connectedRegionLayoutNotice(plane),undefined);
      const before=JSON.stringify(plane),audit=auditRaster(plane);
      const expected=new Set(plane.edges.map(e=>connectionKey(e.a,e.b)));
      assert.deepEqual([...audit.contacts.keys()].sort(),[...expected].sort(),"compare actual owner pixels, not declared topology with itself");
      for(const [owner,p] of plane.provinces.entries()) {
        assert.equal(audit.model.ownerAt(p.x,p.y),owner);
        assert.equal(audit.components[owner]!.length,1,`${p.index}: disconnected footprint sizes ${audit.components[owner]}`);
      }
      const topology=computeProvinceTopology(plane);
      for(const edge of plane.edges) {
        const borders=topology.sharedBorders.get(connectionKey(edge.a,edge.b));
        assert.ok(borders?.length,"every link must have a genuinely painted frontier");
        const a=plane.provinces.findIndex(p=>p.id===edge.a),b=plane.provinces.findIndex(p=>p.id===edge.b);
        for(const border of borders!) {
          const dx=(border.to.x-border.from.x)*audit.model.metricAspect,dy=border.to.y-border.from.y,length=Math.hypot(dx,dy);
          for(const t of [.2,.5,.8]) {
            const x=border.from.x+(border.to.x-border.from.x)*t,y=border.from.y+(border.to.y-border.from.y)*t;
            const epsilon=1e-6;
            const owners=[audit.model.ownerAt(x-dy/length*epsilon/audit.model.metricAspect,y+dx/length*epsilon),
              audit.model.ownerAt(x+dy/length*epsilon/audit.model.metricAspect,y-dx/length*epsilon)];
            assert.deepEqual(owners.sort((x,y)=>x-y),[a,b].sort((x,y)=>x-y),"drawn border must have the expected owner on each side");
          }
        }
      }
      assert.equal(JSON.stringify(plane),before);
    });
  }
}

test("regional masses have broad shared frontiers and existing real passage provinces",()=>{
  const plane=fixture("cavern",512,256,56,false,false,"broad-region-proof"),plan=buildConnectedRegionPlan(plane);
  assert.ok(plan.groups.length>=3);
  assert.ok(plan.groups.every(g=>g.length>=3));
  assert.ok(plan.passageOwners.size>=2);
  const regions=createProvinceOwnershipModel(plane);
  let regionalArea=0;
  for(let y=0;y<256;y++)for(let x=0;x<512;x++){
    regionalArea+=Number(regions.ownerAt((x+.5)/512,(y+.5)/256)>=0);
  }
  assert.ok(regionalArea>512*256*.6,"adjoining multi-province landforms must occupy substantial area, not a network of thin tubes");
  for (const sparseLayout of [undefined,"chambers","regions"] as const) {
    assert.equal(createProvinceOwnershipModel({...plane,sparseLayout}),regions,"obsolete layout metadata cannot select the removed renderer");
  }
  const topology=computeProvinceTopology(plane);
  const widths=plan.regionPairs.map(p=>(topology.sharedBorders.get(p.key)??[]).reduce((sum,s)=>sum+Math.hypot((s.to.x-s.from.x)*plan.aspect,s.to.y-s.from.y),0)).sort((a,b)=>a-b);
  assert.ok(widths[Math.floor(widths.length/2)]!>plan.spacing*.4,"typical internal border should be a large fraction of a province width");
  for(const owner of plan.passageOwners) {
    const p=plane.provinces[owner]!;
    assert.equal(regions.ownerAt(p.x,p.y),owner,"a passage remains a real, individually owned province");
    const chamber=regions.primitives.find(s=>s.kind==="chamber"&&s.owner===owner);
    assert.ok(chamber?.kind==="chamber"&&chamber.radiusX>plan.localSpacings[owner]!*.2,"passage floors must not be hairlines");
  }
});

test("group planning is stable across graph and gameplay edits; removed contacts become rock seams",()=>{
  const plane=fixture("cloud",384,256,40,false,false,"region-edit");
  const originalPlan=buildConnectedRegionPlan(plane),before=JSON.stringify(originalPlan.groupByOwner);
  const removed=plane.edges.pop()!;
  plane.provinces[0]!.poptype=81;plane.provinces[0]!.start=true;plane.provinces[0]!.terrainFlags=["cave","sea"];
  const afterPlan=buildConnectedRegionPlan(plane);
  assert.equal(JSON.stringify(afterPlan.groupByOwner),before);
  const audit=auditRaster(plane);
  assert.equal(audit.contacts.has(connectionKey(removed.a,removed.b)),false);
  assert.deepEqual([...audit.contacts.keys()].sort(),plane.edges.map(e=>connectionKey(e.a,e.b)).sort());
});

test("arbitrary nonlocal authored links retain explicit compatibility geometry without graph edits",()=>{
  const plane=fixture("cave",256,256,24,false,false,"region-fallback"),plan=buildConnectedRegionPlan(plane);
  const safe=new Set(plan.voronoiPairs.map(p=>p.key));
  let pair:readonly[number,number]|undefined;
  for(let a=0;a<plane.provinces.length&&!pair;a++)for(let b=a+1;b<plane.provinces.length;b++)if(!safe.has(connectionKey(plane.provinces[a]!.id,plane.provinces[b]!.id))){pair=[a,b];break;}
  assert.ok(pair);
  plane.edges.push({id:"authored-long-link",a:plane.provinces[pair[0]]!.id,b:plane.provinces[pair[1]]!.id,kind:"standard"});
  const before=JSON.stringify(plane),model=createProvinceOwnershipModel(plane);
  assert.match(connectedRegionLayoutNotice(plane)!,/Compatibility geometry is retained/);
  assert.equal(model.regionBorders,undefined,"a notice must not claim the incompatible graph has regional frontiers");
  for(const [owner,p] of plane.provinces.entries())assert.equal(model.ownerAt(p.x,p.y),owner);
  for (const sparseLayout of [undefined,"chambers","regions"] as const) {
    assert.equal(createProvinceOwnershipModel({...plane,sparseLayout}),model,"all imported metadata variants share the same safe rendering");
  }
  assert.equal(JSON.stringify(plane),before);
});

test("regional preview pixels match native D6M ownership, including flooded caves",async()=>{
  const plane=fixture("cave",256,256,40,true,true,"region-native");
  plane.provinces[0]!.terrain="cave";plane.provinces[0]!.terrainFlags=["sea","deep"];
  const before=JSON.stringify(plane),bytes=await encodeD6m(plane,"region-native"),header=inspectD6m(bytes);
  assert.equal(header.provinceCount,plane.provinces.length);
  const offset=34+plane.provinces.length*12+plane.width*plane.height*2;
  const native=new Int16Array(bytes.buffer,bytes.byteOffset+offset,plane.width*plane.height);
  const preview=samplePlaneOwnership(plane,plane.width,plane.height,createProvinceOwnershipModel(plane));
  assert.equal(native.length,preview.length);
  for(let i=0;i<native.length;i++)if(native[i]!-1!==preview[i])assert.fail(`Preview/native ownership mismatch at pixel ${i}`);
  assert.equal(JSON.stringify(plane),before);
});

test("large and extreme-aspect regional maps retain native-sized centre ownership",()=>{
  for(const [width,height,count] of [[256,256,240],[2048,256,96],[256,2048,96],[3840,2160,800]] as const) {
    const plane=fixture("cavern",width,height,count,true,true,`region-envelope-${width}`);
    assert.equal(connectedRegionLayoutNotice(plane),undefined);
    const model=createProvinceOwnershipModel(plane);
    for(const [owner,p] of plane.provinces.entries())assert.equal(model.ownerAt(p.x,p.y),owner);
  }
});
