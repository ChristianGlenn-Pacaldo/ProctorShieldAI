import { cpSync, existsSync, mkdirSync } from "node:fs";

if (!existsSync(".next/standalone/server.js")) {
  throw new Error("Standalone build not found. Run npm run build first.");
}

mkdirSync(".next/standalone/.next", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true, force: true });
if (existsSync("public")) {
  cpSync("public", ".next/standalone/public", { recursive: true, force: true });
}
