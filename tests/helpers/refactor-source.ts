import fs from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";

/** Bundle actual extracted modules while existing harnesses continue mocking external boundaries.
 * This prevents a structural extraction from silently replacing feature behavior with test stubs. */
export function refactorTestSource(file: string): string {
 const absolute=path.resolve(file);
 if (!absolute.includes(path.normalize("src/features/")) && !absolute.endsWith(path.normalize("src/app/api/quizzes/route.ts")) && !absolute.endsWith(path.normalize("src/app/dashboard/teacher/quizzes/content.tsx"))) return fs.readFileSync(absolute,"utf8");
 return buildSync({entryPoints:[absolute],bundle:true,write:false,format:"esm",platform:"node",target:"es2022",jsx:"automatic",logLevel:"silent",
 external:["@/lib/*","@/components/*","@prisma/client","server-only","node:*","react","react-dom","react/jsx-runtime","next/*","lucide-react"],
 }).outputFiles[0].text;
}
