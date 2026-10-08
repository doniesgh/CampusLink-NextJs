import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { createAdmin, uniqueEmail } from '../support/accounts';
import {
  API_PORT,
  API_URL,
  BACKEND_DIR,
  JWT_SECRET,
  MONGO_URI,
  NEXT_DIR,
  PUSH_OUTBOX_FILE,
  RATE_LIMIT_AUTH_MAX,
  RATE_LIMIT_BOOKING_MAX,
  RATE_LIMIT_IP_MAX,
  RATE_LIMIT_PHASE3_MAX,
  RATE_LIMIT_RESET_MAX,
  SECURITY_API_URL,
  SECURITY_MONGO_URI,
  STORAGE_DIR,
  TEST_VAPID,
  TMP_DIR,
  WEB_URL,
} from '../support/env';
import { decodeJwt, expiredAccessToken, signJwt } from '../support/jwt';
import { extractResetLink, mailsTo, waitForMail } from '../support/outbox';

/**
 * Security checks of phases 1 to 3 (one file, no functional coverage): authorization, IDOR, mass assignment,
 * uploads, injection, secret leaks, rate limiting, the web app's BFF / redirects / headers, and (phase 3) the
 * Socket.IO real-time layer, carpooling privacy and seats, marketplace files and wallets, alumni consent and GDPR.
 * Backends: 4100 (main, rate limiting off, Socket.IO) and 4101 (rate limiting on, test VAPID keys); Next.js on 3100.
 */

type Res = { status: number; body: any; text: string; headers: Record<string, string>; url: string };
type CallOptions = { token?: string; json?: unknown; form?: FormData; headers?: Record<string, string>; base?: string };
type Person = { id: string; email: string; password: string; token: string; refreshToken: string };
type Endpoint = { method: string; path: string; json?: unknown; form?: () => FormData };

const AUTH_PATHS = /^\/api\/auth\/(signup|login|refresh|verify-otp)$/;
const CALENDAR_LINK_PATHS = /^\/api\/timetable\/me\/calendar-link(\/reset)?$/;
const WEB_ORIGIN = new URL(WEB_URL).origin;
const rand = () => crypto.randomBytes(4).toString('hex');
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let ctx: APIRequestContext;

/**
 * Every JSON answer of this file, and the secret values that must never appear in one, are appended to
 * tests/.tmp (reset at each run by scripts/test-db.mjs): Playwright restarts the worker after a failed
 * test, so memory alone would lose them before the final "leaks" test scans them.
 */
const RECORD_FILE = path.join(TMP_DIR, 'security-answers.jsonl');
type Answer = { kind: 'answer'; label: string; path: string; text: string; isError: boolean };
type Secret = { kind: 'secret'; label: string; value: string; allowedIn?: string };
const record = (entry: Answer | Secret) => fs.appendFileSync(RECORD_FILE, `${JSON.stringify(entry)}\n`);
const secret = (label: string, value: string, allowedIn?: RegExp) => {
  record({ kind: 'secret', label, value, allowedIn: allowedIn?.source });
  return value;
};

async function call(method: string, url: string, { token, json, form, headers = {}, base = API_URL }: CallOptions = {}): Promise<Res> {
  const full = url.startsWith('http') ? url : `${base}${url}`;
  const response = await ctx.fetch(full, {
    method,
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(json !== undefined ? { data: json } : {}),
    ...(form ? { multipart: form } : {}),
    failOnStatusCode: false,
    maxRedirects: 0,
    timeout: 180_000,
  });
  const status = response.status();
  const text = await response.text();
  const responseHeaders = response.headers();
  let body: any = text;
  if ((responseHeaders['content-type'] ?? '').includes('application/json') && text) {
    body = JSON.parse(text);
    const where = new URL(full);
    record({ kind: 'answer', label: `${method} ${where.host}${where.pathname} -> ${status}`, path: where.pathname, text, isError: status >= 400 });
  }
  return { status, body, text, headers: responseHeaders, url: full };
}

/** Records "<label>: expected …, got …" in `failures` when the answer is not `status` (+ `code`). */
function expectAnswer(failures: string[], label: string, res: Res, status: number, code?: string) {
  if (res.status !== status || (code !== undefined && res.body?.code !== code)) {
    failures.push(`${label}: expected ${status} ${code ?? ''}, got ${res.status} ${res.body?.code ?? String(res.text).slice(0, 100)}`);
  }
}

async function login(email: string, password: string, base = API_URL) {
  const res = await call('POST', '/api/auth/login', { json: { email, password }, base });
  expect(res.status, `login ${email}: ${res.text}`).toBe(200);
  secret('access token', res.body.accessToken, AUTH_PATHS);
  secret('refresh token', res.body.refreshToken, AUTH_PATHS);
  return { id: res.body.user.id as string, token: res.body.accessToken as string, refreshToken: res.body.refreshToken as string };
}

async function createUser(adminToken: string, role: string, group?: string, names: { firstname?: string; lastname?: string } = {}): Promise<Person> {
  const email = uniqueEmail(`sec-${role.toLowerCase()}`);
  const password = secret('password', `Sec-${rand()}-Passw0rd!`);
  const res = await call('POST', '/api/users', {
    token: adminToken,
    json: { firstname: names.firstname ?? 'Sec', lastname: names.lastname ?? role, email, password, role, ...(group ? { group } : {}) },
  });
  expect(res.status, `create ${role}: ${res.text}`).toBe(201);
  return { email, password, ...(await login(email, password)) };
}

const file = (name: string, type: string, content: string | Buffer) =>
  new File([new Uint8Array(typeof content === 'string' ? Buffer.from(content) : content)], name, { type });
const pdf = (marker: string) => Buffer.from(`%PDF-1.4\n% ${marker}\n%%EOF\n`);

function announcementForm(data: Record<string, unknown>, files: File[]) {
  const form = new FormData();
  form.append('data', JSON.stringify(data));
  files.forEach((item) => form.append('attachments', item));
  return form;
}

const announce = (token: string, data: Record<string, unknown>, files: File[] = []) =>
  files.length > 0
    ? call('POST', '/api/announcements', { token, form: announcementForm(data, files) })
    : call('POST', '/api/announcements', { token, json: data });

async function waitFor<T>(probe: () => Promise<T | undefined>, what: string, timeout = 15_000): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await pause(250);
  }
}

const feedIds = async (token: string) =>
  ((await call('GET', '/api/announcements?limit=100', { token })).body.items as { id: string }[]).map((item) => item.id);

const calendarToken = (url: string) => /\/api\/timetable\/ics\/([^/]+)\.ics$/.exec(url)?.[1] ?? '';

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .map((name) => path.join(dir, name))
    .filter((item) => fs.statSync(item).isFile());
}

/**
 * Runs `code` (body of an async function, `db` = the main test database) with the backend's own mongoose, and
 * returns what it writes to stdout. MONGO_URI is passed explicitly: backend/.env (the developer database) is never used.
 */
function withTestDb(code: string, env: Record<string, string> = {}): string {
  const script = `const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  try { ${code} } finally { await mongoose.disconnect(); }
})().catch((error) => { console.error(error); process.exit(1); });`;
  return execFileSync(process.execPath, ['-'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, MONGO_URI, ...env },
    input: script,
    encoding: 'utf8',
    timeout: 60_000,
  }).trim();
}

/** Lines of the main backend's push outbox (PUSH_OUTBOX_FILE): one per push the backend would send. */
const pushOutbox = (): { userId: string; endpoint: string | null }[] =>
  fs.existsSync(PUSH_OUTBOX_FILE)
    ? fs.readFileSync(PUSH_OUTBOX_FILE, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : [];

/** How the backend sees a request coming from Next.js on this machine. */
const LOOPBACK = /^(::1|127(\.\d{1,3}){3}|::ffff:127(\.\d{1,3}){3})$/;

/** A "YYYY-MM-DD" day in the campus timezone. */
const campusDay = (offsetDays: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + offsetDays * 86_400_000)
  );

// ---------------------------------------------------------------- shared data (one set per worker)

let w: {
  admin: Person;
  teacher1: Person; // teaches g1
  teacher2: Person; // teaches g2
  studentA: Person; // g1
  studentB: Person; // g2
  studentC: Person; // no group
  alumni: Person;
  programId: string;
  g1: string;
  g2: string;
  subjectId: string;
  roomId: string;
  sessionA: string;
  sessionB: string;
  day: string;
};

test.beforeAll(async ({ playwright }, testInfo) => {
  testInfo.setTimeout(180_000);
  ctx = await playwright.request.newContext();

  const adminEmail = uniqueEmail('sec-admin');
  const adminPassword = secret('password', `Sec-${rand()}-Admin-Passw0rd!`);
  createAdmin(adminEmail, adminPassword);
  const admin = { email: adminEmail, password: adminPassword, ...(await login(adminEmail, adminPassword)) };
  const tag = rand().toUpperCase();
  const create = async (resource: string, json: Record<string, unknown>) => {
    const res = await call('POST', `/api/academic/${resource}`, { token: admin.token, json });
    expect(res.status, `create ${resource}: ${res.text}`).toBe(201);
    return res.body.id as string;
  };
  const programId = await create('programs', { name: `Security ${tag}`, code: `SEC${tag}` });
  const g1 = await create('groups', { name: `SEC-${tag}-1`, level: 4, academicYear: '2026-2027', program: programId });
  const g2 = await create('groups', { name: `SEC-${tag}-2`, level: 4, academicYear: '2026-2027', program: programId });
  const subjectId = await create('subjects', { name: `Security ${tag}`, code: `SEC${tag}` });
  const roomId = await create('rooms', { name: `SEC-${tag}` });

  const [teacher1, teacher2, studentA, studentB, studentC, alumni] = await Promise.all([
    createUser(admin.token, 'TEACHER'),
    createUser(admin.token, 'TEACHER'),
    createUser(admin.token, 'STUDENT', g1),
    createUser(admin.token, 'STUDENT', g2),
    createUser(admin.token, 'STUDENT'),
    createUser(admin.token, 'ALUMNI'),
  ]);

  // One evening session per group (own teachers and groups, no room: never conflicts with other tests).
  const day = campusDay(3);
  const session = async (teacher: string, group: string) => {
    const res = await call('POST', '/api/timetable/sessions', {
      token: admin.token,
      json: { subject: subjectId, teacher, groups: [group], startsAt: `${day}T18:00`, endsAt: `${day}T19:30` },
    });
    expect(res.status, `create session: ${res.text}`).toBe(201);
    return res.body.items[0].id as string;
  };
  const sessionA = await session(teacher1.id, g1);
  const sessionB = await session(teacher2.id, g2);

  w = { admin, teacher1, teacher2, studentA, studentB, studentC, alumni, programId, g1, g2, subjectId, roomId, sessionA, sessionB, day };
});

test.afterAll(async () => {
  await ctx?.dispose();
});

// ---------------------------------------------------------------- authorization

test('admin-only and manager-only endpoints refuse STUDENT and ALUMNI (403), TEACHER where admin-only (403) and anonymous calls (401)', async () => {
  const published = await announce(w.admin.token, { title: `Everyone ${rand()}`, body: 'Visible to all', action: 'publish' });
  expect(published.status, published.text).toBe(201);
  const annId = published.body.id;
  const csv = () => {
    const form = new FormData();
    form.append('file', file('timetable.csv', 'text/csv', 'date,start,end,subject_code,teacher_email,groups\n'));
    form.append('dryRun', 'true');
    return form;
  };
  const { programId: p, g1, subjectId: s, roomId: r, sessionA: sid } = w;
  const uid = w.studentB.id;

  const academic: [string, string, Record<string, unknown>][] = [
    ['programs', p, { name: 'Forbidden', code: `NO${rand()}` }],
    ['groups', g1, { name: 'Forbidden', level: 4, academicYear: '2026-2027', program: p }],
    ['subjects', s, { name: 'Forbidden', code: `NO${rand()}` }],
    ['rooms', r, { name: `NO-${rand()}` }],
  ];
  const adminOnly: Endpoint[] = [
    ...academic.flatMap(([plural, id, created]): Endpoint[] => [
      { method: 'POST', path: `/api/academic/${plural}`, json: created },
      { method: 'PATCH', path: `/api/academic/${plural}/${id}`, json: { name: 'Hacked' } },
      { method: 'DELETE', path: `/api/academic/${plural}/${id}` },
    ]),
    { method: 'GET', path: '/api/audit' },
    { method: 'GET', path: '/api/audit/actions' },
    { method: 'GET', path: '/api/users' },
    { method: 'GET', path: '/api/users/stats' },
    { method: 'POST', path: '/api/users', json: { firstname: 'X', lastname: 'Y', email: uniqueEmail('forbidden'), password: 'Passw0rd-Forbidden', role: 'ADMIN' } },
    { method: 'GET', path: `/api/users/${uid}` },
    { method: 'PATCH', path: `/api/users/${uid}`, json: { role: 'ADMIN' } },
    { method: 'DELETE', path: `/api/users/${uid}` },
    {
      method: 'POST',
      path: '/api/timetable/sessions',
      json: { subject: s, teacher: w.teacher1.id, groups: [g1], startsAt: `${w.day}T20:00`, endsAt: `${w.day}T21:00` },
    },
    { method: 'PATCH', path: `/api/timetable/sessions/${sid}`, json: { status: 'CANCELLED' } },
    { method: 'DELETE', path: `/api/timetable/sessions/${sid}` },
    { method: 'POST', path: '/api/timetable/import', form: csv },
  ];
  const managers: Endpoint[] = [
    { method: 'GET', path: '/api/announcements/manage' },
    { method: 'POST', path: '/api/announcements', json: { title: 'Forbidden', body: 'x', action: 'publish' } },
    { method: 'POST', path: '/api/announcements', form: () => announcementForm({ title: 'Forbidden', body: 'x' }, [file('a.txt', 'text/plain', 'x')]) },
    { method: 'POST', path: '/api/announcements/audience-preview', json: { audience: {} } },
    { method: 'PATCH', path: `/api/announcements/${annId}`, json: { title: 'Hacked' } },
    { method: 'DELETE', path: `/api/announcements/${annId}` },
    { method: 'POST', path: `/api/announcements/${annId}/publish` },
    { method: 'GET', path: `/api/announcements/${annId}/stats` },
  ];

  const failures: string[] = [];
  const attempt = async (who: string, token: string | undefined, ep: Endpoint, status: number, code: string) => {
    const res = await call(ep.method, ep.path, { token, json: ep.json, form: ep.form?.() });
    expectAnswer(failures, `${who} ${ep.method} ${ep.path}`, res, status, code);
  };
  for (const ep of [...adminOnly, ...managers]) {
    await attempt('anonymous', undefined, ep, 401, 'AUTH_REQUIRED');
    await attempt('STUDENT', w.studentA.token, ep, 403, 'FORBIDDEN');
    await attempt('ALUMNI', w.alumni.token, ep, 403, 'FORBIDDEN');
  }
  for (const ep of adminOnly) await attempt('TEACHER', w.teacher1.token, ep, 403, 'FORBIDDEN');
  expect(failures).toEqual([]);

  // The refused calls changed nothing.
  for (const [plural, id] of academic) {
    const res = await call('GET', `/api/academic/${plural}/${id}`, { token: w.admin.token });
    expect(res.status).toBe(200);
    expect(res.body.name).not.toBe('Hacked');
  }
  expect((await call('GET', `/api/users/${uid}`, { token: w.admin.token })).body).toMatchObject({ role: 'STUDENT' });
  expect((await call('GET', `/api/timetable/sessions/${sid}`, { token: w.admin.token })).body).toMatchObject({ status: 'SCHEDULED' });
  expect((await call('GET', `/api/announcements/${annId}`, { token: w.admin.token })).body).toMatchObject({ status: 'PUBLISHED', title: published.body.title });
});

// ---------------------------------------------------------------- IDOR

test.describe('IDOR', () => {
  test("a user can neither read nor mark another user's notifications", async () => {
    const ann = await announce(w.admin.token, { title: `For group 2 ${rand()}`, body: 'Only g2', audience: { groups: [w.g2] }, action: 'publish' });
    expect(ann.status, ann.text).toBe(201);
    const notification = await waitFor(async () => {
      const list = await call('GET', '/api/notifications?limit=100', { token: w.studentB.token });
      return (list.body.items as any[]).find((item) => item.data?.announcementId === ann.body.id);
    }, "student B's notification");

    const listA = await call('GET', '/api/notifications?limit=100', { token: w.studentA.token });
    expect((listA.body.items as any[]).map((item) => item.id)).not.toContain(notification.id);
    const markA = await call('POST', `/api/notifications/${notification.id}/read`, { token: w.studentA.token });
    expect(markA.status, markA.text).toBe(404);
    expect(markA.body.code).toBe('RESOURCE_NOT_FOUND');
    expect((await call('POST', '/api/notifications/read-all', { token: w.studentA.token })).status).toBe(200);

    const unreadB = await call('GET', '/api/notifications?unread=true&limit=100', { token: w.studentB.token });
    expect((unreadB.body.items as any[]).find((item) => item.id === notification.id)).toMatchObject({ readAt: null });
    const markB = await call('POST', `/api/notifications/${notification.id}/read`, { token: w.studentB.token });
    expect(markB.status).toBe(200);
    expect(markB.body.readAt).not.toBeNull();
  });

  test('announcements and their attachments are only visible to their audience, the author and admins', async () => {
    const marker = `idor-${rand()}`;
    const ann = await announce(
      w.admin.token,
      { title: `Group 1 only ${marker}`, body: 'Private to g1', audience: { groups: [w.g1] }, action: 'publish' },
      [file('g1-only.pdf', 'application/pdf', pdf(marker))]
    );
    expect(ann.status, ann.text).toBe(201);
    const attachment = `/api/announcements/${ann.body.id}/attachments/${ann.body.attachments[0].id}`;

    expect((await call('GET', `/api/announcements/${ann.body.id}`, { token: w.studentA.token })).status).toBe(200);
    const download = await call('GET', attachment, { token: w.studentA.token });
    expect(download.status).toBe(200);
    expect(download.text).toContain(marker);

    const failures: string[] = [];
    const outsiders = { 'student of g2': w.studentB, 'student without group': w.studentC, alumni: w.alumni, 'other teacher': w.teacher2 };
    for (const [who, person] of Object.entries(outsiders)) {
      expectAnswer(failures, `${who} GET`, await call('GET', `/api/announcements/${ann.body.id}`, { token: person.token }), 404, 'RESOURCE_NOT_FOUND');
      expectAnswer(failures, `${who} attachment`, await call('GET', attachment, { token: person.token }), 404, 'RESOURCE_NOT_FOUND');
      expectAnswer(failures, `${who} read`, await call('POST', `/api/announcements/${ann.body.id}/read`, { token: person.token }), 404, 'RESOURCE_NOT_FOUND');
      if ((await feedIds(person.token)).includes(ann.body.id)) failures.push(`${who} sees it in the feed`);
    }

    // A visible announcement cannot be used to reach the attachment of another one.
    const open = await announce(w.admin.token, { title: `Everyone ${marker}`, body: 'All', action: 'publish' });
    const crossed = await call('GET', `/api/announcements/${open.body.id}/attachments/${ann.body.attachments[0].id}`, { token: w.studentB.token });
    expectAnswer(failures, 'attachment through another announcement', crossed, 404, 'RESOURCE_NOT_FOUND');

    // Drafts are invisible to their future audience; a teacher cannot touch another teacher's announcement.
    const draft = await announce(w.admin.token, { title: `Draft ${marker}`, body: 'Not yet', audience: { groups: [w.g1] } });
    expectAnswer(failures, 'recipient GET draft', await call('GET', `/api/announcements/${draft.body.id}`, { token: w.studentA.token }), 404, 'RESOURCE_NOT_FOUND');
    const own = await announce(w.teacher1.token, { title: `Teacher 1 draft ${marker}`, body: 'Mine', audience: { groups: [w.g1] } });
    expect(own.status, own.text).toBe(201);
    const base = `/api/announcements/${own.body.id}`;
    for (const [method, suffix, json] of [['GET', '', undefined], ['PATCH', '', { title: 'Hijacked' }], ['DELETE', '', undefined], ['GET', '/stats', undefined], ['POST', '/publish', undefined]] as const) {
      expectAnswer(failures, `teacher2 ${method} ${suffix || '/'}`, await call(method, `${base}${suffix}`, { token: w.teacher2.token, json }), 404, 'RESOURCE_NOT_FOUND');
    }
    const managed = await call('GET', '/api/announcements/manage?limit=100', { token: w.teacher2.token });
    if ((managed.body.items as any[]).some((item) => item.id === own.body.id)) failures.push("teacher2 lists teacher1's draft");
    expect(failures).toEqual([]);
    expect((await call('GET', base, { token: w.teacher1.token })).body).toMatchObject({ title: own.body.title, status: 'DRAFT' });
  });

  test("an ICS token only exposes its owner's calendar, and a reset invalidates the old URL", async () => {
    const link = async (person: Person) => {
      const res = await call('GET', '/api/timetable/me/calendar-link', { token: person.token });
      expect(res.status, res.text).toBe(200);
      secret('calendar token', calendarToken(res.body.url), CALENDAR_LINK_PATHS);
      return res.body.url as string;
    };
    const feed = async (url: string) => {
      const res = await call('GET', url);
      return { status: res.status, text: res.text.replace(/\r\n[ \t]/g, '') };
    };
    const urlA = await link(w.studentA);
    const urlB = await link(w.studentB);
    expect(calendarToken(urlA).length).toBeGreaterThanOrEqual(32);
    expect(calendarToken(urlA)).not.toBe(calendarToken(urlB));

    const feedA = await feed(urlA);
    expect(feedA.status).toBe(200);
    expect(feedA.text).toContain(`UID:${w.sessionA}@campuslink`);
    expect(feedA.text).not.toContain(w.sessionB);
    const feedB = await feed(urlB);
    expect(feedB.text).toContain(`UID:${w.sessionB}@campuslink`);
    expect(feedB.text).not.toContain(w.sessionA);

    const reset = await call('POST', '/api/timetable/me/calendar-link/reset', { token: w.studentA.token });
    expect(reset.status).toBe(200);
    secret('calendar token', calendarToken(reset.body.url), CALENDAR_LINK_PATHS);
    expect(reset.body.url).not.toBe(urlA);
    expect((await feed(urlA)).status).toBe(404);
    expect((await feed(reset.body.url)).text).toContain(`UID:${w.sessionA}@campuslink`);
    expect((await feed(urlB)).status).toBe(200);
  });

  test('a teacher cannot address groups they do not teach (403 AUDIENCE_NOT_ALLOWED)', async () => {
    const t1 = w.teacher1.token;
    const refused: [Record<string, unknown>, string][] = [
      [{ groups: [w.g2] }, 'GROUP_NOT_TAUGHT'],
      [{ groups: [w.g1, w.g2] }, 'GROUP_NOT_TAUGHT'],
      [{ roles: ['TEACHER'], groups: [w.g1] }, 'ROLES_NOT_ALLOWED'],
      [{ roles: ['STUDENT', 'ALUMNI'], groups: [w.g1] }, 'ROLES_NOT_ALLOWED'],
      [{}, 'GROUPS_REQUIRED'],
      [{ programs: [w.programId], levels: [4] }, 'GROUPS_REQUIRED'],
    ];
    const failures: string[] = [];
    const title = `Refused ${rand()}`;
    for (const [audience, reason] of refused) {
      const label = JSON.stringify(audience);
      const created = await announce(t1, { title, body: 'x', audience, action: 'publish' });
      expectAnswer(failures, `create ${label}`, created, 403, 'AUDIENCE_NOT_ALLOWED');
      if (created.body?.details?.reason !== reason) failures.push(`create ${label}: reason ${created.body?.details?.reason}`);
      expectAnswer(failures, `preview ${label}`, await call('POST', '/api/announcements/audience-preview', { token: t1, json: { audience } }), 403, 'AUDIENCE_NOT_ALLOWED');
    }

    const draft = await announce(t1, { title: `Own group ${rand()}`, body: 'g1', audience: { groups: [w.g1] } });
    expect(draft.status, draft.text).toBe(201);
    const base = `/api/announcements/${draft.body.id}`;
    expectAnswer(failures, 'teacher widens own draft', await call('PATCH', base, { token: t1, json: { audience: { groups: [w.g2] } } }), 403, 'AUDIENCE_NOT_ALLOWED');
    // An admin widens it: the teacher still cannot publish it.
    expect((await call('PATCH', base, { token: w.admin.token, json: { audience: { groups: [w.g2] } } })).status).toBe(200);
    expectAnswer(failures, 'teacher publishes widened draft', await call('POST', `${base}/publish`, { token: t1 }), 403, 'AUDIENCE_NOT_ALLOWED');
    expectAnswer(failures, 'teacher PATCH action publish', await call('PATCH', base, { token: t1, json: { action: 'publish' } }), 403, 'AUDIENCE_NOT_ALLOWED');
    expect(failures).toEqual([]);

    expect((await call('GET', base, { token: w.admin.token })).body).toMatchObject({ status: 'DRAFT' });
    expect(await feedIds(w.studentB.token)).not.toContain(draft.body.id);
    const managed = await call('GET', '/api/announcements/manage?limit=100', { token: t1 });
    expect((managed.body.items as any[]).filter((item) => item.title === title)).toEqual([]);
  });
});

// ---------------------------------------------------------------- mass assignment

test.describe('mass assignment', () => {
  test('PATCH /api/users/me cannot change role, group, email, password or calendarToken', async () => {
    const a = w.studentA;
    const before = await call('GET', '/api/users/me', { token: a.token });
    const linkBefore = (await call('GET', '/api/timetable/me/calendar-link', { token: a.token })).body.url;
    const forgedToken = `forged-calendar-token-${rand()}${rand()}`;
    const forged = {
      role: 'ADMIN',
      group: w.g2,
      email: uniqueEmail('mallory'),
      password: 'Hijacked-Passw0rd!',
      calendarToken: forgedToken,
      id: w.admin.id,
      _id: w.admin.id,
      createdAt: '2000-01-01T00:00:00.000Z',
    };

    const res = await call('PATCH', '/api/users/me', { token: a.token, json: { firstname: 'Mallory', ...forged } });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ id: a.id, firstname: 'Mallory', role: 'STUDENT', email: a.email, createdAt: before.body.createdAt });
    expect(res.body.group?.id).toBe(w.g1);
    const onlyForbidden = await call('PATCH', '/api/users/me', { token: a.token, json: forged });
    expect(onlyForbidden.status, onlyForbidden.text).toBe(400);
    expect(onlyForbidden.body.code).toBe('NO_CHANGES');

    expect((await call('GET', '/api/users', { token: a.token })).status).toBe(403);
    expect((await call('GET', '/api/timetable/me/calendar-link', { token: a.token })).body.url).toBe(linkBefore);
    expect((await call('GET', `/api/timetable/ics/${forgedToken}.ics`)).status).toBe(404);
    expect((await call('POST', '/api/auth/login', { json: { email: a.email, password: forged.password } })).status).toBe(401);
    await login(a.email, a.password);
  });

  test('announcement author, stats, status, dates and attachments cannot be forged by the body', async () => {
    const forged = {
      author: w.admin.id,
      authorSnapshot: { firstname: 'Ada', lastname: 'Admin', role: 'ADMIN' },
      stats: { recipients: 999, reads: 999, readRate: 1 },
      recipients: 999,
      read: true,
      status: 'PUBLISHED',
      publishedAt: '2020-01-01T00:00:00.000Z',
      createdAt: '2020-01-01T00:00:00.000Z',
      attachments: [{ key: '../../../backend/.env', filename: 'env.txt', size: 1, mimeType: 'text/plain' }],
      id: w.admin.id,
      _id: w.admin.id,
    };
    const data = { title: `Forged ${rand()}`, body: 'x', audience: { groups: [w.g1] }, ...forged };
    for (const res of [await announce(w.teacher1.token, data), await announce(w.teacher1.token, data, [file('ok.txt', 'text/plain', 'ok')])]) {
      expect(res.status, res.text).toBe(201);
      expect(res.body).toMatchObject({ status: 'DRAFT', publishedAt: null, author: { id: w.teacher1.id, role: 'TEACHER' } });
      expect(res.body.id).not.toBe(w.admin.id);
      expect(res.body.stats).toMatchObject({ reads: 0, readRate: 0 });
      expect(res.body.stats.recipients).not.toBe(999);
      expect(new Date(res.body.createdAt).getUTCFullYear()).toBeGreaterThan(2020);
      expect((res.body.attachments as any[]).map((item) => item.filename)).not.toContain('env.txt');

      const patch = await call('PATCH', `/api/announcements/${res.body.id}`, {
        token: w.teacher1.token,
        json: { status: 'PUBLISHED', publishedAt: forged.publishedAt, author: w.admin.id, stats: forged.stats, recipients: 999 },
      });
      expect(patch.status, patch.text).toBe(400);
      expect(patch.body.code).toBe('NO_CHANGES');
      expect((await call('GET', `/api/announcements/${res.body.id}`, { token: w.studentA.token })).status).toBe(404);
      expect(await feedIds(w.studentA.token)).not.toContain(res.body.id);
    }
  });
});

// ---------------------------------------------------------------- uploads

