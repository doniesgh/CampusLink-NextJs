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
  MONGO_URI,
  PUSH_OUTBOX_FILE,
  RATE_LIMIT_AUTH_MAX,
  SECURITY_API_URL,
  STORAGE_DIR,
  TEST_VAPID,
  TMP_DIR,
  WEB_URL,
} from '../support/env';
import { extractResetLink, mailsTo, waitForMail } from '../support/outbox';

/**
 * Phase-1 security checks (one file, no functional coverage): authorization, IDOR, mass assignment,
 * uploads, injection, secret leaks, rate limiting and the web app's BFF / redirects / headers.
 * Backends: 4100 (main, rate limiting off) and 4101 (rate limiting on, test VAPID keys); Next.js on 3100.
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

async function createUser(adminToken: string, role: string, group?: string): Promise<Person> {
  const email = uniqueEmail(`sec-${role.toLowerCase()}`);
  const password = secret('password', `Sec-${rand()}-Passw0rd!`);
  const res = await call('POST', '/api/users', {
    token: adminToken,
    json: { firstname: 'Sec', lastname: role, email, password, role, ...(group ? { group } : {}) },
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
      '/reset-password?token=x', '/bff/users/me', '/auth/expired', 'http://evil.example/dashboard'];
    for (const route of never) if (kind(route) !== null) failures.push(`${route} would be saved (${kind(route)})`);
    for (const route of ['/dashboard', '/dashboard/timetable', '/dashboard/announcements', `/dashboard/announcements/${w.sessionA}`, '/dashboard/notifications']) {
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
