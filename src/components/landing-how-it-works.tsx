"use client";

import { useState } from "react";
import HowItWorks, { type Step, useFlowReducedMotion } from "./how-it-works";
import styles from "./how-it-works.module.css";

const steps: Step[] = [
  { title: "Create Your Account", description: "Register as a student or teacher, then sign in to your workspace." },
  { title: "Create & Configure Quizzes", description: "Teachers write questions or use AI assistance, choose quiz settings, and share a room code." },
  { title: "Join & Take Assessments", description: "Students enter the room code, complete any required device checks, and take the assessment." },
  { title: "AI-Assisted Monitoring", description: "When enabled for a proctored quiz, monitoring flags recorded events for teacher review." },
  { title: "Review Results", description: "Students see their results. Teachers review scores and, for proctored quizzes, recorded events and supporting evidence." },
].map((step, index) => ({ ...step, colors: {
  bg: styles.cardBackground,
  text: [styles.emerald, styles.teal, styles.gold][index % 3],
  border: styles.cardBorder,
} }));

export default function LandingHowItWorks() {
  const [paused, setPaused] = useState(false);
  const reducedMotion = useFlowReducedMotion();

  return (
    <div className={styles.wrapper}>
      <div className={styles.controls}>
        <button type="button" className={styles.motionButton} disabled={!!reducedMotion}
          aria-pressed={paused} onClick={() => setPaused(value => !value)}>
          {reducedMotion ? "Motion reduced" : paused ? "Play flow animation" : "Pause flow animation"}
        </button>
      </div>
      <HowItWorks features={steps} paused={paused} />
    </div>
  );
}
