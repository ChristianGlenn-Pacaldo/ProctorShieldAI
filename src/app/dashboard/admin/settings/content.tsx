"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsContent() {
  const router = useRouter();
  const [user, setUser] = useState<{ fullName: string; email: string } | null>(null);
  const [fullName, setFullName] = useState("");
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => {
        if (!res.ok) throw new Error("Session unavailable");
        return res.json();
      })
      .then((data) => {
        if (!data.authenticated || !data.user) throw new Error("Session unavailable");
        setUser({ fullName: data.user.fullName, email: data.user.email });
        setFullName(data.user.fullName);
      })
      .catch(() => setProfileMessage({ type: "error", text: "Could not load your profile. Please reload the page." }))
      .finally(() => setIsLoadingProfile(false));
  }, []);

  const handleSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    const name = fullName.trim();
    if (name.length < 2 || name.length > 150) {
      setProfileMessage({ type: "error", text: "Name must be between 2 and 150 characters." });
      return;
    }
    if (name === user.fullName) return;

    setIsSaving(true);
    setProfileMessage(null);
    try {
      const response = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: name }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        setProfileMessage({ type: "error", text: data?.message || "Could not save your profile. Please try again." });
        return;
      }
      setUser({ ...user, fullName: name });
      setFullName(name);
      setProfileMessage({ type: "success", text: "Profile updated successfully." });
      router.refresh();
    } catch {
      setProfileMessage({ type: "error", text: "Network error. Please try again." });
    } finally {
      setIsSaving(false);
    }
  };

  const name = user?.fullName || "Admin User";
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="animate-fade-in grid lg:grid-cols-2 gap-4">
      {/* Admin Profile */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">👤 Admin Profile</h3>
        </div>
        <div className="p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center text-3xl font-extrabold text-white mx-auto mb-4">
            {initials || "AD"}
          </div>
          <h3 className="text-lg font-bold text-[var(--ink)] mb-1">{name}</h3>
          <p className="text-sm text-[var(--muted)] mb-6">ProctorShield Administration</p>
          <form onSubmit={handleSaveProfile} className="text-left space-y-3">
            <label htmlFor="admin-full-name" className="text-xs font-semibold text-[var(--muted)] block">Full Name</label>
            <input
              id="admin-full-name"
              value={fullName}
              onChange={(event) => { setFullName(event.target.value); setProfileMessage(null); }}
              disabled={!user || isSaving}
              maxLength={150}
              className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
            />
            {profileMessage && <p role="alert" className={`text-xs ${profileMessage.type === "error" ? "text-rose-500" : "text-emerald-500"}`}>{profileMessage.text}</p>}
            <button
              type="submit"
              disabled={isLoadingProfile || !user || isSaving || fullName.trim() === user.fullName}
              className="w-full py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-500 transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </form>
        </div>
      </div>

      {/* Global Settings */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)]">⚙️ Global Settings</h3>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-[var(--muted)] mb-1.5 block">System Name</label>
            <input value="Proctor Shield AI" disabled aria-describedby="admin-settings-unavailable" className="w-full px-4 py-2.5 rounded-xl bg-[var(--surface2)] border border-[var(--border)] text-sm text-[var(--muted)] disabled:cursor-not-allowed" />
          </div>
          <div className="pt-3 border-t border-[var(--border)]">
            <label className="text-xs font-semibold text-[var(--muted)] mb-3 block">Platform Policies</label>
            <div className="flex items-center justify-between py-3 border-b border-[var(--border)]">
              <div>
                <div className="text-sm font-medium text-[var(--ink)]">Allow Instructor Registration</div>
                <div className="text-xs text-[var(--muted)]">Teachers can create their own accounts</div>
              </div>
              <span className="text-xs font-semibold text-[var(--muted)]">Unavailable</span>
            </div>
            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-medium text-[var(--ink)]">Strict AI Enforcements</div>
                <div className="text-xs text-[var(--muted)]">Force lock quizzes on high severity violations</div>
              </div>
              <span className="text-xs font-semibold text-[var(--muted)]">Unavailable</span>
            </div>
          </div>
          <p id="admin-settings-unavailable" className="text-xs text-[var(--muted)]">Global configuration is not available yet. These values cannot be changed here.</p>
          <button disabled className="w-full py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-xl shadow-md shadow-indigo-600/20 mt-2 disabled:opacity-50 disabled:cursor-not-allowed">
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
