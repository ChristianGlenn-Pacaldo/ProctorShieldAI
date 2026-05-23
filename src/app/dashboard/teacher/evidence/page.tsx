import EvidenceContent from "./content";
import { getSession } from "@/lib/auth";

export default async function Page() {
  const session = await getSession();
  const userId = session?.userId || "unknown";

  return <EvidenceContent teacherId={userId} />;
}