test('uploads: type, spoofed content, size, count and file names are enforced; nothing escapes STORAGE_DIR', async () => {
  const rejected = `rejected-${rand()}`;
  const accepted = `accepted-${rand()}`;
  const data = { title: `Upload ${rand()}`, body: 'Attachments' };
  const post = (files: File[]) => announce(w.admin.token, data, files);
  const failures: string[] = [];

  const refused: [string, File[], number, string][] = [
    ['executable', [file('setup.exe', 'application/x-msdownload', `MZ ${rejected}`)], 415, 'UNSUPPORTED_FILE_TYPE'],
    ['svg', [file('logo.svg', 'image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">${rejected}</svg>`)], 415, 'UNSUPPORTED_FILE_TYPE'],
    ['html', [file('page.html', 'text/html', `<script>alert(1)</script>${rejected}`)], 415, 'UNSUPPORTED_FILE_TYPE'],
    ['HTML content named .pdf', [file('report.pdf', 'application/pdf', `<html><script>alert(1)</script>${rejected}</html>`)], 415, 'UNSUPPORTED_FILE_TYPE'],
    ['real PDF named .html', [file('report.html', 'application/pdf', pdf(rejected))], 415, 'UNSUPPORTED_FILE_TYPE'],
    ['binary named .txt', [file('notes.txt', 'text/plain', Buffer.concat([Buffer.from([0x4d, 0x5a, 0, 0, 0]), Buffer.from(rejected)]))], 415, 'UNSUPPORTED_FILE_TYPE'],
    ['oversize', [file('big.pdf', 'application/pdf', Buffer.concat([pdf(rejected), Buffer.alloc(10 * 1024 * 1024, 0x20)]))], 413, 'FILE_TOO_LARGE'],
    ['six files', Array.from({ length: 6 }, (_, i) => file(`f${i}.txt`, 'text/plain', `${rejected} ${i}`)), 400, 'TOO_MANY_FILES'],
  ];
  for (const [label, files, status, code] of refused) expectAnswer(failures, label, await post(files), status, code);

  const importForm = (item: File) => {
    const form = new FormData();
    form.append('file', item);
    form.append('dryRun', 'true');
    return form;
  };
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.from(rejected)]);
  for (const [label, item] of [['binary CSV', file('timetable.csv', 'text/csv', png)], ['.exe as CSV', file('timetable.exe', 'application/octet-stream', `a,b\n${rejected}`)]] as const) {
    expectAnswer(failures, `import ${label}`, await call('POST', '/api/timetable/import', { token: w.admin.token, form: importForm(item) }), 415, 'UNSUPPORTED_FILE_TYPE');
  }
  expect(failures).toEqual([]);
  expect(listFiles(STORAGE_DIR).filter((item) => fs.readFileSync(item).includes(rejected)), 'rejected files must not be stored').toEqual([]);

  // Path traversal in the file name: stored under a generated name inside STORAGE_DIR, shown as a plain name.
  const escapeName = `sec-escape-${rand()}`;
  const traversal = await post([
    file(`../../../../../../${escapeName}.pdf`, 'application/pdf', pdf(`${accepted}-1`)),
    file(`..\\..\\..\\..\\${escapeName}.txt`, 'text/plain', `<script>alert(1)</script> ${accepted}-2`),
  ]);
  expect(traversal.status, traversal.text).toBe(201);
  for (const item of traversal.body.attachments as { filename: string }[]) {
    expect(item.filename).not.toMatch(/[\\/]|^\.\./);
    expect(item.filename.startsWith(escapeName)).toBe(true);
  }
  const stored = listFiles(STORAGE_DIR).filter((item) => fs.readFileSync(item).includes(accepted));
  expect(stored).toHaveLength(2);
  for (const item of stored) {
    expect(path.relative(STORAGE_DIR, item).startsWith('..')).toBe(false);
    expect(path.basename(item)).toMatch(/^[a-f0-9]{32}\.(pdf|txt)$/);
  }
  for (let dir = path.join(STORAGE_DIR, 'announcements', '2026', '10'); ; dir = path.dirname(dir)) {
    for (const ext of ['pdf', 'txt']) expect(fs.existsSync(path.join(dir, `${escapeName}.${ext}`)), `${dir}`).toBe(false);
    if (path.dirname(dir) === dir) break;
  }

  // A text file with HTML is served as an inert download.
  const txt = (traversal.body.attachments as any[]).find((item) => item.filename.endsWith('.txt'));
  const download = await call('GET', `/api/announcements/${traversal.body.id}/attachments/${txt.id}`, { token: w.admin.token });
  expect(download.status).toBe(200);
  expect(download.headers['content-type']).toMatch(/^text\/plain/);
  expect(download.headers['x-content-type-options']).toBe('nosniff');
  expect(download.headers['content-disposition']).toMatch(/^attachment;/);
  expect(download.headers['content-disposition']).not.toMatch(/\.\.|[\\/]/);
});

// ---------------------------------------------------------------- injection

test.describe('injection', () => {
  test('NoSQL operator objects and regex payloads in the new bodies and query params are rejected or neutralized', async () => {
    const admin = w.admin.token;
    const a = w.studentA.token;
    const draft = await announce(admin, { title: `Injection ${rand()}`, body: 'x' });
    const ne = { $ne: null };
    const bodies: [string, string, string, unknown, number, string][] = [
      [admin, 'POST', '/api/announcements', { title: 'x', body: 'y', audience: { groups: [ne] } }, 400, 'VALIDATION_ERROR'],
      [admin, 'POST', '/api/announcements', { title: 'x', body: 'y', audience: { roles: [{ $gt: '' }] } }, 400, 'VALIDATION_ERROR'],
      [admin, 'POST', '/api/announcements', { title: 'x', body: 'y', audience: { programs: { $exists: true } } }, 400, 'VALIDATION_ERROR'],
      [admin, 'POST', '/api/announcements', { title: 'x', body: 'y', audience: { levels: [{ $gt: 0 }] } }, 400, 'VALIDATION_ERROR'],
      [admin, 'POST', '/api/announcements', { title: ne, body: { $regex: '.*' } }, 400, 'VALIDATION_ERROR'],
      [admin, 'POST', '/api/announcements/audience-preview', { audience: { groups: { $in: [w.g1] } } }, 400, 'VALIDATION_ERROR'],
      [admin, 'PATCH', `/api/announcements/${draft.body.id}`, { removeAttachments: [ne] }, 400, 'VALIDATION_ERROR'],
      [admin, 'POST', '/api/timetable/sessions', { subject: ne, teacher: ne, groups: [ne], startsAt: { $gt: '' }, endsAt: { $gt: '' } }, 400, 'VALIDATION_ERROR'],
      [admin, 'PATCH', `/api/timetable/sessions/${w.sessionA}`, { room: ne, teacher: { $in: [w.teacher2.id] } }, 400, 'VALIDATION_ERROR'],
      [admin, 'PATCH', `/api/users/${w.studentA.id}`, { group: ne }, 400, 'VALIDATION_ERROR'],
      [admin, 'POST', '/api/academic/programs', { name: { $gt: '' }, code: { $gt: '' } }, 400, 'VALIDATION_ERROR'],
      [admin, 'POST', '/api/academic/groups', { name: 'x', level: { $gt: 0 }, academicYear: '2026-2027', program: ne }, 400, 'VALIDATION_ERROR'],
      [a, 'PATCH', '/api/users/me', { locale: { $ne: 'fr' } }, 400, 'VALIDATION_ERROR'],
      [a, 'POST', '/api/push/subscriptions', { type: 'web', endpoint: ne, keys: { p256dh: ne, auth: ne } }, 400, 'VALIDATION_ERROR'],
      [a, 'DELETE', '/api/push/subscriptions', { endpoint: ne, token: ne }, 400, 'MISSING_FIELDS'],
      [a, 'POST', `/api/notifications/${encodeURIComponent('{"$ne":null}')}/read`, undefined, 400, 'INVALID_ID'],
      [a, 'GET', `/api/announcements/${encodeURIComponent('{"$ne":null}')}`, undefined, 400, 'INVALID_ID'],
    ];
    const failures: string[] = [];
    for (const [token, method, url, json, status, code] of bodies) {
      expectAnswer(failures, `${method} ${url} ${JSON.stringify(json)}`, await call(method, url, { token, json }), status, code);
    }

    const total = async (token: string, url: string) => {
      const res = await call('GET', url, { token });
      if (res.status !== 200) failures.push(`GET ${url}: ${res.status} ${res.body?.code}`);
      return res.body?.total;
    };
    for (const url of ['/api/users?q=.*', '/api/users?email=.*', '/api/users?q=(a%2B)%2B%24', '/api/audit?action=.*', '/api/audit?action=.**']) {
      const count = await total(admin, url);
      if (count !== 0) failures.push(`GET ${url}: the pattern was interpreted (${count} results)`);
    }
    if (!((await total(admin, '/api/audit?action=academic.*')) > 0)) failures.push('positive control: action=academic.* finds nothing');
    const queries: [string, string, number, string][] = [
      [a, '/api/timetable?group[$ne]=000000000000000000000000', 400, 'MISSING_FIELDS'],
      [a, '/api/timetable?group=.*', 400, 'VALIDATION_ERROR'],
      [a, '/api/announcements?priority=.*', 400, 'VALIDATION_ERROR'],
      [admin, '/api/academic/groups?level=4%7C%7C1', 400, 'VALIDATION_ERROR'],
      [a, '/api/timetable/ics/.*.ics', 404, 'RESOURCE_NOT_FOUND'],
      [a, `/api/timetable/ics/${encodeURIComponent('{"$ne":null}')}.ics`, 404, 'RESOURCE_NOT_FOUND'],
    ];
    for (const [token, url, status, code] of queries) expectAnswer(failures, `GET ${url}`, await call('GET', url, { token }), status, code);
    expect(failures).toEqual([]);

    // Nothing was changed by the refused calls.
    expect((await call('GET', '/api/users/me', { token: a })).body).toMatchObject({ role: 'STUDENT', locale: 'fr', group: { id: w.g1 } });
    expect((await call('GET', `/api/timetable/sessions/${w.sessionA}`, { token: a })).body).toMatchObject({ teacher: { id: w.teacher1.id } });
  });

  test('push subscriptions cannot point the backend at internal or plain-http hosts (SSRF)', async () => {
    const keys = { p256dh: crypto.randomBytes(65).toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
    const id = () => `sec-${rand()}${rand()}`;
    const internal = [
      'http://127.0.0.1:27018/',
      'http://localhost:4100/api/health',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/admin',
      'https://192.168.1.1/',
      // Allowlist bypass attempts: plain http, look-alike hosts, credentials, ports, IP literals, parser confusion.
      `http://fcm.googleapis.com/fcm/send/${id()}`,
      `https://fcm.googleapis.com.evil.example/fcm/send/${id()}`,
      `https://evil.example/fcm.googleapis.com/${id()}`,
      `https://evilpush.apple.com/${id()}`,
      `https://fcm.googleapis.com@127.0.0.1/${id()}`,
      `https://evil.example\\@fcm.googleapis.com/${id()}`,
      `https://fcm.googleapis.com%2F@127.0.0.1/${id()}`,
      `https://fcm.googleapis.com:${API_PORT}/${id()}`,
      `https://[::1]/${id()}`,
      `https://127.0.0.1/${id()}`,
      `https://2130706433/${id()}`,
      `https://localhost/${id()}`,
      ` https://fcm.googleapis.com/fcm/send/${id()}`,
      `https://fcm.googleapis.com/fcm/send/${id()}\n`,
    ];
    const accepted: string[] = [];
    for (const endpoint of internal) {
      const res = await call('POST', '/api/push/subscriptions', { token: w.studentC.token, json: { type: 'web', endpoint, keys } });
      if (res.status !== 400 || res.body?.code !== 'VALIDATION_ERROR' || !res.body?.details?.endpoint) {
        accepted.push(`${JSON.stringify(endpoint)} -> ${res.status} ${res.body?.code ?? ''}`);
      }
      if (res.status === 201) await call('DELETE', '/api/push/subscriptions', { token: w.studentC.token, json: { endpoint } });
    }
    expect(accepted, 'web push endpoints must be https URLs of public push services').toEqual([]);

    // Positive control: the push services of the browsers are still accepted.
    const services = [
      `https://fcm.googleapis.com/fcm/send/${id()}`,
      `https://updates.push.services.mozilla.com/wpush/v2/${id()}`,
      `https://wns2-par02p.notify.windows.com/w/?token=${id()}`,
      `https://web.push.apple.com/${id()}`,
    ];
    const refused: string[] = [];
    for (const endpoint of services) {
      secret('push endpoint', endpoint);
      const res = await call('POST', '/api/push/subscriptions', { token: w.studentC.token, json: { type: 'web', endpoint, keys } });
      if (res.status !== 201) refused.push(`${endpoint} -> ${res.status} ${res.body?.code ?? ''}`);
      expect((await call('DELETE', '/api/push/subscriptions', { token: w.studentC.token, json: { endpoint } })).status).toBe(204);
    }
    expect(refused, 'browser push services must stay accepted').toEqual([]);
  });

  test('a stored push subscription that is not a browser push service is never contacted, and is deleted', async () => {
    const tag = rand().toUpperCase();
    const group = await call('POST', '/api/academic/groups', {
      token: w.admin.token,
      json: { name: `SEC-${tag}-PUSH`, level: 4, academicYear: '2026-2027', program: w.programId },
    });
    expect(group.status, group.text).toBe(201);
    const person = await createUser(w.admin.token, 'STUDENT', group.body.id);
    const keys = { p256dh: crypto.randomBytes(65).toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
    const good = secret('push endpoint', `https://fcm.googleapis.com/fcm/send/sec-good-${rand()}${rand()}`);
    expect((await call('POST', '/api/push/subscriptions', { token: person.token, json: { type: 'web', endpoint: good, keys } })).status).toBe(201);

    // Rows written before the check existed (or by hand): the API refuses them, so they go straight to the database.
    const bad = [`http://127.0.0.1:${API_PORT}/ssrf-${rand()}`, `https://fcm.googleapis.com.evil.example/${rand()}`, `https://169.254.169.254/${rand()}`];
    for (const endpoint of bad) {
      withTestDb(
        `await db.collection('pushsubscriptions').insertOne({ user: new mongoose.Types.ObjectId(process.env.CL_USER_ID), type: 'web',
          endpoint: process.env.CL_ENDPOINT, keys: { p256dh: 'x', auth: 'y' }, userAgent: '', lastSuccessAt: null,
          createdAt: new Date(), updatedAt: new Date() });`,
        { CL_USER_ID: person.id, CL_ENDPOINT: endpoint }
      );
    }
    const stored = () =>
      // process.stdout.write: console.log colours numbers under the runner's FORCE_COLOR.
      Number(withTestDb(`process.stdout.write(String(await db.collection('pushsubscriptions').countDocuments({ endpoint: { $in: JSON.parse(process.env.CL_ENDPOINTS) } })));`, {
        CL_ENDPOINTS: JSON.stringify(bad),
      }));
    expect(stored()).toBe(bad.length);

    const published = await announce(w.admin.token, { title: `Push ${tag}`, body: 'x', audience: { groups: [group.body.id] }, action: 'publish' });
    expect(published.status, published.text).toBe(201);
    // The valid subscription gets its push (the notification pipeline ran)...
    await waitFor(async () => (pushOutbox().some((entry) => entry.userId === person.id && entry.endpoint === good) ? true : undefined), 'the push to the valid subscription', 30_000);
    // ...the others are deleted without being contacted.
    await waitFor(async () => (stored() === 0 ? true : undefined), 'the invalid subscriptions to be deleted', 30_000);
    expect(pushOutbox().filter((entry) => entry.userId === person.id).map((entry) => entry.endpoint)).toEqual([good]);
  });
});

// ---------------------------------------------------------------- rate limiting (backend on 4101)

test('POST /api/auth/login is rate limited per IP + email: 429 TOO_MANY_REQUESTS with Retry-After', async () => {
  const email = uniqueEmail('sec-ratelimit');
  const password = secret('password', `Sec-${rand()}-Passw0rd!`);
  const signup = await call('POST', '/api/auth/signup', { base: SECURITY_API_URL, json: { firstname: 'Rate', lastname: 'Limit', email, password } });
  expect(signup.status, signup.text).toBe(201);
  secret('refresh token', signup.body.refreshToken, AUTH_PATHS);

  const attempt = (address: string, pass: string) => call('POST', '/api/auth/login', { base: SECURITY_API_URL, json: { email: address, password: pass } });
  for (let i = 0; i < RATE_LIMIT_AUTH_MAX; i += 1) expect((await attempt(email, 'Wrong-Passw0rd!')).status).toBe(401);

  const limited = await attempt(email, 'Wrong-Passw0rd!');
  expect(limited.status, limited.text).toBe(429);
  expect(limited.body.code).toBe('TOO_MANY_REQUESTS');
  expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  expect(limited.body.details.retryAfter).toBeGreaterThan(0);
  // Still blocked with the right password, or the same address written differently.
  expect((await attempt(email, password)).status).toBe(429);
  expect((await attempt(`  ${email.toUpperCase()} `, password)).status).toBe(429);
  // Another account is not blocked by this one.
  expect((await attempt(uniqueEmail('sec-ratelimit-other'), 'Wrong-Passw0rd!')).status).toBe(401);
});

test('the per-IP limits apply to a forwarded client address, not to loopback callers without X-Forwarded-For (the web app)', async () => {
  // The security backend trusts loopback (TRUST_PROXY=loopback): an X-Forwarded-For sent from here is the client IP.
  // Two documentation addresses (RFC 5737) in different ranges, fresh at every run (counters live in memory).
  const address = `198.51.100.${1 + crypto.randomInt(254)}`;
  const otherAddress = `203.0.113.${1 + crypto.randomInt(254)}`;
  const from = (ip?: string): Record<string, string> => (ip ? { 'X-Forwarded-For': ip } : {});
  // A new email each time, so the per route + IP + email limiter (RATE_LIMIT_AUTH_MAX) never answers first.
  const badLogin = (ip?: string) =>
    call('POST', '/api/auth/login', {
      base: SECURITY_API_URL,
      headers: from(ip),
      json: { email: uniqueEmail('sec-iplimit'), password: 'Wrong-Passw0rd!' },
    });
  const badReset = (ip?: string) =>
    call('POST', '/api/auth/reset-password', {
      base: SECURITY_API_URL,
      headers: from(ip),
      json: { token: crypto.randomBytes(32).toString('hex'), password: 'Sec-Reset-Passw0rd!' },
    });
  const statuses = async (count: number, send: () => Promise<Res>) => {
    const seen: number[] = [];
    for (let i = 0; i < count; i += 1) seen.push((await send()).status);
    return seen;
  };

  // login, signup, forgot-password and verify-otp share one counter per client IP, whatever the email.
  expect(await statuses(RATE_LIMIT_IP_MAX, () => badLogin(address))).toEqual(Array(RATE_LIMIT_IP_MAX).fill(401));
  const limited = await badLogin(address);
  expect(limited.status, limited.text).toBe(429);
  expect(limited.body.code).toBe('TOO_MANY_REQUESTS');
  expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  expect(limited.headers['ratelimit-policy']).toBe(`${RATE_LIMIT_IP_MAX};w=900`);
  const forgot = await call('POST', '/api/auth/forgot-password', {
    base: SECURITY_API_URL,
    headers: from(address),
    json: { email: uniqueEmail('sec-iplimit') },
  });
  expect(forgot.status, forgot.text).toBe(429);
  // Another client is not blocked by this one.
  expect((await badLogin(otherAddress)).status).toBe(401);
  // Loopback without X-Forwarded-For (what Next.js sends with TRUSTED_PROXY_HOPS=0, for every web user) only has
  // the per route + IP + email limit: one person's failed logins cannot lock every web user out.
  expect(await statuses(RATE_LIMIT_IP_MAX + 1, () => badLogin())).toEqual(Array(RATE_LIMIT_IP_MAX + 1).fill(401));

  // reset-password: per client IP, same rule for loopback.
  expect(await statuses(RATE_LIMIT_RESET_MAX, () => badReset(address))).toEqual(Array(RATE_LIMIT_RESET_MAX).fill(400));
  const resetLimited = await badReset(address);
  expect(resetLimited.status, resetLimited.text).toBe(429);
  expect(resetLimited.body.code).toBe('TOO_MANY_REQUESTS');
  expect((await badReset(otherAddress)).status).toBe(400);
  expect(await statuses(RATE_LIMIT_RESET_MAX + 1, () => badReset())).toEqual(Array(RATE_LIMIT_RESET_MAX + 1).fill(400));
});

// ---------------------------------------------------------------- phase 2: bookings, forum, attendance, grades, analytics

/** Phase 2 data (one set per worker, on top of `w`), created by the beforeAll of the "phase 2" block. */
let p: {
  equipment: string; // active, no approval
  camera: string; // requires an approval
  pastA: string; // teacher1 / g1, yesterday: its roll call is open for teacher1
  studentD: Person; // second student of g1
  assessment: string; // teacher1, subject / g1, unpublished
  booking: string; // studentA's PENDING request on the camera
  question: string; // studentB's question (visible)
  answer: string; // teacher1's answer to it
  report: string; // studentC's report of it
};

/** `{"$ne":null}` as a path segment. */
const OPERATOR_ID = encodeURIComponent('{"$ne":null}');

/** Records a failure for each private value (another user's id, a marker...) found in the answer. */
function mentions(failures: string[], label: string, res: Res, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) if (value && res.text.includes(value)) failures.push(`${label} reveals ${name}`);
}

test.describe('phase 2', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(180_000);
    const admin = w.admin.token;
    const tag = rand().toUpperCase();
    const created = (res: Res, what: string) => {
      expect(res.status, `${what}: ${res.text}`).toBe(201);
      return res.body.id as string;
    };
    const equipment = created(
      await call('POST', '/api/resources/equipment', { token: admin, json: { name: `SEC-PROJ-${tag}`, category: 'PROJECTOR' } }),
      'equipment'
    );
    const camera = created(
      await call('POST', '/api/resources/equipment', { token: admin, json: { name: `SEC-CAM-${tag}`, category: 'CAMERA', requiresApproval: true } }),
      'camera'
    );
    const yesterday = campusDay(-1);
    const past = await call('POST', '/api/timetable/sessions', {
      token: admin,
      json: { subject: w.subjectId, teacher: w.teacher1.id, groups: [w.g1], startsAt: `${yesterday}T10:00`, endsAt: `${yesterday}T11:30` },
    });
    expect(past.status, `past session: ${past.text}`).toBe(201);
    const studentD = await createUser(admin, 'STUDENT', w.g1);
    const assessment = created(
      await call('POST', '/api/grades/assessments', {
        token: w.teacher1.token,
        json: { subject: w.subjectId, group: w.g1, title: `Exam ${tag}`, type: 'EXAM', date: campusDay(0) },
      }),
      'assessment'
    );
    const booking = created(
      await call('POST', '/api/bookings', {
        token: w.studentA.token,
        json: { resourceType: 'EQUIPMENT', equipment: camera, startsAt: `${campusDay(6)}T09:00`, endsAt: `${campusDay(6)}T10:00`, purpose: 'Security request' },
      }),
      'booking'
    );
    const question = created(
      await call('POST', '/api/forum/questions', {
        token: w.studentB.token,
        json: { title: `Security question ${tag}`, body: 'A visible question used by the security checks.', subject: w.subjectId },
      }),
      'question'
    );
    const answer = created(
      await call('POST', `/api/forum/questions/${question}/answers`, { token: w.teacher1.token, json: { body: 'A certified answer.' } }),
      'answer'
    );
    const report = created(
      await call('POST', `/api/forum/questions/${question}/report`, { token: w.studentC.token, json: { reason: 'Security check report' } }),
      'report'
    );
    p = { equipment, camera, pastA: past.body.items[0].id, studentD, assessment, booking, question, answer, report };
  });

  test('new endpoints answer 401 without a token and 403 to the wrong role or another teacher', async () => {
    const A = w.studentA.id;
    const { equipment, booking, question, answer, report, assessment, pastA } = p;
    const sheet = `/api/grades/assessments/${assessment}`;
    const newAssessment = { subject: w.subjectId, group: w.g1, title: 'Forbidden', type: 'EXAM', date: campusDay(0) };
    const adminOnly: Endpoint[] = [
      { method: 'POST', path: '/api/resources/equipment', json: { name: `Forbidden ${rand()}` } },
      { method: 'PATCH', path: `/api/resources/equipment/${equipment}`, json: { name: 'Hacked' } },
      { method: 'DELETE', path: `/api/resources/equipment/${equipment}` },
      { method: 'GET', path: '/api/bookings' },
      { method: 'GET', path: '/api/bookings/stats' },
      { method: 'POST', path: `/api/bookings/${booking}/approve`, json: { version: 0 } },
      { method: 'POST', path: `/api/bookings/${booking}/reject`, json: { version: 0, note: 'No' } },
      { method: 'GET', path: '/api/forum/reports' },
      { method: 'POST', path: `/api/forum/reports/${report}/resolve`, json: {} },
      ...[`questions/${question}`, `answers/${answer}`].flatMap((target) =>
        ['hide', 'unhide'].map((action): Endpoint => ({ method: 'POST', path: `/api/forum/${target}/${action}`, json: { reason: 'Hacked' } }))
      ),
      { method: 'GET', path: '/api/attendance/alerts' },
      { method: 'GET', path: `/api/analytics/students/${A}` },
      { method: 'GET', path: `/api/analytics/students/${A}/report.pdf` },
    ];
    const staff: Endpoint[] = [
      { method: 'GET', path: '/api/attendance/sessions' },
      { method: 'GET', path: `/api/attendance/sessions/${pastA}` },
      { method: 'PUT', path: `/api/attendance/sessions/${pastA}`, json: { records: [{ student: A, status: 'PRESENT' }] } },
      { method: 'GET', path: '/api/grades/teaching' },
      { method: 'GET', path: '/api/grades/assessments' },
      { method: 'POST', path: '/api/grades/assessments', json: newAssessment },
      { method: 'GET', path: sheet },
      { method: 'PATCH', path: sheet, json: { title: 'Hacked' } },
      { method: 'DELETE', path: sheet },
      { method: 'GET', path: `${sheet}/grades` },
      { method: 'PUT', path: `${sheet}/grades`, json: { grades: [{ student: A, score: 20 }] } },
      { method: 'POST', path: `${sheet}/publish` },
      { method: 'GET', path: `/api/analytics/groups/${w.g1}` },
    ];
    const studentOnly: Endpoint[] = [
      { method: 'GET', path: '/api/grades/me' },
      { method: 'GET', path: '/api/analytics/me' },
      { method: 'GET', path: '/api/analytics/me/report.pdf' },
    ];
    const signedIn: Endpoint[] = [
      { method: 'GET', path: '/api/resources/equipment' },
      { method: 'GET', path: `/api/resources/equipment/${equipment}` },
      { method: 'GET', path: `/api/bookings/availability?resourceType=ROOM&resource=${w.roomId}` },
      { method: 'GET', path: `/api/bookings/free-rooms?from=${campusDay(7)}&to=${campusDay(8)}` },
      { method: 'GET', path: '/api/bookings/me' },
      { method: 'POST', path: '/api/bookings', json: {} },
      { method: 'GET', path: `/api/bookings/${booking}` },
      { method: 'POST', path: `/api/bookings/${booking}/cancel`, json: { version: 0 } },
      { method: 'GET', path: '/api/forum/questions' },
      { method: 'GET', path: '/api/forum/questions/similar?title=security' },
      { method: 'GET', path: '/api/forum/tags' },
      { method: 'GET', path: '/api/forum/leaderboard' },
      { method: 'GET', path: '/api/forum/profiles/me' },
      { method: 'GET', path: `/api/forum/profiles/${A}` },
      { method: 'POST', path: '/api/forum/questions', json: {} },
      { method: 'GET', path: `/api/forum/questions/${question}` },
      { method: 'PATCH', path: `/api/forum/questions/${question}`, json: { title: 'Hacked question title' } },
      { method: 'DELETE', path: `/api/forum/questions/${question}` },
      { method: 'POST', path: `/api/forum/questions/${question}/answers`, json: { body: 'Anonymous answer' } },
      { method: 'POST', path: `/api/forum/questions/${question}/accept`, json: { answerId: answer } },
      { method: 'POST', path: `/api/forum/questions/${question}/vote`, json: { value: 1 } },
      { method: 'POST', path: `/api/forum/questions/${question}/follow` },
      { method: 'DELETE', path: `/api/forum/questions/${question}/follow` },
      { method: 'POST', path: `/api/forum/questions/${question}/report`, json: { reason: 'Anonymous report' } },
      { method: 'PATCH', path: `/api/forum/answers/${answer}`, json: { body: 'Hacked' } },
      { method: 'DELETE', path: `/api/forum/answers/${answer}` },
      { method: 'POST', path: `/api/forum/answers/${answer}/vote`, json: { value: 1 } },
      { method: 'POST', path: `/api/forum/answers/${answer}/report`, json: { reason: 'Anonymous report' } },
      { method: 'GET', path: '/api/attendance/me' },
    ];
    // teacher2 teaches the subject to g2 only: teacher1's session, assessment and group are out of reach.
    const otherTeacher: [Endpoint, string?][] = [
      [{ method: 'GET', path: `/api/attendance/sessions/${pastA}` }],
      [{ method: 'PUT', path: `/api/attendance/sessions/${pastA}`, json: { records: [{ student: A, status: 'PRESENT' }] } }],
      [{ method: 'POST', path: '/api/grades/assessments', json: newAssessment }, 'NOT_TEACHING'],
      [{ method: 'GET', path: sheet }, 'NOT_TEACHING'],
      [{ method: 'PATCH', path: sheet, json: { title: 'Hacked' } }, 'NOT_TEACHING'],
      [{ method: 'DELETE', path: sheet }, 'NOT_TEACHING'],
      [{ method: 'GET', path: `${sheet}/grades` }, 'NOT_TEACHING'],
      [{ method: 'PUT', path: `${sheet}/grades`, json: { grades: [{ student: A, score: 0 }] } }, 'NOT_TEACHING'],
      [{ method: 'POST', path: `${sheet}/publish` }, 'NOT_TEACHING'],
      [{ method: 'GET', path: `/api/analytics/groups/${w.g1}` }, 'NOT_TEACHING'],
    ];

    const failures: string[] = [];
    const attempt = async (who: string, token: string | undefined, ep: Endpoint, status: number, code: string, reason?: string) => {
      const res = await call(ep.method, ep.path, { token, json: ep.json });
      expectAnswer(failures, `${who} ${ep.method} ${ep.path}`, res, status, code);
      if (reason && res.status === status && res.body?.details?.reason !== reason) {
        failures.push(`${who} ${ep.method} ${ep.path}: details.reason ${res.body?.details?.reason}, expected ${reason}`);
      }
    };
    for (const ep of [...adminOnly, ...staff, ...studentOnly, ...signedIn]) await attempt('anonymous', undefined, ep, 401, 'AUTH_REQUIRED');
    for (const ep of [...adminOnly, ...staff]) {
      await attempt('STUDENT', w.studentA.token, ep, 403, 'FORBIDDEN');
      await attempt('ALUMNI', w.alumni.token, ep, 403, 'FORBIDDEN');
    }
    for (const ep of adminOnly) await attempt('TEACHER', w.teacher1.token, ep, 403, 'FORBIDDEN');
    for (const ep of studentOnly) {
      for (const [who, person] of [['TEACHER', w.teacher1], ['ADMIN', w.admin], ['ALUMNI', w.alumni]] as const) {
        await attempt(who, person.token, ep, 403, 'FORBIDDEN');
      }
    }
    const day = campusDay(9);
    await attempt('ALUMNI', w.alumni.token, {
      method: 'POST',
      path: '/api/bookings',
      json: { resourceType: 'ROOM', room: w.roomId, startsAt: `${day}T08:00`, endsAt: `${day}T09:00`, purpose: 'Alumni booking' },
    }, 403, 'FORBIDDEN');
    for (const [ep, reason] of otherTeacher) await attempt('teacher2', w.teacher2.token, ep, 403, 'FORBIDDEN', reason);
    await attempt('teacher1', w.teacher1.token, { method: 'GET', path: `/api/attendance/sessions/${w.sessionB}` }, 403, 'FORBIDDEN');
    await attempt('teacher1', w.teacher1.token, { method: 'POST', path: '/api/grades/assessments', json: { ...newAssessment, group: w.g2 } }, 403, 'FORBIDDEN', 'NOT_TEACHING');
    // Lists only show what the caller may manage.
    const listed = await call('GET', `/api/grades/assessments?group=${w.g1}&subject=${w.subjectId}`, { token: w.teacher2.token });
    if (listed.status !== 200 || (listed.body.items as any[]).some((item) => item.id === assessment)) failures.push(`teacher2 lists teacher1's assessment (${listed.status})`);
    const sessions = await call('GET', `/api/attendance/sessions?from=${campusDay(-3)}&to=${campusDay(1)}&teacher=${w.teacher1.id}`, { token: w.teacher2.token });
    if (sessions.status !== 200 || (sessions.body.items as any[]).some((item) => item.session.id === pastA)) failures.push(`teacher2 lists teacher1's session (${sessions.status})`);
    expect(failures).toEqual([]);

    // The refused calls changed nothing.
    const admin = w.admin.token;
    expect((await call('GET', `/api/resources/equipment/${equipment}`, { token: admin })).body.name).not.toBe('Hacked');
    expect((await call('GET', `/api/bookings/${booking}`, { token: admin })).body).toMatchObject({ status: 'PENDING', version: 0 });
    const detail = await call('GET', `/api/forum/questions/${question}`, { token: admin });
    expect(detail.body.question).toMatchObject({ hidden: false, title: expect.stringMatching(/^Security question/) });
    expect((detail.body.answers as any[]).find((item) => item.id === answer)).toMatchObject({ hidden: false, body: 'A certified answer.' });
    const reports = await call('GET', '/api/forum/reports?status=OPEN&limit=100', { token: admin });
    expect((reports.body.items as any[]).map((item) => item.id)).toContain(report);
    const kept = await call('GET', sheet, { token: admin });
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ published: false, title: expect.stringMatching(/^Exam /) });
    expect(((await call('GET', `${sheet}/grades`, { token: admin })).body.grades as any[]).every((item) => item.score === null)).toBe(true);
    expect(((await call('GET', `/api/attendance/sessions/${pastA}`, { token: admin })).body.roster as any[]).every((item) => item.status === null)).toBe(true);
  });

  test("bookings: another user's booking can be neither read nor cancelled, and its owner and purpose never reach non-admins", async () => {
    const marker = `purpose-${rand()}`;
    const day = campusDay(7);
    const A = w.studentA;
    const own = await call('POST', '/api/bookings', {
      token: A.token,
      json: { resourceType: 'ROOM', room: w.roomId, startsAt: `${day}T10:00`, endsAt: `${day}T11:00`, purpose: `Private ${marker}` },
    });
    expect(own.status, own.text).toBe(201);
    expect(own.body).toMatchObject({ status: 'CONFIRMED', version: 0, user: { id: A.id } });
    const id = own.body.id as string;
    const privateValues = { "the owner's id": A.id, 'the purpose': marker, 'the booking id': id };
    const failures: string[] = [];
    const availability = (token: string) =>
      call('GET', `/api/bookings/availability?resourceType=ROOM&resource=${w.roomId}&from=${day}&to=${campusDay(8)}`, { token });
    const overlapping = { resourceType: 'ROOM', room: w.roomId, startsAt: `${day}T10:30`, endsAt: `${day}T11:30`, purpose: 'Overlap attempt' };

    for (const [who, person] of [['student B', w.studentB], ['teacher 2', w.teacher2], ['alumni', w.alumni]] as const) {
      expectAnswer(failures, `${who} GET`, await call('GET', `/api/bookings/${id}`, { token: person.token }), 404, 'RESOURCE_NOT_FOUND');
      expectAnswer(failures, `${who} cancel`, await call('POST', `/api/bookings/${id}/cancel`, { token: person.token, json: { version: 0 } }), 404, 'RESOURCE_NOT_FOUND');
      mentions(failures, `${who} /bookings/me`, await call('GET', '/api/bookings/me?limit=100', { token: person.token }), privateValues);

      const busy = await availability(person.token);
      expectAnswer(failures, `${who} availability`, busy, 200);
      const entry = (busy.body?.busy as any[] | undefined)?.find((item) => item.kind === 'BOOKING' && item.startsAt === own.body.startsAt);
      if (!entry) failures.push(`${who}: the booking is missing from the availability`);
      else if (entry.mine !== false || ['user', 'purpose', 'bookingId'].some((key) => key in entry)) failures.push(`${who} availability entry: ${JSON.stringify(entry)}`);
      mentions(failures, `${who} availability`, busy, privateValues);

      if (person !== w.alumni) {
        const conflict = await call('POST', '/api/bookings', { token: person.token, json: overlapping });
        expectAnswer(failures, `${who} overlapping booking`, conflict, 409, 'BOOKING_CONFLICT');
        for (const item of (conflict.body?.details?.conflicts as any[] | undefined) ?? []) {
          const extra = Object.keys(item).filter((key) => !['kind', 'startsAt', 'endsAt', 'mine'].includes(key));
          if (extra.length > 0) failures.push(`${who} conflict exposes ${extra.join(', ')}`);
        }
        mentions(failures, `${who} conflict`, conflict, privateValues);
      }
    }
    expect(failures).toEqual([]);

    // Positive controls: admins see who booked and why; the owner keeps the booking and can cancel it.
    const adminView = await availability(w.admin.token);
    expect((adminView.body.busy as any[]).find((item) => item.bookingId === id)).toMatchObject({ user: { id: A.id }, purpose: `Private ${marker}` });
    const adminConflict = await call('POST', '/api/bookings', { token: w.admin.token, json: overlapping });
    expect(adminConflict.status).toBe(409);
    expect(adminConflict.body.details.conflicts[0]).toMatchObject({ bookingId: id, user: { id: A.id } });
    expect((await call('GET', `/api/bookings/${id}`, { token: A.token })).body).toMatchObject({ status: 'CONFIRMED', version: 0 });
    expect((await call('POST', `/api/bookings/${id}/cancel`, { token: A.token, json: { version: 0 } })).body).toMatchObject({ status: 'CANCELLED', cancelledBy: 'OWNER' });
  });

  test('bookings: status, owner and version cannot be forged; one winner per slot under concurrency; stale versions get 409', async () => {
    const day = campusDay(8);
    const A = w.studentA;
    const admin = w.admin.token;
    const forged = {
      status: 'CONFIRMED',
      user: w.admin.id,
      version: 42,
      decision: { by: w.admin.id, at: new Date().toISOString(), note: 'Self-approved' },
      reminderSentAt: new Date().toISOString(),
      userSnapshot: { firstname: 'Ada', lastname: 'Admin', role: 'ADMIN' },
      source: 'SEED',
      id: w.admin.id,
      _id: w.admin.id,
      createdAt: '2000-01-01T00:00:00.000Z',
    };
    const created = await call('POST', '/api/bookings', {
      token: A.token,
      json: { resourceType: 'EQUIPMENT', equipment: p.camera, startsAt: `${day}T12:00`, endsAt: `${day}T13:00`, purpose: 'Forged fields', ...forged },
    });
    expect(created.status, created.text).toBe(201);
    expect(created.body).toMatchObject({ status: 'PENDING', version: 0, decision: null, user: { id: A.id, role: 'STUDENT' } });
    expect(created.body.id).not.toBe(w.admin.id);
    expect(new Date(created.body.createdAt).getUTCFullYear()).toBeGreaterThan(2000);
    // Cancel only reads the version.
    const cancelled = await call('POST', `/api/bookings/${created.body.id}/cancel`, {
      token: A.token,
      json: { version: 0, status: 'CONFIRMED', user: w.studentB.id, cancelledBy: 'ADMIN' },
    });
    expect(cancelled.status, cancelled.text).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', version: 1, cancelledBy: 'OWNER', user: { id: A.id } });

    // Double booking: six simultaneous requests whose intervals all share 14:30-14:45 (teachers and admins have no limit).
    const intervals = [['14:00', '15:30'], ['14:15', '15:00'], ['14:30', '14:45'], ['13:45', '14:45'], ['14:30', '16:00'], ['14:00', '15:30']];
    const people = [w.teacher1, w.teacher2, w.admin, w.teacher1, w.teacher2, w.admin];
    const race = await Promise.all(
      intervals.map(([start, end], i) =>
        call('POST', '/api/bookings', {
          token: people[i].token,
          json: { resourceType: 'ROOM', room: w.roomId, startsAt: `${day}T${start}`, endsAt: `${day}T${end}`, purpose: `Race ${i}` },
        })
      )
    );
    const outcomes = race.map((res) => `${res.status} ${res.body?.code ?? ''}`.trim());
    expect(outcomes.filter((item) => item === '201'), outcomes.join(' | ')).toHaveLength(1);
    expect(outcomes.filter((item) => item === '409 BOOKING_CONFLICT'), outcomes.join(' | ')).toHaveLength(intervals.length - 1);
    const active = await call('GET', `/api/bookings?resource=${w.roomId}&status=PENDING,CONFIRMED&from=${day}T13:00&to=${day}T17:00`, { token: admin });
    expect(active.status, active.text).toBe(200);
    expect(active.body.total).toBe(1);

    // Optimistic locking: two admins deciding at once, then stale versions.
    const pending = await call('POST', '/api/bookings', {
      token: w.studentC.token,
      json: { resourceType: 'EQUIPMENT', equipment: p.camera, startsAt: `${day}T16:00`, endsAt: `${day}T17:00`, purpose: 'Decision race' },
    });
    expect(pending.status, pending.text).toBe(201);
    expect(pending.body).toMatchObject({ status: 'PENDING', version: 0 });
    const target = `/api/bookings/${pending.body.id}`;
    const decisions = await Promise.all([
      call('POST', `${target}/approve`, { token: admin, json: { version: 0 } }),
      call('POST', `${target}/reject`, { token: admin, json: { version: 0, note: 'Race' } }),
    ]);
    const decided = decisions.map((res) => `${res.status} ${res.body?.code ?? ''}`.trim()).sort();
    expect(decided).toEqual(['200', '409 VERSION_CONFLICT']);
    const failures: string[] = [];
    expectAnswer(failures, 'owner cancel with a stale version', await call('POST', `${target}/cancel`, { token: w.studentC.token, json: { version: 0 } }), 409, 'VERSION_CONFLICT');
    expectAnswer(failures, 'approve with a stale version', await call('POST', `${target}/approve`, { token: admin, json: { version: 0 } }), 409, 'VERSION_CONFLICT');
    expectAnswer(failures, 'approve with a future version', await call('POST', `${target}/approve`, { token: admin, json: { version: 7 } }), 409, 'VERSION_CONFLICT');
    expect(failures).toEqual([]);
    const winner = decisions.find((res) => res.status === 200)!;
    expect((await call('GET', target, { token: w.studentC.token })).body).toMatchObject({ status: winner.body.status, version: 1 });
  });

  test('bookings: the admins get one request notification per requester every 10 minutes, not one per request', async () => {
    const admin = w.admin.token;
    const requester = await createUser(admin, 'STUDENT');
    const control = await createUser(admin, 'STUDENT');
    const day = campusDay(10);
    const request = async (person: Person, start: string, end: string) => {
      const res = await call('POST', '/api/bookings', {
        token: person.token,
        json: { resourceType: 'EQUIPMENT', equipment: p.camera, startsAt: `${day}T${start}`, endsAt: `${day}T${end}`, purpose: 'Notification flood check' },
      });
      expect(res.status, res.text).toBe(201);
      expect(res.body.status).toBe('PENDING');
      return res.body.id as string;
    };
    // Booking ids of the BOOKING notifications the admin received (newest first).
    const notified = async () => {
      const res = await call('GET', '/api/notifications?limit=100', { token: admin });
      expect(res.status, res.text).toBe(200);
      return (res.body.items as any[]).filter((item) => item.type === 'BOOKING').map((item) => item.data?.bookingId as string);
    };
    const until = (id: string, what: string) => waitFor(async () => ((await notified()).includes(id) ? true : undefined), what);

    const first = await request(requester, '08:00', '09:00');
    await until(first, "the admin's notification of the first request");
    const later = [await request(requester, '09:00', '10:00'), await request(requester, '10:00', '11:00')];
    // Another requester is notified as usual; once that notification is there, the later ones would be too.
    await until(await request(control, '11:00', '12:00'), "the admin's notification of another requester");
    await pause(1000);
    expect((await notified()).filter((id) => later.includes(id)), 'notifications of the later requests (same requester, < 10 min)').toEqual([]);
    // The requests themselves still reach the admins' queue.
    const queue = await call('GET', `/api/bookings?status=PENDING&user=${requester.id}&limit=100`, { token: admin });
    expect(queue.status, queue.text).toBe(200);
    expect((queue.body.items as any[]).map((item) => item.id).sort()).toEqual([first, ...later].sort());
  });

  test('bookings: creating and cancelling are rate limited per user, whatever the role (429 TOO_MANY_REQUESTS, security backend)', async () => {
    const base = SECURITY_API_URL;
    const adminEmail = uniqueEmail('sec-booking-admin');
    const adminPassword = secret('password', `Sec-${rand()}-Admin-Passw0rd!`);
    createAdmin(adminEmail, adminPassword, 'Ada', 'Admin', SECURITY_MONGO_URI);
    const admin = await login(adminEmail, adminPassword, base);
    const person = async (role: string) => {
      const email = uniqueEmail(`sec-booking-${role.toLowerCase()}`);
      const password = secret('password', `Sec-${rand()}-Passw0rd!`);
      const res = await call('POST', '/api/users', { base, token: admin.token, json: { firstname: 'Rate', lastname: role, email, password, role } });
      expect(res.status, `create ${role}: ${res.text}`).toBe(201);
      return login(email, password, base);
    };
    const student = await person('STUDENT');
    const teacher = await person('TEACHER');
    const other = await person('STUDENT');

    // The limiter runs before the controller: refused bodies (400) and unknown bookings (404) are counted too.
    const create = (token: string) => call('POST', '/api/bookings', { base, token, json: {} });
    const cancel = (token: string) =>
      call('POST', `/api/bookings/${crypto.randomBytes(12).toString('hex')}/cancel`, { base, token, json: { version: 0 } });
    const statuses = async (count: number, send: () => Promise<Res>) => {
      const seen: number[] = [];
      for (let i = 0; i < count; i += 1) seen.push((await send()).status);
      return seen;
    };
    const limited = (label: string, res: Res) => {
      expect(res.status, `${label}: ${res.text}`).toBe(429);
      expect(res.body.code).toBe('TOO_MANY_REQUESTS');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(res.body.details.retryAfter).toBeGreaterThan(0);
      expect(res.headers['ratelimit-policy']).toBe(`${RATE_LIMIT_BOOKING_MAX};w=3600`);
    };
    // A create / cancel loop would notify every admin each time (teachers have no booking limit).
    for (const [who, token] of [['student', student.token], ['teacher', teacher.token]] as const) {
      expect(await statuses(RATE_LIMIT_BOOKING_MAX, () => create(token)), `${who} creations`).toEqual(Array(RATE_LIMIT_BOOKING_MAX).fill(400));
      limited(`${who} creation`, await create(token));
      expect(await statuses(RATE_LIMIT_BOOKING_MAX, () => cancel(token)), `${who} cancellations`).toEqual(Array(RATE_LIMIT_BOOKING_MAX).fill(404));
      limited(`${who} cancellation`, await cancel(token));
    }
    // One counter per user, not per address: another student calling from the same address is not blocked.
    expect((await create(other.token)).status).toBe(400);
    expect((await cancel(other.token)).status).toBe(404);
  });

  test('forum: hidden content stays invisible to others; authors, scores, certification and moderation fields cannot be forged', async () => {
    const A = w.studentA;
    const admin = w.admin.token;
    const word = `zq${rand()}`;
    const failures: string[] = [];

    // Mass assignment.
    const forged = {
      score: 999,
      author: w.admin.id,
      authorSnapshot: { firstname: 'Ada', lastname: 'Admin', role: 'ADMIN' },
      hidden: true,
      hiddenReason: 'Forged',
      viewCount: 999,
      answerCount: 9,
      answersTotal: 9,
      acceptedAnswer: p.answer,
      acceptedAnswerId: p.answer,
      hasCertifiedAnswer: true,
      deleting: true,
      createdAt: '2000-01-01T00:00:00.000Z',
      lastActivityAt: '2000-01-01T00:00:00.000Z',
      id: w.admin.id,
      _id: w.admin.id,
    };
    const asked = await call('POST', '/api/forum/questions', {
      token: A.token,
      json: { title: `Hidden ${word} question about moderation`, body: `Body ${word} of a question that the moderation team hides.`, subject: w.subjectId, tags: [word], status: 'CLOSED', ...forged },
    });
    expect(asked.status, asked.text).toBe(201);
    expect(asked.body).toMatchObject({
      author: { id: A.id, role: 'STUDENT' },
      score: 0,
      hidden: false,
      viewCount: 0,
      answerCount: 0,
      acceptedAnswerId: null,
      hasCertifiedAnswer: false,
      status: 'OPEN',
    });
    expect(asked.body.id).not.toBe(w.admin.id);
    expect(new Date(asked.body.createdAt).getUTCFullYear()).toBeGreaterThan(2000);
    const id = asked.body.id as string;
    expectAnswer(failures, 'PATCH with forged fields only', await call('PATCH', `/api/forum/questions/${id}`, { token: A.token, json: forged }), 400, 'NO_CHANGES');
    const studentAnswer = await call('POST', `/api/forum/questions/${p.question}/answers`, {
      token: w.studentC.token,
      json: { body: 'An answer written by a student', certified: true, accepted: true, score: 50, author: w.teacher1.id, hidden: true, question: id, questionId: id },
    });
    expect(studentAnswer.status, studentAnswer.text).toBe(201);
    expect(studentAnswer.body).toMatchObject({
      questionId: p.question,
      author: { id: w.studentC.id, role: 'STUDENT' },
      certified: false,
      accepted: false,
      score: 0,
      hidden: false,
    });

    // Votes: +1 / -1 numbers only, never on one's own content, a repeated vote removes the first one.
    const voteUrl = `/api/forum/questions/${p.question}/vote`;
    for (const value of [5, '1', 0, null, { $gt: 0 }]) {
      expectAnswer(failures, `vote ${JSON.stringify(value)}`, await call('POST', voteUrl, { token: A.token, json: { value } }), 400, 'VALIDATION_ERROR');
    }
    expectAnswer(failures, 'vote on own question', await call('POST', voteUrl, { token: w.studentB.token, json: { value: 1 } }), 403, 'FORBIDDEN');
    expect((await call('POST', voteUrl, { token: A.token, json: { value: 1 } })).body).toEqual({ score: 1, myVote: 1 });
    expect((await call('POST', voteUrl, { token: A.token, json: { value: 1 } })).body).toEqual({ score: 0, myVote: 0 });

    // Author-only actions (admins moderate, they do not edit other people's content).
    const authorOnly: [string, string, unknown][] = [
      ['PATCH', `/api/forum/questions/${p.question}`, { title: 'Hijacked question title' }],
      ['DELETE', `/api/forum/questions/${p.question}`, undefined],
      ['POST', `/api/forum/questions/${p.question}/accept`, { answerId: p.answer }],
      ['PATCH', `/api/forum/answers/${p.answer}`, { body: 'Hijacked answer' }],
      ['DELETE', `/api/forum/answers/${p.answer}`, undefined],
    ];
    for (const [method, url, json] of authorOnly) {
      expectAnswer(failures, `student C ${method} ${url}`, await call(method, url, { token: w.studentC.token, json }), 403, 'FORBIDDEN');
    }
    for (const [method, url, json] of [authorOnly[0], authorOnly[2], authorOnly[3]]) {
      expectAnswer(failures, `admin ${method} ${url}`, await call(method, url, { token: admin, json }), 403, 'FORBIDDEN');
    }

    // Moderation: a hidden question and a hidden answer.
    const hidden = await call('POST', `/api/forum/questions/${id}/hide`, { token: admin, json: { reason: 'Off topic' } });
    expect(hidden.status, hidden.text).toBe(200);
    expect(hidden.body).toMatchObject({ hidden: true, hiddenReason: 'Off topic' });
    const secretAnswer = `answer-${rand()}`;
    const t2 = await call('POST', `/api/forum/questions/${p.question}/answers`, { token: w.teacher2.token, json: { body: `Hidden answer ${secretAnswer}` } });
    expect(t2.status, t2.text).toBe(201);
    expect((await call('POST', `/api/forum/answers/${t2.body.id}/hide`, { token: admin, json: {} })).body).toMatchObject({ hidden: true });

    const reads = [
      `/api/forum/questions?q=${word}`,
      `/api/forum/questions?tag=${word}`,
      '/api/forum/questions?limit=100',
      `/api/forum/questions?subject=${w.subjectId}&sort=unanswered&limit=100`,
      `/api/forum/questions/similar?title=${word}`,
      `/api/forum/tags?subject=${w.subjectId}&limit=50`,
    ];
    const blocked: [string, string, unknown][] = [
      ['GET', `/api/forum/questions/${id}`, undefined],
      ['PATCH', `/api/forum/questions/${id}`, { title: 'Editing a hidden question' }],
      ['DELETE', `/api/forum/questions/${id}`, undefined],
      ['POST', `/api/forum/questions/${id}/answers`, { body: 'Answering a hidden question' }],
      ['POST', `/api/forum/questions/${id}/vote`, { value: 1 }],
      ['POST', `/api/forum/questions/${id}/follow`, undefined],
      ['POST', `/api/forum/questions/${id}/report`, { reason: 'I can still see it' }],
      ['POST', `/api/forum/answers/${t2.body.id}/vote`, { value: 1 }],
      ['POST', `/api/forum/answers/${t2.body.id}/report`, { reason: 'I can still see it' }],
      ['PATCH', `/api/forum/answers/${t2.body.id}`, { body: 'Editing a hidden answer' }],
    ];
    for (const [who, person] of [['student B', w.studentB], ['student D', p.studentD], ['teacher 1', w.teacher1], ['alumni', w.alumni]] as const) {
      for (const url of reads) {
        const res = await call('GET', url, { token: person.token });
        expectAnswer(failures, `${who} GET ${url}`, res, 200);
        mentions(failures, `${who} GET ${url}`, res, { 'the hidden question': id, 'its tag': word });
      }
      for (const [method, url, json] of blocked) {
        expectAnswer(failures, `${who} ${method} ${url}`, await call(method, url, { token: person.token, json }), 404, 'RESOURCE_NOT_FOUND');
      }
    }
    for (const [who, person] of [['student A', A], ['student C', w.studentC], ['alumni', w.alumni]] as const) {
      const thread = await call('GET', `/api/forum/questions/${p.question}`, { token: person.token });
      expectAnswer(failures, `${who} thread`, thread, 200);
      mentions(failures, `${who} thread`, thread, { 'the hidden answer': t2.body.id, 'its text': secretAnswer });
    }
    expect(failures).toEqual([]);

    // Positive controls: the authors and the admins still see the hidden content, with its notice.
    expect((await call('GET', `/api/forum/questions/${id}`, { token: A.token })).body.question).toMatchObject({ hidden: true, hiddenReason: 'Off topic' });
    expect(((await call('GET', `/api/forum/questions?q=${word}`, { token: admin })).body.items as any[]).map((item) => item.id)).toContain(id);
    expect(((await call('GET', `/api/forum/questions/${p.question}`, { token: w.teacher2.token })).body.answers as any[]).find((item) => item.id === t2.body.id)).toMatchObject({ hidden: true });
  });

  test('attendance: the session teacher (inside the window) or an admin, roster students only, EXCUSED for admins, marks cannot be forged', async () => {
    const t1 = w.teacher1.token;
    const A = w.studentA.id;
    const D = p.studentD.id;
    const url = `/api/attendance/sessions/${p.pastA}`;
    const save = (token: string, json: unknown) => call('PUT', url, { token, json });
    const failures: string[] = [];

    const saved = await save(t1, {
      session: w.sessionB,
      markedBy: w.teacher2.id,
      records: [{ student: A, status: 'ABSENT', note: 'Forged fields', markedBy: w.teacher2.id, markedAt: '2000-01-01T00:00:00.000Z', session: w.sessionB, id: w.admin.id }],
    });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.session.id).toBe(p.pastA);
    const row = (saved.body.roster as any[]).find((item) => item.student.id === A);
    expect(row).toMatchObject({ status: 'ABSENT' });
    expect(new Date(row.markedAt).getUTCFullYear()).toBeGreaterThan(2000);
    const own = await call('GET', '/api/attendance/me', { token: w.studentA.token });
    const record = (own.body.items as any[]).find((item) => item.session.id === p.pastA);
    expect(record).toMatchObject({ status: 'ABSENT', student: { id: A }, markedBy: { id: w.teacher1.id } });
    expect((own.body.items as any[]).some((item) => item.session.id === w.sessionB)).toBe(false);

    // Other students never get A's records.
    for (const [who, person] of [['student D (same group)', p.studentD], ['student B', w.studentB], ['student C', w.studentC]] as const) {
      const res = await call('GET', '/api/attendance/me', { token: person.token });
      expectAnswer(failures, `${who} /attendance/me`, res, 200);
      mentions(failures, `${who} /attendance/me`, res, { "student A's id": A, "student A's record": record.id });
    }

    expectAnswer(failures, 'student of another group', await save(t1, { records: [{ student: w.studentB.id, status: 'ABSENT' }] }), 400, 'VALIDATION_ERROR');
    expectAnswer(failures, 'teacher (not a student)', await save(t1, { records: [{ student: w.teacher2.id, status: 'ABSENT' }] }), 400, 'VALIDATION_ERROR');
    const excuse = await save(t1, { records: [{ student: D, status: 'EXCUSED' }] });
    expectAnswer(failures, 'teacher sets EXCUSED', excuse, 403, 'FORBIDDEN');
    if (excuse.body?.details?.reason !== 'EXCUSED_ADMIN_ONLY') failures.push(`teacher sets EXCUSED: reason ${excuse.body?.details?.reason}`);
    expect((await save(w.admin.token, { records: [{ student: D, status: 'EXCUSED' }] })).status).toBe(200);
    for (const status of ['PRESENT', 'ABSENT', null]) {
      expectAnswer(failures, `teacher changes EXCUSED to ${status}`, await save(t1, { records: [{ student: D, status }] }), 403, 'FORBIDDEN');
    }
    const early = await call('PUT', `/api/attendance/sessions/${w.sessionA}`, { token: t1, json: { records: [{ student: A, status: 'PRESENT' }] } });
    expectAnswer(failures, 'teacher before the roll call opens', early, 403, 'FORBIDDEN');
    if (early.body?.details?.reason !== 'ROLL_CALL_NOT_OPEN') failures.push(`early roll call: reason ${early.body?.details?.reason}`);
    expect(failures).toEqual([]);

    const after = await call('GET', url, { token: w.admin.token });
    expect((after.body.roster as any[]).find((item) => item.student.id === D)).toMatchObject({ status: 'EXCUSED' });
    expect((after.body.roster as any[]).map((item) => item.student.id)).not.toContain(w.studentB.id);
  });

  test("grades: unpublished grades stay hidden, nobody reads another student's score, publication and authorship cannot be forged", async () => {
    const t1 = w.teacher1.token;
    const A = w.studentA;
    const base = `/api/grades/assessments/${p.assessment}`;
    const marker = `comment-${rand()}`;
    const failures: string[] = [];

    const fields = { subject: w.subjectId, group: w.g1, title: `Forged ${rand()}`, type: 'QUIZ', date: campusDay(0) };
    const forgedCreate = await call('POST', '/api/grades/assessments', {
      token: t1,
      json: { ...fields, published: true, publishedAt: '2000-01-01T00:00:00.000Z', createdBy: w.admin.id },
    });
    expectAnswer(failures, 'create with published / createdBy', forgedCreate, 400, 'VALIDATION_ERROR');
    for (const json of [{ published: true }, { publishedAt: '2000-01-01T00:00:00.000Z' }, { createdBy: w.admin.id }, { group: w.g2 }, { subject: w.subjectId }]) {
      expectAnswer(failures, `PATCH ${JSON.stringify(json)}`, await call('PATCH', base, { token: t1, json }), 400, 'VALIDATION_ERROR');
    }
    const sheet = await call('PUT', `${base}/grades`, {
      token: t1,
      json: { published: true, grades: [{ student: A.id, score: 18, comment: `Well done ${marker}`, gradedBy: w.teacher2.id, assessment: w.sessionA, published: true }] },
    });
    expect(sheet.status, sheet.text).toBe(200);
    expect(sheet.body.assessment.published).toBe(false);
    const invalid: [string, unknown[]][] = [
      ['score as a string', [{ student: A.id, score: '18' }]],
      ['score above maxScore', [{ student: A.id, score: 20.5 }]],
      ['negative score', [{ student: A.id, score: -1 }]],
      ['missing score', [{ student: A.id }]],
      ['student of another group', [{ student: w.studentB.id, score: 10 }]],
    ];
    for (const [label, grades] of invalid) {
      expectAnswer(failures, label, await call('PUT', `${base}/grades`, { token: t1, json: { grades } }), 400, 'VALIDATION_ERROR');
    }

    const views = async (person: Person) => [
      await call('GET', '/api/grades/me', { token: person.token }),
      await call('GET', '/api/analytics/me', { token: person.token }),
    ];
    const items = (res: Res) => (res.body?.items ?? res.body?.grades?.items ?? []) as any[];
    // Not published yet: invisible to every student, the graded one included.
    for (const person of [A, p.studentD]) {
      for (const res of await views(person)) {
        expectAnswer(failures, `GET ${res.url}`, res, 200);
        if (items(res).some((item) => item.id === p.assessment)) failures.push(`unpublished assessment listed by ${res.url} for ${person.email}`);
        mentions(failures, `${res.url} before publication`, res, { "the teacher's comment": marker });
      }
    }
    // Publication is claimed once.
    const published = await Promise.all([0, 1, 2].map(() => call('POST', `${base}/publish`, { token: t1 })));
    expect(published.map((res) => `${res.status} ${res.body?.code ?? ''}`.trim()).sort()).toEqual(['200', '409 INVALID_STATE', '409 INVALID_STATE']);
    // A sees their score; D sees the assessment without A's score or comment; B (another group) does not see it.
    for (const res of await views(A)) expect(items(res).find((item) => item.id === p.assessment)).toMatchObject({ score: 18 });
    for (const res of await views(p.studentD)) {
      const item = items(res).find((entry) => entry.id === p.assessment);
      if (!item || item.score !== null) failures.push(`student D ${res.url}: ${JSON.stringify(item)}`);
      mentions(failures, `student D ${res.url}`, res, { "student A's comment": marker, "student A's id": A.id });
    }
    for (const res of await views(w.studentB)) {
      if (items(res).some((item) => item.id === p.assessment)) failures.push(`student B ${res.url} lists another group's assessment`);
    }
    expect(failures).toEqual([]);

    // Published grades never change or disappear without a trace: a teacher cannot delete a published assessment,
    // and every change is in the audit log (scores, never the comments).
    const refused = await call('DELETE', base, { token: t1 });
    expectAnswer(failures, 'teacher deletes a published assessment', refused, 409, 'INVALID_STATE');
    if (refused.body?.details?.reason !== 'PUBLISHED') failures.push(`teacher deletes a published assessment: reason ${refused.body?.details?.reason}`);
    expect((await call('GET', base, { token: t1 })).body).toMatchObject({ published: true });
    const regraded = await call('PUT', `${base}/grades`, { token: t1, json: { grades: [{ student: A.id, score: 17 }] } });
    expect(regraded.status, regraded.text).toBe(200);
    const audit = async (assessment: string) => {
      const res = await call('GET', `/api/audit?targetType=Assessment&targetId=${assessment}&limit=100`, { token: w.admin.token });
      expect(res.status, res.text).toBe(200);
      mentions(failures, `audit log of ${assessment}`, res, { "the teacher's comment": marker });
      return res.body.items as any[];
    };
    const entries = await audit(p.assessment);
    const count = (action: string) => entries.filter((entry) => entry.action === action).length;
    expect(count('grades.assessment.create'), 'grades.assessment.create entries').toBe(1);
    // Three concurrent publications, one success: one entry.
    expect(count('grades.publish'), 'grades.publish entries').toBe(1);
    expect(count('grades.assessment.delete'), 'grades.assessment.delete entries (the deletion was refused)').toBe(0);
    const updates = entries.filter((entry) => entry.action === 'grades.update');
    expect(updates.map((entry) => entry.metadata?.changes)).toEqual(
      expect.arrayContaining([[{ student: A.id, from: null, to: 18 }], [{ student: A.id, from: 18, to: 17 }]])
    );
    const afterPublication = updates.find((entry) => entry.metadata?.changes?.[0]?.to === 17);
    expect(afterPublication).toMatchObject({ actor: { id: w.teacher1.id }, metadata: { published: true } });

    // An admin can still delete a published assessment: its grades go, the audit log keeps them.
    const extra = await call('POST', '/api/grades/assessments', { token: t1, json: { ...fields, title: `Deleted ${rand()}` } });
    expect(extra.status, extra.text).toBe(201);
    const extraUrl = `/api/grades/assessments/${extra.body.id}`;
    expect((await call('PUT', `${extraUrl}/grades`, { token: t1, json: { grades: [{ student: A.id, score: 12, comment: `Deleted ${marker}` }] } })).status).toBe(200);
    expect((await call('POST', `${extraUrl}/publish`, { token: t1 })).status).toBe(200);
    expectAnswer(failures, 'teacher deletes a published assessment (2)', await call('DELETE', extraUrl, { token: t1 }), 409, 'INVALID_STATE');
    expectAnswer(failures, 'admin deletes a published assessment', await call('DELETE', extraUrl, { token: w.admin.token }), 204);
    expectAnswer(failures, 'deleted assessment', await call('GET', extraUrl, { token: w.admin.token }), 404, 'RESOURCE_NOT_FOUND');
    const deletion = (await audit(extra.body.id)).find((entry) => entry.action === 'grades.assessment.delete');
    expect(deletion).toMatchObject({
      actor: { id: w.admin.id },
      metadata: { assessmentId: extra.body.id, published: true, gradesDeleted: 1, grades: [{ student: A.id, score: 12 }] },
    });
    if (items(await call('GET', '/api/grades/me', { token: A.token })).some((item) => item.id === extra.body.id)) failures.push('the deleted assessment is still listed');
    expect(failures).toEqual([]);
  });

  test("analytics: a student only gets their own figures and PDF report, admins any student's", async () => {
    const A = w.studentA;
    const failures: string[] = [];
    const mine = await call('GET', '/api/analytics/me?compare=true', { token: w.studentB.token });
    expect(mine.status, mine.text).toBe(200);
    expect(mine.body.student.id).toBe(w.studentB.id);
    mentions(failures, 'student B /analytics/me', mine, { "student A's id": A.id });

    const pdf = (label: string, res: Res) => {
      const ok =
        res.status === 200 &&
        /^application\/pdf/.test(res.headers['content-type'] ?? '') &&
        res.text.startsWith('%PDF') &&
        /private/.test(res.headers['cache-control'] ?? '') &&
        /no-store/.test(res.headers['cache-control'] ?? '') &&
        /^attachment;/.test(res.headers['content-disposition'] ?? '');
      if (!ok) failures.push(`${label}: ${res.status} ${res.headers['content-type']} ${res.headers['cache-control']} ${res.headers['content-disposition']}`);
    };
    pdf('own report', await call('GET', '/api/analytics/me/report.pdf', { token: A.token }));
    pdf('admin report of a student', await call('GET', `/api/analytics/students/${A.id}/report.pdf?locale=en`, { token: w.admin.token }));
    for (const [who, person] of [['student B', w.studentB], ['student D (same group)', p.studentD], ['teacher of the group', w.teacher1], ['alumni', w.alumni]] as const) {
      for (const suffix of ['', '?compare=true', '/report.pdf', '/report.pdf?locale=fr']) {
        expectAnswer(failures, `${who} /analytics/students/A${suffix}`, await call('GET', `/api/analytics/students/${A.id}${suffix}`, { token: person.token }), 403, 'FORBIDDEN');
      }
    }
    // The admin student view only serves STUDENT accounts.
    for (const other of [w.teacher1.id, w.admin.id]) {
      expectAnswer(failures, `admin view of a non-student ${other}`, await call('GET', `/api/analytics/students/${other}/report.pdf`, { token: w.admin.token }), 404, 'RESOURCE_NOT_FOUND');
    }
    // A teacher's group view only covers the subjects they teach there.
    const group = await call('GET', `/api/analytics/groups/${w.g1}`, { token: w.teacher1.token });
    expectAnswer(failures, 'teacher1 group view', group, 200);
    if (((group.body?.subjects as any[]) ?? []).some((subject) => subject.id !== w.subjectId)) failures.push(`teacher1 group view subjects: ${JSON.stringify(group.body.subjects)}`);
    expect(failures).toEqual([]);
  });

  test("the opt-in group comparison never reveals one student's grades: every figure comes from at least 5 students", async () => {
    const admin = w.admin.token;
    const tag = rand().toUpperCase();
    const group = await call('POST', '/api/academic/groups', {
      token: admin,
      json: { name: `SEC-${tag}-CMP`, level: 4, academicYear: '2026-2027', program: w.programId },
    });
    expect(group.status, group.text).toBe(201);
    const students: Person[] = [];
    for (let i = 0; i < 5; i += 1) students.push(await createUser(admin, 'STUDENT', group.body.id));
    // Publishes one assessment of the subject, graded for some students only (the others stay ungraded: null).
    const publish = async (title: string, scores: [number, number][]) => {
      const assessment = await call('POST', '/api/grades/assessments', {
        token: admin,
        json: { subject: w.subjectId, group: group.body.id, title: `${title} ${tag}`, type: 'EXAM', date: campusDay(0) },
      });
      expect(assessment.status, assessment.text).toBe(201);
      const base = `/api/grades/assessments/${assessment.body.id}`;
      const saved = await call('PUT', `${base}/grades`, { token: admin, json: { grades: scores.map(([i, score]) => ({ student: students[i].id, score })) } });
      expect(saved.status, saved.text).toBe(200);
      expect((await call('POST', `${base}/publish`, { token: admin })).status).toBe(200);
    };
    // The grade figures student 0 sees: { overall, subject } (null = not shown).
    const comparison = async () => {
      const res = await call('GET', '/api/analytics/me?compare=true', { token: students[0].token });
      expect(res.status, res.text).toBe(200);
      expect(res.body.comparison).toMatchObject({ available: true, groupSize: 5 });
      const failures: string[] = [];
      mentions(failures, 'comparison', res, Object.fromEntries(students.slice(1).map((student, i) => [`student ${i + 1}'s id`, student.id])));
      expect(failures).toEqual([]);
      const subject = ((res.body.comparison.grades?.bySubject as any[]) ?? []).find((item) => item.subject?.id === w.subjectId);
      return { overall: res.body.comparison.grades?.overall ?? null, subject: subject?.average ?? null };
    };

    // One student sat the retake: a "group average" would be that student's own average (15.5 / 20).
    await publish('Retake', [[1, 15.5]]);
    expect(await comparison(), 'figures computed from 1 graded student').toEqual({ overall: null, subject: null });
    // Four graded students are still too few (from 2, the others' figures can be derived from one's own).
    await publish('Quiz', [[1, 10], [2, 12], [3, 14], [4, 16]]);
    expect(await comparison(), 'figures computed from 4 graded students').toEqual({ overall: null, subject: null });
    // Five: the group average is shown, rounded to 0.5 (averages 8, 12.75, 12, 14 and 16: 12.55 -> 12.5).
    await publish('Exam', [[0, 8]]);
    expect(await comparison(), 'figures computed from 5 graded students').toEqual({ overall: 12.5, subject: 12.5 });
  });

  test('NoSQL operators and regex payloads in the phase 2 bodies, queries and ids are rejected or neutralized', async () => {
    const admin = w.admin.token;
    const a = w.studentA.token;
    const t1 = w.teacher1.token;
    const ne = { $ne: null };
    const day = campusDay(9);
    const bodies: [string, string, string, unknown, number, string][] = [
      [a, 'POST', '/api/bookings', { resourceType: 'ROOM', room: ne, startsAt: { $gt: '' }, endsAt: { $gt: '' }, purpose: { $ne: '' } }, 400, 'VALIDATION_ERROR'],
      [a, 'POST', '/api/bookings', { resourceType: { $in: ['ROOM'] }, room: w.roomId, startsAt: `${day}T08:00`, endsAt: `${day}T09:00`, purpose: 'Injection' }, 400, 'VALIDATION_ERROR'],
      [a, 'POST', `/api/bookings/${p.booking}/cancel`, { version: { $gte: 0 } }, 400, 'VALIDATION_ERROR'],
      [admin, 'POST', `/api/bookings/${p.booking}/approve`, { version: ne }, 400, 'VALIDATION_ERROR'],
      [admin, 'POST', '/api/resources/equipment', { name: ne, category: { $ne: '' }, active: { $ne: false } }, 400, 'VALIDATION_ERROR'],
      [a, 'POST', '/api/forum/questions', { title: ne, body: { $regex: '.*' }, subject: ne, tags: [{ $gt: '' }] }, 400, 'VALIDATION_ERROR'],
      [a, 'POST', `/api/forum/questions/${p.question}/answers`, { body: ne, clientRequestId: ne }, 400, 'VALIDATION_ERROR'],
      [w.studentB.token, 'PATCH', `/api/forum/questions/${p.question}`, { status: { $ne: 'OPEN' } }, 400, 'VALIDATION_ERROR'],
      [w.studentB.token, 'POST', `/api/forum/questions/${p.question}/accept`, { answerId: ne }, 400, 'VALIDATION_ERROR'],
      [a, 'POST', `/api/forum/answers/${p.answer}/report`, { reason: ne }, 400, 'VALIDATION_ERROR'],
      [t1, 'PUT', `/api/attendance/sessions/${p.pastA}`, { records: [{ student: ne, status: 'ABSENT' }] }, 400, 'VALIDATION_ERROR'],
      [t1, 'PUT', `/api/attendance/sessions/${p.pastA}`, { records: [{ student: w.studentA.id, status: { $in: ['EXCUSED'] } }] }, 400, 'VALIDATION_ERROR'],
      [t1, 'PUT', `/api/attendance/sessions/${p.pastA}`, { records: ne }, 400, 'VALIDATION_ERROR'],
      [t1, 'POST', '/api/grades/assessments', { subject: ne, group: ne, title: ne, type: 'EXAM', date: { $gt: '' } }, 400, 'VALIDATION_ERROR'],
      [t1, 'PUT', `/api/grades/assessments/${p.assessment}/grades`, { grades: [{ student: ne, score: { $gt: 0 } }] }, 400, 'VALIDATION_ERROR'],
      [a, 'GET', `/api/bookings/${OPERATOR_ID}`, undefined, 400, 'INVALID_ID'],
      [a, 'POST', `/api/bookings/${OPERATOR_ID}/cancel`, { version: 0 }, 400, 'INVALID_ID'],
      [a, 'GET', `/api/resources/equipment/${OPERATOR_ID}`, undefined, 400, 'INVALID_ID'],
      [a, 'GET', `/api/forum/questions/${OPERATOR_ID}`, undefined, 400, 'INVALID_ID'],
      [a, 'POST', `/api/forum/answers/${OPERATOR_ID}/vote`, { value: 1 }, 400, 'INVALID_ID'],
      [a, 'GET', `/api/forum/profiles/${OPERATOR_ID}`, undefined, 400, 'INVALID_ID'],
      [t1, 'GET', `/api/attendance/sessions/${OPERATOR_ID}`, undefined, 400, 'INVALID_ID'],
      [t1, 'GET', `/api/grades/assessments/${OPERATOR_ID}`, undefined, 400, 'INVALID_ID'],
      [t1, 'GET', `/api/analytics/groups/${OPERATOR_ID}`, undefined, 400, 'INVALID_ID'],
      [admin, 'GET', `/api/analytics/students/${OPERATOR_ID}`, undefined, 400, 'INVALID_ID'],
    ];
    const failures: string[] = [];
    for (const [token, method, url, json, status, code] of bodies) {
      expectAnswer(failures, `${method} ${url} ${JSON.stringify(json)}`, await call(method, url, { token, json }), status, code);
    }
    const queries: [string, string, number, string][] = [
      [a, `/api/bookings/availability?resourceType=ROOM&resource=.*`, 400, 'VALIDATION_ERROR'],
      [a, `/api/bookings/availability?resourceType=.*&resource=${w.roomId}`, 400, 'VALIDATION_ERROR'],
      [a, '/api/bookings/availability?resourceType=ROOM&resource[$ne]=x', 400, 'MISSING_FIELDS'],
      [a, '/api/bookings/me?status=.*', 400, 'VALIDATION_ERROR'],
      [a, `/api/bookings/free-rooms?from=${day}&to=${campusDay(10)}&type=.*`, 400, 'VALIDATION_ERROR'],
      [admin, '/api/bookings?user=.*', 400, 'VALIDATION_ERROR'],
      [a, '/api/resources/equipment?category=.*', 400, 'VALIDATION_ERROR'],
      [a, '/api/forum/questions?subject=.*', 400, 'VALIDATION_ERROR'],
      [a, '/api/forum/questions?sort=%24natural', 400, 'VALIDATION_ERROR'],
      [a, '/api/forum/questions?level=1%7C%7C1', 400, 'VALIDATION_ERROR'],
      [a, '/api/forum/questions?status=OPEN&status=CLOSED', 400, 'VALIDATION_ERROR'],
      [a, '/api/forum/leaderboard?subject=.*', 400, 'VALIDATION_ERROR'],
      [t1, '/api/grades/assessments?group=.*', 400, 'VALIDATION_ERROR'],
      [t1, '/api/attendance/sessions?group=.*', 400, 'VALIDATION_ERROR'],
      [admin, '/api/attendance/alerts?level=.*', 400, 'VALIDATION_ERROR'],
      [admin, '/api/attendance/alerts?student=.*', 400, 'VALIDATION_ERROR'],
      [a, '/api/attendance/me?from=.*', 400, 'VALIDATION_ERROR'],
      [a, '/api/analytics/me/report.pdf?locale=.*', 400, 'VALIDATION_ERROR'],
    ];
    for (const [token, url, status, code] of queries) expectAnswer(failures, `GET ${url}`, await call('GET', url, { token }), status, code);
    // Regex-looking filters are matched literally, never as patterns.
    for (const url of ['/api/forum/questions?q=.*', '/api/forum/questions?tag=.*', `/api/forum/questions?tag=${encodeURIComponent('^')}`]) {
      const res = await call('GET', url, { token: admin });
      if (res.status !== 200 || res.body?.total !== 0) failures.push(`GET ${url}: ${res.status}, total ${res.body?.total} (the pattern was interpreted)`);
    }
    expect(failures).toEqual([]);
    // Nothing was changed by the refused calls.
    expect((await call('GET', `/api/bookings/${p.booking}`, { token: a })).body).toMatchObject({ status: 'PENDING', version: 0 });
  });
});

