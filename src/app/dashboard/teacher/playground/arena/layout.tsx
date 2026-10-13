import "@/styles/assessment-theme.css";

export default function AssessmentLayout({ children }: { children: React.ReactNode }) {
  return <div className="ps-assessment-theme ps-assessment-route ps-arena-theme ps-arena-host-theme">{children}</div>;
}
