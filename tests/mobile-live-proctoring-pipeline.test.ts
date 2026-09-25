import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const quizPagePath = path.resolve(process.cwd(), "src/app/quiz/[id]/page.tsx");
const quizPageSrc = fs.readFileSync(quizPagePath, "utf-8");

const violationRoutePath = path.resolve(process.cwd(), "src/app/api/live/violation/route.ts");
const violationRouteSrc = fs.readFileSync(violationRoutePath, "utf-8");

const teacherMonitorPath = path.resolve(process.cwd(), "src/app/dashboard/teacher/monitor/content.tsx");
const teacherMonitorSrc = fs.readFileSync(teacherMonitorPath, "utf-8");

const arenaContentPath = path.resolve(process.cwd(), "src/app/arena/[id]/content.tsx");
const arenaContentSrc = fs.readFileSync(arenaContentPath, "utf-8");

// ─────────────────────────────────────────────────────────────
// PART 19 AUTOMATED TESTS: MOBILE LIVE PROCTORING & VIOLATIONS
// ─────────────────────────────────────────────────────────────

test("1 & 2: Visibility hidden and blur use single authoritative away incident flow", () => {
  assert.match(quizPageSrc, /awayIncidentActiveRef/);
  assert.match(quizPageSrc, /awayViolationRecordedRef/);
  assert.match(quizPageSrc, /awayGraceTimerRef/);
  assert.match(quizPageSrc, /document\.visibilityState === "hidden" \|\| document\.hidden/);
});

test("3 & 4: Grace timer controls violation recording before vs beyond grace threshold", () => {
  assert.match(quizPageSrc, /beginAway\s*=\s*\(graceMs\s*=\s*1500\)/);
  assert.match(quizPageSrc, /awayGraceTimerRef\.current\s*=\s*setTimeout/);
  assert.match(quizPageSrc, /reportViolationRef\.current\("tab_switch",\s*100\)/);
});

test("5: Remaining continuously hidden does NOT create duplicate violation strikes", () => {
  assert.match(quizPageSrc, /if\s*\(awayViolationRecordedRef\.current\)/);
  assert.match(quizPageSrc, /awayViolationRecordedRef\.current\s*=\s*true;/);
});

test("6 & 7: Returning from departure resets incident state allowing future departure to trigger strike", () => {
  assert.match(quizPageSrc, /const\s+endAway\s*=\s*\(\)\s*=>/);
  assert.match(quizPageSrc, /awayIncidentActiveRef\.current\s*=\s*false;/);
  assert.match(quizPageSrc, /awayViolationRecordedRef\.current\s*=\s*false;/);
});