// ---------------------------------------------------------------- phase 3: real-time layer, carpooling, marketplace, alumni

/** Socket.IO client of the web app (next/node_modules/socket.io-client): the same library and protocol as the browser. */
type ClientSocket = {
  on(event: string, listener: (...args: any[]) => void): unknown;
  once(event: string, listener: (...args: any[]) => void): unknown;
  onAny(listener: (event: string, ...args: any[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  timeout(ms: number): { emitWithAck(event: string, ...args: unknown[]): Promise<any> };
  disconnect(): unknown;
};
type SocketFactory = (url: string, options: Record<string, unknown>) => ClientSocket;
/** A connection attempt: every event received, why the handshake was refused (null when it was not), whether it closed. */
type Live = { socket: ClientSocket; events: { event: string; payload: any }[]; refused: { message: string; code: string | null } | null; closed: boolean };

let socketFactory: SocketFactory | undefined;
const sockets: ClientSocket[] = [];

/** Opens a Socket.IO connection to the main backend (WebSocket only, no automatic reconnection) and waits for the handshake. */
async function openSocket(auth?: Record<string, unknown>, headers?: Record<string, string>): Promise<Live> {
  socketFactory ??= (require(path.join(NEXT_DIR, 'node_modules', 'socket.io-client')) as { io: SocketFactory }).io;
  const socket = socketFactory(API_URL, {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    timeout: 15_000,
    ...(auth ? { auth } : {}),
    ...(headers ? { extraHeaders: headers } : {}),
  });
  sockets.push(socket);
  const live: Live = { socket, events: [], refused: null, closed: false };
  socket.onAny((event: string, payload: unknown) => live.events.push({ event, payload }));
  socket.on('disconnect', () => {
    live.closed = true;
  });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      live.refused = { message: 'no answer to the handshake', code: null };
      resolve();
    }, 20_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error: { message?: string; data?: { code?: string } }) => {
      clearTimeout(timer);
      live.refused = { message: String(error?.message ?? ''), code: error?.data?.code ?? null };
      resolve();
    });
  });
  return live;
}

