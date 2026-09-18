"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";

export default function NameEnforcer({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Only prompt on first login if persistent profile name is missing or default placeholder
    const trimmed = (initialName || "").trim();
    if (!trimmed || trimmed === "Google User" || trimmed.toLowerCase() === "student" || trimmed.toLowerCase() === "student user") {
      setIsOpen(true);
    }
  }, [initialName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const cleanName = fullName.trim();
    if (cleanName.length < 2) {
      setError("Please enter your full name.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: cleanName }),
      });

      if (res.ok) {
        setIsOpen(false);
        router.refresh(); // Refresh layout to pick up new session cookie
      } else {
        const data = await res.json();
        setError(data.error || "Failed to update name");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="app-modal-backdrop bg-black/60 backdrop-blur-sm">
      <div className="app-modal-panel bg-[var(--surface)] border border-[var(--border)] rounded-2xl max-w-md p-5 shadow-2xl animate-fade-in-up overflow-y-auto sm:p-8">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-amber-500/10 text-amber-500 mb-6 mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        
        <h2 className="text-2xl font-bold text-center text-[var(--ink)] mb-2">Update Your Name</h2>
        <p className="text-sm text-center text-[var(--muted)] mb-6">
          To ensure proper identification during proctored exams, your name must follow the standard format: <br/>
          <strong className="text-[var(--ink)]">LAST NAME, FIRST NAME, MIDDLE NAME</strong>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-[var(--muted)] mb-1 block">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value.toUpperCase())}
              placeholder="e.g. DELA CRUZ, JUAN, SANTOS"
              className="w-full px-4 py-3 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] font-bold tracking-wide focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all uppercase"
              required
            />
          </div>

          {error && (
            <div className="text-xs font-semibold text-red-500 bg-red-500/10 p-3 rounded-xl text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !fullName.trim()}
            className="w-full py-3.5 rounded-xl bg-indigo-600 text-sm font-bold text-white hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/25 disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Updating...
              </span>
            ) : (
              "Save Formal Name"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
