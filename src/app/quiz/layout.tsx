import "@/styles/assessment-theme.css";

export default function AssessmentLayout({ children }: { children: React.ReactNode }) {
  return <div className="ps-assessment-theme ps-assessment-route ps-exam-theme">{children}</div>;
}
