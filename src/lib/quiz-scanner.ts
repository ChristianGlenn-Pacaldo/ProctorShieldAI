export type QuizScanSource = { name: string; dataUrl?: string; sourceText?: string };
const MAX_INLINE_BYTES = 4_000_000;

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read this file."));
    reader.onerror = () => reject(new Error("Could not read this file."));
    reader.readAsDataURL(file);
  });
}
function canvasImage(image: CanvasImageSource, width: number, height: number): string {
  if (!width || !height) throw new Error("The camera or image is not ready. Please try again.");
  const scale = Math.min(1, 1800 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image processing is unavailable in this browser.");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL("image/jpeg", 0.85);
  if (data.length > 5_500_000) throw new Error("Image is too large. Please choose a smaller image.");
  return data;
}
export async function prepareQuizScan(file: File): Promise<QuizScanSource> {
  if (!file.size || file.size > 10_000_000) throw new Error("Choose a non-empty file up to 10 MB.");
  if (file.type === "text/plain" || /\.txt$/i.test(file.name)) {
    if (file.size > 60_000) throw new Error("Text files must be under 60 KB.");
    const sourceText = (await file.text()).trim();
    if (!sourceText) throw new Error("This text file is empty.");
    return { name: file.name, sourceText };
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_INLINE_BYTES) throw new Error("PDF files must be under 4 MB.");
    const data = await readDataUrl(file);
    return { name: file.name, dataUrl: data.replace(/^data:[^;]*;/, "data:application/pdf;") };
  }
  if (!file.type.startsWith("image/")) throw new Error("Choose an image, PDF, or plain text file.");
  const data = await readDataUrl(file);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("This image format could not be opened. Try JPEG or PNG."));
    image.src = data;
  });
  return { name: file.name, dataUrl: canvasImage(image, image.naturalWidth, image.naturalHeight) };
}
export function captureQuizScan(video: HTMLVideoElement): QuizScanSource {
  if (video.readyState < 2) throw new Error("Wait for the camera preview before capturing.");
  return { name: "Camera scan", dataUrl: canvasImage(video, video.videoWidth, video.videoHeight) };
}
export function quizScanPayload(source: QuizScanSource) {
  if (source.sourceText) return { sourceText: source.sourceText };
  const match = source.dataUrl?.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("The scan could not be read. Please scan or upload again.");
  return { mimeType: match[1], imageBase64: match[2] };
}

/** Cleanup also handles permission requests resolving after modal close/unmount. */
export function startQuizScannerCamera(video: HTMLVideoElement, onError: (message: string) => void) {
  let cancelled = false;
  let stream: MediaStream | null = null;
  const stop = () => {
    cancelled = true;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
  };
  void (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires a supported browser and secure connection.");
      const constraints = { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
      try { stream = await navigator.mediaDevices.getUserMedia(constraints); }
      catch (error) {
        if (cancelled) return;
        if (!(error instanceof DOMException) || error.name !== "OverconstrainedError") throw error;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      }
      if (cancelled) { stream.getTracks().forEach(track => track.stop()); stream = null; return; }
      video.srcObject = stream;
      await video.play();
    } catch (error) {
      if (cancelled) return;
      stop();
      onError(error instanceof Error && error.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access or upload from your device."
        : "Could not start the camera. Check permission or upload from your device.");
    }
  })();
  return stop;
}
