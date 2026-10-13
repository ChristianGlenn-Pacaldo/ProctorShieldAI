import type { Metadata } from "next";
import "./globals.css";
import { THEME_BOOTSTRAP } from "@/lib/theme-presentation";

export const metadata: Metadata = {
  title: "ProctorShieldAI — AI-Powered Online Proctoring",
  description:
    "AI proctoring that detects cheating in real-time, captures evidence automatically, and delivers an intelligent verdict.",
  keywords: ["proctoring", "AI", "quiz", "cheating detection", "online quiz"],
  icons: { icon: "/images/proctorshieldai-shield-transparent.png", apple: "/images/proctorshieldai-shield-transparent.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script id="ps-theme-init" dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} /></head>
      <body className="antialiased app-motion-scope">{children}</body>
    </html>
  );
}
