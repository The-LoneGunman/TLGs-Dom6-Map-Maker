import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultProject, generatePlane, captureGeneratedWaterProvenance } from "../src/generator";
import { computeProvinceTopology, createProvinceOwnershipModel } from "../src/geometry";
import { createNaturalLandformWarp } from "../src/naturalLandforms";
import { createWaterLandformProfile } from "../src/waterLandforms";
import { type Plane, isWaterProvince } from "../src/domain";

function fixture(seed: string, wrap = false): Plane {
  const base = createDefaultProject(seed, {generate:false});
  const plane = generatePlane({...base.planes[0]!, width:768, height:768, provinceTarget:96, wrapX:wrap, wrapY:wrap},
    {...base.settings, waterPercent:0, throneCount:0}, seed, 0, {deferStrategicFeatures:true});
  for (const p of plane.provinces) {
    p.terrain = p.x > .6 || Math.hypot(p.x - .28, p.y - .53) < .1 ? "sea" : "plains";
    p.terrainFlags = undefined;
  }
  captureGeneratedWaterProvenance(plane);
  return plane;
}

test("coastal bays, small lake basins and offshore divisions use distinct shared contours", context => {
  let coastBend = 0, inlandBend = 0, coastCount = 0, inlandCount = 0, seaChanged = 0;
  for (let seed = 0; seed < 8; seed++) {
    const plane = fixture(`coastal-contours-${seed}`), plain = structuredClone(plane);
    delete plain.landformWater;
    const warp = createNaturalLandformWarp(plane)!, ordinary = createNaturalLandformWarp(plain)!;
    const legacy = structuredClone(plain); delete legacy.landformStyle;
    const topology = computeProvinceTopology(legacy), profiles = createWaterLandformProfile(plane)!;
    assert.ok(plane.landformWater!.some(body => body.enclosed));
    assert.ok(plane.landformWater!.some(body => !body.enclosed));
    assert.ok(profiles(.9,.5).water > .9, "interior ocean has a water-specific profile");
    assert.ok(profiles(.05,.15).water < .1, "inland regions do not get ocean divisions");
    const wet = new Set(plane.provinces.filter(isWaterProvince).map(p => p.id));
    for (const [key, borders] of topology.sharedBorders) for (const {from,to} of borders) {
      const [a,b] = key.split("|");
      const length = Math.hypot(to.x-from.x, to.y-from.y);
      if (length < .025) continue;
      const start = warp.forward(from), end = warp.forward(to), dx = end.x-start.x, dy=end.y-start.y;
      let bend = 0;
      for (let step = 1; step < 12; step++) {
        const point = {x:from.x+(to.x-from.x)*step/12,y:from.y+(to.y-from.y)*step/12};
        const p = warp.forward(point), old = ordinary.forward(point);
        bend = Math.max(bend, Math.abs(dx*(p.y-start.y)-dy*(p.x-start.x))/Math.hypot(dx,dy));
        if (wet.has(a!) && wet.has(b!) && Math.hypot(p.x-old.x,p.y-old.y) > .0001) seaChanged++;
      }
      if (wet.has(a!) !== wet.has(b!)) {coastBend += bend; coastCount++;}
      else if (!wet.has(a!)) {inlandBend += bend; inlandCount++;}
    }
    assert.deepEqual(computeProvinceTopology(plane).pairs, topology.pairs);
    const owner = createProvinceOwnershipModel(plane);
    plane.provinces.forEach((p,i)=>assert.equal(owner.ownerAt(p.x,p.y),i));
  }
  context.diagnostic(JSON.stringify({coastBend:coastBend/coastCount,inlandBend:inlandBend/inlandCount,seaChanged}));
  assert.ok(coastBend/coastCount > inlandBend/inlandCount * 1.5, "shorelines should be visibly more sculpted than inland boundaries");
  assert.ok(seaChanged > 200, "open-water divisions must not reuse the ordinary land-wave pattern");
});

test("coastal profiles remain invertible and periodic without following later terrain edits", () => {
  const plane = fixture("coastal-wrap-profile",true), warp = createNaturalLandformWarp(plane)!;
  const samples = [];
  for (let y=0;y<71;y++) for(let x=0;x<91;x++) {
    const source = {x:(x+.32)/91,y:(y+.62)/71}, mapped=warp.forward(source), restored=warp.inverse(mapped.x,mapped.y);
    assert.ok(Math.hypot(source.x-restored.x,source.y-restored.y)<1e-9);
    samples.push(mapped);
  }
  for(let step=0;step<=100;step++) {
    const n=step/100,l=warp.forward({x:0,y:n}),r=warp.forward({x:1,y:n}),t=warp.forward({x:n,y:0}),b=warp.forward({x:n,y:1});
    assert.ok(Math.abs(l.y-r.y)<1e-12);assert.ok(Math.abs(t.x-b.x)<1e-12);
  }
  for (const p of plane.provinces) {p.terrain="forest";p.terrainFlags=["cave"];}
  const edited=createNaturalLandformWarp(plane)!;
  assert.equal(edited,warp);
  assert.deepEqual(samples,Array.from({length:71*91},(_,i)=>edited.forward({x:(i%91+.32)/91,y:(Math.floor(i/91)+.62)/71})));
});

test("malformed in-memory water provenance is safely ignored by the shape hint consumer", () => {
  const plane = fixture("coast-invalid-provenance");
  for (const invalid of [null, [null], [{provinceIds:["unknown"],enclosed:true}], [{provinceIds:[],enclosed:0}]]) {
    Object.assign(plane,{landformWater:invalid});
    assert.equal(createWaterLandformProfile(plane),undefined);
  }
});
