import { expect, expectError, test } from '../support/api';

test.describe('General API behaviour', () => {
  test('GET /api/health answers 200 { status: "ok" }', async ({ api }) => {
    const res = await api.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('unknown routes answer 404 NOT_FOUND', async ({ api }) => {
    expectError(await api.get('/api/does-not-exist'), 404, 'NOT_FOUND');
    expectError(await api.post('/api/auth/does-not-exist', {}), 404, 'NOT_FOUND');
    expectError(await api.delete('/api/nothing/here'), 404, 'NOT_FOUND');
  });

  test('a malformed JSON body answers 400 INVALID_JSON', async ({ api }) => {
    const res = await api.post('/api/auth/login', '{"email": "broken@campuslink.test", "password": ', {
      headers: { 'Content-Type': 'application/json' },
    });
    expectError(res, 400, 'INVALID_JSON');
  });

  test('an invalid ObjectId answers 400 INVALID_ID', async ({ api, adminCredentials }) => {
    const admin = await api.login(adminCredentials.email, adminCredentials.password);
    expectError(await api.get('/api/users/not-an-object-id', { token: admin.accessToken }), 400, 'INVALID_ID');
  });
});
