import crypto from 'node:crypto';
import path from 'node:path';

/**
 * Fixed settings of the test environment. Every server is started by playwright.config.ts
 * on these ports, never on the development ports (3000 / 4000 / 27017).
 */
export const MONGO_PORT = 27018;
export const API_PORT = 4100;
export const WEB_PORT = 3100;
/** Second backend, used only by api/security.spec.ts: rate limiting ON (3 attempts) and VAPID keys set. */
export const SECURITY_API_PORT = 4101;

export const MONGO_URI = `mongodb://127.0.0.1:${MONGO_PORT}/campuslink-test`;
export const SECURITY_MONGO_URI = `mongodb://127.0.0.1:${MONGO_PORT}/campuslink-test-security`;
export const API_URL = `http://localhost:${API_PORT}`;
export const SECURITY_API_URL = `http://localhost:${SECURITY_API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const RATE_LIMIT_AUTH_MAX = 3;
/** Per-IP limits of the security backend: above the logins the other security tests send from loopback. */
export const RATE_LIMIT_IP_MAX = 30;
export const RATE_LIMIT_RESET_MAX = 5;

export const JWT_SECRET = 'test-secret';
/** Lower than the production default (5) so the lockout test stays short. */
export const OTP_MAX_ATTEMPTS = 3;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export const TESTS_DIR = path.resolve(__dirname, '..');
export const ROOT_DIR = path.resolve(TESTS_DIR, '..');
export const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
export const NEXT_DIR = path.join(ROOT_DIR, 'next');
export const TMP_DIR = path.join(TESTS_DIR, '.tmp');
export const OUTBOX_FILE = path.join(TMP_DIR, 'outbox.jsonl');
/** Pushes are written there (PUSH_OUTBOX_FILE), never sent. */
export const PUSH_OUTBOX_FILE = path.join(TMP_DIR, 'push-outbox.jsonl');
/** Uploaded files (STORAGE_DIR), never backend/uploads. */
export const STORAGE_DIR = path.join(TMP_DIR, 'uploads');

/**
 * Test-only VAPID key pair (P-256, derived from a fixed seed, so every worker knows it).
 * Only the security backend gets it: the main backend keeps push disabled (503 PUSH_DISABLED).
 */
export const TEST_VAPID = (() => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(crypto.createHash('sha256').update('campuslink-test-vapid').digest());
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: ecdh.getPrivateKey().toString('base64url') };
})();

export const ROLES = ['STUDENT', 'TEACHER', 'ADMIN', 'ALUMNI'] as const;
export type Role = (typeof ROLES)[number];
