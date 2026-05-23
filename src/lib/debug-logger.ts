import fs from "fs";
import path from "path";

export function logDebug(msg: string) {
  try {
    const logPath = path.join(process.cwd(), "debug.log");
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {
    console.error("Failed to write to debug.log:", e);
  }
}
