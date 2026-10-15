import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

// Opt-in real-model benchmark on public package demo photos, without camera,
// accounts, database access, or student evidence. Results are not hardware QA.
test("desktop real-model inference benchmark and shared TensorFlow engine", {timeout:240_000}, async()=>{
  const bundle=await build({stdin:{contents:`
    import * as faceapi from '@vladmandic/face-api/dist/face-api.esm-nobundle.js';
    import * as core from '@tensorflow/tfjs-core';
    import * as coco from '@tensorflow-models/coco-ssd';
    import {prepareDesktopFaceFrame,detectDesktopFacesWithFallback} from './src/lib/desktop-head-tracking';
    window.monitoring={faceapi,core,coco,prepareDesktopFaceFrame,detectDesktopFacesWithFallback};
  `,resolveDir:process.cwd()},alias:{"@tensorflow/tfjs/dist/index.js":path.resolve("src/lib/tensorflow-browser.ts")},bundle:true,write:false,platform:"browser",format:"iife"});
  const cache=path.resolve(".tmp-stabilization-model-cache");await fs.mkdir(cache,{recursive:true});
  const browser=await chromium.launch({headless:true});const page=await browser.newPage();
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.route("https://models.example.test/**",async route=>{
    const url=new URL(route.request().url()),file=path.basename(url.pathname);
    let body:Buffer;
    if(url.pathname.startsWith("/models/")) body=await fs.readFile(path.join("public/models",file));
    else if(url.pathname==="/sample.jpg") body=await fs.readFile("node_modules/@vladmandic/face-api/demo/sample1.jpg");
    else if(url.pathname.startsWith("/coco/") && /^(model\.json|group1-shard[1-5]of5)$/.test(file)) {
      const local=path.join(cache,file);
      try{body=await fs.readFile(local);}catch{
        const response=await fetch("https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/"+file);
        assert.equal(response.ok,true);body=Buffer.from(await response.arrayBuffer());await fs.writeFile(local,body);
      }
    }else{await route.abort();return;}
    await route.fulfill({body,contentType:file.endsWith(".json")?"application/json":file.endsWith(".jpg")?"image/jpeg":"application/octet-stream",headers:{"access-control-allow-origin":"*"}});
  });
  try{
    await page.setContent('<canvas id="frame" width="480" height="270"></canvas>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const result=await page.evaluate(async()=>{
      const {faceapi,core,coco,prepareDesktopFaceFrame,detectDesktopFacesWithFallback}=(window as any).monitoring;
      core.enableProdMode();await core.ready();
      const init=performance.now();
      await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri("https://models.example.test/models"),faceapi.nets.faceLandmark68Net.loadFromUri("https://models.example.test/models")]);
      const faceLoadMs=performance.now()-init;
      const cocoStart=performance.now(),model=await coco.load({base:"lite_mobilenet_v2",modelUrl:"https://models.example.test/coco/model.json"});
      const cocoLoadMs=performance.now()-cocoStart;
      const raw=document.getElementById("frame") as HTMLCanvasElement;
      const photo=new Image();photo.crossOrigin="anonymous";photo.src="https://models.example.test/sample.jpg";await photo.decode();
      raw.getContext("2d")!.drawImage(photo,0,0,raw.width,raw.height);
      const bright=document.createElement("canvas"),context=bright.getContext("2d",{willReadFrequently:true})!;
      let calls=0;
      const scan=async(size:number,scoreThreshold:number)=>{
        calls++;
        return faceapi.detectAllFaces(size<320?raw:prepareDesktopFaceFrame(raw,bright,context),new faceapi.TinyFaceDetectorOptions({inputSize:size,scoreThreshold})).withFaceLandmarks(false);
      };
      const before=()=>detectDesktopFacesWithFallback(160,scan),after=()=>detectDesktopFacesWithFallback(320,scan);
      await before();await after();await model.detect(raw,10,.5);
      const memoryBefore=core.memory().numTensors;
      const samples:{beforeMs:number;afterMs:number;beforeFaces:number;afterFaces:number;beforeCalls:number;afterCalls:number}[]=[];
      for(let i=0;i<8;i++){
        const row:any={};
        for(const kind of (i%2?["after","before"]:["before","after"])){
          calls=0;const start=performance.now(),faces=await(kind==="before"?before():after());
          row[kind+"Ms"]=performance.now()-start;row[kind+"Faces"]=faces.length;row[kind+"Calls"]=calls;
        }
        samples.push(row);
      }
      const objects=[];
      for(let i=0;i<3;i++){const start=performance.now(),predictions=await model.detect(raw,10,.5);objects.push({ms:performance.now()-start,classes:predictions.map((p:any)=>p.class)});}
      const memoryAfter=core.memory().numTensors;
      const backend=core.getBackend(),sharedEngine=faceapi.tf.engine()===core.engine();
      model.dispose();faceapi.nets.tinyFaceDetector.dispose();faceapi.nets.faceLandmark68Net.dispose();
      return{backend,sharedEngine,faceLoadMs,cocoLoadMs,samples,objects,memoryBefore,memoryAfter,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency};
    });
    assert.equal(result.sharedEngine,true);assert.deepEqual(errors,[]);
    for(const row of result.samples){assert.ok(row.afterFaces>0,"demo image must exercise successful face detection");assert.equal(row.beforeFaces,row.afterFaces);assert.equal(row.beforeCalls,2);assert.equal(row.afterCalls,1);}
    assert.equal(result.memoryAfter,result.memoryBefore,"repeated inference must not retain tensors");
    const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const beforeMedianMs=median(result.samples.map(r=>r.beforeMs)),afterMedianMs=median(result.samples.map(r=>r.afterMs));
    const evidence={scope:"Headless Chromium real model weights and bundled demo photograph. No physical camera, real-device accuracy, live student evidence, or classroom capacity verification.",...result,beforeMedianMs,afterMedianMs,medianReductionPercent:100*(beforeMedianMs-afterMedianMs)/beforeMedianMs};
    await fs.mkdir("release-review/stabilization-2026-10-15",{recursive:true});
    await fs.writeFile("release-review/stabilization-2026-10-15/AI_LATENCY.json",JSON.stringify(evidence,null,2));
    console.log(JSON.stringify(evidence,null,2));
  }finally{await browser.close();}
});
