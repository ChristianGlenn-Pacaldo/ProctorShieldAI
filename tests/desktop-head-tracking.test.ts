import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as desktopModule from "../src/lib/desktop-head-tracking.ts";
import * as detectionModule from "../src/lib/proctoring-detection.ts";
import { createDesktopHeadTracker, getDesktopInferenceDimensions, measureDesktopPose, requestDesktopCamera } from "../src/lib/desktop-head-tracking.ts";

function calibrated() {
  const tracker = createDesktopHeadTracker();
  for (let i = 0; i < 8; i++) tracker.observe({ yawOffset: 0.08, pitchRatio: 0.5 }, i * 500);
  return tracker;
}
function frames(tracker: ReturnType<typeof calibrated>, yaw: number, pitch = 0.5, start = 4000) {
  return Array.from({ length: 6 }, (_, i) => tracker.observe({ yawOffset: yaw, pitchRatio: pitch }, start + i * 500));
}

test("desktop neutral calibration requires stable forward samples", () => {
  const t = createDesktopHeadTracker();
  for (let i = 0; i < 12; i++) assert.equal(t.observe({ yawOffset: i % 2 ? 0.22 : -0.22, pitchRatio: 0.5 }, i * 500).pose.calibrated, false);
  for (let i = 0; i < 7; i++) assert.equal(t.observe({ yawOffset: 0, pitchRatio: 0.5 }, 6000 + i * 500).pose.calibrated, false);
  assert.equal(t.observe({ yawOffset: 0, pitchRatio: 0.5 }, 9500).pose.calibrated, true);
});
test("centered face and small desktop movement emit no head-turn incident", () => {
  const t = calibrated();
  for (let i = 0; i < 30; i++) assert.equal(t.observe({ yawOffset: 0.08 + Math.sin(i) * 0.08, pitchRatio: 0.5 + Math.cos(i) * 0.06 }, 4000 + i * 500).confirmed, false);
});
for (const [yaw, pitch, reason] of [[0.6,0.5,"looking_left"],[-0.5,0.5,"looking_right"],[0.08,0.25,"looking_up"],[0.08,0.85,"looking_down"]] as const) {
  test(`desktop sustained ${reason} is temporally confirmed`, () => {
    const results = frames(calibrated(), yaw, pitch);
    assert.equal(results[0].confirmed, false);
    assert.equal(results[1].confirmed, false);
    assert.equal(results.at(-1)?.confirmed, true);
    assert.equal(results.at(-1)?.pose.violationReason, reason);
  });
}
test("single noisy landmark and changing turn directions do not accumulate into an incident", () => {
  const t = calibrated();
  const noisy = [0.08,0.08,1.8,0.08,0.08,0.6,-0.5,0.6,-0.5,0.6,-0.5];
  noisy.forEach((yaw, i) => assert.equal(t.observe({ yawOffset: yaw, pitchRatio: 0.5 }, 4000 + i * 500).confirmed, false));
});
test("confirmed incident latches, only stable neutral recovery rearms", () => {
  const t = calibrated(); assert.equal(frames(t, 0.6).at(-1)?.confirmed, true); t.acknowledge();
  assert.equal(frames(t,0.6,0.5,7000).at(-1)?.confirmed,false);
  frames(t,0.08,0.5,10000);
  assert.equal(frames(t,-0.5,0.5,13000).at(-1)?.confirmed,true);
});
test("face loss, low confidence, and long camera gaps cannot count as head turns", () => {
  for (const interruption of ["missing","confidence","gap"]) {
    const t = calibrated(); t.observe({ yawOffset: 0.6,pitchRatio:0.5 },4000);
    if(interruption==="missing") assert.equal(t.observe(null,4500).confirmed,false);
    if(interruption==="confidence") assert.equal(t.observe({yawOffset:0.6,pitchRatio:0.5},4500,0.2).reliable,false);
    const now=interruption==="gap"?10000:5000;
    assert.equal(t.observe({yawOffset:0.6,pitchRatio:0.5},now).confirmed,false);
  }
});
test("reset recalibrates after dimensions change without rearming a recorded incident", () => {
  const t=calibrated(); frames(t,0.6); t.acknowledge(); t.reset();
  for(let i=0;i<8;i++)t.observe({yawOffset:0.08,pitchRatio:0.5},7000+i*500);
  assert.equal(frames(t,0.6,0.5,11000).at(-1)?.confirmed,false);
});
test("intrinsic desktop geometry respects aspect, roll and explicit mirrored inputs", () => {
  assert.deepEqual(getDesktopInferenceDimensions(1280,720,480,360),{width:480,height:270});
  assert.deepEqual(getDesktopInferenceDimensions(640,480,480,360),{width:480,height:360});
  assert.deepEqual(getDesktopInferenceDimensions(720,1280,480,360),{width:203,height:360});
  const pose=measureDesktopPose({x:20,y:20},{x:120,y:20},{x:90,y:70})!;
  const mirror=measureDesktopPose({x:180,y:20},{x:80,y:20},{x:110,y:70},true);
  assert.deepEqual(mirror,pose);
  const rotate=(p:{x:number;y:number})=>({x:p.x*Math.cos(0.3)-p.y*Math.sin(0.3),y:p.x*Math.sin(0.3)+p.y*Math.cos(0.3)});
  const tilted=measureDesktopPose(rotate({x:20,y:20}),rotate({x:120,y:20}),rotate({x:90,y:70}))!;
  assert.ok(Math.abs(tilted.yawOffset-pose.yawOffset)<1e-9); assert.ok(Math.abs(tilted.pitchRatio-pose.pitchRatio)<1e-9);
  assert.equal(measureDesktopPose({x:0,y:0},{x:1,y:0},{x:0,y:1}),null);
});
test("actual desktop inference callback updates stale canvas dimensions from intrinsic pixels", () => {
  const source=fs.readFileSync("src/app/quiz/[id]/page.tsx","utf8");const ast=ts.createSourceFile("page.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let text=""; const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==="drawInferenceFrame")text=n.getText(ast);ts.forEachChild(n,visit);};visit(ast);
  const canvas={width:480,height:360};let resets=0;
  const context={isMobile:false,getDesktopInferenceDimensions,inferenceCanvas:canvas,inferenceContext:{drawImage(){}},performanceProfile:{inferenceWidth:480,inferenceHeight:360},resetDetectorIncidents:()=>resets++};
  vm.runInNewContext(ts.transpile("const "+text+"; drawInferenceFrame({videoWidth:1280,videoHeight:720});"),context);
  assert.equal(canvas.height,270);assert.equal(resets,1);
  assert.match(source,/if \(!isMobile\) desktopHeadTracker\.observe\(null/);
  assert.match(source,/desktopHeadTracker\.reportIncident\(\(\) => reportViolationRef\.current\(violationReason, 90\)/);
  assert.ok(source.startsWith('"use client";'));
});
test("desktop camera uses ideal HD constraints and falls back without enforcing exact hardware", async()=>{
  const calls:MediaStreamConstraints[]=[]; const stream={} as MediaStream;
  const result=await requestDesktopCamera(async constraints=>{calls.push(constraints);if(calls.length===1)throw Object.assign(new Error(),{name:"OverconstrainedError"});return stream;},false);
  assert.equal(result,stream);assert.deepEqual(calls,[{video:{facingMode:"user",width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24}},audio:false},{video:{facingMode:"user"},audio:false}]);
});


test("frontal desktop face calibrates from its central nose landmark after reentry", () => {
  const source = fs.readFileSync("src/app/quiz/[id]/page.tsx", "utf8");
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "desktopTracking") callback = node.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(callback, "use the actual desktop inference callback");
  // Eight steady, forward-facing observations recorded by the desktop check.
  // A nostril edge moves just beyond 0.25 even though the nose tip stays centered.
  const observations = [
    [0.230, 0.708, 0.023, 0.584], [0.221, 0.681, 0.015, 0.530],
    [0.219, 0.672, -0.017, 0.548], [0.252, 0.671, 0.016, 0.556],
    [0.215, 0.628, 0.008, 0.520], [0.215, 0.652, 0.020, 0.535],
    [0.225, 0.638, 0.010, 0.546], [0.228, 0.654, 0.016, 0.535],
  ];
  const tracker = createDesktopHeadTracker();
  let result: ReturnType<typeof tracker.observe> | null = null;
  observations.forEach(([wingYaw, wingPitch, tipYaw, tipPitch], index) => {
    const nosePoints = Array.from({ length: 9 }, () => ({ x: 70, y: 70 }));
    nosePoints[3] = { x: 70 + tipYaw * 100, y: 20 + tipPitch * 100 };
    nosePoints[8] = { x: 70 + wingYaw * 100, y: 20 + wingPitch * 100 };
    const context = { ...desktopModule, isMobile: false, desktopHeadTracker: tracker,
      leftEyeX: 20, leftEyeY: 20, rightEyeX: 120, rightEyeY: 20,
      nosePoints, noseBottom: nosePoints[8], performance: { now: () => index * 1000 },
      detections: [{ detection: { score: 0.81 } }] };
    result = vm.runInNewContext(ts.transpile("const " + callback + "; desktopTracking;"), context);
    assert.equal(result!.confirmed, false, "centered observations must not produce an incident");
  });
  assert.equal(result!.pose.calibrated, true, "steady frontal face should finish calibration after returning to the quiz");
});


test("desktop missing nose-tip landmarks are treated as unreliable rather than using a nostril", () => {
  const left = { x: 20, y: 20 }, right = { x: 120, y: 20 };
  assert.equal(desktopModule.measureDesktopLandmarkPose(left, right, []), null);
  assert.equal(desktopModule.measureDesktopLandmarkPose(left, right, [{ x: 90, y: 70 }]), null);
  const nose = Array.from({ length: 9 }, () => ({ x: 130, y: 90 }));
  nose[3] = { x: 70, y: 70 };
  assert.deepEqual(desktopModule.measureDesktopLandmarkPose(left, right, nose), { yawOffset: 0, pitchRatio: 0.5 });
  assert.equal(desktopModule.measureDesktopLandmarkPose(left, right, nose.slice(0, 8)), null);
});

function desktopFaceBuffers() {
  let draws=0;
  const inferenceCanvas={width:480,height:270};
  const desktopFaceCanvas={width:0,height:0};
  const desktopFaceContext={drawImage(){draws++;},getImageData(){return {data:new Uint8ClampedArray([16,64,128,255])};},putImageData(){}};
  return {inferenceCanvas,desktopFaceCanvas,desktopFaceContext,get brightnessDraws(){return draws;}};
}

async function runQuizFaceDetection(mobile: boolean, responses: Map<number, { detection: { score: number } }[]>, brightResponses?: Map<number, { detection: { score: number } }[]>) {
  const source = fs.readFileSync("src/app/quiz/[id]/page.tsx", "utf8");
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "detections"
      && node.getText(ast).includes("detectMobileFacesWithFallback")) declaration = node.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(declaration, "execute the actual quiz face detection callback");
  const calls: { inputSize: number; scoreThreshold: number; tinyLandmarks: boolean }[] = [];
  const { detectMobileFacesWithFallback } = await import("../src/lib/head-pose.ts");
  const buffers=desktopFaceBuffers();
  const framesUsed: {inputSize:number;processed:boolean}[]=[];
  const context = { ...desktopModule, ...buffers, detectMobileFacesWithFallback, isMobile: mobile,
    performanceProfile: { faceInputSize: mobile ? 128 : 160, useTinyLandmarks: mobile },
    faceapi: {
      TinyFaceDetectorOptions: class { options: { inputSize: number; scoreThreshold: number }; constructor(options: { inputSize: number; scoreThreshold: number }) { this.options = options; } },
      detectAllFaces(_canvas: unknown, detector: { options: { inputSize: number; scoreThreshold: number } }) {
        return { withFaceLandmarks(tinyLandmarks: boolean) {
          calls.push({ ...detector.options, tinyLandmarks });
          const processed=_canvas===buffers.desktopFaceCanvas;
          framesUsed.push({inputSize:detector.options.inputSize,processed});
          return Promise.resolve((processed&&brightResponses?brightResponses:responses).get(detector.options.inputSize) ?? []);
        } };
      },
    },
  };
  const detections = await vm.runInNewContext(ts.transpile("(async () => { const " + declaration + "; return detections; })()"), context);
  return { detections, calls, framesUsed, brightnessDraws:buffers.brightnessDraws };
}

