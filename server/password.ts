// Password hashing for the `users` table. Uses Node's built-in scrypt — no
// new dependency, no native build step (avoids bcrypt/argon2 native bindings
// breaking the Docker build). Stored format: "<saltHex>:<hashHex>".
// Pattern copied from share-projects/marcow-crop/server/password.ts.
import crypto from "crypto";

const KEY_LEN = 64;

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, KEY_LEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const hash = crypto.scryptSync(plain, salt, KEY_LEN);
  const expected = Buffer.from(hashHex, "hex");
  if (hash.length !== expected.length) return false;
  return crypto.timingSafeEqual(hash, expected);
}
