import { hash, verify } from "@node-rs/argon2";

// Auth.js ships no password hashing, so the Credentials provider needs its
// own. Argon2id with OWASP's minimum recommended parameters (19 MiB, t=2,
// p=1) - strong enough, and light enough for a serverless function's memory
// and cold-start budget.
//
// Node-only (native binding): import this from server code, never from a
// client component or middleware (middleware never needs it - JWT sessions
// mean it only ever reads the token).
const OPTIONS = {
  memoryCost: 19456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    // A malformed stored hash must read as "wrong password", never crash sign-in.
    return false;
  }
}

// A real hash of a random string, computed once. When the email doesn't
// exist we still run a verify against this, so "unknown email" and "wrong
// password" take about the same time - otherwise response time leaks which
// emails are registered.
let dummyHash: Promise<string> | null = null;
export async function burnVerifyTime(password: string): Promise<void> {
  dummyHash ??= hashPassword(crypto.randomUUID());
  await verifyPassword(await dummyHash, password);
}