test("actual desktop quiz recovers observed downward face loss at unchanged confidence", async () => {
  // Same-frame scores captured by the isolated desktop check, 2026-10-06.
  const scores = [[null,.86],[null,.57],[null,.53],[null,null],[.51,.85],[.58,.81],[null,.72],[null,.62]];
  let missing = 0;
  for (const [primary, detailed] of scores) {
    const face = (score: number | null) => score === null ? [] : [{ detection: { score } }];
    const result = await runQuizFaceDetection(false, new Map([[160,face(primary)],[320,face(detailed)]]));
    if (!result.detections.length) missing++;
    assert.deepEqual(result.calls.map(call => [call.inputSize,call.scoreThreshold,call.tinyLandmarks]),
      [[160,.5,false],[320,.5,false]]);
  }
  assert.equal(missing, 1, "only the frame absent at both resolutions should remain missing");
});

test("actual desktop quiz keeps a genuinely absent face absent after its retry", async () => {
  const result = await runQuizFaceDetection(false, new Map());
  assert.equal(result.detections.length, 0);
  assert.deepEqual(result.calls.map(call => call.inputSize), [160,320]);
});

test("actual desktop quiz preserves primary multiple-face detection without a retry", async () => {
  const faces = [{ detection: { score: .8 } }, { detection: { score: .7 } }];
  const result = await runQuizFaceDetection(false, new Map([[160,faces]]));
  assert.equal(result.detections.length, 2);
  assert.equal(result.calls.length, 1);
});

test("actual desktop quiz preserves multiple faces recovered by its retry", async () => {
  const faces = [{ detection: { score: .8 } }, { detection: { score: .7 } }];
  const result = await runQuizFaceDetection(false, new Map([[320,faces]]));
  assert.equal(result.detections.length, 2);
  assert.deepEqual(result.calls.map(call => call.inputSize), [160,320]);
});

test("actual desktop quiz retains the recorded second face when the primary scan sees one", async () => {
  // Same-frame desktop QA observations, 2026-10-06 08:56 UTC. The detailed
  // scan sees both people throughout; the primary scan misses one in five frames.
  const scores = [
    [[], [.852,.769]], [[.651], [.788,.755]], [[.606], [.773,.766]],
    [[.598], [.784,.745]], [[.692], [.830,.744]], [[.667], [.842,.736]],
    [[.638,.577], [.729,.712]], [[.664,.607], [.797,.789]],
  ];
  for (const [primary,detailed] of scores) {
    const faces = (values: number[]) => values.map(score=>({detection:{score}}));
    const result = await runQuizFaceDetection(false,new Map([[160,faces(primary)],[320,faces(detailed)]]));
    assert.equal(result.detections.length,2,"both visible faces must reach the quiz multiple-face branch");
    assert.deepEqual(result.calls.map(call=>[call.inputSize,call.scoreThreshold,call.tinyLandmarks]),
      primary.length>1 ? [[160,.5,false]] : [[160,.5,false],[320,.5,false]]);
  }
});

