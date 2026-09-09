// Pure-JS bcrypt, not a native binding: Edge Functions run in a Deno
// isolate with no node-gyp/native-addon support, which rules out the usual
// native bcrypt package.
import bcrypt from "npm:bcryptjs@2.4.3";

const COST_FACTOR = 12;

// Compared against when no user was found, so a login attempt against a
// nonexistent email still pays the same bcrypt cost as a real one instead
// of returning early - otherwise response timing alone reveals which
// emails have accounts.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", COST_FACTOR);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST_FACTOR);
}

export function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  return bcrypt.compare(password, hash ?? DUMMY_HASH);
}
