import assert from "node:assert/strict";
import test from "node:test";
import { getUnauthorizedDevicePrediction, getDevicePredictionLabel, getUnauthorizedDeviceConfidence, isActionableDeviceDetection } from "../src/lib/proctoring-detection.ts";
import { getProctoringPerformanceProfile } from "../src/lib/device-capabilities.ts";
import { detectDesktopFacesWithFallback } from "../src/lib/desktop-head-tracking.ts";

test("device labels retain the actual COCO class and never infer a phone from a camera", () => {
  for (const [category,label] of [["cell phone","Possible phone"],["laptop","Possible laptop"],["remote","Possible electronic device (remote)"]] as const) {
    const prediction=getUnauthorizedDevicePrediction([{class:category,score:.85}]);
    assert.equal(getDevicePredictionLabel(prediction),label);
  }
  for (const category of ["camera","person","tv","monitor","book"]) assert.equal(getUnauthorizedDevicePrediction([{class:category,score:.99}]),null);
  assert.equal(getDevicePredictionLabel(null),"Possible electronic device");
});

test("invalid and low-confidence predictions cannot generate device incidents", () => {
  for (const score of [NaN,Infinity,-1,1.01,.49]) {
    assert.equal(getUnauthorizedDeviceConfidence([{class:"cell phone",score}]),0);
    assert.equal(isActionableDeviceDetection(score,false),false);
  }
  assert.equal(getUnauthorizedDeviceConfidence([{class:" CELL PHONE ",score:.5}]),.5);
  assert.equal(isActionableDeviceDetection(.5,false),true);
  assert.equal(isActionableDeviceDetection(.64,true,true),false);
  assert.equal(isActionableDeviceDetection(.65,true,true),true);
});

test("a successful detailed desktop observation uses one scan and keeps both faces", async () => {
  const profile=getProctoringPerformanceProfile("desktop");
  const faces=[{score:.8},{score:.75}],calls:number[]=[];
  const result=await detectDesktopFacesWithFallback(profile.faceInputSize,async size=>{calls.push(size);return faces;});
  assert.equal(result,faces);
  assert.deepEqual(calls,[320]);
  assert.equal(profile.useTinyLandmarks,false);
});

test("a missed detailed desktop face still retries raw pixels at unchanged confidence", async () => {
  const calls:number[][]=[],face=[{score:.75}];
  const result=await detectDesktopFacesWithFallback(getProctoringPerformanceProfile("desktop").faceInputSize,async (size,score)=>{
    calls.push([size,score]);return size===160?face:[];
  });
  assert.equal(result,face);
  assert.deepEqual(calls,[[320,.5],[160,.5]]);
});