test("desktop verification retains a primary face if detailed detection misses it", async () => {
  const primary=[{detection:{score:.65}}];
  const result=await runQuizFaceDetection(false,new Map([[160,primary],[320,[]]]));
  assert.equal(result.detections,primary);
  assert.deepEqual(result.calls.map(call=>call.inputSize),[160,320]);
});

test("desktop single-face calibration and tracking prefer the available detailed landmarks", async () => {
  const primary=[{detection:{score:.65}}], detailed=[{detection:{score:.85}}];
  const result=await runQuizFaceDetection(false,new Map([[160,primary],[320,detailed]]));
  assert.equal(result.detections,detailed);
  assert.deepEqual(result.calls.map(call=>[call.inputSize,call.scoreThreshold,call.tinyLandmarks]),[[160,.5,false],[320,.5,false]]);
});

test("desktop already detailed inference does not run the same resolution twice", async () => {
  const calls:number[]=[];
  const faces=[{detection:{score:.8}}];
  const result=await desktopModule.detectDesktopFacesWithFallback(320,async size=>{calls.push(size);return faces;});
  assert.equal(result,faces);
  assert.deepEqual(calls,[320]);
});

test("actual quiz retains the existing mobile fallback and tiny landmarks", async () => {
  const result = await runQuizFaceDetection(true, new Map([[224,[{ detection: { score: .45 } }]]]));
  assert.equal(result.detections.length, 1);
  assert.deepEqual(result.calls.map(call => [call.inputSize,call.scoreThreshold,call.tinyLandmarks]), [[128,.5,true],[224,.4,true]]);
});

// Nose-tip trajectories captured from the local camera. The alternative nose
// point stays fixed in the replay so selecting it cannot masquerade as tracking
// the measured tip movement. The callback itself is extracted from the quiz.
function replayRecordedDesktopPitch(calibration: readonly (readonly [number,number])[], movement: readonly (readonly [number,number] | null)[]) {
  const source = fs.readFileSync("src/app/quiz/[id]/page.tsx", "utf8");
  const ast = ts.createSourceFile("page.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "desktopTracking") callback = node.getText(ast);
    ts.forEachChild(node,visit);
  };
  visit(ast);
  assert.ok(callback);
  const tracker = createDesktopHeadTracker();
  let time = 0;
  const results: ReturnType<typeof tracker.observe>[] = [];
  for (const measurement of [...calibration,...movement]) {
    if (!measurement) { results.push(tracker.observe(null,time)); time+=1000; continue; }
    const [yaw,pitch] = measurement;
    const nose = Array.from({ length: 9 }, () => ({ x:92,y:90 }));
    nose[3] = { x:70+yaw*100,y:20+pitch*100 };
    const result = vm.runInNewContext(ts.transpile("const " + callback + "; desktopTracking;"), {
      ...desktopModule,isMobile:false,desktopHeadTracker:tracker,
      leftEyeX:20,leftEyeY:20,rightEyeX:120,rightEyeY:20,
      nosePoints:nose,noseBottom:nose[8],performance:{now:()=>time},
      detections:[{detection:{score:.8}}],
    }) as ReturnType<typeof tracker.observe>;
    results.push(result);
    if(result.confirmed)tracker.acknowledge();
    time+=1000;
  }
  return results.slice(calibration.length);
}

test("actual desktop callback confirms both recorded sustained downward windows before face loss", () => {
  // 2026-10-06 06:51 calibration and 06:53 downward checks; yaw/pitch rounded
  // to six decimal places. These are measurements, not assumed head angles.
  const calibration = [[.068131,.520486],[.050451,.494245],[.030717,.551731],[.026421,.550864],
    [.038286,.510679],[.041065,.522848],[.045291,.522916],[.062341,.534995]] as const;
  const windows = [
    [[.020791,.543712],[.009097,.554572],[-.014153,.646983],[-.012846,.686383],
      [-.009016,.655549],[-.028630,.679861],[-.011480,.673382],null],
    [[.062281,.483499],[.014300,.536062],[-.025601,.699967],[-.022758,.680742],
      [-.011862,.658540],[-.008684,.664029],[-.002004,.663272],null],
  ] as const;
  for(const window of windows){
    const results = replayRecordedDesktopPitch(calibration,[...window,[.04,.523],[.04,.523]]);
    assert.equal(results.filter(result=>result.confirmed).length,1,"confirm one sustained down incident before the missed frame");
    assert.equal(results.find(result=>result.confirmed)!.pose.violationReason,"looking_down");
    assert.equal(results[0].confirmed,false,"neutral/first movement sample must not confirm");
    assert.equal(results[7].reliable,false,"an absent face remains unreliable, not head movement");
    assert.equal(results.at(-1)!.pose.direction,"Focused ✓");
  }
});

test("actual desktop callback keeps recorded small movements and transient face loss free of incidents", () => {
  const calibration = [[.047132,.506373],[.020808,.583778],[.035481,.575481],[.008077,.571114],
    [.010442,.580677],[-.004139,.601547],[.009991,.597464],[.000498,.574415]] as const;
  // 2026-10-06 06:21 small-movement check, including brief absence and one
  // isolated up-looking sample. Missing observations must break confirmation.
  const movement = [null,null,[.008326,.550152],[.035589,.590222],null,[.025624,.584359],null,[.017545,.259113],
    [-.010413,.577100],[-.007084,.572268],[.072904,.602592],null,[.032414,.537584],[.037354,.555872],
    [.020382,.586857],[-.012005,.578267]] as const;
  const results = replayRecordedDesktopPitch(calibration,movement);
  assert.equal(results.filter(result=>result.confirmed).length,0);
  assert.equal(results.at(-1)!.pose.direction,"Focused ✓");
});


test("desktop down sensitivity does not turn a brief nod into a confirmed incident", () => {
  const tracker=calibrated();
  const pitch=[.5,.5,.5,.66,.5,.5,.5];
  pitch.forEach((value,index)=>assert.equal(tracker.observe({yawOffset:.08,pitchRatio:value},4000+index*1000).confirmed,false));
});

test("desktop downward incident stays latched near the cutoff until a centered return", () => {
  const tracker=calibrated();
  assert.equal(frames(tracker,.08,.66,4000).at(-1)!.confirmed,true);
  tracker.acknowledge();
  frames(tracker,.08,.60,7000);
  assert.equal(frames(tracker,.08,.66,10000).at(-1)!.confirmed,false,"borderline recovery must not rearm the same down incident");
  frames(tracker,.08,.5,13000);
  assert.equal(frames(tracker,.08,.66,16000).at(-1)!.confirmed,true,"genuine center recovery rearms a new incident");
});

