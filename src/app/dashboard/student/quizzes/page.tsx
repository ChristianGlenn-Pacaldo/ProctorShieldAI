import { getSession } from "@/lib/auth";
import QuizzesContent from "./content";

export default async function Page() {
  const session = await getSession();
  return <QuizzesContent userId={session?.userId || ""} />;
}
