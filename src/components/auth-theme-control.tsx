"use client";

import { useEffect, useRef } from "react";
import { Moon, Sun } from "lucide-react";
import { syncSystemTheme, togglePresentationTheme } from "@/lib/theme-presentation";

export default function AuthThemeControl() {
  const manuallySelected = useRef(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => { if (!manuallySelected.current) syncSystemTheme(); };
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return <button type="button" className="ps-auth-theme" onClick={() => { manuallySelected.current = true; togglePresentationTheme(); }}>
    <span className="ps-theme-when-light"><Moon aria-hidden="true" size={16} />Dark mode</span>
    <span className="ps-theme-when-dark"><Sun aria-hidden="true" size={16} />Light mode</span>
  </button>;
}
