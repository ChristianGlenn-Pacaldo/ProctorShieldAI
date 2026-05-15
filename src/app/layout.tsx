import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Proctor Shield AI — AI-Powered Online Proctoring",
  description:
    "AI proctoring that detects cheating in real-time, captures evidence automatically, and delivers an intelligent verdict.",
  keywords: ["proctoring", "AI", "exam", "cheating detection", "online exam"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
