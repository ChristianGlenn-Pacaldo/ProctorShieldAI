import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createDesktopDeviceWorker } from "../src/lib/desktop-device-worker.ts";
import { getDesktopDeviceAssetPath } from "../src/lib/desktop-device-model.ts";
import { getUnauthorizedDevicePrediction } from "../src/lib/proctoring-detection.ts";

function fakeWorker() {
  const messages: {id:number;type:string;frame?:ImageBitmap}[]=[];
  let terminated=0;
  const worker={onmessage:null as Worker["onmessage"],onerror:null as Worker["onerror"],postMessage:(value:typeof messages[number])=>messages.push(value),terminate:()=>{terminated++;}};
  return {worker,messages,reply:(data:unknown)=>worker.onmessage?.call(worker as unknown as Worker,{data} as MessageEvent),get terminated(){return terminated;}};
}
test("device assets use a closed manifest; request paths cannot select arbitrary files",()=>{
  assert.equal(getDesktopDeviceAssetPath("worker.js"),"public/desktop-device-worker.js");
  assert.match(getDesktopDeviceAssetPath("vision_wasm_internal.wasm")!,/tasks-vision\/wasm\//);
  for(const file of ["../.env","%2e%2e%2f.env","https://example.com/model","package.json","__proto__"])assert.equal(getDesktopDeviceAssetPath(file),null);
});
test("worker serializes scans, ignores unrelated replies and preserves scores",async()=>{
  const f=fakeWorker();let frames=0;
  const detector=createDesktopDeviceWorker({createWorker:()=>f.worker,createFrame:async()=>{frames++;return {close(){}} as ImageBitmap;}});
  f.reply({id:f.messages[0].id,loaded:true});await detector.ready;
  const result=detector.detect({} as HTMLVideoElement);
  await assert.rejects(detector.detect({} as HTMLVideoElement),/already scanning/);
  await new Promise(resolve=>setTimeout(resolve,0));
  const request=f.messages.at(-1)!;
  f.reply({id:request.id-1,predictions:[{class:"cell phone",score:1}]});
  f.reply({id:request.id,predictions:[{class:"cell phone",score:.7}]});
  assert.equal(getUnauthorizedDevicePrediction(await result)?.score,.7);assert.equal(frames,1);
  detector.dispose();assert.equal(f.terminated,1);
});
test("cleanup during frame preparation releases the unsent bitmap",async()=>{
  const f=fakeWorker();let close=0;
  let release!:(frame:ImageBitmap)=>void;
  const detector=createDesktopDeviceWorker({createWorker:()=>f.worker,createFrame:()=>new Promise(resolve=>{release=resolve;})});
  f.reply({id:1,loaded:true});await detector.ready;
  const result=detector.detect({} as HTMLVideoElement);await Promise.resolve();
  detector.dispose();release({close(){close++;}} as ImageBitmap);
  await assert.rejects(result,/stopped/);assert.equal(close,1);assert.equal(f.messages.length,1);
});
test("a hung model times out and terminates rather than returning a clean reading",async()=>{
  const f=fakeWorker();const detector=createDesktopDeviceWorker({createWorker:()=>f.worker,loadTimeoutMs:10});
  await assert.rejects(detector.ready,/stopped/);assert.equal(f.terminated,1);
});

test("scan timeout includes frame preparation and closes a bitmap that arrives late",async()=>{
  const f=fakeWorker();let close=0;let release!:(frame:ImageBitmap)=>void;
  const detector=createDesktopDeviceWorker({createWorker:()=>f.worker,scanTimeoutMs:10,
    createFrame:()=>new Promise(resolve=>{release=resolve;})});
  f.reply({id:1,loaded:true});await detector.ready;
  const result=detector.detect({} as HTMLVideoElement);
  let guard:ReturnType<typeof setTimeout>;
  try {
    await assert.rejects(Promise.race([result,new Promise((_,reject)=>{
      guard=setTimeout(()=>reject(new Error("Frame capture was never bounded")),250);
    })]),{code:"SCAN_TIMEOUT"});
    assert.equal(f.terminated,1);
  } finally {
    clearTimeout(guard!);detector.dispose();release({close(){close++;}} as ImageBitmap);
    await result.catch(()=>{});await new Promise(setImmediate);
  }
  assert.equal(close,1);assert.equal(f.messages.length,1);
});

for(const predictions of [undefined,null,{},[null],[{class:"cell phone",score:NaN}],[{class:42,score:.8}]]) {
  test("malformed matching worker reply is unavailable, never a clear device reading: "+JSON.stringify(predictions),async()=>{
    const f=fakeWorker();const detector=createDesktopDeviceWorker({createWorker:()=>f.worker,createFrame:async()=>({close(){}} as ImageBitmap)});
    f.reply({id:1,loaded:true});await detector.ready;
    const result=detector.detect({} as HTMLVideoElement);await new Promise(setImmediate);
    f.reply({id:f.messages.at(-1)!.id,predictions});
    try{await assert.rejects(result,{code:"WORKER_PROTOCOL_ERROR"});assert.equal(f.terminated,1);}
    finally{detector.dispose();}
  });
}

test("dispose cancels a stalled frame immediately and ignores late capture errors",async()=>{
  const f=fakeWorker();let fail!:(error:Error)=>void;
  const detector=createDesktopDeviceWorker({createWorker:()=>f.worker,createFrame:()=>new Promise((_,reject)=>{fail=reject;})});
  f.reply({id:1,loaded:true});await detector.ready;
  const result=detector.detect({} as HTMLVideoElement);await Promise.resolve();
  detector.dispose();await assert.rejects(result,{code:"STOPPED"});
  fail(new Error("synthetic sensitive detail"));await new Promise(setImmediate);
  assert.equal(f.terminated,1);
});

test("valid empty detections stay distinct from inference timeout or failure",async()=>{
  const f=fakeWorker();
  const detector=createDesktopDeviceWorker({createWorker:()=>f.worker,scanTimeoutMs:20,createFrame:async()=>({close(){}} as ImageBitmap)});
  f.reply({id:1,loaded:true});await detector.ready;
  const clear=detector.detect({} as HTMLVideoElement);await new Promise(setImmediate);
  f.reply({id:2,predictions:[]});assert.deepEqual(await clear,[]);
  await assert.rejects(detector.detect({} as HTMLVideoElement),{code:"SCAN_TIMEOUT"});
  await assert.rejects(detector.detect({} as HTMLVideoElement),{code:"SCAN_TIMEOUT"});
  assert.equal(f.terminated,1);
});

test("capture exceptions are categorized without exposing raw details",async()=>{
  const f=fakeWorker();
  const detector=createDesktopDeviceWorker({createWorker:()=>f.worker,createFrame:async()=>{throw new Error("synthetic sensitive detail");}});
  f.reply({id:1,loaded:true});await detector.ready;
  await assert.rejects(detector.detect({} as HTMLVideoElement),(error:unknown)=>{
    assert.equal((error as {code:string}).code,"FRAME_CAPTURE_FAILED");
    assert.doesNotMatch((error as Error).message,/sensitive/);return true;
  });
  assert.equal(f.terminated,1);
});

test("a matching load response must explicitly confirm the model loaded",async()=>{
  const f=fakeWorker();const detector=createDesktopDeviceWorker({createWorker:()=>f.worker});
  f.reply({id:1,predictions:[]});
  await assert.rejects(detector.ready,{code:"WORKER_PROTOCOL_ERROR"});assert.equal(f.terminated,1);
});

test("worker runtime errors reject the in-flight scan and release the worker",async()=>{
  const f=fakeWorker();const detector=createDesktopDeviceWorker({createWorker:()=>f.worker,createFrame:async()=>({close(){}} as ImageBitmap)});
  f.reply({id:1,loaded:true});await detector.ready;
  const result=detector.detect({} as HTMLVideoElement);await new Promise(setImmediate);
  f.worker.onerror?.call(f.worker as unknown as Worker,{} as ErrorEvent);
  await assert.rejects(result,{code:"WORKER_ERROR"});assert.equal(f.terminated,1);
});

function workerFixture(outputs: {class:string;score:number}[][]) {
  const replies: {loaded?:boolean;predictions?:{class:string;score:number}[];error?:boolean}[]=[];
  const draws:unknown[][]=[];let scans=0,closed=0;
  const context={drawImage:(...args:unknown[])=>draws.push(args)};
  const scope={importScripts:()=>{},Vision:{FilesetResolver:{forVisionTasks:async()=>({})},ObjectDetector:{createFromOptions:async()=>({detect:()=>({detections:(outputs[scans++]??[]).map(p=>({categories:[{categoryName:p.class,score:p.score}]}))})})}},OffscreenCanvas:class{width:number;height:number;constructor(width:number,height:number){this.width=width;this.height=height;}getContext(){return context;}},self:{postMessage:(data:typeof replies[number])=>replies.push(data),onmessage:null as unknown as (event:{data:unknown})=>Promise<void>}};
  vm.runInNewContext(readFileSync("public/desktop-device-worker.js","utf8"),scope);
  return {scope,replies,draws,get scans(){return scans;},get closed(){return closed;},frame:(width=1280,height=720)=>({width,height,close(){closed++;}})};
}
test("actual worker retains original pixels, scans side regions and closes frames",async()=>{
  const f=workerFixture([[{class:"person",score:.95}],[{class:"cell phone",score:.8}]]);
  await f.scope.self.onmessage({data:{type:"load",id:1}});
  const frame=f.frame();await f.scope.self.onmessage({data:{type:"detect",id:2,frame}});
  assert.equal(f.scans,2);assert.equal(f.closed,1);
  assert.equal(f.draws[0][0],frame);assert.deepEqual(f.draws[0].slice(1),[0,0,720,720,0,0,720,720]);
  assert.equal(getUnauthorizedDevicePrediction(f.replies.at(-1)!.predictions!)?.score,.8);
});
test("actual worker does not promote books, weak phone predictions or monitors into phone alerts",async()=>{
  const f=workerFixture([[{class:"book",score:.99}],[{class:"cell phone",score:.49}],[{class:"tv",score:.99}]]);
  await f.scope.self.onmessage({data:{type:"load",id:1}});
  await f.scope.self.onmessage({data:{type:"detect",id:2,frame:f.frame()}});
  assert.equal(f.scans,3);assert.equal(getUnauthorizedDevicePrediction(f.replies.at(-1)!.predictions!),null);assert.equal(f.closed,1);
});