const closeSockets = () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
};

/** Ack of `room:join` ({ ok: true } | { ok: false, error }). */
async function joinRoom(live: Live, room: unknown): Promise<{ ok?: boolean; error?: string }> {
  try {
    return await live.socket.timeout(10_000).emitWithAck('room:join', typeof room === 'string' ? { room } : room);
  } catch {
    return { ok: false, error: 'NO_ACK' };
  }
}

const received = (live: Live, event: string) => live.events.filter((item) => item.event === event).map((item) => item.payload);

/** A ticket may only appear in the answer of the ticket endpoint. */
const REALTIME_TICKET_PATHS = /^\/(api|bff)\/realtime\/ticket$/;
/** Key of the real-time tickets (backend/docs/carpool.md): HMAC-SHA256(JWT_SECRET, "campuslink:realtime-ticket:v1"). */
const TICKET_KEY = crypto.createHmac('sha256', JWT_SECRET).update('campuslink:realtime-ticket:v1').digest();

async function realtimeTicket(token: string): Promise<string> {
  const res = await call('GET', '/api/realtime/ticket', { token });
  expect(res.status, `realtime ticket: ${res.text}`).toBe(200);
  return secret('realtime ticket', res.body.ticket, REALTIME_TICKET_PATHS);
}

/** A ticket signed by the test (valid by default: 60 s, audience "realtime", issuer "campuslink"). */
function forgeTicket(sub: string, claims: Record<string, unknown> = {}, key: string | Buffer = TICKET_KEY): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ jti: crypto.randomBytes(16).toString('base64url'), aud: 'realtime', iss: 'campuslink', sub, iat: now, exp: now + 60, ...claims }, key);
}

/** A connection of `person` opened like the web app does (single-use ticket from GET /api/realtime/ticket). */
const webSocketOf = async (person: Person) => openSocket({ ticket: await realtimeTicket(person.token) });

/** Sorted "status CODE" of concurrent answers. */
const outcomes = (results: Res[]) => results.map((res) => `${res.status} ${res.body?.code ?? ''}`.trim()).sort();
const countOf = (list: string[], value: string) => list.filter((item) => item === value).length;

/** Exact departure of the test trips (a street of Ariana) and what everyone but the participants must get (~1 km). */
const EXACT_POINT = { lat: 36.862347, lng: 10.195671 };
const ROUNDED_POINT = { lat: 36.86, lng: 10.2 };
const EXACT_DIGITS = /862347|195671/;

async function offerTrip(driver: Person, json: Record<string, unknown> = {}) {
  const res = await call('POST', '/api/carpool/trips', {
    token: driver.token,
    json: { departure: { label: 'Ariana', ...EXACT_POINT }, departureAt: `${campusDay(2)}T07:45`, seats: 3, pricePerSeat: 2, ...json },
  });
  expect(res.status, `offer a trip: ${res.text}`).toBe(201);
  return res.body as { id: string } & Record<string, any>;
}

async function requestSeat(person: Person, tripId: string, seats = 1): Promise<string> {
  const res = await call('POST', `/api/carpool/trips/${tripId}/requests`, { token: person.token, json: { seats } });
  expect(res.status, `seat request: ${res.text}`).toBe(201);
  return res.body.id;
}

async function acceptSeat(driver: Person, requestId: string) {
  const res = await call('POST', `/api/carpool/requests/${requestId}/accept`, { token: driver.token });
  expect(res.status, `accept: ${res.text}`).toBe(200);
}

const marketForm = (data: Record<string, unknown>, files: File[]) => {
  const form = new FormData();
  form.append('data', JSON.stringify(data));
  files.forEach((item) => form.append('file', item));
  return form;
};

const uploadDocument = (person: Person, data: Record<string, unknown>, files: File[]) =>
  call('POST', '/api/marketplace/documents', { token: person.token, form: marketForm({ subject: w.subjectId, ...data }, files) });

/**
 * A marketplace document of `author` titled "Notes <words>" (its PDF contains `words`), brought to `status` by an admin.
 * Returns its id.
 */
async function marketDocument(author: Person, price: number, words: string, status = 'PUBLISHED'): Promise<string> {
  const res = await uploadDocument(author, { title: `Notes ${words}`, description: `About ${words}`, price }, [
    file(`${words.replace(/\W+/g, '-')}.pdf`, 'application/pdf', pdf(words)),
  ]);
  expect(res.status, `upload: ${res.text}`).toBe(201);
  const id = res.body.id as string;
  const moderate = async (action: string, json?: unknown) => {
    const decided = await call('POST', `/api/marketplace/documents/${id}/${action}`, { token: w.admin.token, json });
    expect(decided.status, `${action}: ${decided.text}`).toBe(200);
  };
  if (status === 'REJECTED') await moderate('reject', { reason: 'Not suitable for the marketplace' });
  if ((status === 'PUBLISHED' || status === 'UNPUBLISHED') && res.body.status !== 'PUBLISHED') await moderate('approve');
  if (status === 'UNPUBLISHED') await moderate('unpublish', { reason: 'Copyright complaint' });
  return id;
}

type WalletJson = { balance: number; transactions: { type: string; amount: number; balanceAfter: number | null }[] };
async function walletOf(person: Person): Promise<WalletJson> {
  const res = await call('GET', '/api/marketplace/wallet?limit=100', { token: person.token });
  expect(res.status, res.text).toBe(200);
  return res.body;
}

const MENTORING_MESSAGE = 'I would love your advice on my final-year project and on my first job search.';

/** An ALUMNI account with a CAMPUS profile (explicit consent) open to mentoring. */
async function listedAlumni(names: { firstname?: string; lastname?: string } = {}, profile: Record<string, unknown> = {}) {
  const person = await createUser(w.admin.token, 'ALUMNI', undefined, names);
  const res = await call('PUT', '/api/alumni/me', {
    token: person.token,
    json: { headline: 'Software engineer', mentoringAvailable: true, mentoringTopics: ['Careers'], visibility: 'CAMPUS', consent: true, ...profile },
  });
  expect(res.status, `alumni profile: ${res.text}`).toBe(200);
  return { ...person, profileId: res.body.id as string };
}

const askMentoring = (student: Person, profileId: string) =>
  call('POST', `/api/alumni/${profileId}/mentoring`, { token: student.token, json: { topic: 'Career advice', message: MENTORING_MESSAGE } });

const cookieOf = (person: Person) => `cl_access=${person.token}; cl_refresh=${person.refreshToken}`;

