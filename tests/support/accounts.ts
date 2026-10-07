import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { BACKEND_DIR, MONGO_URI } from './env';

/** A unique, lowercase email address for this test (the backend stores emails lowercased). */
export function uniqueEmail(prefix = 'user'): string {
  const id = `${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
  return `${prefix}-${id}@campuslink.test`.toLowerCase();
}

export const DEFAULT_PASSWORD = 'Passw0rd-Test!';

/**
 * Creates (or promotes) an ADMIN account in the test database with the backend's own script:
 * `npm run create-admin -- <email> <password> [firstname] [lastname]`.
 * MONGO_URI is passed explicitly, so backend/.env (the developer database) is never used.
 */
export function createAdmin(email: string, password: string, firstname = 'Ada', lastname = 'Admin'): void {
  try {
    execFileSync(process.execPath, [path.join('scripts', 'create-admin.js'), email, password, firstname, lastname], {
      cwd: BACKEND_DIR,
      env: { ...process.env, MONGO_URI },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 60_000,
    });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    throw new Error(`create-admin failed for ${email}:\n${stdout ?? ''}${stderr ?? ''}`);
  }
}
