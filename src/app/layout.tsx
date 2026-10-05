import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Proctor Shield AI — AI-Powered Online Proctoring",
  description:
    "AI proctoring that detects cheating in real-time, captures evidence automatically, and delivers an intelligent verdict.",
  keywords: ["proctoring", "AI", "quiz", "cheating detection", "online quiz"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body className="antialiased app-motion-scope">{children}</body>
    </html>
  );
}
