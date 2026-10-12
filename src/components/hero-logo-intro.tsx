"use client";

import { useEffect, useRef, useState } from "react";
import BrandImage from "@/components/brand-image";
import styles from "./hero-logo-intro.module.css";

type Status = "waiting" | "playing" | "paused" | "fallback" | "unavailable";
type DataConnection = EventTarget & { saveData?: boolean };

export default function HeroLogoIntro({ className = "" }: { className?: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const toggleRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<Status>("waiting");
  const [showVideo, setShowVideo] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    const video = videoRef.current;
    if (!stage || !video) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const data = window.matchMedia("(prefers-reduced-data: reduce)");
    const connection = (navigator as Navigator & { connection?: DataConnection }).connection;
    let visible = false;
    let manuallyPaused = false;
    let autoplayBlocked = false;
    let failed = false;
    let attempting = false;
    let disposed = false;
    let generation = 0;
    const restricted = () => motion.matches || data.matches || connection?.saveData === true;
    const eligible = () => visible && !document.hidden && !restricted();

    const start = () => {
      if (disposed || attempting || failed || !eligible()) return;
      video.muted = true;
      if (!video.hasAttribute("src")) video.src = "/videos/original-google-flow-intro.mp4";
      attempting = true;
      const attempt = ++generation;
      void video.play().catch(() => {
        if (disposed || attempt !== generation || failed) return;
        // Visibility interruptions are retryable; policy rejection needs a user gesture.
        if (eligible() && !manuallyPaused) {
          autoplayBlocked = true;
          setShowVideo(false);
          setStatus("fallback");
        }
      }).finally(() => {
        if (attempt === generation) attempting = false;
      });
    };

    const reconcile = () => {
      if (disposed) return;
      if (restricted()) {
        generation++;
        attempting = false;
        video.pause();
        if (video.hasAttribute("src")) {
          video.removeAttribute("src");
          video.load();
        }
        setShowVideo(false);
        setStatus("unavailable");
      } else if (!eligible()) {
        generation++;
        attempting = false;
        video.pause();
      } else if (failed) {
        setStatus("unavailable");
      } else if (manuallyPaused) {
        setStatus("paused");
      } else if (autoplayBlocked) {
        setStatus("fallback");
      } else {
        setStatus(video.paused ? "waiting" : "playing");
        start();
      }
    };
    const playing = () => {
      if (!eligible() || manuallyPaused) { video.pause(); return; }
      setShowVideo(true);
      setStatus("playing");
    };
    const paused = () => {
      if (!disposed && !restricted() && !failed) setStatus(autoplayBlocked ? "fallback" : "paused");
    };
    const error = () => {
      failed = true;
      video.pause();
      setShowVideo(false);
      setStatus("unavailable");
    };
    const silence = () => { if (!video.muted) video.muted = true; };
    toggleRef.current = () => {
      if (!eligible() || failed) return;
      if (!video.paused) {
        manuallyPaused = true;
        generation++;
        attempting = false;
        video.pause();
      } else {
        manuallyPaused = false;
        autoplayBlocked = false;
        start();
      }
    };
    video.addEventListener("playing", playing);
    video.addEventListener("pause", paused);
    video.addEventListener("error", error);
    video.addEventListener("volumechange", silence);
    document.addEventListener("visibilitychange", reconcile);
    motion.addEventListener("change", reconcile);
    data.addEventListener("change", reconcile);
    connection?.addEventListener("change", reconcile);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
      reconcile();
    }, { threshold: [0, 0.25] });
    observer.observe(stage);

    return () => {
      disposed = true;
      generation++;
      toggleRef.current = null;
      observer.disconnect();
      document.removeEventListener("visibilitychange", reconcile);
      motion.removeEventListener("change", reconcile);
      data.removeEventListener("change", reconcile);
      connection?.removeEventListener("change", reconcile);
      video.removeEventListener("playing", playing);
      video.removeEventListener("pause", paused);
      video.removeEventListener("error", error);
      video.removeEventListener("volumechange", silence);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, []);

  return (
    <div ref={stageRef} className={`${styles.stage} ${className}`} data-hero-video="" data-status={status}>
      <div className={styles.poster} style={{ opacity: showVideo ? 0 : 1 }}>
        <BrandImage variant="logo" width={470} preload />
      </div>
      <video ref={videoRef} className={styles.video} style={{ opacity: showVideo ? 1 : 0 }}
        width={1920} height={1080} muted playsInline loop preload="none" aria-hidden="true" tabIndex={-1} />
      <button type="button" className={styles.control} disabled={status === "waiting" || status === "unavailable"}
        aria-label={status === "playing" ? "Pause logo animation" : "Play logo animation"}
        onClick={() => toggleRef.current?.()}>
        {status === "playing" ? "Pause" : "Play"}
      </button>
    </div>
  );
}