function desktopMonitoringFixture(tracker = calibrated()) {
  const source = fs.readFileSync("src/app/quiz/[id]/page.tsx", "utf8");
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = "";
  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === "faceDetectionInterval"
      && ts.isCallExpression(node.right)) callback = node.right.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(callback, "execute the real quiz monitoring interval");
  let now = 4000, pitch = .5, scans = 0;
  const gaze: string[] = [], reports: string[] = [];
  const context: any = {
    ...desktopModule, ...detectionModule, cancelled: false, document: { hidden: false, visibilityState: "visible" },
    detectionBusy: false, examActiveRef: { current: true }, violationCountRef: { current: 0 },
    submissionInFlightRef: { current: false }, isReportingRef: { current: false },
    isMobile: false, videoRef: { current: { paused: false, readyState: 2, videoWidth: 1280, videoHeight: 720 } },
    mediaStreamRef: { current: { active: true } }, drawInferenceFrame() {},
    ...desktopFaceBuffers(), tickCounter: 0, loadedCocoModel: null, trackingGeneration: 0,
    performanceProfile: { faceInputSize: 320, useTinyLandmarks: false }, performance: { now: () => now },
    desktopHeadTracker: tracker, noFaceFrames: 0,
    desktopNoFaceReporter: desktopModule.createDesktopIncidentReporter(),
    desktopMultipleFacesReporter: desktopModule.createDesktopIncidentReporter(),
    desktopDeviceReporter: desktopModule.createDesktopIncidentReporter(),
    multipleFacesFrames: 0, multipleFacesViolationRecorded: false, lookingAwayFrames: 0,
    phoneDetectedFrames: 0, phoneAbsentFrames: 0, phoneViolationRecorded: false,
    setDeviceStatus() {}, setPreWarning() {},
    mobileFaceRecoveryFrames: 0, mobileMissingSince: null, mobileLastFaceSeenAt: null,
    setFaceStatus() {}, setFaceTrackingWarning() {}, setHeadPos() {},
    setGazeStatus(value: string) { gaze.push(value); },
    reportViolationRef: { current: async (reason: string) => { reports.push(reason); return true; } },
    console: { warn(error: unknown) { throw error; } },
    faceapi: {
      TinyFaceDetectorOptions: class {},
      detectAllFaces() {
        scans++;
        return { withFaceLandmarks: async () => [{ detection: { score: .85 }, landmarks: {
          getLeftEye: () => [{ x: 20, y: 20 }], getRightEye: () => [{ x: 120, y: 20 }],
          getNose: () => Array.from({ length: 9 }, () => ({ x: 78, y: 20 + pitch * 100 })),
        } }] };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpile("globalThis.qaTick = " + callback + ";"), context);
  return { context, gaze, reports, get scans() { return scans; },
    tick(time: number, nextPitch = .5) { now = time; pitch = nextPitch; return context.qaTick() as Promise<void>; } };
}

test("actual desktop scan updates centered gaze while an audio report is pending", async () => {
  const f = desktopMonitoringFixture();
  f.context.isReportingRef.current = true;
  await f.tick(4000);
  assert.equal(f.scans, 1, "reporting must not freeze desktop face tracking");
  assert.equal(f.gaze.at(-1), "Focused ✓");
  assert.equal(f.reports.length, 0);
});

test("actual desktop head report does not hold the scan busy or repeat the pending incident", async () => {
  const f = desktopMonitoringFixture();
  let finish!: (value: boolean) => void;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  f.context.reportViolationRef.current = (reason: string) => {
    f.reports.push(reason); f.context.isReportingRef.current = true; return pending;
  };
  await f.tick(4000, .66);
  await f.tick(5000, .66);
  let completed = false;
  const confirmation = f.tick(6000, .66).then(() => { completed = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(completed, true, "the interval must complete before the network/evidence request");
    assert.equal(f.context.detectionBusy, false);
    for (const time of [7000,8000,9000]) await f.tick(time, .66);
    assert.deepEqual(f.reports, ["looking_down"], "one sustained pose must not queue duplicate reports");
    for (const time of [10000,11000,12000]) await f.tick(time);
    assert.equal(f.gaze.at(-1), "Focused ✓", "center recovery must be visible during upload");
    finish(true);
    await pending;
    f.context.isReportingRef.current = false;
    for (const time of [13000,14000,15000,16000]) await f.tick(time, .66);
    assert.equal(f.reports.length, 2, "a new sustained turn after centered recovery remains actionable");
  } finally {
    finish(true);
    await confirmation;
  }
});

test("mobile retains its reporting suspension during the desktop freeze correction", async () => {
  const f = desktopMonitoringFixture();
  f.context.isMobile = true; f.context.isReportingRef.current = true;
  await f.tick(4000);
  assert.equal(f.scans, 0);
});

test("failed desktop head reports can retry without latching an unrecorded strike", async () => {
  for (const failure of ["rejected", "timeout"]) {
    const tracker = calibrated();
    assert.equal(frames(tracker,.08,.66,4000).at(-1)!.confirmed,true);
    if (failure === "timeout") {
      await assert.rejects(tracker.reportIncident(async () => { throw new Error("request timed out"); }), /timed out/);
    } else {
      assert.equal(await tracker.reportIncident(async () => false), false);
    }
    assert.equal(tracker.observe({yawOffset:.08,pitchRatio:.66},7000).confirmed,true);
    assert.equal(await tracker.reportIncident(async () => true),true);
    assert.equal(tracker.observe({yawOffset:.08,pitchRatio:.66},8000).confirmed,false);
  }
});


test("actual desktop detector confirms recorded down tilt across primary face loss without changing thresholds", async () => {
  // 2026-10-06 13:45 calibration, 13:47 centered control and 13:49 down
  // miss. Each row is primary yaw/pitch/score, detailed yaw/pitch/score.
  // The primary detector misses the tilted face; primary160/detailed320 landmarks
  // must not share a baseline calibrated from a different resolution.
  const recording: readonly (readonly [number | null, number | null, number | null, number, number, number])[] = [
    [0.008049, 0.62664, 0.697, -0.007928, 0.585112, 0.926],
    [-0.017199, 0.594019, 0.8, 0.003777, 0.574854, 0.97],
    [-0.021061, 0.592246, 0.804, -0.010343, 0.572345, 0.978],
    [-0.030862, 0.593405, 0.792, -0.006505, 0.58114, 0.959],
    [-0.022846, 0.559809, 0.768, -0.009188, 0.569867, 0.966],
    [-0.01455, 0.53123, 0.752, -0.023096, 0.549168, 0.941],
    [-0.016505, 0.575401, 0.734, -0.022492, 0.558255, 0.903],
    [-0.010644, 0.548417, 0.768, -0.029998, 0.537243, 0.881],
    [-0.00869, 0.537155, 0.752, -0.020554, 0.54384, 0.893],
    [null, null, null, 0.008356, 0.595425, 0.753],
    [null, null, null, 0.018013, 0.551534, 0.781],
    [0.038079, 0.486331, 0.583, 0.004224, 0.504847, 0.757],
    [0.022153, 0.500145, 0.582, 0.002525, 0.508653, 0.811],
    [0.032896, 0.491312, 0.613, 0.0033, 0.529359, 0.71],
    [0.050844, 0.534687, 0.618, -0.006114, 0.554228, 0.851],
    [0.044164, 0.504359, 0.625, -0.01463, 0.500397, 0.811],
    [0.038164, 0.534132, 0.594, -0.010653, 0.530583, 0.806],
    [0.00659, 0.580079, 0.732, 0.006344, 0.565353, 0.835],
    [0.022111, 0.572511, 0.731, 0.015313, 0.554297, 0.812],
    [0.029295, 0.630792, 0.557, -0.002931, 0.652166, 0.756],
    [null, null, null, -0.004647, 0.70578, 0.851],
    [null, null, null, -0.028234, 0.74806, 0.781],
    [null, null, null, -0.012661, 0.716422, 0.77],
    [null, null, null, -0.011334, 0.711699, 0.814],
    [null, null, null, -0.009468, 0.704006, 0.782],
  ] as const;
  const selected: [number, number][] = [];
  for (const [primaryYaw,primaryPitch,primaryScore,detailedYaw,detailedPitch,detailedScore] of recording) {
    const primary = primaryYaw === null ? [] : [{ detection: { score: primaryScore! }, qaPose: { yawOffset: primaryYaw, pitchRatio: primaryPitch! } }];
    const detailed = [{ detection: { score: detailedScore }, qaPose: { yawOffset: detailedYaw, pitchRatio: detailedPitch } }];
    const result = await runQuizFaceDetection(false,new Map([[160,primary],[320,detailed]]));
    assert.equal(result.detections.length,1);
    const face = result.detections[0];
    selected.push([face.qaPose.yawOffset,face.qaPose.pitchRatio]);
  }
  const results = replayRecordedDesktopPitch(selected.slice(0,9),[...selected.slice(9),[0,.574],[0,.574],[0,.574]]);
  assert.equal(results.slice(0,8).filter(result=>result.confirmed).length,0,"recorded centered control must remain free of incidents");
  assert.equal(results.filter(result=>result.confirmed).length,1,"confirm the sustained recorded down tilt even when primary detection disappears");
  assert.equal(results.find(result=>result.confirmed)!.pose.violationReason,"looking_down");
  assert.equal(results.at(-1)!.pose.direction,"Focused ✓","returning centered must recover without an up strike");
});


test("desktop brightness frame preserves raw pixels, geometry and alpha", () => {
  const prepare=(desktopModule as unknown as {prepareDesktopFaceFrame:(source:unknown,target:unknown,context:unknown)=>unknown}).prepareDesktopFaceFrame;
  assert.equal(typeof prepare,"function");
  const raw={width:480,height:270},target={width:0,height:0};const original=new Uint8ClampedArray([0,64,128,17,255,16,32,255]);let output:Uint8ClampedArray|undefined;
  const calls:unknown[][]=[];
  const context={drawImage(...args:unknown[]){calls.push(args);},getImageData(x:number,y:number,width:number,height:number){assert.deepEqual([x,y,width,height],[0,0,480,270]);return {data:original.slice()};},putImageData(image:{data:Uint8ClampedArray},x:number,y:number){assert.deepEqual([x,y],[0,0]);output=image.data;}};
  assert.equal(prepare(raw,target,context),target);
  assert.deepEqual(target,{width:480,height:270});assert.deepEqual(calls,[[raw,0,0]]);
  assert.deepEqual([...original],[0,64,128,17,255,16,32,255],"never brighten the shared raw frame");
  assert.deepEqual([...output!],[0,97,157,17,255,37,60,255],"fixed gamma0.7 raises dark pixels while keeping black, white and alpha");
});

test("actual desktop quiz brightens detailed faces while primary and mobile retain raw input", async () => {
  const primary=[{detection:{score:.7}}],bright=[{detection:{score:.8}}];
  const result=await runQuizFaceDetection(false,new Map([[160,primary]]),new Map([[320,bright]]));
  assert.equal(result.detections[0],bright[0]);assert.deepEqual(result.framesUsed,[{inputSize:160,processed:false},{inputSize:320,processed:true}]);assert.equal(result.brightnessDraws,1);
  const multiple=await runQuizFaceDetection(false,new Map([[160,[...primary,...primary]]]));
  assert.equal(multiple.detections.length,2);assert.equal(multiple.brightnessDraws,0,"primary multiple faces must keep their fast path");
  const mobile=await runQuizFaceDetection(true,new Map([[224,[{detection:{score:.45}}]]]));
  assert.equal(mobile.brightnessDraws,0);assert.ok(mobile.framesUsed.every(frame=>!frame.processed));
  assert.deepEqual(mobile.calls.map(call=>[call.inputSize,call.scoreThreshold,call.tinyLandmarks]),[[128,.5,true],[224,.4,true]]);
});

test("actual desktop quiz retains recorded dim turns with brightness and preserves negative controls", async () => {
  // Same-frame QA: 2026-10-06 15:04–15:15 UTC. Eight calibration samples,
  // Left, small centered movement, genuine absence, two Down runs, Right, Up.
  // Each row: primary score, raw yaw/pitch/score, bright yaw/pitch/score, gap.
  // Numeric metadata only; no images or personal identifiers.
  const recording: readonly (readonly [number|null,number|null,number|null,number|null,number|null,number|null,number|null,number])[] = [
    [0.619,0.022733,0.527228,0.729559,0.021882,0.512707,0.64952,10000],
    [0.735,0.038535,0.545001,0.774408,0.028984,0.558632,0.702275,1356],
    [0.732,0.051329,0.545396,0.7836,0.038445,0.548704,0.7235,1004],
    [0.681,0.029173,0.542053,0.812347,0.030598,0.542066,0.72024,974],
    [0.702,0.041823,0.55245,0.717036,0.01401,0.566889,0.731796,1006],
    [0.686,0.038717,0.561049,0.800494,0.036526,0.561637,0.777706,956],
    [0.685,0.027389,0.569661,0.829477,0.032811,0.587334,0.778806,1013],
    [0.642,0.018184,0.586069,0.826565,0.029429,0.611182,0.812954,1051],
    [null,0.035903,0.531748,0.733156,0.032767,0.526825,0.654693,10000],
    [0.519,0.028584,0.5372,0.766881,0.031199,0.532221,0.812131,1018],
    [null,null,null,null,null,null,null,928],
    [null,null,null,null,0.520748,0.78928,0.55082,1018],
    [null,0.430794,0.800541,0.734765,0.491092,0.761935,0.764044,1003],
    [null,0.431005,0.768599,0.751524,0.470669,0.755562,0.753927,986],
    [null,0.423486,0.804469,0.632812,0.47963,0.79254,0.743102,1018],
    [null,null,null,null,0.415217,0.740824,0.609131,978],
    [null,-0.007925,0.510368,0.902201,-0.002569,0.493025,0.862391,10000],
    [0.624,-0.005568,0.5615,0.837433,0.018207,0.56182,0.850234,970],
    [0.679,0.006952,0.582111,0.819139,0.028864,0.5882,0.81005,1004],
    [0.622,0.009556,0.575341,0.85398,0.024052,0.564183,0.859865,1000],
    [0.603,0.007742,0.583348,0.854352,0.013554,0.582742,0.882259,997],
    [0.602,-0.001332,0.575856,0.839545,0.014149,0.563356,0.876484,997],
    [0.622,0.001919,0.561537,0.842238,0.01555,0.559077,0.859079,1055],
    [0.62,-0.01106,0.569156,0.878107,0.008799,0.569021,0.889202,950],
    [null,null,null,null,null,null,null,10000],
    [null,null,null,null,null,null,null,899],
    [null,null,null,null,null,null,null,1105],
    [null,null,null,null,null,null,null,971],
    [null,null,null,null,null,null,null,992],
    [null,null,null,null,null,null,null,1007],
    [null,null,null,null,null,null,null,983],
    [null,null,null,null,null,null,null,951],
    [0.773,0.054866,0.582964,0.768173,0.049918,0.575618,0.763301,10000],
    [0.778,0.038615,0.566819,0.702611,0.034012,0.572192,0.701256,978],
    [0.767,0.043371,0.554342,0.705673,0.023801,0.584492,0.676497,942],
    [null,null,null,null,null,null,null,879],
    [null,null,null,null,null,null,null,1031],
    [null,0.005849,0.65044,0.710529,0.033703,0.629651,0.697123,1058],
    [null,0.015887,0.670395,0.730244,0.029541,0.672898,0.74148,1001],
    [null,0.024361,0.686865,0.830849,0.018212,0.627812,0.763349,966],
    [null,-0.014765,0.46561,0.724064,-0.005393,0.46418,0.768825,10000],
    [0.642,0.000213,0.501774,0.871054,-0.000315,0.493774,0.810542,983],
    [0.617,-0.021025,0.505036,0.884464,-0.025298,0.496256,0.860748,1028],
    [null,null,null,null,null,null,null,932],
    [null,-0.011699,0.658348,0.837955,-0.008313,0.674169,0.834465,1023],
    [null,0.005464,0.696633,0.820388,0.00474,0.684552,0.848594,981],
    [null,0.006957,0.724536,0.803241,0.017798,0.713982,0.720372,1037],
    [null,0.014744,0.699941,0.67032,0.019339,0.663556,0.527731,966],
    [0.742,-0.00185,0.514654,0.787826,0.006923,0.510211,0.796467,10000],
    [0.741,-0.0112,0.499425,0.725312,0.011229,0.49417,0.801034,944],
    [0.781,0.012622,0.539496,0.723867,0.004522,0.514809,0.789542,1051],
    [null,-0.31077,0.663795,0.663666,-0.37684,0.63539,0.679737,967],
    [null,null,null,null,-0.784183,0.916352,0.58796,938],
    [0.61,-0.741322,0.700096,0.528278,-0.726813,0.851127,0.631697,1072],
    [null,-0.666147,0.926383,0.607011,-0.709056,0.796066,0.582843,949],
    [0.612,-0.729311,0.784448,0.59755,-0.763372,0.774055,0.73429,1029],
    [null,0.00049,0.510585,0.829729,-0.006231,0.498113,0.813324,10000],
    [0.748,-0.004979,0.52354,0.858521,-0.001311,0.516589,0.846531,999],
    [0.795,-0.020694,0.514953,0.743486,-0.009395,0.512032,0.824886,1029],
    [null,-0.041052,0.323888,0.809066,-0.040345,0.313748,0.739303,977],
    [null,-0.019997,0.219337,0.777775,-0.018159,0.210162,0.748165,974],
    [null,-0.01652,0.257645,0.751388,-0.025404,0.237835,0.753312,1046],
    [null,-0.025099,0.226486,0.772968,-0.021273,0.217704,0.785164,970],
    [null,-0.024262,0.242655,0.742936,-0.015424,0.229703,0.719598,989],
  ];
  const tracker=createDesktopHeadTracker();let now=0;const results:{faceCount:number;direction:string;confirmed:boolean;reason:string}[]=[];
  for(const [primaryScore,rawYaw,rawPitch,rawScore,brightYaw,brightPitch,brightScore,gap] of recording){
    const face=(yaw:number|null,pitch:number|null,score:number|null)=>yaw===null?[]:[{detection:{score:score!},qaPose:{yawOffset:yaw,pitchRatio:pitch!}}];
    const primary=primaryScore===null?[]:face(rawYaw,rawPitch,primaryScore);
    const raw=face(rawYaw,rawPitch,rawScore),bright=face(brightYaw,brightPitch,brightScore);
    const selected=await runQuizFaceDetection(false,new Map([[160,primary],[320,raw]]),new Map([[320,bright]]));
    now+=gap;const detected=selected.detections[0];const tracked=tracker.observe(detected?.qaPose??null,now,detected?.detection.score??1);
    if(tracked.confirmed)tracker.acknowledge();
    results.push({faceCount:selected.detections.length,direction:tracked.pose.direction,confirmed:tracked.confirmed,reason:tracked.pose.violationReason});
    assert.ok(selected.calls.every(call=>call.scoreThreshold===.5&&!call.tinyLandmarks));
  }
  const left=results.slice(8,16),small=results.slice(16,24),absence=results.slice(24,32),down=results.slice(32,48),right=results.slice(48,56),up=results.slice(56,64);
  assert.equal(left.filter(result=>result.faceCount===1).length,7,"retain the two dim Left frames missing from raw inference");
  assert.equal(right.filter(result=>result.faceCount===1).length,8,"retain the dim Right transition missing from raw inference");
  for(const [run,reason] of [[left,"looking_left"],[down,"looking_down"],[right,"looking_right"],[up,"looking_up"]] as const){assert.deepEqual(run.filter(result=>result.confirmed).map(result=>result.reason),[reason]);}
  assert.ok(small.every(result=>result.faceCount===1&&result.direction==="Focused ✓"&&!result.confirmed));
  assert.ok(absence.every(result=>result.faceCount===0&&!result.confirmed));
  assert.ok(results.slice(0,8).every(result=>!result.confirmed));
});

function simulateMissingFace(f: ReturnType<typeof desktopMonitoringFixture>) {
  const detect = f.context.faceapi.detectAllFaces;
  f.context.faceapi.detectAllFaces = () => ({ withFaceLandmarks: async () => [] });
  return () => { f.context.faceapi.detectAllFaces = detect; };
}

test("actual desktop No Face report leaves scans free and shows center recovery during upload", async () => {
  const f = desktopMonitoringFixture(), recover = simulateMissingFace(f);
  let finish!: (recorded: boolean) => void;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  f.context.reportViolationRef.current = (reason: string) => { f.reports.push(reason); return pending; };
  for (const time of [4000,5000,6000,7000]) await f.tick(time);
  assert.equal(f.reports.length, 0, "keep the five-frame missing-face threshold");
  let completed = false;
  const confirmation = f.tick(8000).then(() => { completed = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(completed, true, "No Face upload must not block the scan callback");
    assert.equal(f.context.detectionBusy, false);
    assert.equal(f.gaze.at(-1), "Face not detected");
    for (const time of [9000,10000,11000]) await f.tick(time);
    assert.deepEqual(f.reports, ["no_face"], "a pending sustained absence must not queue duplicate strikes");
    recover(); await f.tick(12000);
    assert.equal(f.gaze.at(-1), "Focused ✓", "center updates before the pending upload finishes");
  } finally { finish(true); await confirmation; await pending; }
});

test("actual desktop No Face completion cannot latch a new absence after face recovery", async () => {
  for (const recorded of [true,false]) {
    const f = desktopMonitoringFixture(), recover = simulateMissingFace(f);
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>(resolve => { finish = resolve; });
    f.context.reportViolationRef.current = (reason: string) => { f.reports.push(reason); return f.reports.length === 1 ? pending : Promise.resolve(true); };
    for (const time of [4000,5000,6000,7000]) await f.tick(time);
    const confirmation = f.tick(8000);
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      recover(); await f.tick(9000);
      simulateMissingFace(f);
      for (const time of [10000,11000,12000,13000,14000]) await f.tick(time);
      assert.equal(f.reports.length, 1, "wait for the old upload before reporting another absence");
      finish(recorded); await pending; await new Promise<void>(resolve => setImmediate(resolve));
      await f.tick(15000);
      assert.deepEqual(f.reports, ["no_face","no_face"], "the old result cannot suppress the new episode");
      await f.tick(16000);
      assert.equal(f.reports.length, 2, "successful new episode stays latched");
    } finally { finish(recorded); await confirmation; }
  }
});

test("actual desktop No Face retries an unrecorded report while absence continues", async () => {
  const f = desktopMonitoringFixture(); simulateMissingFace(f);
  f.context.reportViolationRef.current = async (reason: string) => { f.reports.push(reason); return f.reports.length > 1; };
  for (const time of [4000,5000,6000,7000,8000,9000,10000,11000]) {
    await f.tick(time); await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.deepEqual(f.reports, ["no_face","no_face"], "failed persistence retries, success stays latched");
});


test("actual desktop rejected No Face upload releases its latch for retry", async () => {
  const f = desktopMonitoringFixture(); simulateMissingFace(f);
  const warnings: unknown[][] = [];
  f.context.console.warn = (...args: unknown[]) => { warnings.push(args); };
  f.context.reportViolationRef.current = (reason: string) => {
    f.reports.push(reason);
    return f.reports.length === 1 ? Promise.reject(new Error("upload failed")) : Promise.resolve(true);
  };
  for (const time of [4000,5000,6000,7000,8000,9000,10000]) {
    await f.tick(time); await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.deepEqual(f.reports, ["no_face","no_face"]);
  assert.equal(f.context.detectionBusy, false);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][1]), /upload failed/);
});

test("actual mobile No Face confirmation and reporting retain their existing awaited behavior", async () => {
  const f = desktopMonitoringFixture(); simulateMissingFace(f);
  Object.assign(f.context, {
    detectMobileFacesWithFallback: (await import("../src/lib/head-pose.ts")).detectMobileFacesWithFallback,
    isMobile: true, mobileVideoRef: f.context.videoRef, mobileHeadPoseBaseline: null,
    mobileHeadPoseSamples: [], mobileNoFaceRecoveryFrames: 0,
    mobileNoFaceIncidentRecordedRef: { current: false }, loadedCocoModel: {},
    isTransientMobileFaceLoss: () => false,
    confirmMobileFaceMissing: async () => true,
  });
  let finish!: (value: boolean) => void;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  f.context.reportViolationRef.current = (reason: string) => { f.reports.push(reason); return pending; };
  for (const time of [4000,5000,6000]) { f.context.tickCounter = 1; await f.tick(time); }
  assert.equal(f.reports.length, 0);
  f.context.tickCounter = 1;
  let completed = false;
  const confirmation = f.tick(7000).then(() => { completed = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(f.reports, ["no_face"]);
    assert.equal(completed, false, "desktop fix must preserve mobile's awaited reporting");
    assert.equal(f.context.detectionBusy, true);
  } finally { finish(true); await confirmation; }
  assert.equal(f.context.mobileNoFaceIncidentRecordedRef.current, true);
  assert.equal(f.context.detectionBusy, false);
});


function desktopUploadFixture(reason: "multiple_faces" | "device_detected") {
  const f = desktopMonitoringFixture();
  const detect = f.context.faceapi.detectAllFaces;
  let present = true;
  if (reason === "multiple_faces") {
    f.context.faceapi.detectAllFaces = () => ({ withFaceLandmarks: async () => present
      ? [{ detection: { score: .85 } }, { detection: { score: .8 } }]
      : await detect().withFaceLandmarks() });
  } else {
    f.context.loadedCocoModel = { detect: async () => present ? [{ class: "cell phone", score: .85 }] : [] };
  }
  return { ...f, present(value: boolean) { present = value; },
    incidentTick(time: number) { f.context.tickCounter = reason === "device_detected" ? 0 : 1; return f.tick(time); },
    centeredTick(time: number) { f.context.tickCounter = 1; return f.tick(time); } };
}

for (const reason of ["multiple_faces", "device_detected"] as const) {
  test("actual desktop " + reason + " report leaves fresh face scans running during upload", async () => {
    const f = desktopUploadFixture(reason);
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>(resolve => { finish = resolve; });
    f.context.reportViolationRef.current = (type: string) => { f.reports.push(type); return pending; };
    const threshold = reason === "multiple_faces" ? 4 : 2;
    for (let index = 0; index < threshold - 1; index++) await f.incidentTick(4000 + index * 1000);
    assert.equal(f.reports.length, 0, "keep the existing confirmation threshold");
    let completed = false;
    const confirmation = f.incidentTick(4000 + (threshold - 1) * 1000).then(() => { completed = true; });
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(completed, true, "upload must not hold detectionBusy");
      assert.equal(f.context.detectionBusy, false);
      for (const time of [9000,10000,11000]) await f.incidentTick(time);
      assert.deepEqual(f.reports, [reason], "do not queue the same incident during upload");
      f.present(false); await f.centeredTick(12000);
      assert.equal(f.gaze.at(-1), "Focused ✓", "fresh centered face must be visible during upload");
    } finally { finish(true); await confirmation; }
  });
}


test("actual quiz replays recorded Right, isolated missing transition and centered recovery during pending upload", async () => {
  // Real numerical observations, 2026-10-06 17:33 UTC. No images or identity data.
  // Phase, elapsed ms, primary count, selected count/score/yaw/pitch.
  const recording = [
    ["baseline",4000,1,1,0.881,0.024705630096852362,0.5211488794615248],
    ["baseline",5377,1,1,0.875,0.00711982339779529,0.5181265720775831],
    ["baseline",6758,1,1,0.857,0.01716681762450977,0.5144632718868295],
    ["baseline",8116,1,1,0.861,0.019489919033946656,0.5213137179081354],
    ["baseline",9448,1,1,0.883,0.021579187089727878,0.5132922083768903],
    ["baseline",10773,1,1,0.856,0.02802574714525087,0.5071738881434629],
    ["baseline",12154,1,1,0.866,0.028145224638093096,0.5143083519980184],
    ["baseline",13505,1,1,0.842,0.03459637650073923,0.5251906958498628],
    ["right",18923,1,1,0.873,0.0057473647416262565,0.5436633747423932],
    ["right",20183,0,0,null,null,null],
    ["right",21499,0,1,0.633,-0.6095007292591718,0.7434896539240867],
    ["right",22835,1,1,0.776,-0.4096895122177198,0.6243941249040736],
    ["right",24161,1,1,0.739,-0.48834783268077053,0.6735775313542026],
    ["right",25494,1,1,0.727,-0.47296401877830696,0.6591162666216251],
    ["right",26878,1,1,0.794,-0.4748140625894806,0.6779144972171239],
    ["right",28235,1,1,0.687,-0.47489440840340963,0.6754926041354504],
    ["right",29615,1,1,0.729,-0.5451288392029615,0.695936458686394],
    ["right",30978,0,1,0.699,-0.45432830077321773,0.655368313454331],
    ["right",32328,1,1,0.768,-0.4666434894344456,0.6805851960320258],
    ["right",33668,1,1,0.753,-0.4874002059924546,0.6780403971233424],
    ["recovery",39064,1,1,0.859,0.035698404226441265,0.4861948860860025],
    ["recovery",40455,1,1,0.86,0.0230019185708869,0.4888306799058125],
    ["recovery",41813,1,1,0.875,0.023656269394797872,0.5042276630182674],
    ["recovery",43147,1,1,0.86,0.022797060752422826,0.5003962056283169],
    ["recovery",44502,1,1,0.863,0.03448870148869005,0.4882146661886146],
    ["recovery",45854,1,1,0.857,0.02533902978897998,0.48637399708901385],
    ["recovery",47258,1,1,0.856,0.012711743337745492,0.49639006526130497],
    ["recovery",48614,1,1,0.86,0.030209484387232272,0.48169134216110726],
  ] as const;
  const f = desktopMonitoringFixture(createDesktopHeadTracker());
  let sample: typeof recording[number] = recording[0];
  f.context.performanceProfile.faceInputSize = 160;
  f.context.faceapi.TinyFaceDetectorOptions = class { options: { inputSize: number }; constructor(options: { inputSize: number }) { this.options = options; } };
  f.context.faceapi.detectAllFaces = (_canvas: unknown, options: { options: { inputSize: number } }) => ({ withFaceLandmarks: async () => {
    const [, ,primary, count, score, yaw, pitch] = sample;
    if (options.options.inputSize === 160) return Array.from({ length: primary }, () => ({
      detection: { score: .5 }, get landmarks() { throw Error("recorded primary landmarks were not captured and must not be used"); },
    }));
    if (!count) return [];
    return [{ detection: { score }, landmarks: {
      getLeftEye: () => [{ x: 20, y: 20 }], getRightEye: () => [{ x: 120, y: 20 }],
      getNose: () => Array.from({ length: 9 }, () => ({ x: 70 + yaw! * 100, y: 20 + pitch! * 100 })),
    } }];
  } });
  let finish!: (value: boolean) => void;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  f.context.reportViolationRef.current = (reason: string) => { f.reports.push(reason); return pending; };
  try {
    for (const row of recording) {
      sample = row; await f.tick(row[1]);
      assert.equal(f.context.detectionBusy, false);
      if (row[0] === "baseline") assert.equal(f.reports.length, 0);
      if (row[0] === "recovery") assert.equal(f.gaze.at(-1), "Focused ✓", "all eight centered frames recover before upload completes");
    }
    assert.deepEqual(f.reports, ["looking_right"], "one real sustained Right, no No Face or false Up/Down strikes");
    assert.equal(f.context.noFaceFrames, 0);
  } finally { finish(true); await pending; }
});

for (const reason of ["multiple_faces", "device_detected"] as const) {
  test("actual desktop " + reason + " late upload does not suppress a new incident after recovery", async () => {
    const f = desktopUploadFixture(reason);
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>(resolve => { finish = resolve; });
    f.context.reportViolationRef.current = (type: string) => { f.reports.push(type); return f.reports.length === 1 ? pending : Promise.resolve(true); };
    const threshold = reason === "multiple_faces" ? 4 : 2;
    try {
      for (let index = 0; index < threshold; index++) await f.incidentTick(4000 + index * 1000);
      f.present(false);
      for (const time of [8000,9000,10000]) await f.incidentTick(time);
      f.present(true);
      for (let index = 0; index < threshold; index++) await f.incidentTick(11000 + index * 1000);
      assert.equal(f.reports.length, 1);
      finish(true); await pending; await new Promise<void>(resolve => setImmediate(resolve));
      await f.incidentTick(16000); await new Promise<void>(resolve => setImmediate(resolve));
      await f.incidentTick(17000);
      assert.deepEqual(f.reports, [reason,reason], "late successful upload must not latch the next episode");
    } finally { finish(true); await pending; }
  });

  test("actual desktop " + reason + " unrecorded persistence retries without duplicate successful strikes", async () => {
    const f = desktopUploadFixture(reason);
    f.context.reportViolationRef.current = async (type: string) => { f.reports.push(type); return f.reports.length > 1; };
    for (let index = 0; index < 8; index++) {
      await f.incidentTick(4000 + index * 1000); await new Promise<void>(resolve => setImmediate(resolve));
    }
    assert.deepEqual(f.reports, [reason,reason]);
    assert.equal(f.context.detectionBusy, false);
  });

  test("actual mobile " + reason + " retains awaited reporting", async () => {
    const f = desktopUploadFixture(reason);
    Object.assign(f.context, {
      isMobile: true, mobileVideoRef: f.context.videoRef, mobileHeadPoseBaseline: null, mobileHeadPoseSamples: [],
      mobileNoFaceIncidentRecordedRef: { current: false }, mobileNoFaceRecoveryFrames: 0,
      detectMobileFacesWithFallback: (await import("../src/lib/head-pose.ts")).detectMobileFacesWithFallback,
    });
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>(resolve => { finish = resolve; });
    f.context.reportViolationRef.current = (type: string) => { f.reports.push(type); return pending; };
    const threshold = reason === "multiple_faces" ? 3 : 2;
    for (let index = 0; index < threshold - 1; index++) await f.incidentTick(4000 + index * 1000);
    let completed = false;
    const confirmation = f.incidentTick(4000 + (threshold - 1) * 1000).then(() => { completed = true; });
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(f.reports, [reason]);
      assert.equal(completed, false);
      assert.equal(f.context.detectionBusy, true);
    } finally { finish(true); await confirmation; }
    assert.equal(f.context.detectionBusy, false);
  });
}


