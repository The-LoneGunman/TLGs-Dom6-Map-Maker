import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source=readFileSync(new URL("../src/MapMakerApp.tsx",import.meta.url),"utf8");
test("iteration checkboxes override full-width form styling on narrow screens",()=>{
  const css=readFileSync(new URL("../app/globals.css",import.meta.url),"utf8");
  assert.match(css,/\.iteration-check input\s*\{[^}]*width:\s*16px/);
});
test("Undo/Redo capture the outgoing project before deferred React stack updaters execute",()=>{
  for(const [name,stackName,opposite] of [["handleUndo","undoStack","setRedoStack"],["handleRedo","redoStack","setUndoStack"]]){
    const start=source.indexOf(`  const ${name} = () => {`),end=source.indexOf("\n  };",start);
    assert.ok(start>=0&&end>start);
    const body=source.slice(source.indexOf("{",start)+1,end);
    const outgoing={name:"edited"},incoming={name:"older"};const ref={current:outgoing};
    const queued:((stack:unknown[])=>unknown[])[]=[];
    const state:Record<string,unknown>={undoStack:[incoming],redoStack:[incoming],rangeEditStartRef:{current:undefined},textEditSessionRef:{current:undefined},currentProjectRef:ref,
      setUndoStack:(fn:(stack:unknown[])=>unknown[])=>{if(opposite==="setUndoStack")queued.push(fn);},setRedoStack:(fn:(stack:unknown[])=>unknown[])=>{if(opposite==="setRedoStack")queued.push(fn);},
      appendHistorySnapshot:(stack:unknown[],value:unknown)=>[...stack,value],importGuardRef:{current:{changed:()=>undefined}},setProject:()=>undefined,setAutosaveSaving:()=>undefined,setSelectedId:()=>undefined,setLinkSource:()=>undefined,setGateSource:()=>undefined};
    new Function(...Object.keys(state),body)(...Object.values(state));
    assert.equal(ref.current,incoming,stackName);
    assert.equal(queued.length,1);assert.equal(queued[0]!([])[0],outgoing,"History must capture the outgoing atlas, not the mutable ref's later value.");
  }
});
test("typing in one field records one Undo step; other commits record their own",async()=>{
  const {textEditHistoryStep}=await import("../src/uiWorkflow");
  const name={field:"name"},seed={field:"seed"};
  let session:object|undefined;const recorded:boolean[]=[];
  for(const target of [name,name,name,undefined,name,seed,seed]){
    const step=textEditHistoryStep(session,target);session=step.session;recorded.push(step.record);
  }
  // Three keystrokes, then Generate, then a new name session, then a seed session.
  assert.deepEqual(recorded,[true,false,false,true,true,true,false]);
  assert.match(source,/onBlur=\{\(event\) => \{ if \(event\.target === textEditSessionRef\.current\) textEditSessionRef\.current = undefined; \}\}/);
});
