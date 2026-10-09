import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with Node's built-in scrypt (no native dependency, runs on
 * Vercel and in scripts alike). Stored as "scrypt$N$r$p$salt$hash" so the cost
 * can be raised later without breaking existing hashes.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 10;

function derive(password: string, salt: Buffer, opts: ScryptOptions, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, length, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P }, KEY_LENGTH);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = stored?.split("$");
  if (!parts || parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltText, keyText] = parts;
  const expected = Buffer.from(keyText, "base64url");
  const key = await derive(password, Buffer.from(saltText, "base64url"), { N: Number(n), r: Number(r), p: Number(p) }, expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Why a new password is refused, or null when it's acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Password harus berisi huruf dan angka.";
  return null;
}

/** A temporary password an admin hands over (no look-alike characters); the user must change it at first sign-in. */
export function generateTemporaryPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const pick = (set: string, n: number) => Array.from({ length: n }, () => set[randomInt(set.length)]).join("");
  return `${pick(letters, 4)}-${pick(digits, 4)}-${pick(letters, 4)}`;
}
