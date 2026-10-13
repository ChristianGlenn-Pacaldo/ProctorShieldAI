// Presentation only: reuse DashboardShell's existing key and html.dark contract.
// A fixed parser-blocking script in the root head resolves preferences before paint.
export const THEME_BOOTSTRAP = `(()=>{let preference;try{preference=localStorage.getItem("theme")}catch{}const dark=preference==="dark"||(preference!=="light"&&typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark)})()`;

export function syncSystemTheme() {
  let preference: string | null = null;
  try { preference = localStorage.getItem("theme"); } catch {}
  if (preference === "light" || preference === "dark") return;
  document.documentElement.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
}

export function togglePresentationTheme() {
  const dark = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", dark);
  try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
}
