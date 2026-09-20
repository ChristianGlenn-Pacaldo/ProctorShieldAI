import { UserRound } from "lucide-react";
import { getStudentInitials } from "@/lib/student-identity";

interface ArenaIdentityProps {
  studentName?: string | null;
  initials?: string | null;
  className?: string;
}

export function ArenaIdentity({
  studentName,
  initials,
  className = "w-9 h-9 text-xs",
}: ArenaIdentityProps) {
  const stableInitials = initials || getStudentInitials(studentName);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-indigo-400/40 bg-indigo-500/20 font-black tracking-wide text-indigo-100 ${className}`}
      aria-label={`${studentName || "Student"} identity`}
      data-arena-identity={stableInitials || "generic"}
    >
      {stableInitials || <UserRound className="h-1/2 w-1/2" aria-hidden="true" />}
    </span>
  );
}
