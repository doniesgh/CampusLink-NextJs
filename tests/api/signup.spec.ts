import { uniqueEmail } from '../support/accounts';
import { expect, expectError, expectSession, test } from '../support/api';
import { ACCESS_TOKEN_TTL_SECONDS } from '../support/env';
import { decodeJwt } from '../support/jwt';

test.describe('POST /api/auth/signup', () => {
  test('creates a STUDENT and returns a session, even when the body asks for ADMIN', async ({ api }) => {
    const email = uniqueEmail('signup');
    const res = await api.post('/api/auth/signup', {
      firstname: 'Sami',
      lastname: 'Ben Ali',
      email,
      password: 'Passw0rd-Test!',
      role: 'ADMIN',
    });

    expect(res.status).toBe(201);
    expectSession(res.body, {
      firstname: 'Sami',
      lastname: 'Ben Ali',
      email,
      role: 'STUDENT',
      twoFactorEnabled: false,
    });

    // Access token: subject = user id, payload { role }, lifetime JWT_ACCESS_TTL.
    const payload = decodeJwt(res.body.accessToken);
    expect(payload.sub).toBe(res.body.user.id);
    expect(payload.role).toBe('STUDENT');
    expect(Number(payload.exp) - Number(payload.iat)).toBe(ACCESS_TOKEN_TTL_SECONDS);

    // The token works and the stored account really is a STUDENT.
    const me = await api.get('/api/users/me', { token: res.body.accessToken });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: res.body.user.id, role: 'STUDENT' });
    expectError(await api.get('/api/users', { token: res.body.accessToken }), 403, 'FORBIDDEN');
  });

  test('400 MISSING_FIELDS lists every missing field', async ({ api }) => {
    const empty = await api.post('/api/auth/signup', {});
    expectError(empty, 400, 'MISSING_FIELDS');
    expect([...empty.body.details.fields].sort()).toEqual(['email', 'firstname', 'lastname', 'password']);

    const partial = await api.post('/api/auth/signup', { email: uniqueEmail(), password: 'Passw0rd-Test!' });
    expectError(partial, 400, 'MISSING_FIELDS');
    expect([...partial.body.details.fields].sort()).toEqual(['firstname', 'lastname']);
  });

  test('400 VALIDATION_ERROR for a password shorter than 8 characters', async ({ api }) => {
    const res = await api.post('/api/auth/signup', {
      firstname: 'Short',
      lastname: 'Password',
      email: uniqueEmail(),
      password: 'Ab1!xyz',
    });
    expectError(res, 400, 'VALIDATION_ERROR');
    expect(res.body.details).toEqual(expect.objectContaining({ password: expect.any(String) }));
  });

  test('400 VALIDATION_ERROR for an invalid email', async ({ api }) => {
    const res = await api.post('/api/auth/signup', {
      firstname: 'Bad',
      lastname: 'Email',
      email: 'not-an-email',
      password: 'Passw0rd-Test!',
    });
    expectError(res, 400, 'VALIDATION_ERROR');
    expect(res.body.details).toEqual(expect.objectContaining({ email: expect.any(String) }));
  });

  test('409 EMAIL_TAKEN when the email is already registered', async ({ api }) => {
    const existing = await api.signup();
    const res = await api.post('/api/auth/signup', {
      firstname: 'Second',
      lastname: 'Account',
      email: existing.email,
      password: 'Another-Passw0rd',
    });
    expectError(res, 409, 'EMAIL_TAKEN');
  });
});
