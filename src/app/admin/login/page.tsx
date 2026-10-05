import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Page Not Found | ProctorShieldAI",
  description: "The page you're looking for may have been moved, removed, or is no longer available.",
};

export default function DeprecatedLoginPage() {
  notFound();
}
