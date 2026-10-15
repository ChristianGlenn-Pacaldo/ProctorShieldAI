"use client";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { QuizPrivacyInfo } from "@/lib/quiz-privacy";
import styles from "./student-privacy-notice.module.css";

export default function StudentPrivacyNotice({ quizId, continued, onContinue }: {
  quizId: string; continued: boolean; onContinue: () => void;
}) {
  const [info, setInfo] = useState<QuizPrivacyInfo | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    setInfo(null); setError(false);
    fetch("/api/quizzes/" + encodeURIComponent(quizId) + "/privacy", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw Error("Unavailable");
        const data = await response.json() as QuizPrivacyInfo;
        if (!Number.isInteger(data.retentionDays) || data.retentionDays < 1 || data.retentionDays > 3650) throw Error("Unavailable");
        if (active && !controller.signal.aborted) setInfo(data);
      }).catch(() => { if (active) setError(true); }).finally(() => window.clearTimeout(timer));
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [quizId, retry]);

  return <section className={styles.notice} aria-labelledby="quiz-privacy-heading">
    <h2 id="quiz-privacy-heading"><ShieldCheck size={21} aria-hidden="true" /> Your Privacy Matters</h2>
    <p>AI-assisted monitoring checks your camera frames, microphone levels and browser activity for events that may need review. Incident snapshots and short clips may be collected; clips may include microphone audio when available.</p>
    <p>It does not continuously record your full exam video or screen. Your teacher may receive live camera images and available audio during monitoring. Teachers review signals in context; a flag alone does not prove misconduct.</p>
    <details>
      <summary>Evidence access and privacy information</summary>
      <p>Your quiz’s teacher, with an active Pro plan, can review its recorded evidence. Administrators can also access evidence. Individual Administrator approval is not currently required.</p>
      <p>Browser camera and microphone permission controls your device access. It is not legal consent. Ask your institution about the purpose and lawful basis for monitoring, and requests to access, correct, object to or erase information or appeal an outcome.</p>
    </details>
    {info ? <>
      <p className={styles.retention}>Configured evidence retention: <strong>{info.retentionDays} days</strong>.</p>
      <p>This is the configured period, not a guarantee that every copy is deleted on that day. Academic records and backups may follow different schedules.</p>
      {info.contact && <div className={styles.contact}>
        <strong>{info.institution || "Institution privacy contact"}</strong>
        {info.contact.email && <a href={"mailto:" + encodeURIComponent(info.contact.email)}>{info.contact.email}</a>}
        {info.contact.url && <a href={info.contact.url} target="_blank" rel="noopener noreferrer">Institution privacy information</a>}
      </div>}
    </> : error
      ? <p role="alert">Privacy information could not load. Retry before checking your camera or microphone.</p>
      : <p role="status">Loading the configured retention period...</p>}
    {error && <button type="button" onClick={() => setRetry(value => value + 1)}>Retry privacy information</button>}
    <button type="button" disabled={!info || continued} onClick={onContinue}>
      {continued ? "Ready for device check" : "Continue to Device Check"}
    </button>
    <small>This step opens the device check. It does not record legal consent.</small>
  </section>;
}

