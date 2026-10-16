import { expect, test } from "@playwright/test";
import jwt from "jsonwebtoken";
import fs from "node:fs";

// Exercise Next's production chunks. An esbuild-only model harness does not
// reproduce the module evaluation order used by the deployed quiz page.
test.use({ launchOptions: { args: ["--disable-gpu"] } });

test("production quiz initializes face and object AI on a four-thread laptop", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop low-power runtime regression");
  test.setTimeout(120_000);
  if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Synthetic fixture requires loopback");
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Synthetic fixture requires an explicit local secret");
  const browserId = "11111111-1111-4111-8111-111111111111";
  const value = jwt.sign({ userId: "synthetic-student", email: "synthetic@example.invalid", fullName: "Synthetic Student", role: "student", sessionClass: "user", sessionVersion: 0,
    browserId, authGeneration: "22222222-2222-4222-8222-222222222222" }, secret,
    { algorithm: "HS256", audience: "proctorshield:user", expiresIn: "10m" });
  await context.addCookies([{ name: "ps_session_user", value, url: baseURL, httpOnly: true, sameSite: "Lax" },
    { name: "ps_browser_auth", value: browserId, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  const sample = "data:image/jpeg;base64," + fs.readFileSync("node_modules/@vladmandic/face-api/demo/sample1.jpg").toString("base64");
  await page.addInitScript(sample => {
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 });
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
    navigator.mediaDevices.getUserMedia = async constraints => {
      const image = new Image(); image.src = sample; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
      const paint = () => {
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0, 640, 480);
        context.fillStyle = Math.floor(performance.now() / 500) % 2 ? "#ff0000" : "#0000ff";
        context.fillRect(0, 0, 64, 64);
      };
      paint(); setInterval(paint, 125);
      const stream = canvas.captureStream(12);
      if (constraints?.audio) {
        const audio = new AudioContext(); const destination = audio.createMediaStreamDestination();
        const oscillator = audio.createOscillator(); const gain = audio.createGain(); gain.gain.value = 0;
        oscillator.connect(gain); gain.connect(destination); oscillator.start(); await audio.resume();
        stream.addTrack(destination.stream.getAudioTracks()[0]);
      }
      return stream;
    };
  }, sample);
  const errors: string[] = [];
  const evidenceDiagnostics: string[] = [];
  let incidents = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /Proctoring AI|TensorFlow|evaluate flag/.test(message.text())) errors.push(message.text()); });
  page.on("console", message => { if (/Video evidence|Failed to report violation|Violation API rejected/.test(message.text())) evidenceDiagnostics.push(message.text()); });
  const modelResponses: string[] = [];
  const uploads: Array<{ bytes: string; durationMs: number; type: string }> = [];
  page.on("response", response => { if (response.ok() && /tfjs-backend-wasm.*\.wasm|face_landmark_68_model|tiny_face_detector_model|coco\/model\.json/.test(response.url())) modelResponses.push(response.url()); });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (!url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/models/")) return route.continue();
    // All session/attempt, telemetry, evidence and signaling calls stay local
    // to the fixture. No account, real attempt or student media is persisted.
    const reply = (json: unknown) => route.fulfill({ json });
    if (url.pathname === "/api/auth/session") return reply({ authenticated: true, user: { userId: "synthetic-student", role: "student", fullName: "Synthetic Student" } });
    if (url.pathname === "/api/quizzes/99/privacy") return reply({ retentionDays: 30, institution: null, contact: null });
    if (url.pathname === "/api/quizzes/99") return reply({ success: true, userId: "synthetic-student", studentQuizId: "synthetic-attempt", studentQuizStatus: "enrolled", attemptMode: "proctored", canEnterQuiz: true,
      remainingSeconds: 600, violationCount: 0, savedAnswers: [], quiz: { id: 99, title: "Synthetic AI startup check", duration: 10, totalQuestions: 1, quizStatus: "in_progress", quizMode: "proctored", teacherId: "synthetic-teacher" },
      questions: [{ id: 1, questionText: "Synthetic startup question", questionType: "multiple_choice", points: 1, choices: [{ id: 11, choiceText: "One" }, { id: 12, choiceText: "Two" }] }] });
    if (url.pathname === "/api/quizzes/session") return reply({ success: true, monitoringLevel: "strict", startTime: new Date().toISOString(), remainingSeconds: 600 });
    if (url.pathname === "/api/live/violation") { incidents++; return reply({ success: true, violation: { id: "1" }, violationCount: 1 }); }
    if (url.pathname === "/api/live/violation/1/evidence") {
      const request = new Request(url, { method: "POST", headers: route.request().headers(), body: Uint8Array.from(route.request().postDataBuffer()!).buffer });
      const form = await request.formData(); const file = form.get("evidence") as File;
      uploads.push({ bytes: Buffer.from(await file.arrayBuffer()).toString("base64"), durationMs: Number(form.get("durationMs")), type: file.type });
      if (uploads.length === 1) return route.fulfill({ status: 503, json: { error: "Synthetic temporary storage outage" } });
      return reply({ success: true });
    }
    if (url.pathname === "/api/live/warning") return reply({ warning: null });
    return reply({ success: true, signals: [] });
  });
  await page.goto("/quiz/99");
  await page.getByRole("button", { name: "Continue to Device Check", exact: true }).click();
  await page.locator("#quiz-device-check").click();
  await page.getByRole("button", { name: "I Understand, Start Quiz", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Synthetic startup question" })).toBeVisible();
  await expect.poll(async () => {
    if (errors.length) throw new Error(errors.join("\n"));
    return page.getByText("AI Engine:", { exact: true }).locator("..").textContent();
  }, { timeout: 90_000 }).toContain("Active ✓");
  expect(modelResponses.some(url => /tfjs-backend-wasm.*\.wasm/.test(url))).toBe(true);
  expect(modelResponses.some(url => url.includes("face_landmark_68_model"))).toBe(true);
  expect(modelResponses.some(url => url.includes("coco/model.json"))).toBe(true);
  // Trigger a print incident after startup grace if the synthetic faces
  // have not already generated an incident. All posts are intercepted above.
  await page.waitForTimeout(5_100);
  if (uploads.length < 2) {
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    try { await expect.poll(() => uploads.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2); }
    catch { throw new Error(JSON.stringify({ incidents, evidenceDiagnostics, uploads: uploads.length })); }
  }
  expect(uploads[0]).toEqual(uploads[1]);
  expect(uploads[1].durationMs).toBeGreaterThanOrEqual(3_000);
  expect(uploads[1].durationMs).toBeLessThanOrEqual(5_500);
  expect(uploads[1].type).toBe("video/webm");
  const playback = await page.evaluate(async bytes => {
    const blob = new Blob([Uint8Array.from(atob(bytes), value => value.charCodeAt(0))], { type: "video/webm" });
    const url = URL.createObjectURL(blob); const video = document.createElement("video"); video.muted = true; video.src = url;
    try {
      await video.play(); const samples: number[][] = [];
      const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      for (let i = 0; i < 8; i++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        context.drawImage(video, 0, 0); samples.push([...context.getImageData(2, 2, 1, 1).data]);
      }
      return { time: video.currentTime, samples };
    } finally { video.pause(); URL.revokeObjectURL(url); }
  }, uploads[1].bytes);
  expect(playback.time).toBeGreaterThan(1);
  expect(playback.samples.some(pixel => pixel[0] > 180 && pixel[2] < 60)).toBe(true);
  expect(playback.samples.some(pixel => pixel[2] > 180 && pixel[0] < 60)).toBe(true);
  expect(errors).toEqual([]);
});
