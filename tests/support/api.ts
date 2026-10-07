import { expect, test as base, type APIRequestContext } from '@playwright/test';
import { createAdmin, DEFAULT_PASSWORD, uniqueEmail } from './accounts';
import { API_URL, type Role } from './env';

/** `group` of a user (phase-1 contract, section 1); null for non-students and students without a group. */
export type UserGroup = {
  id: string;
  name: string;
  level: number;
  academicYear: string;
  program: { id: string; name: string; code: string };
};

export type User = {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  role: Role;
  twoFactorEnabled: boolean;
  locale: 'fr' | 'en';
  group: UserGroup | null;
  createdAt: string;
  updatedAt: string;
};
export type Session = { user: User; accessToken: string; refreshToken: string };
export type ErrorBody = { error: string; code: string; details?: Record<string, unknown> };
export type ApiResult<T = any> = { status: number; body: T; headers: Record<string, string> };
export type Account = Session & { email: string; password: string; firstname: string; lastname: string };
export type Credentials = { email: string; password: string };

type CallOptions = {
  token?: string;
  data?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
};

export const USER_KEYS = [
  'createdAt',
  'email',
  'firstname',
  'group',
  'id',
  'lastname',
  'locale',
  'role',
  'twoFactorEnabled',
  'updatedAt',
];

/** Keys that must never appear in any response body (secrets and internals). */
const FORBIDDEN_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'otp',
  'otpHash',
  'otpExpiresAt',
  'otpAttempts',
  'passwordResetHash',
  'passwordResetExpiresAt',
  'stack',
]);

/**
 * Paths of forbidden keys in a response body. The `details` of an error body is skipped:
 * by contract it is keyed by field name (e.g. `details.password = "at least 8 characters"`).
 */
function findForbiddenKeys(value: unknown, isErrorBody: boolean, path = '$', found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, false, `${path}[${index}]`, found));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (isErrorBody && path === '$' && key === 'details') continue;
      if (FORBIDDEN_KEYS.has(key)) found.push(`${path}.${key}`);
      findForbiddenKeys(item, false, `${path}.${key}`, found);
    }
  }
  return found;
}

/**
 * Thin client for the backend. Every response is checked against the contract's global rules
 * (JSON body, `{ error, code }` on errors, no secret keys); problems are collected in `problems`
 * and asserted when the test ends (see the `api` fixture).
 */
export class Api {
  readonly problems: string[] = [];

  constructor(private readonly request: APIRequestContext) {}

  get<T = any>(path: string, options?: CallOptions) {
    return this.call<T>('GET', path, options);
  }

  post<T = any>(path: string, data?: unknown, options?: CallOptions) {
    return this.call<T>('POST', path, { ...options, data });
  }

  patch<T = any>(path: string, data?: unknown, options?: CallOptions) {
    return this.call<T>('PATCH', path, { ...options, data });
  }

  delete<T = any>(path: string, options?: CallOptions) {
    return this.call<T>('DELETE', path, options);
  }

  async call<T = any>(method: string, path: string, { token, data, headers, params }: CallOptions = {}): Promise<ApiResult<T>> {
    const response = await this.request.fetch(`${API_URL}${path}`, {
      method,
      data,
      params,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      failOnStatusCode: false,
      maxRedirects: 0,
    });

    const status = response.status();
    const responseHeaders = response.headers();
    const text = await response.text();
    const label = `${method} ${path} -> ${status}`;
    let body: any;

    if (text === '') {
      if (status !== 204) this.problems.push(`${label}: empty body`);
    } else {
      const contentType = responseHeaders['content-type'] ?? '';
      if (!contentType.includes('application/json')) this.problems.push(`${label}: content-type "${contentType}" is not JSON`);
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
        this.problems.push(`${label}: body is not valid JSON`);
      }
    }

    const isError = status >= 400;
    if (isError && !(body && typeof body.error === 'string' && body.error && typeof body.code === 'string' && body.code)) {
      this.problems.push(`${label}: error body is not { error, code }: ${text.slice(0, 200)}`);
    }
    for (const key of findForbiddenKeys(body, isError)) {
      this.problems.push(`${label}: response exposes ${key}`);
    }

    return { status, body: body as T, headers: responseHeaders };
  }

  /** Public signup with a unique email; fails the test unless it answers 201. */
  async signup(overrides: Partial<Credentials & { firstname: string; lastname: string }> = {}): Promise<Account> {
    const input = {
      firstname: 'Test',
      lastname: 'User',
      email: uniqueEmail(),
      password: DEFAULT_PASSWORD,
      ...overrides,
    };
    const res = await this.post<Session>('/api/auth/signup', input);
    expect(res.status, `signup failed: ${JSON.stringify(res.body)}`).toBe(201);
    return { ...input, ...res.body };
  }

  /** Login of an account without 2FA; fails the test unless it returns a session. */
  async login(email: string, password: string): Promise<Session> {
    const res = await this.post<Session>('/api/auth/login', { email, password });
    expect(res.status, `login failed: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.accessToken, 'login returned no session').toEqual(expect.any(String));
    return res.body;
  }

  async enableTwoFactor(accessToken: string): Promise<void> {
    const res = await this.patch<User>('/api/users/me', { twoFactorEnabled: true }, { token: accessToken });
    expect(res.status, `enabling 2FA failed: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.twoFactorEnabled).toBe(true);
  }
}

export function expectError(res: ApiResult, status: number, code: string): void {
  expect(res.status, `expected ${status} ${code}, got ${res.status} ${JSON.stringify(res.body)}`).toBe(status);
  expect(res.body).toMatchObject({ code, error: expect.any(String) });
  expect((res.body as ErrorBody).error.length).toBeGreaterThan(0);
}

/** A public user object: exactly the contract keys, with the expected values. */
export function expectUser(user: unknown, expected: Partial<User> = {}): void {
  expect(user).toEqual(expect.any(Object));
  expect(Object.keys(user as object).sort()).toEqual(USER_KEYS);
  expect(user).toMatchObject({
    id: expect.stringMatching(/^[a-f0-9]{24}$/),
    firstname: expect.any(String),
    lastname: expect.any(String),
    email: expect.any(String),
    role: expect.stringMatching(/^(STUDENT|TEACHER|ADMIN|ALUMNI)$/),
    twoFactorEnabled: expect.any(Boolean),
    locale: expect.stringMatching(/^(fr|en)$/),
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
    ...expected,
  });
}

export function expectSession(body: unknown, expectedUser: Partial<User> = {}): asserts body is Session {
  expect(Object.keys(body as object).sort()).toEqual(['accessToken', 'refreshToken', 'user']);
  const session = body as Session;
  expect(session.accessToken).toEqual(expect.any(String));
  expect(session.accessToken.split('.')).toHaveLength(3);
  expect(session.refreshToken).toEqual(expect.any(String));
  expect(session.refreshToken.length).toBeGreaterThanOrEqual(32);
  expectUser(session.user, expectedUser);
}

export const test = base.extend<{ api: Api }, { adminCredentials: Credentials }>({
  api: async ({ request }, use) => {
    const api = new Api(request);
    await use(api);
    expect(api.problems, 'every API response must be JSON, use { error, code } for errors and never expose secrets').toEqual([]);
  },
  // One ADMIN per worker, created with the backend's create-admin script.
  adminCredentials: [
    async ({}, use) => {
      const credentials = { email: uniqueEmail('admin'), password: 'Admin-Passw0rd!' };
      createAdmin(credentials.email, credentials.password);
      await use(credentials);
    },
    { scope: 'worker' },
  ],
});

export { expect };