test("actual callback rejects Down for recorded moderate Left 2026-10-06T18:37:50.113Z", () => {
  // Numeric webcam observations only; no image or identifying data.
  const calibration = [[0.082124,0.550828],[0.030691,0.554206],[0.010622,0.549901],[0.026513,0.526357],[0.023593,0.53665],[0.030537,0.484461],[0.029842,0.494335],[0.018654,0.488263]] as const;
  const movement = [[0.353083,0.672551],[0.354402,0.769529],null,null,[0.415871,0.688964],[0.326745,0.721821],[0.370983,0.704312],[0.345489,0.615425],null,null,null,null] as const;
  const recovery = [[0.041663,0.543222],[0.033602,0.554452],[0.036236,0.540103],[0.030787,0.542525],[0.042501,0.530372],[0.042072,0.555365],[0.03238,0.529739],[0.035441,0.559787]] as const;
  const results = replayRecordedDesktopPitch(calibration, [...movement, ...recovery]);
  assert.deepEqual(results.filter(result => result.confirmed).map(result => result.pose.violationReason), ["looking_left"], "one actual Left, no false Down/Up/Right");
  assert.ok(results.slice(movement.length).every(result => result.pose.direction === "Focused ✓" && !result.confirmed), "center recovery stays neutral");
  for (let index = 0; index < movement.length; index++) if (!movement[index]) assert.equal(results[index].reliable, false, "missing faces stay missing, not inferred turns");
});

