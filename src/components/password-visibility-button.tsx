"use client";

import { Eye, EyeOff } from "lucide-react";

type Props = {
  inputId: string;
  visible: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
};

export function PasswordVisibilityButton({ inputId, visible, onToggle, label, disabled }: Props) {
  // Preserve centering when the shared motion styles lift hovered buttons.
  return (
    <button
      type="button"
      aria-controls={inputId}
      aria-label={`${visible ? "Hide" : "Show"} ${label}`}
      aria-pressed={visible}
      disabled={disabled}
      onClick={onToggle}
      style={{ translate: "0 -50%" }}
      className="absolute right-1 top-1/2 flex h-11 w-11 items-center justify-center rounded-lg text-[var(--ps-text-secondary)] hover:text-[var(--ps-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ps-focus)] disabled:opacity-50"
    >
      {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}
