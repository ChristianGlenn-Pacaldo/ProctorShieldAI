import bcrypt from "bcryptjs";

export const STRICT_PASSWORD_HASH_PREFIX = "psai:pw:v1:";
export const PASSWORD_HASH_COST = 12;

// Canonical bcrypt encoding: 16-byte salt and 23-byte checksum padding bits.
const STRICT_PAYLOAD = /^\$2b\$12\$[./A-Za-z0-9]{21}[.Oeu][./A-Za-z0-9]{30}[.CGKOSWaeimquy26]$/;
const LEGACY_PAYLOAD = /^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{21}[.Oeu][./A-Za-z0-9]{30}[.CGKOSWaeimquy26]$/;

export function isStrictPasswordInput(password: unknown): password is string {
  return typeof password === "string" && !password.includes("\0") && !bcrypt.truncates(password);
}

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string") throw new Error("Password must be a string");
  if (password.includes("\0")) throw new Error("Password must not contain NUL characters");
  if (bcrypt.truncates(password)) throw new Error("Password must not exceed 72 UTF-8 bytes");
  const payload = await bcrypt.hash(password, PASSWORD_HASH_COST);
  if (payload.length !== 60 || !STRICT_PAYLOAD.test(payload)) throw new Error("Invalid password hash output");
  return STRICT_PASSWORD_HASH_PREFIX + payload;
}

export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  if (typeof password !== "string" || typeof hashed !== "string") return false;
  let payload: string;
  if (hashed.startsWith(STRICT_PASSWORD_HASH_PREFIX)) {
    if (hashed.length !== STRICT_PASSWORD_HASH_PREFIX.length + 60) return false;
    payload = hashed.slice(STRICT_PASSWORD_HASH_PREFIX.length);
    if (!STRICT_PAYLOAD.test(payload) || !isStrictPasswordInput(password)) return false;
  } else {
    // Never upgrade a legacy record during verification or apply the new input policy.
    if (hashed.length !== 60 || !LEGACY_PAYLOAD.test(hashed)) return false;
    payload = hashed;
  }
  try {
    return await bcrypt.compare(password, payload);
  } catch {
    return false;
  }
}
