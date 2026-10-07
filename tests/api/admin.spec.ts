import { DEFAULT_PASSWORD, uniqueEmail } from '../support/accounts';
import type { Api, User } from '../support/api';
import { expect, expectError, expectUser, test } from '../support/api';
import { ROLES } from '../support/env';

// Tests in this file run one after another in a single worker (Playwright's default for a file),
// and only this file creates TEACHER / ALUMNI accounts, so their counts are predictable.

let adminToken: string;
let adminId: string;

test.beforeEach(async ({ api, adminCredentials }) => {
  const session = await api.login(adminCredentials.email, adminCredentials.password);
  expect(session.user.role).toBe('ADMIN');
  adminToken = session.accessToken;
  adminId = session.user.id;
});

/** Creates a user through the admin API (password DEFAULT_PASSWORD unless given). */
async function createUser(api: Api, body: Record<string, unknown> = {}): Promise<User> {
  const input = { firstname: 'Created', lastname: 'ByAdmin', email: uniqueEmail('created'), password: DEFAULT_PASSWORD, ...body };
  const res = await api.post<User>('/api/users', input, { token: adminToken });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

test.describe('Admin routes are protected', () => {
  test('403 FORBIDDEN for a student on every admin route', async ({ api }) => {
    const student = await api.signup();
    const token = student.accessToken;
    const someId = student.user.id;

    expectError(await api.get('/api/users', { token }), 403, 'FORBIDDEN');
    expectError(await api.get('/api/users/stats', { token }), 403, 'FORBIDDEN');
    expectError(await api.post('/api/users', { firstname: 'A', lastname: 'B', email: uniqueEmail(), password: DEFAULT_PASSWORD }, { token }), 403, 'FORBIDDEN');
    expectError(await api.get(`/api/users/${someId}`, { token }), 403, 'FORBIDDEN');
    expectError(await api.patch(`/api/users/${someId}`, { role: 'ADMIN' }, { token }), 403, 'FORBIDDEN');
    expectError(await api.delete(`/api/users/${someId}`, { token }), 403, 'FORBIDDEN');

    // Nothing changed.
    const me = await api.get('/api/users/me', { token });
    expect(me.body.role).toBe('STUDENT');
  });

  test('401 AUTH_REQUIRED without a token', async ({ api }) => {
    expectError(await api.get('/api/users'), 401, 'AUTH_REQUIRED');
    expectError(await api.get('/api/users/stats'), 401, 'AUTH_REQUIRED');
  });
});

test.describe('GET /api/users', () => {
  test('lists users newest first with default pagination', async ({ api }) => {
    // Make sure more than one default page of users exists. Other workers keep signing up users
    // while this runs (users are never removed concurrently), so `total` is only a lower bound.
    const probe = await api.get('/api/users', { token: adminToken, params: { limit: 1 } });
    for (let i = probe.body.total; i < 21; i += 1) await createUser(api);
    const newest = await createUser(api);

    const res = await api.get('/api/users', { token: adminToken });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['items', 'limit', 'page', 'total']);
    expect(res.body).toMatchObject({ page: 1, limit: 20 });
    expect(res.body.total).toBeGreaterThanOrEqual(22);
    expect(res.body.items).toHaveLength(20);
    res.body.items.forEach((user: unknown) => expectUser(user));
    // Newest first: our latest account is on the first page (only parallel signups can be newer).
    expect(res.body.items.map((user: User) => user.id)).toContain(newest.id);

    const dates = res.body.items.map((user: User) => Date.parse(user.createdAt));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  test('paginates, filters by role and email, caps limit at 100; 400 INVALID_ROLE', async ({ api }) => {
    const created = [];
    for (let i = 0; i < 3; i += 1) created.push(await createUser(api, { role: 'ALUMNI', firstname: `Alumnus${i}` }));
    const [first, second, third] = created;

    const page1 = await api.get('/api/users', { token: adminToken, params: { role: 'ALUMNI', page: 1, limit: 2 } });
    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({ page: 1, limit: 2 });
    expect(page1.body.total).toBeGreaterThanOrEqual(3);
    expect(page1.body.items.map((user: User) => user.id)).toEqual([third.id, second.id]);
    page1.body.items.forEach((user: User) => expect(user.role).toBe('ALUMNI'));

    const page2 = await api.get('/api/users', { token: adminToken, params: { role: 'ALUMNI', page: 2, limit: 2 } });
    expect(page2.status).toBe(200);
    expect(page2.body).toMatchObject({ page: 2, limit: 2, total: page1.body.total });
    expect(page2.body.items[0].id).toBe(first.id);

    const byEmail = await api.get('/api/users', { token: adminToken, params: { email: second.email } });
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.total).toBe(1);
    expect(byEmail.body.items.map((user: User) => user.id)).toEqual([second.id]);

    const capped = await api.get('/api/users', { token: adminToken, params: { limit: 1000 } });
    expect(capped.status).toBe(200);
    expect(capped.body.limit).toBe(100);
    expect(capped.body.items.length).toBeLessThanOrEqual(100);

    expectError(await api.get('/api/users', { token: adminToken, params: { role: 'SUPERUSER' } }), 400, 'INVALID_ROLE');
  });
});

test.describe('GET /api/users/stats', () => {
  test('counts users per role', async ({ api }) => {
    const before = await api.get('/api/users/stats', { token: adminToken });
    expect(before.status).toBe(200);
    expect(Object.keys(before.body).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) expect(Number.isInteger(before.body[role])).toBe(true);
    expect(before.body.ADMIN).toBeGreaterThanOrEqual(1);

    await createUser(api, { role: 'TEACHER' });
    await createUser(api, { role: 'ALUMNI' });

    const after = await api.get('/api/users/stats', { token: adminToken });
    expect(after.body.TEACHER).toBe(before.body.TEACHER + 1);
    expect(after.body.ALUMNI).toBe(before.body.ALUMNI + 1);
    expect(after.body.STUDENT).toBeGreaterThanOrEqual(before.body.STUDENT);
  });
});

test.describe('POST /api/users', () => {
  test('creates a STUDENT by default, or the given role; the account can log in', async ({ api }) => {
    const student = await createUser(api, { firstname: 'Default' });
    expectUser(student, { role: 'STUDENT', firstname: 'Default', twoFactorEnabled: false });

    const teacher = await createUser(api, { role: 'TEACHER' });
    expectUser(teacher, { role: 'TEACHER' });

    const session = await api.login(teacher.email, DEFAULT_PASSWORD);
    expect(session.user).toMatchObject({ id: teacher.id, role: 'TEACHER' });
  });

  test('400 MISSING_FIELDS and 409 EMAIL_TAKEN', async ({ api }) => {
    const missing = await api.post('/api/users', { firstname: 'No', lastname: 'Email' }, { token: adminToken });
    expectError(missing, 400, 'MISSING_FIELDS');
    expect([...missing.body.details.fields].sort()).toEqual(['email', 'password']);

    const existing = await createUser(api);
    expectError(
      await api.post('/api/users', { firstname: 'Dup', lastname: 'Licate', email: existing.email, password: DEFAULT_PASSWORD }, { token: adminToken }),
      409,
      'EMAIL_TAKEN'
    );
  });
});

test.describe('GET /api/users/:id', () => {
  test('returns the user, 404 USER_NOT_FOUND for an unknown id, 400 INVALID_ID for a bad id', async ({ api }) => {
    const user = await createUser(api, { firstname: 'Fetched' });

    const res = await api.get(`/api/users/${user.id}`, { token: adminToken });
    expect(res.status).toBe(200);
    expectUser(res.body, { id: user.id, firstname: 'Fetched', email: user.email });

    expectError(await api.get('/api/users/0123456789abcdef01234567', { token: adminToken }), 404, 'USER_NOT_FOUND');
    expectError(await api.get('/api/users/12345', { token: adminToken }), 400, 'INVALID_ID');
  });
});

test.describe('PATCH /api/users/:id', () => {
  test('updates profile fields and role', async ({ api }) => {
    const user = await createUser(api);
    const res = await api.patch(
      `/api/users/${user.id}`,
      { firstname: 'Renamed', lastname: 'Person', role: 'TEACHER', twoFactorEnabled: true },
      { token: adminToken }
    );
    expect(res.status).toBe(200);
    expectUser(res.body, { id: user.id, firstname: 'Renamed', lastname: 'Person', role: 'TEACHER', twoFactorEnabled: true });

    const fetched = await api.get(`/api/users/${user.id}`, { token: adminToken });
    expect(fetched.body).toMatchObject({ firstname: 'Renamed', role: 'TEACHER', twoFactorEnabled: true });
  });

  test('changes the email; the account then logs in with the new address', async ({ api }) => {
    const user = await createUser(api);
    const newEmail = uniqueEmail('moved');

    const res = await api.patch(`/api/users/${user.id}`, { email: newEmail }, { token: adminToken });
    expect(res.status).toBe(200);
    expectUser(res.body, { id: user.id, email: newEmail });

    await api.login(newEmail, DEFAULT_PASSWORD);
    expectError(await api.post('/api/auth/login', { email: user.email, password: DEFAULT_PASSWORD }), 401, 'INVALID_CREDENTIALS');
  });

  test('changing the password revokes the user sessions; the new password works', async ({ api }) => {
    const user = await createUser(api);
    const session = await api.login(user.email, DEFAULT_PASSWORD);
    const newPassword = 'Admin-Set-Passw0rd';

    const res = await api.patch(`/api/users/${user.id}`, { password: newPassword }, { token: adminToken });
    expect(res.status).toBe(200);
    expectUser(res.body, { id: user.id });

    expectError(await api.post('/api/auth/refresh', { refreshToken: session.refreshToken }), 401, 'INVALID_REFRESH_TOKEN');
    expectError(await api.post('/api/auth/login', { email: user.email, password: DEFAULT_PASSWORD }), 401, 'INVALID_CREDENTIALS');
    await api.login(user.email, newPassword);
  });

  test('400 NO_CHANGES without an allowed field, 404 USER_NOT_FOUND, 400 INVALID_ID', async ({ api }) => {
    const user = await createUser(api);
    expectError(await api.patch(`/api/users/${user.id}`, {}, { token: adminToken }), 400, 'NO_CHANGES');
    expectError(await api.patch(`/api/users/${user.id}`, { unknownField: 'x' }, { token: adminToken }), 400, 'NO_CHANGES');
    expectError(await api.patch('/api/users/0123456789abcdef01234567', { firstname: 'X' }, { token: adminToken }), 404, 'USER_NOT_FOUND');
    expectError(await api.patch('/api/users/nope', { firstname: 'X' }, { token: adminToken }), 400, 'INVALID_ID');
  });
});

test.describe('DELETE /api/users/:id', () => {
  test('deletes the user and revokes their tokens', async ({ api }) => {
    const user = await createUser(api);
    const session = await api.login(user.email, DEFAULT_PASSWORD);

    const res = await api.delete(`/api/users/${user.id}`, { token: adminToken });
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();

    expectError(await api.get(`/api/users/${user.id}`, { token: adminToken }), 404, 'USER_NOT_FOUND');
    expectError(await api.post('/api/auth/refresh', { refreshToken: session.refreshToken }), 401, 'INVALID_REFRESH_TOKEN');
    // An access token of a deleted user is no longer accepted.
    expectError(await api.get('/api/users/me', { token: session.accessToken }), 401, 'INVALID_TOKEN');
    expectError(await api.post('/api/auth/login', { email: user.email, password: DEFAULT_PASSWORD }), 401, 'INVALID_CREDENTIALS');
  });

  test('400 CANNOT_DELETE_SELF when an admin targets their own account', async ({ api }) => {
    expectError(await api.delete(`/api/users/${adminId}`, { token: adminToken }), 400, 'CANNOT_DELETE_SELF');
    const me = await api.get('/api/users/me', { token: adminToken });
    expect(me.status).toBe(200);
  });
});