test("actual callback rejects Down for recorded moderate Left 2026-10-06T18:41:40.903Z", () => {
  // Numeric webcam observations only; no image or identifying data.
  const calibration = [[-0.013159,0.50422],[-0.004815,0.49143],[-0.014223,0.482956],[-0.024225,0.495258],[-0.009285,0.482461],[-0.014794,0.491389],[-0.004515,0.50732],[-0.023007,0.502678]] as const;
  const movement = [[0.314991,0.661656],[0.322829,0.633894],[0.348656,0.704192],null,[0.47518,0.780926],null,null,null,null,null,null,null] as const;
  const recovery = [[0.056964,0.531424],[0.059735,0.556757],[0.060929,0.558571],[0.046726,0.538604],[0.025387,0.518106],[0.061364,0.507147],[0.060075,0.508317],[0.056711,0.502771]] as const;
  const results = replayRecordedDesktopPitch(calibration, [...movement, ...recovery]);
  assert.deepEqual(results.filter(result => result.confirmed).map(result => result.pose.violationReason), ["looking_left"], "one actual Left, no false Down/Up/Right");
  assert.ok(results.slice(movement.length).every(result => result.pose.direction === "Focused ✓" && !result.confirmed), "center recovery stays neutral");
  for (let index = 0; index < movement.length; index++) if (!movement[index]) assert.equal(results[index].reliable, false, "missing faces stay missing, not inferred turns");
});

test("Left correction preserves the verified Right cutoff and centered negative control", () => {
  const right = calibrated();
  assert.ok(frames(right, -0.23).every(result => result.pose.direction === "Focused ✓" && !result.confirmed), "Right yaw below the existing cutoff must remain neutral");
  assert.equal(frames(right, -0.32, .5, 7000).at(-1)!.pose.violationReason, "looking_right");
  assert.equal(frames(right, -0.32, .5, 10000).at(-1)!.confirmed, true);
  const neutral = calibrated();
  assert.ok(frames(neutral, .28).every(result => result.pose.direction === "Focused ✓" && !result.confirmed), "centered recovery boundary is not a Left incident");
});
