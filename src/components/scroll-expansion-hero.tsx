"use client";

/** Adapted from arunachalam/scroll-expansion-hero (21st.dev catalog 1932).
 * Uses the retrieved media-expansion/motion composition. Native passive scrolling
 * replaces its wheel/touch lock; the original player is passed in exactly once.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { motion, useMotionValue, type MotionStyle } from "motion/react";
import styles from "./scroll-expansion-hero.module.css";

export default function ScrollExpandMedia({ children, className = "" }: {
  children: ReactNode;
  className?: string;
}) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const scrollProgress = useMotionValue(0);

  useEffect(() => {
    const section = sectionRef.current;
    const hero = section?.closest<HTMLElement>("[data-scroll-hero]");
    const destination = hero?.querySelector<HTMLElement>("[data-hero-expansion-space]");
    if (!section || !hero || !destination) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobile = window.matchMedia("(max-width: 850px)");
    const header = document.querySelector("header");
    let frame = 0;

    const update = () => {
      frame = 0;
      const origin = section.getBoundingClientRect();
      const target = destination.getBoundingClientRect();
      const headerHeight = header?.getBoundingClientRect().height ?? 0;
      const compact = mobile.matches;
      const progress = reduced.matches ? 0 : compact
        ? Math.min(1, Math.max(0, (window.innerHeight * 0.75 - origin.top) / (window.innerHeight * 0.5)))
        : Math.min(1, Math.max(0, window.scrollY / Math.max(1, target.top + window.scrollY - headerHeight - 24)));
      // Clear the copy vertically before widening into its former horizontal area.
      const expansion = compact ? progress : Math.max(0, (progress - 0.4) / 0.6);
      const travel = compact ? 0 : Math.min(1, progress / 0.4);
      const initialWidth = origin.width * (compact && !reduced.matches ? 0.88 : 1);
      const initialHeight = origin.height * (compact && !reduced.matches ? 0.88 : 1);
      const initialLeft = (origin.width - initialWidth) / 2;
      const mediaWidth = initialWidth + expansion * ((compact ? origin.width : target.width) - initialWidth);
      const mediaHeight = initialHeight + expansion * ((compact ? origin.height : target.height) - initialHeight);
      section.style.setProperty("--media-width", `${mediaWidth}px`);
      section.style.setProperty("--media-height", `${mediaHeight}px`);
      section.style.setProperty("--control-top", `${(mediaHeight + Math.min(mediaHeight, mediaWidth * 9 / 16)) / 2 + 8}px`);
      section.style.setProperty("--media-x", `${initialLeft + expansion * ((compact ? 0 : target.left - origin.left) - initialLeft)}px`);
      section.style.setProperty("--media-y", `${travel * (target.top - origin.top)}px`);
      scrollProgress.set(progress);
      section.dataset.progress = progress.toFixed(3);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update(); // Also handles a restored scroll position without resetting it.
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("pageshow", schedule);
    reduced.addEventListener("change", schedule);
    mobile.addEventListener("change", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(section);
    observer.observe(destination);
    if (header) observer.observe(header);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pageshow", schedule);
      reduced.removeEventListener("change", schedule);
      mobile.removeEventListener("change", schedule);
    };
  }, [scrollProgress]);

  return <div ref={sectionRef} className={`${styles.root} ${className}`} data-scroll-expansion="">
    <motion.div className={styles.media} style={{ "--expansion": scrollProgress } as MotionStyle}>
      {children}
    </motion.div>
  </div>;
}
