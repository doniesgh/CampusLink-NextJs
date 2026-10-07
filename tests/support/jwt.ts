import crypto from 'node:crypto';

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

/** Decodes a JWT payload WITHOUT verifying it (tests only). */
export function decodeJwt(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error(`Not a JWT: ${token}`);
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

/** Signs an HS256 JWT, e.g. to build an expired access token with the test secret. */
export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

/** An access token for `userId` that expired one hour ago, signed with `secret`. */
export function expiredAccessToken(userId: string, role: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ role, sub: userId, iat: now - 2 * 3600, exp: now - 3600 }, secret);
}
