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
  RATE_LIMIT_BOOKING_MAX,
  RATE_LIMIT_IP_MAX,
  RATE_LIMIT_RESET_MAX,
  SECURITY_API_URL,
  SECURITY_MONGO_URI,
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
      '/dashboard/grades', `/dashboard/grades/${w.sessionA}`, `/dashboard/forum/profile/${w.studentA.id}`, '/bff/analytics/me/report.pdf'];
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
