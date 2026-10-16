import type { EvidenceClip } from "./evidence-clip-buffer";

// Keep the same clip and violation on a transient failure. Re-recording would
// lose the movement that originally triggered the incident.
export async function uploadEvidenceClip(violationId: string, clip: EvidenceClip,
  request: typeof fetch = fetch): Promise<boolean> {
  if (!/^[1-9]\d*$/.test(violationId)) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const form = new FormData();
    form.append("evidence", clip.blob, `violation-${violationId}.${clip.extension}`);
    form.append("durationMs", String(clip.durationMs));
    try {
      const response = await request(`/api/live/violation/${violationId}/evidence`, {
        method: "POST", body: form, signal: AbortSignal.timeout(15_000),
      });
      if (response.ok && (await response.json()).success === true) return true;
      if (response.status < 500 && response.status !== 408) return false;
    } catch { /* Retry a dropped response or connection with the original clip. */ }
  }
  return false;
}