test.describe('phase 3', () => {
  test.describe.configure({ timeout: 180_000 });
  test.afterEach(() => closeSockets());

  // ---------- real-time layer

  test('real-time: the handshake needs a valid ticket or access token; tickets are single use, short-lived and useless on the REST API', async () => {
    const person = await createUser(w.admin.token, 'STUDENT');
    const failures: string[] = [];

    // GET /api/realtime/ticket: signed-in users only, never cached, 60 s, audience "realtime", subject = the caller.
    expectAnswer(failures, 'anonymous ticket', await call('GET', '/api/realtime/ticket'), 401, 'AUTH_REQUIRED');
    const issued = await call('GET', '/api/realtime/ticket', { token: person.token });
    expect(issued.status, issued.text).toBe(200);
    const ticket = secret('realtime ticket', issued.body.ticket, REALTIME_TICKET_PATHS);
    expect(issued.headers['cache-control']).toMatch(/no-store/);
    const claims = decodeJwt(ticket);
    expect(claims).toMatchObject({ aud: 'realtime', sub: person.id });
    expect(Number(claims.exp) - Number(claims.iat)).toBeLessThanOrEqual(60);
    // A ticket handed to the browser is not an access token.
    expectAnswer(failures, 'ticket as a REST access token', await call('GET', '/api/users/me', { token: ticket }), 401, 'INVALID_TOKEN');
    expectAnswer(failures, 'ticket to get another ticket', await call('GET', '/api/realtime/ticket', { token: ticket }), 401, 'INVALID_TOKEN');

    const now = Math.floor(Date.now() / 1000);
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ jti: rand(), aud: 'realtime', iss: 'campuslink', sub: person.id, exp: now + 60 })}.`;
    const refused: [string, Record<string, unknown> | undefined, string][] = [
      ['no credential', undefined, 'AUTH_REQUIRED'],
      ['empty ticket', { ticket: '' }, 'AUTH_REQUIRED'],
      ['operator object as ticket', { ticket: { $ne: null } }, 'AUTH_REQUIRED'],
      ['malformed ticket', { ticket: 'not-a-ticket' }, 'INVALID_TOKEN'],
      ['expired ticket', { ticket: forgeTicket(person.id, { iat: now - 120, exp: now - 60 }) }, 'TOKEN_EXPIRED'],
      ['ticket signed with JWT_SECRET itself', { ticket: forgeTicket(person.id, {}, JWT_SECRET) }, 'INVALID_TOKEN'],
      ['ticket of another audience', { ticket: forgeTicket(person.id, { aud: 'api' }) }, 'INVALID_TOKEN'],
      ['unsigned ticket (alg none)', { ticket: unsigned }, 'INVALID_TOKEN'],
      ['ticket of an unknown account', { ticket: forgeTicket(crypto.randomBytes(12).toString('hex')) }, 'INVALID_TOKEN'],
      ['access token sent as a ticket', { ticket: person.token }, 'INVALID_TOKEN'],
      ['ticket sent as an access token', { token: ticket }, 'INVALID_TOKEN'],
      ['expired access token', { token: expiredAccessToken(person.id, 'STUDENT', JWT_SECRET) }, 'TOKEN_EXPIRED'],
      ['access token signed with another secret', { token: signJwt({ role: 'ADMIN', sub: person.id, iat: now, exp: now + 600 }, 'not-the-secret') }, 'INVALID_TOKEN'],
    ];
    for (const [label, auth, code] of refused) {
      const live = await openSocket(auth);
      if (live.refused?.code !== code) failures.push(`${label}: ${live.refused ? `refused with ${live.refused.code}` : 'connected'}, expected ${code}`);
    }

    // The issued ticket works once. Positive controls: a valid ticket (test key) and the access token (Flutter).
    const first = await openSocket({ ticket });
    if (first.refused) failures.push(`issued ticket refused: ${first.refused.code}`);
    const replay = await openSocket({ ticket });
    if (replay.refused?.code !== 'INVALID_TOKEN') failures.push(`replayed ticket: ${replay.refused ? replay.refused.code : 'connected'}`);
    if ((await openSocket({ ticket: forgeTicket(person.id) })).refused) failures.push('a valid ticket signed with the derived key was refused');
    if ((await openSocket({ token: `Bearer ${person.token}` })).refused) failures.push('the access token was refused');

    // Browsers: the Origin must be the web app (CORS headers do not protect WebSockets).
    for (const origin of ['http://evil.example', `${WEB_ORIGIN}.evil.example`, 'null']) {
      const live = await openSocket({ ticket: await realtimeTicket(person.token) }, { Origin: origin });
      if (!live.refused) failures.push(`Origin ${origin} accepted`);
    }
    if ((await openSocket({ ticket: await realtimeTicket(person.token) }, { Origin: WEB_ORIGIN })).refused) failures.push('the web app origin was refused');

    // Bounded resources: 20 connections per account, 16 KB per client message.
    const crowd = await createUser(w.admin.token, 'STUDENT');
    for (let i = 0; i < 20; i += 1) {
      const live = await openSocket({ token: crowd.token });
      if (live.refused) failures.push(`connection ${i + 1} of 20 refused: ${live.refused.code}`);
    }
    const extra = await openSocket({ token: crowd.token });
    if (extra.refused?.code !== 'TOO_MANY_CONNECTIONS') failures.push(`21st connection: ${extra.refused?.code ?? 'connected'}`);
    first.socket.emit('room:join', { room: `trip:${'a'.repeat(20 * 1024)}` });
    await waitFor(async () => (first.closed ? true : undefined), 'the server to close a connection that sent 20 KB', 10_000).catch(() =>
      failures.push('a 20 KB client message did not close the connection')
    );
    expect(failures).toEqual([]);
  });

  test('real-time and carpool: only the driver and the accepted passengers join trip:<id> and get its chat; notification:new only reaches its recipient', async () => {
    const admin = w.admin.token;
    const [driver, passenger, pending, outsider] = await Promise.all([
      createUser(admin, 'STUDENT'),
      createUser(admin, 'STUDENT'),
      createUser(admin, 'STUDENT'),
      createUser(admin, 'STUDENT'),
    ]);
    const trip = await offerTrip(driver);
    const room = `trip:${trip.id}`;
    const chat = `/api/carpool/trips/${trip.id}/messages`;
    const accepted = await requestSeat(passenger, trip.id);
    await acceptSeat(driver, accepted);
    const waiting = await requestSeat(pending, trip.id);

    const live = {
      driver: await webSocketOf(driver),
      passenger: await webSocketOf(passenger),
      pending: await openSocket({ token: pending.token }), // the Flutter handshake
      outsider: await webSocketOf(outsider),
      admin: await webSocketOf(w.admin),
    };
    for (const [who, item] of Object.entries(live)) expect(item.refused, `${who} handshake`).toBeNull();

    const failures: string[] = [];
    const join = async (who: keyof typeof live, target: unknown, ok: boolean, error?: string) => {
      const ack = await joinRoom(live[who], target);
      if (Boolean(ack?.ok) !== ok || (error && ack?.error !== error)) failures.push(`${who} joins ${JSON.stringify(target).slice(0, 80)}: ${JSON.stringify(ack)}`);
    };
    await join('driver', room, true);
    await join('passenger', room, true);
    await join('pending', room, false, 'FORBIDDEN');
    await join('outsider', room, false, 'FORBIDDEN');
    await join('admin', room, false, 'FORBIDDEN');
    await join('outsider', room.replace(/[a-f]/g, (c) => c.toUpperCase()), false, 'FORBIDDEN');
    await join('outsider', `user:${driver.id}`, false, 'FORBIDDEN');
    await join('outsider', `TRIP:${trip.id}`, false, 'INVALID_ROOM');
    await join('outsider', `admin:${trip.id}`, false, 'UNKNOWN_ROOM');
    await join('outsider', 'trip:{"$ne":null}', false, 'INVALID_ROOM');
    await join('outsider', { room: { $ne: null } }, false, 'INVALID_ROOM');

    // Client events are never relayed to other sockets.
    live.outsider.socket.emit('chat:message', { tripId: trip.id, body: 'spoofed message' });
    live.outsider.socket.emit('notification:new', { id: 'spoofed', type: 'CARPOOL', title: 'spoofed' });

    const marker = `chat-${rand()}`;
    const sent = await call('POST', chat, { token: driver.token, json: { body: `Meet at 7:40 ${marker}` } });
    expect(sent.status, sent.text).toBe(201);
    const message = await waitFor(async () => received(live.passenger, 'chat:message').find((item) => item?.body?.includes(marker)), "the passenger's chat:message");
    expect(Object.keys(message).sort()).toEqual(['body', 'clientRequestId', 'createdAt', 'id', 'sender', 'tripId']);
    expect(Object.keys(message.sender).sort()).toEqual(['firstname', 'id', 'lastname']);
    await pause(1000);
    for (const who of ['pending', 'outsider', 'admin'] as const) {
      for (const event of ['chat:message', 'trip:updated']) if (received(live[who], event).length > 0) failures.push(`${who} received ${event}`);
    }
    if (received(live.passenger, 'chat:message').some((item) => item?.body === 'spoofed message')) failures.push('a chat:message sent by a client was relayed');
    if (received(live.passenger, 'notification:new').some((item) => item?.id === 'spoofed')) failures.push('a notification:new sent by a client was relayed');

    // The chat history: participants only (403 for pending passengers, other students, admins, teachers).
    for (const [who, person] of [['pending passenger', pending], ['other student', outsider], ['admin', w.admin], ['teacher', w.teacher1]] as const) {
      expectAnswer(failures, `${who} reads the chat`, await call('GET', chat, { token: person.token }), 403, 'FORBIDDEN');
      expectAnswer(failures, `${who} writes in the chat`, await call('POST', chat, { token: person.token, json: { body: 'Let me in' } }), 403, 'FORBIDDEN');
    }
    const history = await call('GET', chat, { token: passenger.token });
    expect(history.status, history.text).toBe(200);
    expect((history.body.items as any[]).map((item) => item.body)).toEqual([`Meet at 7:40 ${marker}`]);

    // The driver declines the pending request: only that passenger's sockets get notification:new.
    const declined = await call('POST', `/api/carpool/requests/${waiting}/decline`, { token: driver.token, json: { message: 'Sorry, full' } });
    expect(declined.status, declined.text).toBe(200);
    const hint = await waitFor(async () => received(live.pending, 'notification:new').find((item) => item?.type === 'CARPOOL'), "the declined passenger's notification:new");
    expect(Object.keys(hint).sort()).toEqual(['id', 'title', 'type']);
    const inbox = await call('GET', '/api/notifications?limit=20', { token: pending.token });
    expect((inbox.body.items as any[]).map((item) => item.id)).toContain(hint.id);
    await pause(1000);
    for (const who of ['driver', 'passenger', 'outsider', 'admin'] as const) {
      if (received(live[who], 'notification:new').some((item) => item?.id === hint.id)) failures.push(`${who} received another user's notification:new`);
    }
    await join('pending', room, false, 'FORBIDDEN');

    // A passenger who gives up the seat leaves the room at once and loses the chat.
    expect((await call('POST', `/api/carpool/requests/${accepted}/cancel`, { token: passenger.token })).status).toBe(200);
    const later = `later-${rand()}`;
    expect((await call('POST', chat, { token: driver.token, json: { body: `Still coming? ${later}` } })).status).toBe(201);
    await waitFor(async () => received(live.driver, 'chat:message').find((item) => item?.body?.includes(later)), "the driver's own chat:message");
    await pause(1000);
    if (received(live.passenger, 'chat:message').some((item) => item?.body?.includes(later))) failures.push('the passenger who cancelled still receives the chat');
    expectAnswer(failures, 'former passenger reads the chat', await call('GET', chat, { token: passenger.token }), 403, 'FORBIDDEN');
    await join('passenger', room, false, 'FORBIDDEN');
    expect(failures).toEqual([]);
  });

  test('real-time: a password change (every session revoked) also ends the connections opened before it', async () => {
    // Pushes stop with the revoked sessions (their subscriptions are deleted); an open socket must stop too.
    const admin = w.admin.token;
    const tag = rand().toUpperCase();
    const group = await call('POST', '/api/academic/groups', {
      token: admin,
      json: { name: `SEC-${tag}-RT`, level: 4, academicYear: '2026-2027', program: w.programId },
    });
    expect(group.status, group.text).toBe(201);
    const person = await createUser(admin, 'STUDENT', group.body.id);
    const connections = {
      'web (ticket)': await webSocketOf(person),
      'mobile (access token)': await openSocket({ token: person.token }),
      // A ticket without a session (`sid`): closed with every session of the account (backend/docs/carpool.md).
      'ticket without a session': await openSocket({ ticket: forgeTicket(person.id) }),
    };
    for (const [label, live] of Object.entries(connections)) expect(live.refused, label).toBeNull();
    // Issued before the change, used after it.
    const unusedTicket = await realtimeTicket(person.token);

    const changed = secret('password', `Sec-${rand()}-Changed3!`);
    const change = await call('POST', '/api/auth/change-password', { token: person.token, json: { currentPassword: person.password, newPassword: changed } });
    expect(change.status, change.text).toBe(200);
    const failures: string[] = [];
    // The server closes them: they do not only stop receiving.
    await waitFor(async () => (Object.values(connections).every((live) => live.closed) ? true : undefined), 'the server to close the connections', 10_000).catch(() =>
      failures.push(`still open after the password change: ${Object.entries(connections).filter(([, live]) => !live.closed).map(([label]) => label).join(', ')}`)
    );
    // The credentials of the revoked sessions open nothing, even before they expire.
    const lateTicket = await openSocket({ ticket: unusedTicket });
    if (lateTicket.refused?.code !== 'INVALID_TOKEN') failures.push(`ticket of a revoked session: ${lateTicket.refused?.code ?? 'connected'}`);
    const oldToken = await openSocket({ token: person.token });
    if (oldToken.refused?.code !== 'INVALID_TOKEN') failures.push(`access token of a revoked session: ${oldToken.refused?.code ?? 'connected'}`);
    expectAnswer(failures, 'ticket for the access token of a revoked session', await call('GET', '/api/realtime/ticket', { token: person.token }), 401, 'INVALID_TOKEN');

    const session = await login(person.email, changed);
    const fresh = await webSocketOf({ ...person, ...session });
    expect(fresh.refused, 'positive control: the new session connects').toBeNull();
    // Something new for the account: an announcement to its group (in-app notification, so notification:new).
    const published = await announce(admin, { title: `Realtime ${tag}`, body: 'After the password change', audience: { groups: [group.body.id] }, action: 'publish' });
    expect(published.status, published.text).toBe(201);
    const notification = await waitFor(async () => {
      const list = await call('GET', '/api/notifications?limit=20', { token: session.token });
      return (list.body.items as any[]).find((item) => item.data?.announcementId === published.body.id);
    }, 'the notification of the announcement');
    await waitFor(async () => received(fresh, 'notification:new').find((item) => item?.id === notification.id), "positive control: the new session's notification:new");
    await pause(1000);
    const leaked = Object.entries(connections)
      .filter(([, live]) => received(live, 'notification:new').some((item) => item?.id === notification.id))
      .map(([label]) => label);
    expect(leaked, 'connections opened before the password change still receive the notifications of the account').toEqual([]);
    expect(failures).toEqual([]);
  });

  test('real-time: a logout closes the connections of that session only, a role change closes them all, and a session ended elsewhere cannot join a room', async () => {
    const admin = w.admin.token;
    const person = await createUser(admin, 'STUDENT');
    const second = { ...person, ...(await login(person.email, person.password)) }; // another device
    const failures: string[] = [];
    const openOf = (label: string, group: Record<string, Live>) => Object.entries(group).filter(([, live]) => !live.closed).map(([name]) => `${label} ${name}`);

    const ended = { 'web (ticket)': await webSocketOf(person), 'mobile (access token)': await openSocket({ token: person.token }) };
    const kept = { 'web (ticket)': await webSocketOf(second), 'mobile (access token)': await openSocket({ token: second.token }) };
    for (const [label, live] of [...Object.entries(ended), ...Object.entries(kept)]) expect(live.refused, label).toBeNull();
    const unusedTicket = await realtimeTicket(person.token);

    // Logout of the first session: its connections close, the other device's stay open.
    const out = await call('POST', '/api/auth/logout', { json: { refreshToken: person.refreshToken } });
    expect(out.status, out.text).toBe(204);
    await waitFor(async () => (openOf('', ended).length === 0 ? true : undefined), 'the server to close the connections of the ended session', 10_000).catch(() =>
      failures.push(`still open after the logout: ${openOf('ended session', ended).join(', ')}`)
    );
    await pause(1000);
    if (openOf('', kept).length !== 2) failures.push('a logout closed the connections of another session of the account');
    const lateTicket = await openSocket({ ticket: unusedTicket });
    if (lateTicket.refused?.code !== 'INVALID_TOKEN') failures.push(`ticket of a logged-out session: ${lateTicket.refused?.code ?? 'connected'}`);
    const oldToken = await openSocket({ token: person.token });
    if (oldToken.refused?.code !== 'INVALID_TOKEN') failures.push(`access token of a logged-out session: ${oldToken.refused?.code ?? 'connected'}`);
    expectAnswer(failures, 'ticket for the access token of a logged-out session', await call('GET', '/api/realtime/ticket', { token: person.token }), 401, 'INVALID_TOKEN');

    // Role change by an admin: every connection closes (rooms were joined under the old role); the session reconnects.
    const promoted = await call('PATCH', `/api/users/${person.id}`, { token: admin, json: { role: 'ALUMNI' } });
    expect(promoted.status, promoted.text).toBe(200);
    await waitFor(async () => (openOf('', kept).length === 0 ? true : undefined), 'the server to close the connections after the role change', 10_000).catch(() =>
      failures.push(`still open after the role change: ${openOf('other session', kept).join(', ')}`)
    );
    const again = await openSocket({ token: second.token });
    if (again.refused) failures.push(`positive control: the open session cannot reconnect after the role change (${again.refused.code})`);

    // A session ended by another process (no immediate disconnection): the next room:join is refused and closes the socket.
    withTestDb(
      `await db.collection('refreshtokens').deleteMany({ user: new mongoose.Types.ObjectId(process.env.CL_USER) });`,
      { CL_USER: person.id }
    );
    const ack = await joinRoom(again, `trip:${'0'.repeat(24)}`);
    if (ack?.error !== 'AUTH_REQUIRED') failures.push(`room:join after the session ended elsewhere: ${JSON.stringify(ack)}`);
    await waitFor(async () => (again.closed ? true : undefined), 'the server to close the connection of a session ended elsewhere', 10_000).catch(() =>
      failures.push('the connection of a session ended elsewhere stayed open after room:join')
    );
    expect(failures).toEqual([]);
  });

  // ---------- carpooling

  test('carpool: exact coordinates only reach the driver and the accepted passengers (about 1 km for everyone else, search included)', async () => {
    const admin = w.admin.token;
    const [driver, passenger, pending, outsider] = await Promise.all([
      createUser(admin, 'STUDENT'),
      createUser(admin, 'STUDENT'),
      createUser(admin, 'STUDENT'),
      createUser(admin, 'STUDENT'),
    ]);
    const trip = await offerTrip(driver);
    const back = await offerTrip(driver, { direction: 'FROM_CAMPUS', departure: undefined, destination: { label: 'Ariana', ...EXACT_POINT } });
    const accepted = await requestSeat(passenger, trip.id);
    await acceptSeat(driver, accepted);
    const pendingAnswer = await call('POST', `/api/carpool/trips/${trip.id}/requests`, { token: pending.token, json: { seats: 1 } });
    expect(pendingAnswer.status, pendingAnswer.text).toBe(201);

    const failures: string[] = [];
    const exact = (label: string, res: Res, json: any, end = 'departure') => {
      const place = json?.[end];
      if (json?.exactLocation !== true || place?.lat !== EXACT_POINT.lat || place?.lng !== EXACT_POINT.lng) failures.push(`${label}: ${res.status} ${JSON.stringify(place)}`);
    };
    const rounded = (label: string, res: Res, json: any, end = 'departure') => {
      const place = json?.[end];
      if (!json) failures.push(`${label}: trip missing (${res.status} ${res.body?.code ?? ''})`);
      else if (json.exactLocation !== false || place?.lat !== ROUNDED_POINT.lat || place?.lng !== ROUNDED_POINT.lng) failures.push(`${label}: ${JSON.stringify(place)}`);
      if (EXACT_DIGITS.test(res.text)) failures.push(`${label}: the exact coordinates are in the answer`);
    };
    const get = (person: Person, url: string) => call('GET', url, { token: person.token });
    const detail = `/api/carpool/trips/${trip.id}`;
    let res = await get(driver, detail);
    exact('driver', res, res.body);
    res = await get(passenger, detail);
    exact('accepted passenger', res, res.body);
    for (const [who, person] of [['pending passenger', pending], ['other student', outsider], ['admin', w.admin]] as const) {
      res = await get(person, detail);
      rounded(who, res, res.body);
    }
    rounded('answer to the pending request', pendingAnswer, pendingAnswer.body.trip);
    res = await get(pending, '/api/carpool/me/trips?role=passenger&limit=100');
    rounded('pending passenger /me/trips', res, (res.body.items as any[])?.find((item) => item.id === trip.id));
    // Search next to the exact address: found, rounded; the distance is computed from the rounded point.
    res = await get(outsider, `/api/carpool/trips?lat=${EXACT_POINT.lat}&lng=${EXACT_POINT.lng}&radiusKm=2&limit=100`);
    rounded('search by location', res, (res.body.items as any[])?.find((item) => item.id === trip.id));
    res = await get(outsider, '/api/carpool/trips?limit=100');
    rounded('search without location', res, (res.body.items as any[])?.find((item) => item.id === trip.id));
    // The arrival of a trip leaving the campus is protected the same way.
    res = await get(outsider, `/api/carpool/trips/${back.id}`);
    rounded('FROM_CAMPUS trip, other student', res, res.body, 'destination');
    res = await get(driver, `/api/carpool/trips/${back.id}`);
    exact('FROM_CAMPUS trip, driver', res, res.body, 'destination');
    // A passenger who gives up the seat goes back to the rounded view.
    expect((await call('POST', `/api/carpool/requests/${accepted}/cancel`, { token: passenger.token })).status).toBe(200);
    res = await get(passenger, detail);
    rounded('former passenger', res, res.body);
    expect(failures).toEqual([]);
  });

  test('carpool: only students drive, book, chat and rate; drivers answer their own requests; seatsLeft, status, driver and ratings cannot be forged', async () => {
    const admin = w.admin.token;
    const [driver, passenger, outsider] = await Promise.all([createUser(admin, 'STUDENT'), createUser(admin, 'STUDENT'), createUser(admin, 'STUDENT')]);
    const trip = await offerTrip(driver, { notes: 'Original notes' });
    const tripUrl = `/api/carpool/trips/${trip.id}`;
    const requestId = await requestSeat(passenger, trip.id);
    const newTrip = { departure: { label: 'Ariana', ...EXACT_POINT }, departureAt: `${campusDay(3)}T08:00`, seats: 2 };
    const studentOnly: Endpoint[] = [
      { method: 'POST', path: '/api/carpool/trips', json: newTrip },
      { method: 'PATCH', path: tripUrl, json: { notes: 'Hacked' } },
      { method: 'GET', path: `${tripUrl}/requests` },
      { method: 'POST', path: `${tripUrl}/requests`, json: { seats: 1 } },
      { method: 'POST', path: `/api/carpool/requests/${requestId}/accept` },
      { method: 'POST', path: `/api/carpool/requests/${requestId}/decline`, json: {} },
      { method: 'POST', path: `/api/carpool/requests/${requestId}/cancel` },
      { method: 'GET', path: `${tripUrl}/messages` },
      { method: 'POST', path: `${tripUrl}/messages`, json: { body: 'Hacked' } },
      { method: 'POST', path: `${tripUrl}/ratings`, json: { userId: driver.id, score: 1 } },
    ];
    const reads: Endpoint[] = [
      { method: 'GET', path: '/api/carpool/trips' },
      { method: 'GET', path: tripUrl },
      { method: 'GET', path: '/api/carpool/me/trips' },
      { method: 'POST', path: `${tripUrl}/cancel`, json: { reason: 'Hacked' } },
    ];
    const failures: string[] = [];
    const attempt = async (who: string, token: string | undefined, ep: Endpoint, status: number, code: string) =>
      expectAnswer(failures, `${who} ${ep.method} ${ep.path}`, await call(ep.method, ep.path, { token, json: ep.json }), status, code);
    const open: Endpoint[] = [{ method: 'GET', path: '/api/carpool/places' }, { method: 'GET', path: '/api/carpool/settings' }];
    for (const ep of [...studentOnly, ...reads, ...open]) await attempt('anonymous', undefined, ep, 401, 'AUTH_REQUIRED');
    for (const ep of [...studentOnly, ...reads]) {
      await attempt('TEACHER', w.teacher1.token, ep, 403, 'FORBIDDEN');
      await attempt('ALUMNI', w.alumni.token, ep, 403, 'FORBIDDEN');
    }
    for (const ep of studentOnly) await attempt('ADMIN', admin, ep, 403, 'FORBIDDEN');
    // Another student is not the driver: 403 on the trip, 404 on its requests (they cannot see them).
    for (const ep of [studentOnly[1], studentOnly[2], reads[3]]) await attempt('other student', outsider.token, ep, 403, 'FORBIDDEN');
    for (const ep of studentOnly.slice(4, 7)) await attempt('other student', outsider.token, ep, 404, 'RESOURCE_NOT_FOUND');
    // The passenger cannot answer their own request; the driver cannot cancel it for them.
    await attempt('passenger', passenger.token, studentOnly[4], 403, 'FORBIDDEN');
    await attempt('driver', driver.token, studentOnly[6], 403, 'FORBIDDEN');
    expect(failures).toEqual([]);
    const kept = await call('GET', tripUrl, { token: driver.token });
    expect(kept.body).toMatchObject({ notes: 'Original notes', status: 'OPEN', seatsLeft: 3, cancelReason: null });
    expect((kept.body.requests as any[]).find((item) => item.id === requestId)).toMatchObject({ status: 'PENDING' });

    // Mass assignment: the server computes seatsLeft, status, driver, ratings and the search point.
    const forged = {
      seatsLeft: 6,
      status: 'FULL',
      driver: outsider.id,
      driverSnapshot: { firstname: 'Ada', lastname: 'Admin' },
      rating: 5,
      ratingCount: 99,
      exactLocation: true,
      searchPoint: { type: 'Point', coordinates: [0, 0] },
      myRole: 'DRIVER',
      cancelledBy: 'ADMIN',
      cancelReason: 'Forged',
      completedAt: new Date().toISOString(),
      source: 'SEED',
      createdAt: '2000-01-01T00:00:00.000Z',
      id: w.admin.id,
      _id: w.admin.id,
    };
    const created = await call('POST', '/api/carpool/trips', { token: driver.token, json: { ...newTrip, pricePerSeat: 1, ...forged } });
    expect(created.status, created.text).toBe(201);
    expect(created.body).toMatchObject({
      status: 'OPEN',
      seats: 2,
      seatsLeft: 2,
      cancelledBy: null,
      cancelReason: null,
      driver: { id: driver.id, rating: null, ratingCount: 0 },
    });
    expect(created.body.id).not.toBe(w.admin.id);
    expect(new Date(created.body.createdAt).getUTCFullYear()).toBeGreaterThan(2000);
    const near = async (lat: number, lng: number) =>
      ((await call('GET', `/api/carpool/trips?lat=${lat}&lng=${lng}&radiusKm=20&limit=100`, { token: outsider.token })).body.items as any[]).map((item) => item.id);
    expect(await near(0, 0), 'the trip is found at the forged search point').not.toContain(created.body.id);
    expect(await near(EXACT_POINT.lat, EXACT_POINT.lng)).toContain(created.body.id);
    expectAnswer(failures, 'PATCH with forged fields only', await call('PATCH', `/api/carpool/trips/${created.body.id}`, { token: driver.token, json: forged }), 400, 'NO_CHANGES');
    const forgedRequest = await call('POST', `/api/carpool/trips/${created.body.id}/requests`, {
      token: passenger.token,
      json: { seats: 1, status: 'ACCEPTED', passenger: outsider.id, trip: trip.id, active: false, decidedAt: new Date().toISOString(), cancelledBy: 'TRIP' },
    });
    expect(forgedRequest.status, forgedRequest.text).toBe(201);
    expect(forgedRequest.body).toMatchObject({ status: 'PENDING', tripId: created.body.id, passenger: { id: passenger.id }, decidedAt: null, cancelledBy: null });
    expect(forgedRequest.body.trip).toMatchObject({ seatsLeft: 2, myRole: null, exactLocation: false });

    // Ratings after the trip: rater and roles come from the server, once per rated participant.
    await acceptSeat(driver, requestId);
    withTestDb(
      `await db.collection('trips').updateOne({ _id: new mongoose.Types.ObjectId(process.env.CL_TRIP) }, { $set: { departureAt: new Date(Date.now() - 2 * 3600 * 1000) } });`,
      { CL_TRIP: trip.id }
    );
    const rate = (person: Person, json: Record<string, unknown>) => call('POST', `${tripUrl}/ratings`, { token: person.token, json });
    const rated = await rate(passenger, {
      userId: driver.id,
      score: 5,
      comment: 'Great driver',
      rater: outsider.id,
      raterId: outsider.id,
      raterRole: 'DRIVER',
      rateeRole: 'PASSENGER',
      trip: created.body.id,
      createdAt: '2000-01-01T00:00:00.000Z',
    });
    expect(rated.status, rated.text).toBe(201);
    expect(rated.body).toMatchObject({ tripId: trip.id, raterId: passenger.id, rateeId: driver.id, raterRole: 'PASSENGER', rateeRole: 'DRIVER', score: 5 });
    expectAnswer(failures, 'second rating of the same participant', await rate(passenger, { userId: driver.id, score: 1 }), 409, 'ALREADY_RATED');
    expect(outcomes(await Promise.all([1, 2, 3].map(() => rate(driver, { userId: passenger.id, score: 4 }))))).toEqual(['201', '409 ALREADY_RATED', '409 ALREADY_RATED']);
    expectAnswer(failures, 'a non-participant rates', await rate(outsider, { userId: driver.id, score: 1 }), 403, 'FORBIDDEN');
    expectAnswer(failures, 'rating oneself', await rate(driver, { userId: driver.id, score: 5 }), 400, 'VALIDATION_ERROR');
    expectAnswer(failures, 'rating a non-participant', await rate(passenger, { userId: outsider.id, score: 5 }), 400, 'VALIDATION_ERROR');
    for (const score of [6, 0, 4.5, { $gt: 0 }, [5]]) {
      expectAnswer(failures, `score ${JSON.stringify(score)}`, await rate(driver, { userId: passenger.id, score }), 400, 'VALIDATION_ERROR');
    }
    expect(failures).toEqual([]);
    const after = await call('GET', tripUrl, { token: outsider.token });
    expect(after.body.driver).toMatchObject({ id: driver.id, rating: 5, ratingCount: 1 });
  });

  test('carpool: simultaneous seat requests and accepts never overbook a trip, and a seat is given back only once', async () => {
    const admin = w.admin.token;
    const [driver, ...riders] = await Promise.all(Array.from({ length: 10 }, () => createUser(admin, 'STUDENT')));
    // Five passengers for two seats: the driver accepts all of them at once.
    const small = await offerTrip(driver, { seats: 2 });
    const smallRequests: string[] = [];
    for (const rider of riders.slice(0, 5)) smallRequests.push(await requestSeat(rider, small.id));
    const accepts = await Promise.all(smallRequests.map((id) => call('POST', `/api/carpool/requests/${id}/accept`, { token: driver.token })));
    expect(outcomes(accepts)).toEqual(['200', '200', '409 TRIP_FULL', '409 TRIP_FULL', '409 TRIP_FULL']);
    const full = await call('GET', `/api/carpool/trips/${small.id}`, { token: driver.token });
    expect(full.body).toMatchObject({ seats: 2, seatsLeft: 0, status: 'FULL' });
    expect((full.body.requests as any[]).filter((item) => item.status === 'ACCEPTED')).toHaveLength(2);

    // An accepted passenger cancels three times at once: the seat comes back once.
    const index = accepts.findIndex((res) => res.status === 200);
    const cancels = await Promise.all([0, 1, 2].map(() => call('POST', `/api/carpool/requests/${smallRequests[index]}/cancel`, { token: riders[index].token })));
    expect(outcomes(cancels)).toEqual(['200', '409 INVALID_STATE', '409 INVALID_STATE']);
    expect((await call('GET', `/api/carpool/trips/${small.id}`, { token: driver.token })).body).toMatchObject({ seatsLeft: 1, status: 'OPEN' });

    // Three requests of two seats for three seats: one accepted.
    const big = await offerTrip(driver, { seats: 3 });
    const bigRequests: string[] = [];
    for (const rider of riders.slice(5, 8)) bigRequests.push(await requestSeat(rider, big.id, 2));
    const bigAccepts = await Promise.all(bigRequests.map((id) => call('POST', `/api/carpool/requests/${id}/accept`, { token: driver.token })));
    expect(outcomes(bigAccepts)).toEqual(['200', '409 TRIP_FULL', '409 TRIP_FULL']);
    expect((await call('GET', `/api/carpool/trips/${big.id}`, { token: driver.token })).body).toMatchObject({ seatsLeft: 1, status: 'OPEN' });

    // The same request sent six times at once: one request.
    const repeated = await Promise.all(Array.from({ length: 6 }, () => call('POST', `/api/carpool/trips/${big.id}/requests`, { token: riders[8].token, json: { seats: 1 } })));
    const results = outcomes(repeated);
    expect(countOf(results, '201'), results.join(' | ')).toBe(1);
    expect(countOf(results, '409 ALREADY_REQUESTED'), results.join(' | ')).toBe(5);
  });

  // ---------- notes marketplace

  test('marketplace: a premium file only reaches its buyers, its author and admins; documents that are not published are invisible (404) to everyone else', async () => {
    const admin = w.admin.token;
    const [author, buyer, outsider] = await Promise.all([createUser(admin, 'STUDENT'), createUser(admin, 'STUDENT'), createUser(admin, 'STUDENT')]);
    const marker = `doc${rand()}`;
    const premium = await marketDocument(author, 20, `${marker} premium`);
    const free = await marketDocument(author, 0, `${marker} free`);
    const hidden: Record<string, string> = {
      PENDING_REVIEW: await marketDocument(author, 5, `${marker} pending`, 'PENDING_REVIEW'),
      REJECTED: await marketDocument(author, 5, `${marker} rejected`, 'REJECTED'),
      UNPUBLISHED: await marketDocument(author, 5, `${marker} unpublished`, 'UNPUBLISHED'),
    };
    const failures: string[] = [];
    const download = (person: Person, id: string) => call('GET', `/api/marketplace/documents/${id}/file`, { token: person.token, headers: { Accept: '*/*' } });
    const others: Record<string, Person> = { buyer, 'other student': outsider, teacher: w.teacher1, alumni: w.alumni };

    for (const [who, person] of Object.entries(others)) expectAnswer(failures, `${who} downloads the premium file before buying`, await download(person, premium), 404, 'RESOURCE_NOT_FOUND');
    for (const [who, person] of [['author', author], ['admin', w.admin]] as const) {
      const res = await download(person, premium);
      if (res.status !== 200 || !res.text.includes(`${marker} premium`)) failures.push(`${who} downloads the premium file: ${res.status}`);
    }
    const bought = await call('POST', `/api/marketplace/documents/${premium}/purchase`, { token: buyer.token, json: { expectedPrice: 20 } });
    expect(bought.status, bought.text).toBe(201);
    const own = await download(buyer, premium);
    expect(own.status).toBe(200);
    expect(own.text).toContain(`${marker} premium`);
    expect(own.headers['content-disposition']).toMatch(/^attachment;/);
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    expect(own.headers['cache-control']).toMatch(/no-store/);
    for (const [who, person] of [['other student', outsider], ['teacher', w.teacher1]] as const) {
      expectAnswer(failures, `${who} downloads the premium file after someone bought it`, await download(person, premium), 404, 'RESOURCE_NOT_FOUND');
    }
    expect((await download(outsider, free)).status).toBe(200);

    for (const [status, id] of Object.entries(hidden)) {
      const base = `/api/marketplace/documents/${id}`;
      const blocked: [string, string, unknown][] = [
        ['GET', base, undefined],
        ['GET', `${base}/file`, undefined],
        ['GET', `${base}/reviews`, undefined],
        ['POST', `${base}/purchase`, {}],
        ['POST', `${base}/report`, { reason: 'Looks copied from a book' }],
        ['PUT', `${base}/review`, { rating: 5 }],
        ['PATCH', base, { price: 0 }],
        ['DELETE', base, undefined],
      ];
      for (const [who, person] of Object.entries(others)) {
        for (const [method, url, json] of blocked) {
          expectAnswer(failures, `${who} ${method} ${status} ${url.slice(base.length) || '/'}`, await call(method, url, { token: person.token, json }), 404, 'RESOURCE_NOT_FOUND');
        }
      }
      for (const [who, person] of [['author', author], ['admin', w.admin]] as const) expectAnswer(failures, `${who} GET ${status}`, await call('GET', base, { token: person.token }), 200);
    }
    const listed = async (person: Person, query: string) => {
      const res = await call('GET', `/api/marketplace/documents?${query}`, { token: person.token });
      if (res.status !== 200) failures.push(`${query}: ${res.status} ${res.body?.code}`);
      return ((res.body?.items as any[]) ?? []).map((item) => item.id as string);
    };
    for (const [who, person] of Object.entries(others)) {
      for (const query of [`q=${marker}&limit=100`, `author=${author.id}&limit=100`, 'purchased=true&limit=100', 'sort=oldest&limit=100']) {
        const ids = await listed(person, query);
        for (const [status, id] of Object.entries(hidden)) if (ids.includes(id)) failures.push(`${who} lists the ${status} document (${query})`);
      }
      expectAnswer(failures, `${who} filters by status`, await call('GET', '/api/marketplace/documents?status=PENDING_REVIEW,REJECTED,UNPUBLISHED', { token: person.token }), 403, 'FORBIDDEN');
      const mine = await listed(person, 'mine=true&status=PENDING_REVIEW,REJECTED,UNPUBLISHED&limit=100');
      if (Object.values(hidden).some((id) => mine.includes(id))) failures.push(`${who} sees the author's documents with mine=true`);
    }
    expect(failures).toEqual([]);
    // Positive controls.
    expect(await listed(outsider, `q=${marker}&limit=100`)).toEqual(expect.arrayContaining([premium, free]));
    expect(await listed(author, 'mine=true&limit=100')).toEqual(expect.arrayContaining(Object.values(hidden)));
  });

  test('marketplace: purchases never double-charge nor go below zero, the price is the server\'s, sellers never learn who bought, and wallets have no write route', async () => {
    const admin = w.admin.token;
    const richName = `Rich${rand()}`;
    const [author, seller, buyer, rich] = await Promise.all([
      createUser(admin, 'STUDENT'),
      createUser(admin, 'TEACHER'),
      createUser(admin, 'STUDENT'),
      createUser(admin, 'STUDENT', undefined, { lastname: richName }),
    ]);
    const marker = `wallet${rand()}`;
    const premium = await marketDocument(author, 20, `${marker} premium`);
    const free = await marketDocument(author, 0, `${marker} free`);
    const pending = await marketDocument(author, 10, `${marker} pending`, 'PENDING_REVIEW');
    const failures: string[] = [];
    const buy = (person: Person, id: string, json: unknown = {}) => call('POST', `/api/marketplace/documents/${id}/purchase`, { token: person.token, json });

    expect((await walletOf(buyer)).balance).toBe(100);
    expectAnswer(failures, "buying one's own document", await buy(author, premium), 403, 'FORBIDDEN');
    expectAnswer(failures, 'buying a free document', await buy(buyer, free), 409, 'INVALID_STATE');
    expectAnswer(failures, 'buying a document under review', await buy(buyer, pending), 404, 'RESOURCE_NOT_FOUND');
    expectAnswer(failures, 'buying at another price', await buy(buyer, premium, { expectedPrice: 0 }), 409, 'PRICE_CHANGED');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const url of ['/api/marketplace/wallet', '/api/marketplace/wallet/transactions']) {
        const res = await call(method, url, { token: buyer.token, json: { balance: 9999, amount: 9999, type: 'STARTING_BONUS' } });
        if (res.status !== 404) failures.push(`${method} ${url} -> ${res.status}`);
      }
    }
    expect((await walletOf(buyer)).balance).toBe(100);

    // The price, the buyer and the state come from the server.
    const bought = await buy(buyer, premium, { expectedPrice: 20, price: 0, amount: 0, balance: 9999, buyer: rich.id, buyerId: rich.id, kind: 'FREE', state: 'COMPLETED' });
    expect(bought.status, bought.text).toBe(201);
    expect(bought.body).toMatchObject({ balance: 80, purchase: { price: 20, documentId: premium, kind: 'PURCHASE' } });
    expect((await call('GET', `/api/marketplace/wallet?user=${author.id}&userId=${author.id}`, { token: buyer.token })).body.balance).toBe(80);
    expect((await walletOf(rich)).balance).toBe(100);

    // The same purchase ten times at once: one charge.
    const second = await marketDocument(author, 15, `${marker} second`);
    const repeated = outcomes(await Promise.all(Array.from({ length: 10 }, () => buy(buyer, second))));
    expect(countOf(repeated, '201'), repeated.join(' | ')).toBe(1);
    expect(countOf(repeated, '409 ALREADY_PURCHASED'), repeated.join(' | ')).toBe(9);
    expect((await walletOf(buyer)).balance).toBe(65);

    // Three 50-token documents bought three times each, all at once, with 100 tokens: two purchases, balance 0.
    const expensive = [await marketDocument(seller, 50, `${marker} one`), await marketDocument(seller, 50, `${marker} two`), await marketDocument(seller, 50, `${marker} three`)];
    const race = outcomes(await Promise.all(expensive.flatMap((id) => [0, 1, 2].map(() => buy(rich, id)))));
    expect(countOf(race, '201'), race.join(' | ')).toBe(2);
    expect(race.filter((item) => !['201', '409 ALREADY_PURCHASED', '409 INSUFFICIENT_TOKENS'].includes(item)), race.join(' | ')).toEqual([]);
    const wallet = await walletOf(rich);
    expect(wallet.balance).toBe(0);
    expect(wallet.transactions.reduce((sum, item) => sum + item.amount, 0)).toBe(wallet.balance);
    expect(wallet.transactions.filter((item) => item.type === 'PURCHASE').map((item) => item.amount)).toEqual([-50, -50]);
    expect(wallet.transactions.every((item) => item.balanceAfter === null || item.balanceAfter >= 0)).toBe(true);

    // The seller is credited exactly once per sale and never learns who bought.
    const sales = await call('GET', '/api/marketplace/wallet?limit=100', { token: seller.token });
    expect(sales.body.balance).toBe(200);
    expect((sales.body.transactions as any[]).filter((item) => item.type === 'SALE').map((item) => item.amount)).toEqual([50, 50]);
    const buyerTraces = { "the buyer's id": rich.id, "the buyer's name": richName, "the buyer's e-mail": rich.email };
    mentions(failures, "the seller's wallet", sales, buyerTraces);
    const notified = await waitFor(async () => {
      const res = await call('GET', '/api/notifications?limit=100', { token: seller.token });
      return (res.body.items as any[]).filter((item) => item.type === 'MARKETPLACE' && item.data?.kind === 'SALE').length >= 2 ? res : undefined;
    }, "the seller's sale notifications");
    mentions(failures, "the seller's notifications", notified, buyerTraces);
    expect(failures).toEqual([]);
  });

  test('marketplace: uploads check the file and ignore forged fields; only buyers and downloaders review, once; authors never review their own documents', async () => {
    const admin = w.admin.token;
    const [author, buyer, reader, outsider] = await Promise.all([createUser(admin, 'STUDENT'), createUser(admin, 'STUDENT'), createUser(admin, 'STUDENT'), createUser(admin, 'STUDENT')]);
    const marker = `review${rand()}`;
    const failures: string[] = [];

    const forged = {
      status: 'PUBLISHED',
      author: w.admin.id,
      authorSnapshot: { firstname: 'Ada', lastname: 'Admin' },
      rating: 5,
      ratingSum: 50,
      ratingCount: 10,
      downloads: 999,
      sales: 9,
      purchasesInFlight: 0,
      file: { key: '../../../backend/.env', filename: 'env.txt', size: 1, mimeType: 'text/plain' },
      publishedAt: '2000-01-01T00:00:00.000Z',
      rejectionReason: 'Forged',
      purchased: true,
      id: w.admin.id,
      _id: w.admin.id,
      createdAt: '2000-01-01T00:00:00.000Z',
    };
    const uploaded = await uploadDocument(author, { title: `Forged ${marker}`, price: 10, ...forged }, [file(`${marker}.pdf`, 'application/pdf', pdf(marker))]);
    expect(uploaded.status, uploaded.text).toBe(201);
    expect(uploaded.body).toMatchObject({
      status: 'PENDING_REVIEW',
      author: { id: author.id },
      rating: 0,
      ratingCount: 0,
      downloads: 0,
      publishedAt: null,
      rejectionReason: null,
      file: { filename: `${marker}.pdf`, mimeType: 'application/pdf' },
    });
    expect(uploaded.body.id).not.toBe(w.admin.id);
    expect(new Date(uploaded.body.createdAt).getUTCFullYear()).toBeGreaterThan(2000);
    expectAnswer(failures, 'PATCH with forged fields only', await call('PATCH', `/api/marketplace/documents/${uploaded.body.id}`, { token: author.token, json: forged }), 400, 'NO_CHANGES');
    expectAnswer(failures, 'other student approves', await call('POST', `/api/marketplace/documents/${uploaded.body.id}/approve`, { token: outsider.token }), 403, 'FORBIDDEN');

    const rejected = `rejected-${rand()}`;
    const refused: [string, File[], number, string][] = [
      ['HTML named .pdf', [file('notes.pdf', 'application/pdf', `<html><script>alert(1)</script>${rejected}</html>`)], 415, 'UNSUPPORTED_FILE_TYPE'],
      ['SVG', [file('notes.svg', 'image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">${rejected}</svg>`)], 415, 'UNSUPPORTED_FILE_TYPE'],
      ['executable', [file('notes.exe', 'application/x-msdownload', `MZ ${rejected}`)], 415, 'UNSUPPORTED_FILE_TYPE'],
      ['text file', [file('notes.txt', 'text/plain', rejected)], 415, 'UNSUPPORTED_FILE_TYPE'],
      ['real PDF named .html', [file('notes.html', 'application/pdf', pdf(rejected))], 415, 'UNSUPPORTED_FILE_TYPE'],
      ['two files', [file('a.pdf', 'application/pdf', pdf(rejected)), file('b.pdf', 'application/pdf', pdf(rejected))], 400, 'TOO_MANY_FILES'],
    ];
    for (const [label, files, status, code] of refused) expectAnswer(failures, label, await uploadDocument(author, { title: `Refused ${marker}` }, files), status, code);
    expectAnswer(failures, 'ALUMNI upload', await uploadDocument(w.alumni, { title: `Alumni ${marker}` }, [file('a.pdf', 'application/pdf', pdf(rejected))]), 403, 'FORBIDDEN');
    expect(listFiles(STORAGE_DIR).filter((item) => fs.readFileSync(item).includes(rejected)), 'refused files must not be stored').toEqual([]);

    // Reviews: buyers (premium) and downloaders (free), never the author, one per user.
    const premium = await marketDocument(author, 10, `${marker} premium`);
    const free = await marketDocument(author, 0, `${marker} free`);
    const review = (person: Person, id: string, json: Record<string, unknown>) => call('PUT', `/api/marketplace/documents/${id}/review`, { token: person.token, json });
    const refusedReview = (label: string, res: Res, reason: string) => {
      expectAnswer(failures, label, res, 403, 'FORBIDDEN');
      if (res.status === 403 && res.body?.details?.reason !== reason) failures.push(`${label}: reason ${res.body?.details?.reason}`);
    };
    refusedReview('review without buying', await review(outsider, premium, { rating: 1 }), 'NOT_ACQUIRED');
    refusedReview("author reviews their own document", await review(author, premium, { rating: 5 }), 'OWN_DOCUMENT');
    refusedReview('review of a free document never downloaded', await review(reader, free, { rating: 1 }), 'NOT_ACQUIRED');
    expect((await call('POST', `/api/marketplace/documents/${premium}/purchase`, { token: buyer.token, json: {} })).status).toBe(201);
    const first = await review(buyer, premium, { rating: 4, comment: '$set', author: outsider.id, documentId: free, ratingCount: 99, editedAt: '2000-01-01T00:00:00.000Z', id: w.admin.id });
    expect(first.status, first.text).toBe(201);
    expect(first.body).toMatchObject({ documentId: premium, author: { id: buyer.id }, rating: 4, comment: '$set', editedAt: null });
    const edits = await Promise.all([5, 3, 2, 1, 5].map((rating) => review(buyer, premium, { rating, comment: '$inc' })));
    if (edits.some((res) => res.status !== 200)) failures.push(`concurrent edits: ${outcomes(edits).join(' | ')}`);
    const doc = await call('GET', `/api/marketplace/documents/${premium}`, { token: outsider.token });
    expect(doc.body.ratingCount).toBe(1);
    expect(doc.body.rating).toBeGreaterThanOrEqual(1);
    expect(doc.body.rating).toBeLessThanOrEqual(5);
    const reviews = await call('GET', `/api/marketplace/documents/${premium}/reviews`, { token: outsider.token });
    expect(reviews.body.total).toBe(1);
    expect(reviews.body.items[0]).toMatchObject({ author: { id: buyer.id }, comment: '$inc' });
    // Downloading a free document gives the right to review it.
    expect((await call('GET', `/api/marketplace/documents/${free}/file`, { token: reader.token, headers: { Accept: '*/*' } })).status).toBe(200);
    expect((await review(reader, free, { rating: 5 })).status).toBe(201);
    expectAnswer(failures, 'author reports their own document', await call('POST', `/api/marketplace/documents/${premium}/report`, { token: author.token, json: { reason: 'Reporting myself' } }), 403, 'FORBIDDEN');
    for (const ep of [`/api/marketplace/documents/${premium}/approve`, `/api/marketplace/documents/${premium}/unpublish`, '/api/marketplace/reports']) {
      for (const [who, person] of [['author', author], ['teacher', w.teacher1], ['alumni', w.alumni]] as const) {
        const method = ep.endsWith('/reports') ? 'GET' : 'POST';
        expectAnswer(failures, `${who} ${method} ${ep}`, await call(method, ep, { token: person.token, json: method === 'POST' ? { reason: 'Hacked' } : undefined }), 403, 'FORBIDDEN');
      }
    }
    expect(failures).toEqual([]);
  });

  // ---------- alumni network

  test('alumni: a PRIVATE profile is never listed nor readable by others, and CAMPUS needs an explicit consent the client cannot forge', async () => {
    const admin = w.admin.token;
    const marker = `skill${rand()}`;
    const [hidden, student] = await Promise.all([createUser(admin, 'ALUMNI'), createUser(admin, 'STUDENT')]);
    const listed = await listedAlumni();
    const failures: string[] = [];
    const put = (person: Person, json: unknown) => call('PUT', '/api/alumni/me', { token: person.token, json });

    for (const json of [{ visibility: 'CAMPUS' }, { visibility: 'CAMPUS', consentAt: '2020-01-01T00:00:00.000Z' }, { visibility: 'CAMPUS', consent: false }, { visibility: 'CAMPUS', consent: 'yes' }]) {
      const res = await put(hidden, { headline: `Private ${marker}`, ...json });
      if (res.status !== 400 || res.body?.code !== 'VALIDATION_ERROR' || !res.body?.details?.consent) failures.push(`PUT ${JSON.stringify(json)} -> ${res.status} ${res.body?.code}`);
    }
    const saved = await put(hidden, {
      headline: `Private ${marker}`,
      skills: [marker],
      company: `Company ${marker}`,
      mentoringAvailable: true,
      user: student.id,
      id: w.admin.id,
      _id: w.admin.id,
      consentAt: '2020-01-01T00:00:00.000Z',
      email: 'forged@campuslink.test',
      updatedAt: '2000-01-01T00:00:00.000Z',
    });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body).toMatchObject({ user: { id: hidden.id }, visibility: 'PRIVATE', consentAt: null, headline: `Private ${marker}` });
    expect(saved.body.id).not.toBe(w.admin.id);
    const profileId = saved.body.id as string;

    const outsiders: Record<string, Person> = { student, teacher: w.teacher1, 'listed alumni': listed, 'alumni without profile': w.alumni };
    for (const [who, person] of Object.entries(outsiders)) {
      for (const [label, id] of [['profile id', profileId], ['user id', hidden.id]]) {
        expectAnswer(failures, `${who} GET the private profile by ${label}`, await call('GET', `/api/alumni/${id}`, { token: person.token }), 404, 'RESOURCE_NOT_FOUND');
      }
      for (const query of [`q=${marker}`, `skill=${marker}`, `q=Company%20${marker}`, 'mentoring=true&limit=100', 'sort=recent&limit=100']) {
        const res = await call('GET', `/api/alumni?${query}`, { token: person.token });
        expectAnswer(failures, `${who} directory ${query}`, res, 200);
        mentions(failures, `${who} directory ${query}`, res, { 'the private profile': profileId, 'its marker': marker, "its owner's id": hidden.id });
      }
      mentions(failures, `${who} facets`, await call('GET', '/api/alumni/facets', { token: person.token }), { 'the private skill': marker });
      expectAnswer(failures, `${who} support list`, await call('GET', '/api/alumni/admin/profiles', { token: person.token }), 403, 'FORBIDDEN');
    }
    expectAnswer(failures, 'a student asks the private profile for mentoring', await askMentoring(student, profileId), 404, 'RESOURCE_NOT_FOUND');
    // Support: admins see it, marked as not listed.
    expect((await call('GET', `/api/alumni/${profileId}`, { token: admin })).status).toBe(200);
    const support = await call('GET', `/api/alumni/admin/profiles?q=${marker}`, { token: admin });
    expect((support.body.items as any[]).find((item) => item.id === profileId)).toMatchObject({ listed: false, visibility: 'PRIVATE' });

    // Withdrawing the consent hides a listed profile at once; listing it again needs a new consent.
    expect((await call('GET', `/api/alumni/${listed.profileId}`, { token: student.token })).status).toBe(200);
    expect((await put(listed, { consent: false })).body).toMatchObject({ visibility: 'PRIVATE', consentAt: null });
    expectAnswer(failures, 'profile after the consent was withdrawn', await call('GET', `/api/alumni/${listed.profileId}`, { token: student.token }), 404, 'RESOURCE_NOT_FOUND');
    expectAnswer(failures, 'CAMPUS again without a new consent', await put(listed, { visibility: 'CAMPUS' }), 400, 'VALIDATION_ERROR');
    expect(failures).toEqual([]);
  });

  test('alumni: e-mails are only shared inside an accepted mentoring request, the export only holds the caller\'s data, and the erasure removes or anonymizes everything', async () => {
    const admin = w.admin.token;
    const leavingName = `Erased${rand()}`;
    const [student, otherStudent, pendingMentee, acceptedMentee, otherAlumni] = await Promise.all([
      createUser(admin, 'STUDENT'),
      createUser(admin, 'STUDENT'),
      createUser(admin, 'STUDENT'),
      createUser(admin, 'STUDENT'),
      createUser(admin, 'ALUMNI'),
    ]);
    const mentor = await listedAlumni();
    const leaving = await listedAlumni({ lastname: leavingName });
    const failures: string[] = [];
    const emails = { "the mentor's e-mail": mentor.email, "the student's e-mail": student.email };

    const asked = await askMentoring(student, mentor.profileId);
    expect(asked.status, asked.text).toBe(201);
    expect(asked.body.contact).toBeNull();
    mentions(failures, 'request answer', asked, emails);
    const requestUrl = `/api/alumni/mentoring/${asked.body.id}`;
    for (const [who, person] of [['mentor', mentor], ['student', student], ['admin', w.admin]] as const) {
      const res = await call('GET', requestUrl, { token: person.token });
      expectAnswer(failures, `${who} reads the pending request`, res, 200);
      mentions(failures, `${who} pending request`, res, emails);
    }
    mentions(failures, "the mentor's list", await call('GET', '/api/alumni/mentoring?role=mentor', { token: mentor.token }), emails);
    mentions(failures, "the mentor's profile", await call('GET', `/api/alumni/${mentor.profileId}`, { token: student.token }), emails);
    for (const [who, person] of [['other student', otherStudent], ['other alumni', otherAlumni]] as const) {
      expectAnswer(failures, `${who} reads it`, await call('GET', requestUrl, { token: person.token }), 404, 'RESOURCE_NOT_FOUND');
      expectAnswer(failures, `${who} accepts it`, await call('POST', `${requestUrl}/accept`, { token: person.token, json: {} }), 404, 'RESOURCE_NOT_FOUND');
      expectAnswer(failures, `${who} closes it`, await call('POST', `${requestUrl}/close`, { token: person.token }), 404, 'RESOURCE_NOT_FOUND');
    }
    expectAnswer(failures, 'the mentee accepts their own request', await call('POST', `${requestUrl}/accept`, { token: student.token, json: {} }), 403, 'FORBIDDEN');
    expectAnswer(failures, 'an admin accepts it', await call('POST', `${requestUrl}/accept`, { token: admin, json: {} }), 403, 'FORBIDDEN');

    // Accepted: both e-mails, for the two participants only (the body cannot set the contact or the status).
    const accepted = await call('POST', `${requestUrl}/accept`, { token: mentor.token, json: { reply: 'Happy to help', status: 'CLOSED', contact: { mentorEmail: 'x@evil.example' } } });
    expect(accepted.status, accepted.text).toBe(200);
    const contact = { mentorEmail: mentor.email, menteeEmail: student.email };
    expect(accepted.body).toMatchObject({ status: 'ACCEPTED', contact });
    expect((await call('GET', requestUrl, { token: student.token })).body.contact).toEqual(contact);
    const adminView = await call('GET', requestUrl, { token: admin });
    expect(adminView.body.contact).toBeNull();
    mentions(failures, 'admin view of the accepted request', adminView, emails);
    expectAnswer(failures, 'other student after the acceptance', await call('GET', requestUrl, { token: otherStudent.token }), 404, 'RESOURCE_NOT_FOUND');
    mentions(failures, "the mentor's profile after the acceptance", await call('GET', `/api/alumni/${mentor.profileId}`, { token: student.token }), emails);
    const closed = await call('POST', `${requestUrl}/close`, { token: student.token });
    expect(closed.body).toMatchObject({ status: 'CLOSED', contact: null });
    mentions(failures, 'closed request', closed, emails);

    // Export: the caller's own data only, whatever the query says.
    const privateMarker = `private${rand()}`;
    expect((await call('PUT', '/api/alumni/me', { token: otherAlumni.token, json: { headline: `Other ${privateMarker}` } })).status).toBe(200);
    expect((await call('POST', '/api/alumni/posts', { token: mentor.token, json: { type: 'OTHER', body: `My own news ${rand()}` } })).status).toBe(201);
    const exported = await call('GET', `/api/alumni/me/export?user=${otherAlumni.id}&userId=${otherAlumni.id}`, { token: mentor.token });
    expect(exported.status, exported.text).toBe(200);
    expect(exported.headers['content-disposition']).toMatch(/^attachment;/);
    expect(exported.headers['cache-control']).toMatch(/no-store/);
    expect(exported.body.user).toMatchObject({ id: mentor.id, email: mentor.email });
    expect(exported.body.posts).toHaveLength(1);
    mentions(failures, 'export', exported, {
      "another alumni's id": otherAlumni.id,
      "another alumni's profile": privateMarker,
      "another alumni's e-mail": otherAlumni.email,
      "the student's e-mail (request closed)": student.email,
    });
    for (const [who, person] of [['student', student], ['teacher', w.teacher1], ['admin', w.admin]] as const) {
      expectAnswer(failures, `${who} export`, await call('GET', '/api/alumni/me/export', { token: person.token }), 403, 'FORBIDDEN');
      expectAnswer(failures, `${who} erase`, await call('DELETE', '/api/alumni/me', { token: person.token }), 403, 'FORBIDDEN');
    }

    // Erasure: profile and posts deleted, the alumni's side of the mentoring history anonymized.
    const postMarker = `farewell${rand()}`;
    const replyMarker = `reply${rand()}`;
    expect((await call('POST', '/api/alumni/posts', { token: leaving.token, json: { type: 'NEW_JOB', body: `New job ${postMarker}` } })).status).toBe(201);
    const open = await askMentoring(pendingMentee, leaving.profileId);
    const answered = await askMentoring(acceptedMentee, leaving.profileId);
    expect([open.status, answered.status]).toEqual([201, 201]);
    expect((await call('POST', `/api/alumni/mentoring/${answered.body.id}/accept`, { token: leaving.token, json: { reply: `Sure ${replyMarker}` } })).status).toBe(200);
    const erased = await call('DELETE', '/api/alumni/me', { token: leaving.token });
    expect(erased.status, erased.text).toBe(204);

    const traces = {
      "the erased alumni's id": leaving.id,
      'their last name': leavingName,
      'their e-mail': leaving.email,
      'their reply': replyMarker,
      'their post': postMarker,
      'their profile id': leaving.profileId,
    };
    for (const [who, person] of [['pending mentee', pendingMentee], ['accepted mentee', acceptedMentee]] as const) {
      const list = await call('GET', '/api/alumni/mentoring?role=mentee&limit=100', { token: person.token });
      expect(list.status, list.text).toBe(200);
      const item = (list.body.items as any[])[0];
      if (!item || item.status !== 'CLOSED' || item.mentor !== null || item.contact !== null) failures.push(`${who}: ${JSON.stringify(item)}`);
      mentions(failures, `${who} requests`, list, traces);
    }
    for (const [who, person] of [['student', pendingMentee], ['admin', w.admin]] as const) {
      expectAnswer(failures, `${who} reads the erased profile`, await call('GET', `/api/alumni/${leaving.profileId}`, { token: person.token }), 404, 'RESOURCE_NOT_FOUND');
      mentions(failures, `${who} news wall`, await call('GET', '/api/alumni/posts?limit=100', { token: person.token }), traces);
      mentions(failures, `${who} directory`, await call('GET', `/api/alumni?q=${leavingName}`, { token: person.token }), traces);
    }
    mentions(failures, 'support list', await call('GET', '/api/alumni/admin/profiles?limit=100', { token: admin }), traces);
    const after = await call('GET', '/api/alumni/me/export', { token: leaving.token });
    expect(after.body).toMatchObject({ profile: null, posts: [], mentoring: { asMentor: [], asMentee: [] } });
    const left = Number(
      withTestDb(
        `const id = new mongoose.Types.ObjectId(process.env.CL_USER);
        const counts = await Promise.all([
          db.collection('alumniprofiles').countDocuments({ user: id }),
          db.collection('alumniposts').countDocuments({ author: id }),
          db.collection('mentoringrequests').countDocuments({ $or: [{ mentor: id }, { 'mentorSnapshot.lastname': process.env.CL_NAME }, { reply: { $regex: process.env.CL_REPLY } }] }),
        ]);
        process.stdout.write(String(counts.reduce((sum, value) => sum + value, 0)));`,
        { CL_USER: leaving.id, CL_NAME: leavingName, CL_REPLY: replyMarker }
      )
    );
    expect(left, 'documents of the erased alumni left in the database').toBe(0);
    expect(failures).toEqual([]);
  });

  test('alumni and real-time: an admin deleting an ALUMNI account erases its posts, profile and mentoring traces, and closes its open connections', async () => {
    const admin = w.admin.token;
    const leavingName = `Deleted${rand()}`;
    const [student, viewer] = await Promise.all([createUser(admin, 'STUDENT'), createUser(admin, 'STUDENT')]);
    const leaving = await listedAlumni({ lastname: leavingName });
    const postMarker = `goodbye${rand()}`;
    const replyMarker = `reply${rand()}`;
    const posted = await call('POST', '/api/alumni/posts', { token: leaving.token, json: { type: 'NEW_JOB', body: `New job ${postMarker}` } });
    expect(posted.status, posted.text).toBe(201);
    const asked = await askMentoring(student, leaving.profileId);
    expect(asked.status, asked.text).toBe(201);
    const accepted = await call('POST', `/api/alumni/mentoring/${asked.body.id}/accept`, { token: leaving.token, json: { reply: `Sure ${replyMarker}` } });
    expect(accepted.status, accepted.text).toBe(200);
    const before = await call('GET', `/api/alumni/posts?author=${leaving.id}`, { token: viewer.token });
    expect(before.body.total, before.text).toBe(1);
    const live = { 'web (ticket)': await webSocketOf(leaving), 'mobile (access token)': await openSocket({ token: leaving.token }) };
    for (const [label, item] of Object.entries(live)) expect(item.refused, label).toBeNull();

    const deleted = await call('DELETE', `/api/users/${leaving.id}`, { token: admin });
    expect(deleted.status, deleted.text).toBe(204);

    const failures: string[] = [];
    const traces = {
      "the deleted alumni's id": leaving.id,
      'their last name': leavingName,
      'their post': postMarker,
      'their reply': replyMarker,
      'their profile id': leaving.profileId,
    };
    for (const [who, person] of [['student', viewer], ['admin', w.admin]] as const) {
      const posts = await call('GET', `/api/alumni/posts?author=${leaving.id}`, { token: person.token });
      expectAnswer(failures, `${who} lists the posts of the deleted account`, posts, 200);
      if (posts.body?.total !== 0) failures.push(`${who}: ${posts.body?.total} post(s) of the deleted account still listed`);
      mentions(failures, `${who} news wall`, await call('GET', '/api/alumni/posts?limit=100', { token: person.token }), traces);
      mentions(failures, `${who} directory`, await call('GET', `/api/alumni?q=${leavingName}`, { token: person.token }), traces);
      expectAnswer(failures, `${who} reads the deleted profile`, await call('GET', `/api/alumni/${leaving.profileId}`, { token: person.token }), 404, 'RESOURCE_NOT_FOUND');
    }
    // The mentee keeps the request, closed and without anything of the deleted mentor.
    const requests = await call('GET', '/api/alumni/mentoring?role=mentee&limit=100', { token: student.token });
    expect(requests.status, requests.text).toBe(200);
    const request = (requests.body.items as any[]).find((item) => item.id === asked.body.id);
    if (!request || request.status !== 'CLOSED' || request.mentor !== null || request.contact !== null) failures.push(`mentee request after the deletion: ${JSON.stringify(request)}`);
    mentions(failures, "the mentee's requests", requests, traces);
    // Connections opened before the deletion are closed by the server (they would otherwise keep the trip rooms).
    await waitFor(async () => (Object.values(live).every((item) => item.closed) ? true : undefined), 'the server to close the connections of the deleted account', 10_000).catch(() =>
      failures.push(`connections still open after the deletion: ${Object.entries(live).filter(([, item]) => !item.closed).map(([label]) => label).join(', ')}`)
    );
    expect(failures).toEqual([]);
  });

  test('alumni: posts are plain text with https links only, hidden posts stay hidden, every route checks the role, and mentoring limits hold under concurrency', async () => {
    const admin = w.admin.token;
    const [author, other, student, second] = await Promise.all([
      createUser(admin, 'ALUMNI'),
      createUser(admin, 'ALUMNI'),
      createUser(admin, 'STUDENT'),
      createUser(admin, 'STUDENT'),
    ]);
    const listed = await listedAlumni();
    const failures: string[] = [];
    const marker = `post${rand()}`;
    const html = `<img src=x onerror=alert('${marker}')><script>alert('${marker}')</script>`;
    const post = (person: Person, json: Record<string, unknown>) => call('POST', '/api/alumni/posts', { token: person.token, json });

    const created = await post(author, {
      type: 'ACHIEVEMENT',
      body: `${html}\nSecond line`,
      link: 'https://example.com/news',
      author: other.id,
      authorSnapshot: { firstname: 'Ada', lastname: 'Admin' },
      hidden: false,
      hiddenReason: 'Forged',
      hiddenBy: w.admin.id,
      createdAt: '2000-01-01T00:00:00.000Z',
      id: w.admin.id,
    });
    expect(created.status, created.text).toBe(201);
    expect(created.body).toMatchObject({ body: `${html}\nSecond line`, link: 'https://example.com/news', author: { id: author.id }, hidden: false, hiddenReason: null });
    expect(created.body.id).not.toBe(w.admin.id);
    const badLinks = ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'http://example.com', 'data:text/html,<script>alert(1)</script>',
      'https://user:pass@example.com', '//evil.example', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'https://'];
    for (const link of badLinks) {
      const res = await post(author, { type: 'OTHER', body: 'A post with a bad link', link });
      if (res.status !== 400 || res.body?.code !== 'VALIDATION_ERROR' || !res.body?.details?.link) failures.push(`link ${JSON.stringify(link)} -> ${res.status} ${res.body?.code}`);
    }
    for (const linkedinUrl of ['javascript:alert(1)', 'http://linkedin.com/in/x', 'https://linkedin.com.evil.example/in/x', 'https://evil.example/linkedin.com/in/x', 'https://user:pw@linkedin.com/in/x']) {
      const res = await call('PUT', '/api/alumni/me', { token: author.token, json: { linkedinUrl } });
      if (res.status !== 400 || !res.body?.details?.linkedinUrl) failures.push(`linkedinUrl ${linkedinUrl} -> ${res.status} ${res.body?.code}`);
    }

    // A hidden post: only its author and the admins see it.
    expect((await call('POST', `/api/alumni/posts/${created.body.id}/hide`, { token: admin, json: { reason: 'Off topic' } })).status).toBe(200);
    for (const [who, person] of [['student', student], ['other alumni', other], ['teacher', w.teacher1]] as const) {
      for (const url of ['/api/alumni/posts?limit=100', `/api/alumni/posts?author=${author.id}&limit=100`, `/api/alumni/posts?author=${author.id}&hidden=true&limit=100`]) {
        mentions(failures, `${who} GET ${url}`, await call('GET', url, { token: person.token }), { 'the hidden post': created.body.id });
      }
      expectAnswer(failures, `${who} deletes the hidden post`, await call('DELETE', `/api/alumni/posts/${created.body.id}`, { token: person.token }), 404, 'RESOURCE_NOT_FOUND');
    }
    const mine = await call('GET', '/api/alumni/posts?author=me&limit=100', { token: author.token });
    expect((mine.body.items as any[]).find((item) => item.id === created.body.id)).toMatchObject({ hidden: true, hiddenReason: 'Off topic' });
    const visible = await post(other, { type: 'EVENT', body: 'Meetup next week on campus' });
    expect(visible.status, visible.text).toBe(201);
    expectAnswer(failures, 'a student deletes an alumni post', await call('DELETE', `/api/alumni/posts/${visible.body.id}`, { token: student.token }), 403, 'FORBIDDEN');
    expectAnswer(failures, "an alumni deletes another alumni's post", await call('DELETE', `/api/alumni/posts/${visible.body.id}`, { token: author.token }), 403, 'FORBIDDEN');

    // Roles.
    const alumniOnly: Endpoint[] = [
      { method: 'GET', path: '/api/alumni/me' },
      { method: 'PUT', path: '/api/alumni/me', json: { headline: 'Hacked' } },
      { method: 'GET', path: '/api/alumni/me/export' },
      { method: 'DELETE', path: '/api/alumni/me' },
      { method: 'POST', path: '/api/alumni/posts', json: { type: 'OTHER', body: 'A forbidden post body' } },
    ];
    const studentOnly: Endpoint[] = [{ method: 'POST', path: `/api/alumni/${listed.profileId}/mentoring`, json: { topic: 'Careers', message: MENTORING_MESSAGE } }];
    const adminOnly: Endpoint[] = [
      { method: 'GET', path: '/api/alumni/admin/profiles' },
      { method: 'POST', path: `/api/alumni/posts/${visible.body.id}/hide`, json: { reason: 'Hacked' } },
      { method: 'POST', path: `/api/alumni/posts/${created.body.id}/unhide` },
    ];
    const signedIn: Endpoint[] = [
      { method: 'GET', path: '/api/alumni' },
      { method: 'GET', path: '/api/alumni/facets' },
      { method: 'GET', path: `/api/alumni/${listed.profileId}` },
      { method: 'GET', path: '/api/alumni/mentoring' },
      { method: 'GET', path: '/api/alumni/posts' },
    ];
    const attempt = async (who: string, token: string | undefined, ep: Endpoint, status: number, code: string) =>
      expectAnswer(failures, `${who} ${ep.method} ${ep.path}`, await call(ep.method, ep.path, { token, json: ep.json }), status, code);
    for (const ep of [...alumniOnly, ...studentOnly, ...adminOnly, ...signedIn]) await attempt('anonymous', undefined, ep, 401, 'AUTH_REQUIRED');
    for (const ep of alumniOnly) for (const [who, person] of [['STUDENT', student], ['TEACHER', w.teacher1], ['ADMIN', w.admin]] as const) await attempt(who, person.token, ep, 403, 'FORBIDDEN');
    for (const ep of studentOnly) for (const [who, person] of [['ALUMNI', other], ['TEACHER', w.teacher1], ['ADMIN', w.admin]] as const) await attempt(who, person.token, ep, 403, 'FORBIDDEN');
    for (const ep of adminOnly) for (const [who, person] of [['STUDENT', student], ['TEACHER', w.teacher1], ['ALUMNI', other]] as const) await attempt(who, person.token, ep, 403, 'FORBIDDEN');
    expect(failures).toEqual([]);
    expect(((await call('GET', '/api/alumni/posts?limit=100', { token: student.token })).body.items as any[]).find((item) => item.id === visible.body.id)).toMatchObject({ hidden: false });

    // Simultaneous mentoring requests: at most 3 pending per student, one per alumni.
    const mentors = [listed, ...(await Promise.all([1, 2, 3, 4].map(() => listedAlumni())))];
    expect(outcomes(await Promise.all(mentors.map((item) => askMentoring(student, item.profileId))))).toEqual([
      '201',
      '201',
      '201',
      '409 MENTORING_LIMIT_REACHED',
      '409 MENTORING_LIMIT_REACHED',
    ]);
    expect(outcomes(await Promise.all(Array.from({ length: 4 }, () => askMentoring(second, mentors[0].profileId))))).toEqual([
      '201',
      '409 ALREADY_REQUESTED',
      '409 ALREADY_REQUESTED',
      '409 ALREADY_REQUESTED',
    ]);
  });

  // ---------- injection and rate limits

  test('NoSQL operators and regex payloads in the phase 3 bodies, queries and ids are rejected or neutralized', async () => {
    const admin = w.admin.token;
    const [driver, student, alumni] = await Promise.all([createUser(admin, 'STUDENT'), createUser(admin, 'STUDENT'), createUser(admin, 'ALUMNI')]);
    const trip = await offerTrip(driver);
    const doc = await marketDocument(driver, 5, `inject${rand()} notes`);
    const listed = await listedAlumni();
    const ne = { $ne: null };
    const bodies: [string, string, string, unknown][] = [
      [driver.token, 'POST', '/api/carpool/trips', { departure: { lat: { $gt: 0 }, lng: 10.1 }, departureAt: { $gt: '' }, seats: { $gt: 0 } }],
      [driver.token, 'POST', '/api/carpool/trips', { departure: ne, departureAt: `${campusDay(2)}T08:00`, seats: 2 }],
      [driver.token, 'PATCH', `/api/carpool/trips/${trip.id}`, { seats: { $inc: 5 } }],
      [driver.token, 'PATCH', `/api/carpool/trips/${trip.id}`, { preferences: { smoking: { $ne: false } } }],
      [student.token, 'POST', `/api/carpool/trips/${trip.id}/requests`, { seats: { $gt: 0 }, message: ne }],
      [driver.token, 'POST', `/api/carpool/trips/${trip.id}/messages`, { body: ne }],
      [driver.token, 'POST', `/api/carpool/trips/${trip.id}/messages`, { body: 'Hello', clientRequestId: ne }],
      [driver.token, 'POST', `/api/carpool/trips/${trip.id}/cancel`, { reason: ne }],
      [driver.token, 'POST', `/api/carpool/trips/${trip.id}/ratings`, { userId: ne, score: 5 }],
      [student.token, 'POST', `/api/marketplace/documents/${doc}/purchase`, { expectedPrice: { $gt: 0 } }],
      [student.token, 'PUT', `/api/marketplace/documents/${doc}/review`, { rating: { $gt: 0 }, comment: ne }],
      [student.token, 'POST', `/api/marketplace/documents/${doc}/report`, { reason: ne }],
      [driver.token, 'PATCH', `/api/marketplace/documents/${doc}`, { price: { $gt: 0 } }],
      [admin, 'POST', `/api/marketplace/documents/${doc}/unpublish`, { reason: ne }],
      [alumni.token, 'PUT', '/api/alumni/me', { visibility: { $ne: 'PRIVATE' }, consent: true }],
      [alumni.token, 'PUT', '/api/alumni/me', { skills: [ne], program: ne, promotion: { $gt: 0 } }],
      [alumni.token, 'POST', '/api/alumni/posts', { type: { $in: ['OTHER'] }, body: ne }],
      [student.token, 'POST', `/api/alumni/${listed.profileId}/mentoring`, { topic: ne, message: { $regex: '.*' } }],
    ];
    const failures: string[] = [];
    for (const [token, method, url, json] of bodies) {
      expectAnswer(failures, `${method} ${url} ${JSON.stringify(json)}`, await call(method, url, { token, json }), 400, 'VALIDATION_ERROR');
    }
    const ids: [string, string, string, unknown?][] = [
      [student.token, 'GET', `/api/carpool/trips/${OPERATOR_ID}`],
      [student.token, 'POST', `/api/carpool/trips/${OPERATOR_ID}/requests`, { seats: 1 }],
      [student.token, 'POST', `/api/carpool/requests/${OPERATOR_ID}/cancel`],
      [student.token, 'GET', `/api/carpool/trips/${OPERATOR_ID}/messages`],
      [student.token, 'GET', `/api/marketplace/documents/${OPERATOR_ID}`],
      [student.token, 'GET', `/api/marketplace/documents/${OPERATOR_ID}/file`],
      [student.token, 'POST', `/api/marketplace/documents/${OPERATOR_ID}/purchase`, {}],
      [admin, 'POST', `/api/marketplace/reports/${OPERATOR_ID}/resolve`, {}],
      [admin, 'DELETE', `/api/marketplace/reviews/${OPERATOR_ID}`],
      [student.token, 'GET', `/api/alumni/${OPERATOR_ID}`],
      [student.token, 'GET', `/api/alumni/mentoring/${OPERATOR_ID}`],
      [student.token, 'POST', `/api/alumni/${OPERATOR_ID}/mentoring`, { topic: 'Careers', message: MENTORING_MESSAGE }],
      [admin, 'POST', `/api/alumni/posts/${OPERATOR_ID}/hide`, {}],
    ];
    for (const [token, method, url, json] of ids) expectAnswer(failures, `${method} ${url}`, await call(method, url, { token, json }), 400, 'INVALID_ID');
    const queries: [string, string][] = [
      [student.token, '/api/carpool/trips?lat[$gt]=0&lng=10.1'],
      [student.token, '/api/carpool/trips?lat=36.8&lng=10.1&radiusKm=1000'],
      [student.token, '/api/carpool/trips?direction=.*'],
      [student.token, '/api/carpool/trips?seats=1%7C%7C1'],
      [driver.token, `/api/carpool/trips/${trip.id}/messages?before=.*`],
      [student.token, '/api/carpool/me/trips?role=.*'],
      [student.token, '/api/marketplace/documents?sort=%24natural'],
      [student.token, '/api/marketplace/documents?subject=.*'],
      [student.token, '/api/marketplace/documents?type=.*'],
      [student.token, '/api/marketplace/documents?free=.*'],
      [student.token, '/api/alumni?program=.*'],
      [student.token, '/api/alumni?sort=%24natural'],
      [student.token, '/api/alumni?mentoring=.*'],
      [student.token, '/api/alumni/posts?type=.*'],
      [student.token, '/api/alumni/mentoring?status=.*'],
    ];
    for (const [token, url] of queries) expectAnswer(failures, `GET ${url}`, await call('GET', url, { token }), 400, 'VALIDATION_ERROR');
    // Regex-looking filters are matched literally, never as patterns.
    for (const url of ['/api/alumni?q=.*', `/api/alumni?q=${encodeURIComponent('^')}`, '/api/alumni?skill=.*', '/api/alumni?sector=.*', '/api/marketplace/documents?professor=.*']) {
      const res = await call('GET', url, { token: student.token });
      if (res.status !== 200 || res.body?.total !== 0) failures.push(`GET ${url}: ${res.status}, total ${res.body?.total} (the pattern was interpreted)`);
    }
    if (!((await call('GET', '/api/alumni?q=Software', { token: student.token })).body?.total > 0)) failures.push('positive control: q=Software finds nothing');
    expect(failures).toEqual([]);
    // Nothing was changed by the refused calls.
    expect((await call('GET', `/api/carpool/trips/${trip.id}`, { token: driver.token })).body).toMatchObject({ seats: 3, status: 'OPEN', preferences: { smoking: false } });
    expect((await call('GET', `/api/marketplace/documents/${doc}`, { token: student.token })).body).toMatchObject({ price: 5, status: 'PUBLISHED' });
  });

  test('phase 3 per-user limits: tickets, trips, seat requests, chat messages, uploads, reports, posts and mentoring requests (429, security backend)', async () => {
    const base = SECURITY_API_URL;
    const adminEmail = uniqueEmail('sec-p3-admin');
    const adminPassword = secret('password', `Sec-${rand()}-Admin-Passw0rd!`);
    createAdmin(adminEmail, adminPassword, 'Ada', 'Admin', SECURITY_MONGO_URI);
    const admin = await login(adminEmail, adminPassword, base);
    const person = async (role: string) => {
      const email = uniqueEmail(`sec-p3-${role.toLowerCase()}`);
      const password = secret('password', `Sec-${rand()}-Passw0rd!`);
      const res = await call('POST', '/api/users', { base, token: admin.token, json: { firstname: 'Rate', lastname: role, email, password, role } });
      expect(res.status, `create ${role}: ${res.text}`).toBe(201);
      return login(email, password, base);
    };
    const student = await person('STUDENT');
    const other = await person('STUDENT');
    const alumni = await person('ALUMNI');
    const randomId = () => crypto.randomBytes(12).toString('hex');
    // The limiters run before the controllers: refused bodies (400) and unknown ids (404) count too.
    const limits: [string, string, (token: string) => Promise<Res>][] = [
      ['realtime ticket', student.token, (token) => call('GET', '/api/realtime/ticket', { base, token })],
      ['trip offer', student.token, (token) => call('POST', '/api/carpool/trips', { base, token, json: {} })],
      ['seat request', student.token, (token) => call('POST', `/api/carpool/trips/${randomId()}/requests`, { base, token, json: { seats: 1 } })],
      ['chat message', student.token, (token) => call('POST', `/api/carpool/trips/${randomId()}/messages`, { base, token, json: { body: 'Hello' } })],
      ['document upload', student.token, (token) => call('POST', '/api/marketplace/documents', { base, token, json: {} })],
      ['document report', student.token, (token) => call('POST', `/api/marketplace/documents/${randomId()}/report`, { base, token, json: { reason: 'Copied notes' } })],
      ['alumni post', alumni.token, (token) => call('POST', '/api/alumni/posts', { base, token, json: {} })],
      ['mentoring request', student.token, (token) => call('POST', `/api/alumni/${randomId()}/mentoring`, { base, token, json: { topic: 'Careers', message: MENTORING_MESSAGE } })],
    ];
    const failures: string[] = [];
    for (const [label, token, send] of limits) {
      const seen: number[] = [];
      for (let i = 0; i < RATE_LIMIT_PHASE3_MAX; i += 1) seen.push((await send(token)).status);
      if (seen.includes(429)) failures.push(`${label}: limited before ${RATE_LIMIT_PHASE3_MAX} requests (${seen.join(', ')})`);
      const limited = await send(token);
      if (limited.status !== 429 || limited.body?.code !== 'TOO_MANY_REQUESTS' || !(Number(limited.headers['retry-after']) > 0)) {
        failures.push(`${label}: ${limited.status} ${limited.body?.code ?? ''}, Retry-After ${limited.headers['retry-after']}`);
      }
    }
    // One counter per user: another student is not blocked.
    for (const [label, , send] of limits.filter(([label]) => label !== 'alumni post')) {
      if ((await send(other.token)).status === 429) failures.push(`${label}: another student is blocked`);
    }
    expect(failures).toEqual([]);
  });

  // ---------- web app

  test('phase 3 through the web app: tickets, premium files and cross-site writes are bound to the session; pages never show exact addresses to outsiders nor user text as HTML', async () => {
    test.setTimeout(300_000);
    const admin = w.admin.token;
    const [driver, passenger, outsider, buyer] = await Promise.all([createUser(admin, 'STUDENT'), createUser(admin, 'STUDENT'), createUser(admin, 'STUDENT'), createUser(admin, 'STUDENT')]);
    const alumni = await listedAlumni();
    const failures: string[] = [];
    const web = (url: string, person?: Person, headers: Record<string, string> = {}) =>
      call('GET', `${WEB_URL}${url}`, { headers: { ...(person ? { Cookie: cookieOf(person) } : {}), ...headers } });

    // Real-time tickets through the BFF: the signed-in user's own, never cached; none without a session.
    const ticket = await web('/bff/realtime/ticket', outsider);
    expect(ticket.status, ticket.text.slice(0, 200)).toBe(200);
    secret('realtime ticket', ticket.body.ticket, REALTIME_TICKET_PATHS);
    expect(decodeJwt(ticket.body.ticket).sub).toBe(outsider.id);
    expect(ticket.headers['cache-control']).toMatch(/no-store/);
    expectAnswer(failures, 'ticket without a session', await web('/bff/realtime/ticket'), 401, 'AUTH_REQUIRED');
    expect((await openSocket({ ticket: ticket.body.ticket }, { Origin: WEB_ORIGIN })).refused).toBeNull();

    // Premium files through the BFF: the buyer's session only, as an attachment.
    const marker = `web${rand()}`;
    const premium = await marketDocument(driver, 10, `${marker} premium`);
    const unbought = await marketDocument(driver, 10, `${marker} other`);
    expect((await call('POST', `/api/marketplace/documents/${premium}/purchase`, { token: buyer.token, json: {} })).status).toBe(201);
    const own = await web(`/bff/marketplace/documents/${premium}/file`, buyer, { Accept: '*/*' });
    expect(own.status).toBe(200);
    expect(own.text).toContain(`${marker} premium`);
    expect(own.headers['content-disposition']).toMatch(/^attachment;/);
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    expectAnswer(failures, 'premium file through the BFF, not bought', await web(`/bff/marketplace/documents/${premium}/file`, outsider, { Accept: '*/*' }), 404, 'RESOURCE_NOT_FOUND');

    // Cross-site writes are refused by the BFF (Origin check): no erasure, no purchase, no chat message.
    const payload = `<img src=x onerror=alert('${marker}')><script>alert('${marker}')</script>`;
    const trip = await offerTrip(driver, { notes: `${payload}\nBring a coat` });
    await acceptSeat(driver, await requestSeat(passenger, trip.id));
    const csrf: [Person, string, string, unknown][] = [
      [alumni, 'DELETE', '/bff/alumni/me', undefined],
      [buyer, 'POST', `/bff/marketplace/documents/${unbought}/purchase`, {}],
      [passenger, 'POST', `/bff/carpool/trips/${trip.id}/messages`, { body: 'Cross-site message' }],
    ];
    for (const [person, method, url, json] of csrf) {
      for (const origin of [undefined, 'http://evil.example', 'null']) {
        const headers: Record<string, string> = { Cookie: cookieOf(person), ...(origin ? { Origin: origin } : {}) };
        expectAnswer(failures, `${method} ${url} Origin=${origin}`, await call(method, `${WEB_URL}${url}`, { headers, json }), 403, 'FORBIDDEN');
      }
    }
    expect((await call('GET', `/api/alumni/${alumni.profileId}`, { token: outsider.token })).status).toBe(200);
    expect((await walletOf(buyer)).balance).toBe(90);
    expect((await call('GET', `/api/carpool/trips/${trip.id}/messages`, { token: driver.token })).body.items).toEqual([]);

    // Pages: user text is escaped; the exact address is only in the participants' page.
    const raw = [`<img src=x onerror=alert('${marker}')`, `<script>alert('${marker}')`];
    const page = async (label: string, url: string, person: Person) => {
      const res = await web(url, person, { Accept: 'text/html' });
      if (res.status !== 200 || !res.text.includes(marker)) failures.push(`${label}: ${res.status}, marker shown: ${res.text.includes(marker)}`);
      for (const item of raw) if (res.text.includes(item)) failures.push(`${label} contains the raw HTML ${item}`);
      return res;
    };
    const outsiderPage = await page('trip page of another student', `/dashboard/carpool/${trip.id}`, outsider);
    if (EXACT_DIGITS.test(outsiderPage.text)) failures.push("the exact address is in another student's trip page");
    const passengerPage = await page('trip page of the passenger', `/dashboard/carpool/${trip.id}`, passenger);
    if (!EXACT_DIGITS.test(passengerPage.text)) failures.push('positive control: the exact address is not in the passenger page');
    const described = await uploadDocument(driver, { title: `Escaped ${marker}`, description: `${payload}\nLine two`, price: 0 }, [file('escaped.pdf', 'application/pdf', pdf(marker))]);
    expect(described.status, described.text).toBe(201);
    expect((await call('POST', `/api/marketplace/documents/${described.body.id}/approve`, { token: admin })).status).toBe(200);
    await page('marketplace document page', `/dashboard/marketplace/${described.body.id}`, outsider);
    expect((await call('POST', '/api/alumni/posts', { token: alumni.token, json: { type: 'OTHER', body: `${payload}\nSecond line` } })).status).toBe(201);
    await page('alumni news wall', '/dashboard/alumni?tab=news', outsider);
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------- web app (Next.js on 3100)

test.describe('web app', () => {
  test.describe.configure({ timeout: 300_000 });
  let cookie: string;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    // `next dev` compiles each route on first use.
    for (const route of ['/login', '/', '/offline', '/bff/health', '/auth/expired']) await call('GET', `${WEB_URL}${route}`).catch(() => undefined);
    const session = await login(w.studentC.email, w.studentC.password);
    cookie = `cl_access=${session.token}; cl_refresh=${session.refreshToken}`;
  });

  test('non-GET /bff/* requests without a same-origin Origin are refused (403 FORBIDDEN)', async () => {
    const failures: string[] = [];
    const origins = [undefined, 'null', 'http://evil.example', `${WEB_URL}.evil.example`, API_URL];
    for (const origin of origins) {
      const headers: Record<string, string> = { Cookie: cookie, ...(origin ? { Origin: origin } : {}) };
      for (const [method, url, json] of [['POST', '/bff/notifications/read-all', undefined], ['PATCH', '/bff/users/me', { firstname: 'Csrf' }], ['DELETE', '/bff/push/subscriptions', { endpoint: 'https://x.example/e' }]] as const) {
        expectAnswer(failures, `${method} ${url} Origin=${origin}`, await call(method, `${WEB_URL}${url}`, { headers, json }), 403, 'FORBIDDEN');
      }
    }
    expect(failures).toEqual([]);
    expect((await call('GET', '/api/users/me', { token: w.studentC.token })).body.firstname).not.toBe('Csrf');
    // Same origin: relayed with the session cookie.
    expect((await call('POST', `${WEB_URL}/bff/notifications/read-all`, { headers: { Cookie: cookie, Origin: WEB_ORIGIN } })).status).toBe(200);
  });

  test('/bff/auth/* is never relayed (404), whatever the spelling', async () => {
    const credentials = { email: w.studentC.email, password: w.studentC.password };
    const failures: string[] = [];
    for (const url of ['/bff/auth/login', '/bff/AUTH/login', '/bff/%61uth/login', '/bff/users/%2e%2e/auth/login', '/bff/auth/refresh', '/bff/auth/logout']) {
      for (const method of ['GET', 'POST']) {
        const res = await call(method, `${WEB_URL}${url}`, { headers: { Origin: WEB_ORIGIN }, json: method === 'POST' ? credentials : undefined });
        if (res.status !== 404 || res.text.includes('accessToken') || /cl_access=[^;]/.test(res.headers['set-cookie'] ?? '')) {
          failures.push(`${method} ${url} -> ${res.status} ${res.text.slice(0, 80)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test('?next=/.//evil.com and other off-site targets are never followed', async () => {
    const offSite = (value: string) => {
      if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return true;
      const url = new URL(value, WEB_URL);
      return url.origin !== WEB_ORIGIN || url.pathname.startsWith('//') || url.pathname.startsWith('/\\');
    };
    const failures: string[] = [];
    for (const target of ['/.//evil.com', '//evil.com', '/\\evil.com', 'https://evil.com/x', '/%2F%2Fevil.com', '/./%2F/evil.com', '/\t/evil.com']) {
      const q = encodeURIComponent(target);
      const expired = await call('GET', `${WEB_URL}/auth/expired?next=${q}`);
      const location = new URL(expired.headers.location ?? 'http://missing.invalid', WEB_URL);
      const next = location.searchParams.get('next');
      if (expired.status < 300 || expired.status >= 400 || location.origin !== WEB_ORIGIN || location.pathname !== '/login' || (next !== null && offSite(next))) {
        failures.push(`/auth/expired?next=${target} -> ${expired.status} ${expired.headers.location}`);
      }
      const page = await call('GET', `${WEB_URL}/login?next=${q}`);
      const hidden = [...page.text.matchAll(/<input[^>]*name="next"[^>]*>/g)].map((m) => /value="([^"]*)"/.exec(m[0])?.[1] ?? '');
      if (page.status !== 200 || hidden.length === 0 || hidden.some((value) => value !== '' && offSite(value.replace(/&amp;/g, '&')))) {
        failures.push(`/login?next=${target} -> ${page.status}, next field ${JSON.stringify(hidden)}`);
      }
    }
    // Signed in: /login sends to the dashboard, not to the next target.
    const signedIn = await call('GET', `${WEB_URL}/login?next=${encodeURIComponent('/.//evil.com')}`, { headers: { Cookie: cookie } });
    if (new URL(signedIn.headers.location ?? '', WEB_URL).href !== `${WEB_ORIGIN}/dashboard`) failures.push(`signed-in /login -> ${signedIn.headers.location}`);
    expect(failures).toEqual([]);
  });

  test('security headers are sent on pages and BFF answers', async () => {
    const failures: string[] = [];
    for (const route of ['/', '/login', '/offline', '/bff/health']) {
      const { headers } = await call('GET', `${WEB_URL}${route}`);
      if (headers['x-frame-options'] !== 'DENY') failures.push(`${route}: X-Frame-Options ${headers['x-frame-options']}`);
      if (headers['x-content-type-options'] !== 'nosniff') failures.push(`${route}: X-Content-Type-Options ${headers['x-content-type-options']}`);
      if (headers['referrer-policy'] !== 'strict-origin-when-cross-origin') failures.push(`${route}: Referrer-Policy ${headers['referrer-policy']}`);
      if (!/camera=\(\)/.test(headers['permissions-policy'] ?? '')) failures.push(`${route}: Permissions-Policy ${headers['permissions-policy']}`);
      if (route.startsWith('/bff/') && !/no-store/.test(headers['cache-control'] ?? '')) failures.push(`${route}: Cache-Control ${headers['cache-control']}`);
    }
    expect(failures).toEqual([]);
  });

  test('a client-supplied X-Forwarded-For is not trusted as the client IP (audit log, rate limiting)', async () => {
    const failures: string[] = [];
    // TRUSTED_PROXY_HOPS is not set for the test web app (0): no client address may reach the backend.
    for (const spoofed of ['203.0.113.66', '203.0.113.67, 198.51.100.7', '127.0.0.1, 203.0.113.68', 'unknown']) {
      const reset = await call('POST', `${WEB_URL}/bff/timetable/me/calendar-link/reset`, {
        headers: { Cookie: cookie, Origin: WEB_ORIGIN, 'X-Forwarded-For': spoofed },
      });
      expect(reset.status, reset.text).toBe(200);
      const audit = await call('GET', `/api/audit?action=timetable.calendar_link.reset&targetId=${w.studentC.id}&limit=1`, { token: w.admin.token });
      const ip = audit.body.items[0]?.ip;
      if (!LOOPBACK.test(ip ?? '')) failures.push(`X-Forwarded-For ${spoofed}: audit ip ${ip}`);
    }
    expect(failures, 'the audit log must record the address of Next.js, not one chosen by the client').toEqual([]);
  });

  test('Server Actions do not forward a client-supplied X-Forwarded-For either (change password)', async ({ playwright }) => {
    const person = await createUser(w.admin.token, 'STUDENT');
    const spoofed = '203.0.113.77';
    const newPassword = secret('password', `Sec-${rand()}-Changed2!`);
    const browser = await playwright.chromium.launch();
    try {
      const context = await browser.newContext({ baseURL: WEB_URL, locale: 'en-US', extraHTTPHeaders: { 'X-Forwarded-For': spoofed } });
      await context.addCookies([
        { name: 'cl_access', value: person.token, url: WEB_URL, httpOnly: true, sameSite: 'Lax' },
        { name: 'cl_refresh', value: person.refreshToken, url: WEB_URL, httpOnly: true, sameSite: 'Lax' },
      ]);
      const page = await context.newPage();
      page.setDefaultTimeout(120_000);
      await page.goto('/dashboard/account', { waitUntil: 'networkidle', timeout: 180_000 });
      const form = page.locator('form', { has: page.locator('input[name="currentPassword"]') });
      await form.locator('input[name="currentPassword"]').fill(person.password);
      await form.locator('input[name="newPassword"]').fill(newPassword);
      await form.locator('input[name="confirmPassword"]').fill(newPassword);
      await form.locator('button[type="submit"]').click();

      const entry = await waitFor(async () => {
        const audit = await call('GET', `/api/audit?action=auth.password_change&targetId=${person.id}&limit=1`, { token: w.admin.token });
        return audit.body.items?.[0];
      }, 'the auth.password_change audit entry', 120_000);
      expect(entry.ip, 'the audit log records an IP chosen by the client').not.toBe(spoofed);
      expect(entry.ip).toMatch(LOOPBACK);
      // Let the action's answer finish streaming before the browser goes (else `next dev` logs a closed stream).
      await expect(form.locator('button[type="submit"]')).toBeEnabled({ timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
      await context.close();
    } finally {
      await browser.close();
    }
  });

  test('phase 2 through the web app: reports only reach their owner, and forum text is rendered as text, never as HTML', async () => {
    const failures: string[] = [];
    const headers = { Cookie: cookie };
    // The BFF passes the PDF of the signed-in student through, with its private headers...
    const own = await call('GET', `${WEB_URL}/bff/analytics/me/report.pdf`, { headers });
    expect(own.status, own.text.slice(0, 200)).toBe(200);
    expect(own.headers['content-type']).toMatch(/^application\/pdf/);
    expect(own.text.startsWith('%PDF')).toBe(true);
    expect(own.headers['cache-control']).toMatch(/no-store/);
    expect(own.headers['content-disposition']).toMatch(/^attachment;/);
    // ...but never another student's data, nor staff or admin data.
    for (const url of [
      `/bff/analytics/students/${w.studentA.id}/report.pdf`,
      `/bff/analytics/students/${w.studentA.id}`,
      `/bff/analytics/groups/${w.g1}`,
      `/bff/attendance/sessions/${w.sessionA}`,
      '/bff/attendance/alerts',
      '/bff/grades/teaching',
      '/bff/bookings',
      '/bff/bookings/stats',
      '/bff/forum/reports',
    ]) {
      expectAnswer(failures, `GET ${url}`, await call('GET', `${WEB_URL}${url}`, { headers }), 403, 'FORBIDDEN');
    }
    expect(failures).toEqual([]);

    // HTML typed in a question is stored and returned as plain text (JSON, nosniff)...
    const marker = `xss${rand()}`;
    const payload = `<img src=x onerror=alert('${marker}')><script>alert('${marker}')</script>`;
    const asked = await call('POST', '/api/forum/questions', {
      token: w.studentA.token,
      json: { title: `${payload} title`, body: `${payload}\nSecond line of the body.`, subject: w.subjectId },
    });
    expect(asked.status, asked.text).toBe(201);
    expect(asked.body.body).toBe(`${payload}\nSecond line of the body.`);
    expect(asked.headers['content-type']).toMatch(/^application\/json/);
    expect(asked.headers['x-content-type-options']).toBe('nosniff');
    // ...and the question page escapes it (title, metadata and body).
    const page = await call('GET', `${WEB_URL}/dashboard/forum/${asked.body.id}`, { headers: { Cookie: cookie, Accept: 'text/html' } });
    expect(page.status).toBe(200);
    expect(page.text).toContain(marker);
    for (const raw of [`<img src=x onerror=alert('${marker}')`, `<script>alert('${marker}')`]) {
      expect(page.text.includes(raw), `the question page contains the raw HTML ${raw}`).toBe(false);
    }
  });

  test('the end of a session wipes the offline data (Clear-Site-Data), and dashboard pages carry their owner', async () => {
    const wipe = '"cache", "storage"';
    const expired = await call('GET', `${WEB_URL}/auth/expired?next=%2Fdashboard`, { headers: { Cookie: cookie } });
    expect(expired.status).toBeGreaterThanOrEqual(300);
    expect(expired.status).toBeLessThan(400);
    expect(expired.headers['clear-site-data']).toBe(wipe);
    expect(expired.headers['set-cookie']).toMatch(/(^|\n)cl_ended=1/);
    expect(expired.headers['set-cookie']).toMatch(/(^|\n)cl_owner=;/);

    // The next login page shown without a session after the session ended (logout, revoked, password changed).
    const login = await call('GET', `${WEB_URL}/login`, { headers: { Cookie: 'cl_ended=1' } });
    expect(login.status).toBe(200);
    expect(login.headers['clear-site-data']).toBe(wipe);
    // An unusable refresh token on the login page: the session is over there too.
    const revoked = await call('GET', `${WEB_URL}/login`, { headers: { Cookie: `cl_refresh=revoked-${rand()}` } });
    expect(revoked.status).toBe(200);
    expect(revoked.headers['clear-site-data']).toBe(wipe);

    // Dashboard pages are labelled with the account they were rendered for (offline copies, public/sw.js).
    const dashboard = await call('GET', `${WEB_URL}/dashboard`, { headers: { Cookie: cookie } });
    expect(dashboard.status).toBe(200);
    expect(dashboard.headers['x-cl-owner']).toBe(w.studentC.id);
    expect(dashboard.headers['set-cookie']).toMatch(new RegExp(`(^|\\n)cl_owner=${w.studentC.id};`));
    expect(dashboard.headers['clear-site-data']).toBeUndefined();
  });

  test('the service worker never saves admin or account pages, and only serves a saved page to its owner for 24 h', async () => {
    const res = await call('GET', `${WEB_URL}/sw.js`);
    expect(res.status).toBe(200);
    // public/sw.js only runs in production builds (e2e/offline-privacy.spec.ts with E2E_NEXT_MODE=start checks it in a
    // browser): here its caching rules are evaluated directly.
    let ownerCookie: string | null = null;
    const sandbox: Record<string, any> = {
      self: {
        location: new URL(WEB_URL),
        navigator: {},
        addEventListener: () => undefined,
        cookieStore: { get: async (name: string) => (name === 'cl_owner' && ownerCookie ? { name, value: ownerCookie } : null) },
      },
      URL,
      Headers,
      Response,
      setTimeout,
      clearTimeout,
      console,
    };
    vm.runInNewContext(res.text, sandbox, { filename: 'sw.js' });
    for (const name of ['pageKind', 'isServable', 'currentOwner']) {
      expect(typeof sandbox[name], `public/sw.js no longer defines ${name}(): update this test`).toBe('function');
    }

    const kind = (route: string) => sandbox.pageKind(new URL(route, WEB_URL)) as string | null;
    const failures: string[] = [];
    const never = ['/dashboard/admin/users', `/dashboard/admin/users?q=${encodeURIComponent(w.admin.email)}`, '/dashboard/admin/audit',
      '/dashboard/admin/academic', '/dashboard/admin/timetable', '/dashboard/admin/announcements', '/dashboard/admin/announcements/new',
      `/dashboard/admin/announcements/${w.sessionA}/edit`, '/dashboard/account', '/dashboard/unknown', '/login', '/signup',
      '/reset-password?token=x', '/bff/users/me', '/auth/expired', 'http://evil.example/dashboard',
      // Phase 2: admin and staff pages (other students' data) are never saved either.
      '/dashboard/admin/bookings', '/dashboard/admin/bookings?tab=stats', '/dashboard/admin/forum', '/dashboard/admin/analytics',
      `/dashboard/admin/analytics/students/${w.studentA.id}`, '/dashboard/attendance', `/dashboard/attendance/${w.sessionA}`,
      '/dashboard/grades', `/dashboard/grades/${w.sessionA}`, `/dashboard/forum/profile/${w.studentA.id}`, '/bff/analytics/me/report.pdf',
      // Phase 3: the moderation queue (other users' documents and reports), tickets and files.
      '/dashboard/admin/marketplace', `/dashboard/admin/marketplace?document=${w.sessionA}`, '/bff/realtime/ticket',
      `/bff/marketplace/documents/${w.sessionA}/file`, '/bff/alumni/me/export'];
    for (const route of never) if (kind(route) !== null) failures.push(`${route} would be saved (${kind(route)})`);
    for (const route of ['/dashboard', '/dashboard/timetable', '/dashboard/announcements', `/dashboard/announcements/${w.sessionA}`, '/dashboard/notifications',
      '/dashboard/bookings', '/dashboard/forum', `/dashboard/forum/${w.sessionA}`, '/dashboard/analytics']) {
      if (kind(route) !== 'private') failures.push(`${route}: ${kind(route)} instead of private (owner-bound)`);
    }
    if (kind('/') !== 'public') failures.push(`/: ${kind('/')}`);

    const saved = (owner: string | null, ageMs: number) =>
      new Response('<html></html>', {
        headers: { 'content-type': 'text/html', ...(owner ? { 'x-cl-owner': owner } : {}), 'x-cl-saved-at': String(Date.now() - ageMs) },
      });
    const served = (owner: string | null, ageMs: number, pageKind: string | null, current: string | null) => sandbox.isServable(saved(owner, ageMs), pageKind, current) as boolean;
    const a = w.studentA.id;
    const b = w.studentB.id;
    const cases: [string, boolean, boolean][] = [
      ["owner's own copy", served(a, 1000, 'private', a), true],
      ["another account's copy", served(a, 1000, 'private', b), false],
      ['no session (no cl_owner)', served(a, 1000, 'private', null), false],
      ['unlabelled copy', served(null, 1000, 'private', a), false],
      ['copy older than 24 h', served(a, 25 * 3600_000, 'private', a), false],
      ['private copy served as the public page', served(a, 1000, 'public', a), false],
      ['copy of a page that is no longer saved', served(a, 1000, null, a), false],
      ['public landing page', served('public', 1000, 'public', null), true],
    ];
    for (const [label, actual, expected] of cases) if (actual !== expected) failures.push(`${label}: served=${actual}`);

    // The current account is the cl_owner cookie, which disappears with the session cookies.
    ownerCookie = a;
    if ((await sandbox.currentOwner()) !== a) failures.push('currentOwner() does not read cl_owner');
    ownerCookie = null;
    if ((await sandbox.currentOwner()) !== null) failures.push('currentOwner() without cl_owner is not null');
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------- leaks (last: also scans every answer above)

test('no password hash, OTP, reset token, calendarToken, refresh token, push secret or VAPID private key in any JSON response', async () => {
  const admin = w.admin.token;
  const d = await createUser(admin, 'STUDENT', w.g1);
  const changed = secret('password', `Sec-${rand()}-Changed1!`);
  expect((await call('POST', '/api/auth/change-password', { token: d.token, json: { currentPassword: d.password, newPassword: changed } })).status).toBe(200);
  const session = await login(d.email, changed);
  for (const [method, url] of [['GET', '/api/timetable/me/calendar-link'], ['POST', '/api/timetable/me/calendar-link/reset']]) {
    const res = await call(method, url, { token: session.token });
    secret('calendar token', calendarToken(res.body.url), CALENDAR_LINK_PATHS);
  }
  const endpoint = secret('push endpoint', `https://fcm.googleapis.com/fcm/send/sec-${rand()}${rand()}`);
  const keys = { p256dh: secret('push p256dh', crypto.randomBytes(65).toString('base64url')), auth: secret('push auth', crypto.randomBytes(16).toString('base64url')) };
  expect((await call('POST', '/api/push/subscriptions', { token: session.token, json: { type: 'web', endpoint, keys } })).status).toBe(201);
  const adminSet = secret('password', `Sec-${rand()}-AdminSet1!`);
  expect((await call('PATCH', `/api/users/${d.id}`, { token: admin, json: { password: adminSet } })).status).toBe(200);
  // A pending reset link and a pending login code.
  const mails = mailsTo(d.email).length;
  await call('POST', '/api/auth/forgot-password', { json: { email: d.email } });
  secret('reset token', extractResetLink(await waitForMail(d.email, { after: mails })).token);
  expect((await call('PATCH', '/api/users/me', { token: session.token, json: { twoFactorEnabled: true } })).status).toBe(200);
  expect((await call('POST', '/api/auth/login', { json: { email: d.email, password: adminSet } })).body).toMatchObject({ otpRequired: true });

  const reads: [string, string][] = [
    [session.token, '/api/users/me'],
    [session.token, '/api/timetable/me'],
    [session.token, '/api/timetable/me/groups'],
    [session.token, '/api/notifications'],
    [session.token, '/api/announcements'],
    [admin, '/api/users?limit=100'],
    [admin, `/api/users?q=${encodeURIComponent(d.email)}`],
    [admin, `/api/users/${d.id}`],
    [admin, '/api/audit?limit=100'],
    [admin, `/api/audit?targetId=${d.id}`],
    [admin, '/api/announcements/manage?limit=100'],
    [admin, `/api/academic/groups/${w.g1}`],
  ];
  for (const [token, url] of reads) expect((await call('GET', url, { token })).status, url).toBe(200);
  secret('VAPID private key', TEST_VAPID.privateKey);
  const vapid = await call('GET', '/api/push/vapid-public-key', { base: SECURITY_API_URL });
  expect(vapid.status).toBe(200);
  expect(vapid.body).toEqual({ publicKey: TEST_VAPID.publicKey });

  // Scan every JSON answer recorded by this file during the run.
  const entries = fs.readFileSync(RECORD_FILE, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Answer | Secret);
  const answers = entries.filter((entry): entry is Answer => entry.kind === 'answer');
  const secrets = entries.filter((entry): entry is Secret => entry.kind === 'secret');
  const forbiddenKeys = new Set(['password', 'passwordHash', 'otp', 'otpHash', 'otpExpiresAt', 'otpAttempts', 'passwordResetHash',
    'passwordResetExpiresAt', 'resetToken', 'calendarToken', 'tokenHash', 'privateKey', 'vapidPrivateKey', 'p256dh', 'endpoint', 'key', 'stack']);
  const leaks = new Set<string>();
  const walk = (value: unknown, where: string, entry: Answer) => {
    if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${where}[${i}]`, entry));
    else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (where === '$' && entry.isError && key === 'details') continue; // keyed by field name
        const tokenKey = ['accessToken', 'refreshToken'].includes(key) && !AUTH_PATHS.test(entry.path);
        if (forbiddenKeys.has(key) || tokenKey) leaks.add(`${entry.label}: key ${where}.${key}`);
        walk(item, `${where}.${key}`, entry);
      }
    }
  };
  for (const entry of answers) {
    walk(JSON.parse(entry.text), '$', entry);
    if (/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/.test(entry.text)) leaks.add(`${entry.label}: bcrypt hash`);
    for (const { label, value, allowedIn } of secrets) {
      if (value && entry.text.includes(value) && !(allowedIn && new RegExp(allowedIn).test(entry.path))) leaks.add(`${entry.label}: ${label}`);
    }
  }
  expect(answers.length).toBeGreaterThan(30);
  expect([...leaks]).toEqual([]);
});

test('phase 2 answers never carry an email address, a raw id, a snapshot or an internal field', async () => {
  const entries = fs.readFileSync(RECORD_FILE, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Answer | Secret);
  const answers = entries.filter(
    (entry): entry is Answer => entry.kind === 'answer' && /^\/(api|bff)\/(resources|bookings|forum|attendance|grades|analytics)(\/|$)/.test(entry.path)
  );
  // Authors, owners and students are { id, firstname, lastname, role? }: nothing more.
  const internal = new Set(['_id', '__v', 'email', 'password', 'userSnapshot', 'authorSnapshot', 'resourceSnapshot', 'bySnapshot',
    'reminderSentAt', 'requestNotifiedAt', 'alertCheckAt', 'deleting', 'answersTotal', 'hiddenBy', 'gradedBy', 'calendarToken', 'source']);
  const leaks = new Set<string>();
  const walk = (value: unknown, where: string, entry: Answer) => {
    if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${where}[${i}]`, entry));
    else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (where === '$' && entry.isError && key === 'details') continue; // keyed by field name
        if (internal.has(key)) leaks.add(`${entry.label}: key ${where}.${key}`);
        walk(item, `${where}.${key}`, entry);
      }
    }
  };
  for (const entry of answers) {
    walk(JSON.parse(entry.text), '$', entry);
    if (/[a-z0-9._+-]+@campuslink\.test/i.test(entry.text)) leaks.add(`${entry.label}: an email address`);
  }
  expect(answers.length).toBeGreaterThan(100);
  expect([...leaks]).toEqual([]);
});

test("phase 3 answers never carry an e-mail address (outside an accepted mentoring contact or the caller's own export), a raw id, a snapshot or an internal field", async () => {
  const entries = fs.readFileSync(RECORD_FILE, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Answer | Secret);
  const answers = entries.filter(
    (entry): entry is Answer => entry.kind === 'answer' && /^\/(api|bff)\/(carpool|marketplace|alumni|realtime)(\/|$)/.test(entry.path)
  );
  // People are { id, firstname, lastname, ... }; places { label, lat, lng }; files { filename, size, mimeType }.
  const internal = new Set(['_id', '__v', 'password', 'email', 'driverSnapshot', 'passengerSnapshot', 'senderSnapshot', 'authorSnapshot',
    'mentorSnapshot', 'menteeSnapshot', 'searchPoint', 'location', 'coordinates', 'source', 'ratingSum', 'sales', 'purchasesInFlight',
    'deleting', 'buyerBalanceAfter', 'seller', 'pending', 'pendingSlot', 'sectorKey', 'skillKeys', 'hiddenBy', 'mentorErasedAt',
    'menteeErasedAt', 'active', 'key', 'calendarToken', 'tokenHash', 'jti']);
  // The only places with e-mail addresses: `contact` of a mentoring request (participants, ACCEPTED) and `user.email` of
  // the caller's own export.
  const mentoringPaths = /^\/(api|bff)\/alumni\/(mentoring(\/|$)|me\/export$|[a-f0-9]{24}\/mentoring$)/;
  const leaks = new Set<string>();
  const walk = (value: unknown, where: string, entry: Answer) => {
    if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${where}[${i}]`, entry));
    else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (where === '$' && entry.isError && key === 'details') continue; // keyed by field name
        if (key === 'contact' && item !== null) {
          if (!mentoringPaths.test(entry.path)) leaks.add(`${entry.label}: contact at ${where}`);
          continue;
        }
        if (key === 'email' && where === '$.user' && /\/alumni\/me\/export$/.test(entry.path)) continue;
        if (internal.has(key)) leaks.add(`${entry.label}: key ${where}.${key}`);
        if (typeof item === 'string' && /[a-z0-9._+-]+@campuslink\.test/i.test(item)) leaks.add(`${entry.label}: an e-mail address at ${where}.${key}`);
        walk(item, `${where}.${key}`, entry);
      }
    }
  };
  for (const entry of answers) walk(JSON.parse(entry.text), '$', entry);
  expect(answers.length).toBeGreaterThan(100);
  expect([...leaks]).toEqual([]);
});