test("8: Third valid incident triggers automatic submission", () => {
  assert.match(quizPageSrc, /currentCount\s*>=\s*3/);
  assert.match(quizPageSrc, /isFinal:\s*true/);
  assert.match(quizPageSrc, /submitQuizRef\.current\(/);
});

test("9: Violation API response updates student strike count authoritatively", () => {
  assert.match(quizPageSrc, /const\s+serverCount\s*=\s*Number\(data\.violationCount\)/);
  assert.match(quizPageSrc, /violationCountRef\.current\s*=\s*currentCount/);
  assert.match(quizPageSrc, /setViolationCount\(currentCount\)/);
});

test("10: Teacher update broadcast fires with violationCount after persisted violation", () => {
  assert.match(violationRouteSrc, /pusherServer\.trigger\(channelName,\s*["']new-violation["']/);
  assert.match(violationRouteSrc, /violationCount:\s*violationResult\.count/);
  assert.match(teacherMonitorSrc, /teacherChannel\.bind\(["']new-violation["']/);
});

test("11 & 12: Security incident state uses component refs and event listeners register cleanly", () => {
  assert.match(quizPageSrc, /examActiveRef/);
  assert.match(quizPageSrc, /submissionInFlightRef/);
  assert.match(quizPageSrc, /document\.addEventListener\(["']visibilitychange["']/);
  assert.match(quizPageSrc, /document\.removeEventListener\(["']visibilitychange["']/);
});

test("13 & 14: Video playback auto-resumes on foregrounding if paused on mobile", () => {
  assert.match(quizPageSrc, /activeVideo\.paused && mediaStreamRef\.current\?\.active/);
  assert.match(quizPageSrc, /activeVideo\.play\(\)\.catch/);
});

test("15 & 16: Face-missing and multiple-faces continuous frames produce max one incident violation", () => {
  assert.match(quizPageSrc, /noFaceViolationRecorded/);
  assert.match(quizPageSrc, /multipleFacesViolationRecorded/);
  assert.match(quizPageSrc, /reportViolationRef\.current\("no_face",\s*100\)/);
  assert.match(quizPageSrc, /reportViolationRef\.current\("multiple_faces",\s*100\)/);
});

test("17: Phone / object detection continuous frames produce max one incident violation", () => {
  assert.match(quizPageSrc, /phoneViolationRecorded/);
  assert.match(quizPageSrc, /reportViolationRef\.current\(\s*["']device_detected["']/);
  assert.match(quizPageSrc, /mobileFaceMissing = isMobile && \(mobileMissingSince !== null \|\| mobileNoFaceIncidentRecordedRef\.current\)/);
  assert.match(quizPageSrc, /isActionableDeviceDetection\(deviceConfidence, mobileFaceMissing, isMobile\)/);
});

test("18: Mobile/portrait dimensions use normalized geometric ratios for head pose", () => {
  assert.match(quizPageSrc, /yawOffset\s*=\s*\(noseBottom\.x\s*-\s*eyeCenterX\)\s*\/\s*eyeDistance/);
  assert.match(quizPageSrc, /pitchRatio\s*=\s*\(noseBottom\.y\s*-\s*eyeCenterY\)\s*\/\s*eyeDistance/);
  assert.match(quizPageSrc, /mobileHeadPoseBaseline/);
  assert.match(quizPageSrc, /classifyHeadPose\(yawOffset, pitchRatio/);
  assert.match(quizPageSrc, /advanceMobileHeadPoseCalibration\(mobileHeadPoseSamples, yawOffset, pitchRatio\)/);
  assert.match(quizPageSrc, /if \(!pose\.calibrated\)\s*\{\s*lookingAwayFrames = 0/);
  const missingFaceHeadPose = quizPageSrc.match(/if \(detections\.length === 0\) \{[\s\S]*?lookingAwayFrames = 0;[\s\S]*?noFaceFrames\+\+/)?.[0];
  const multipleFacesHeadPose = quizPageSrc.match(/else if \(detections\.length > 1\) \{[\s\S]*?lookingAwayFrames = 0;[\s\S]*?multipleFacesFrames\+\+/)?.[0];
  const calibratingHeadPose = quizPageSrc.match(/if \(!pose\.calibrated\) \{[\s\S]*?\} else if \(direction !== "Focused ✓"\)/)?.[0];
  for (const segment of [missingFaceHeadPose, multipleFacesHeadPose, calibratingHeadPose]) {
    assert.ok(segment);
    assert.doesNotMatch(segment, /lookingAwayViolationRecorded = false/);
  }
  assert.match(quizPageSrc, /else \{\s*lookingAwayFrames = 0;\s*lookingAwayViolationRecorded = false;\s*setFaceTrackingWarning\(null\);\s*\}/);
  assert.match(quizPageSrc, /window\.addEventListener\("orientationchange", resetDetectorIncidents\)/);
  assert.match(quizPageSrc, /activeVideo\?\.paused[\s\S]*mobileHeadPoseBaseline = null/);
  assert.match(quizPageSrc, /lookingAwayFrames >= \(isMobile \? 3 : 5\)[\s\S]*reportViolationRef\.current\(violationReason, 90\)/);
});

test("18A: Mobile reacquisition suppresses brief no-face evidence but sustained absence retains the strike path", () => {
  assert.match(quizPageSrc, /detectMobileFacesWithFallback(?:<[^>]+>)?\(\s*isMobile,\s*performanceProfile\.faceInputSize/);
  assert.match(quizPageSrc, /\(inputSize, scoreThreshold\) => faceapi\.detectAllFaces\([\s\S]*?\)\.withFaceLandmarks\(performanceProfile\.useTinyLandmarks\)/);
  const missingFace = quizPageSrc.match(/if \(detections\.length === 0\) \{[\s\S]*?\} else if \(detections\.length > 1\)/)?.[0];
  assert.ok(missingFace);
  assert.match(missingFace, /isTransientMobileFaceLoss\(mobileLastFaceSeenAt, mobileMissingSince, performance\.now\(\)\)/);
  assert.match(missingFace, /if \(reacquiringFace\) \{[\s\S]*?noFaceFrames = 0;[\s\S]*?\} else \{[\s\S]*?noFaceFrames\+\+/);
  assert.match(missingFace, /noFaceFrames >= \(isMobile \? 4 : 5\)[\s\S]*reportViolationRef\.current\("no_face", 100\)/);
  assert.match(missingFace, /confirmMobileFaceMissing\(async \(inputSize, scoreThreshold\) =>[\s\S]*?if \(faceRecoveredOnConfirmation\) \{[\s\S]*?noFaceFrames = 0;[\s\S]*?\} else \{[\s\S]*?reportViolationRef\.current\("no_face", 100\)/);
  assert.match(missingFace, /confirmMobileFaceMissing\(async \(inputSize, scoreThreshold\) => \{\s*drawInferenceFrame\(activeVideo\)/);
  assert.match(quizPageSrc, /getMobileInferenceDimensions\(\s*video\.videoWidth,\s*video\.videoHeight/);
  assert.match(quizPageSrc, /inferenceContext\.drawImage\(video, 0, 0, inferenceCanvas\.width, inferenceCanvas\.height\)/);
  assert.match(quizPageSrc, /mobileFaceRecoveryFrames >= 2\) \{[\s\S]*?noFaceFrames = 0;[\s\S]*?mobileMissingSince = null/);
  assert.match(quizPageSrc, /const mobileNoFaceIncidentRecordedRef = useRef\(false\)/);
  assert.match(quizPageSrc, /studentQuizIdRef\.current !== studentQuizId\) mobileNoFaceIncidentRecordedRef\.current = false/);
  assert.match(missingFace, /mobileNoFaceRecoveryFrames = 0;[\s\S]*?mobileNoFaceIncidentRecordedRef\.current/);
  assert.match(quizPageSrc, /pose\.calibrated && direction === "Focused ✓"[\s\S]*?mobileNoFaceIncidentRecordedRef\.current = false/);
});

test("18B: Face-tracking warnings are single-owner, clear on neutral, and reject stale detection results", () => {
  assert.match(quizPageSrc, /const \[faceTrackingWarning, setFaceTrackingWarning\] = useState<string \| null>\(null\)/);
  assert.match(quizPageSrc, /trackingGeneration\+\+;[\s\S]*?setFaceTrackingWarning\(null\)/);
  assert.match(quizPageSrc, /const detectionGeneration = trackingGeneration;[\s\S]*?detectionGeneration !== trackingGeneration/);
  const faceScan = quizPageSrc.match(/faceDetectionInterval = setInterval\(async \(\) => \{[\s\S]*?\}, performanceProfile\.detectionIntervalMs\)/)?.[0];
  assert.ok(faceScan);
  assert.doesNotMatch(faceScan, /setTimeout\([\s\S]*setFaceTrackingWarning/);
  assert.match(quizPageSrc, /else \{\s*lookingAwayFrames = 0;\s*lookingAwayViolationRecorded = false;\s*setFaceTrackingWarning\(null\)/);
  assert.match(quizPageSrc, /setFaceTrackingWarning\(lookingAwayFrames >= 2[\s\S]*?: null\)/);
  assert.match(quizPageSrc, /setFaceTrackingWarning\(noFaceFrames >= 2[\s\S]*?: null\)/);
  assert.doesNotMatch(quizPageSrc, /setPreWarning\(`Please look directly at the screen/);
  assert.match(quizPageSrc, /\{preWarning \|\| faceTrackingWarning\}/);
});

test("18C: Three confirmed violations still trigger one guarded auto-submit", () => {
  assert.match(quizPageSrc, /if \(!hasStarted \|\| violationCount < 3 \|\| isAlertingRef\.current \|\| isSubmitting\) return/);
  assert.match(quizPageSrc, /if \(currentCount >= 3\) \{\s*isAlertingRef\.current = true/);
  assert.match(quizPageSrc, /submitQuizRef\.current\("violation_limit"\)/);
});

test("19: Power Arena never records proctoring violations", () => {
  assert.equal(arenaContentSrc.includes("reportViolation"), false);
  assert.match(violationRouteSrc, /quiz:\s*\{\s*quizMode:\s*\{\s*not:\s*["']arena["']\s*\}\s*\}/);
});

test("20: Submitted exam stops all security incidents via examActiveRef and submissionInFlightRef", () => {
  assert.match(quizPageSrc, /!examActiveRef\.current\s*\|\|\s*submissionInFlightRef\.current/);
  assert.match(quizPageSrc, /examActiveRef\.current\s*=\s*hasStarted && !isSubmitting/);
});
