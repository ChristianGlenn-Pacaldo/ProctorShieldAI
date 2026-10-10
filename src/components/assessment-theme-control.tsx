"use client";

import AuthThemeControl from "./auth-theme-control";

// Reuse the approved existing theme preference control; no game/session state.
export default function AssessmentThemeControl() {
  return <span className="ps-assessment-theme-control"><AuthThemeControl /></span>;
}
