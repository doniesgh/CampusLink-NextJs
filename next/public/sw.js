/*
 * CampusLink service worker (Module 8: offline mode / PWA). Plain JavaScript, served at /sw.js, scope "/".
 * Registered by components/pwa/service-worker-registrar.tsx in production builds (or NEXT_PUBLIC_ENABLE_SW=true).
 *
 * Caching rules (docs/phase1-contract.md, section 9.3):
 * - precache /offline (+ the static files it needs) and the icons;
 * - cache-first for /_next/static/*, fonts and icons;
 * - network-first for page navigations, falling back to the cached page, then to /offline;
 * - NEVER cache /bff/* (data lives in IndexedDB), Server Actions, auth routes or non-GET requests.
 * Also: push -> notification, notificationclick -> focus/open the link, sync "campuslink-outbox" -> replay.
 *
 * Saved pages (private data on a possibly shared computer):
 * - only the landing page (public) and the pages of the offline modules: /dashboard, /dashboard/timetable,
 *   /dashboard/announcements(/<id>), /dashboard/notifications. Never the admin pages or /dashboard/account;
 * - each copy carries the account it was rendered for (`x-cl-owner`, set by proxy.ts) and its save time;
 * - a copy is only served to its owner: the `cl_owner` cookie (Cookie Store API; it lives exactly as long as
 *   the session cookies), or where that API is missing the IndexedDB "meta" owner (wiped at the end of a
 *   session). Copies older than PAGE_MAX_AGE_MS, or belonging to someone else, are deleted.
 *
 * The IndexedDB schema (db "campuslink" v1: cache, outbox, meta) is shared with lib/offline/db.ts.
 */

// v2: copies labelled with their owner; the unlabelled v1 caches are deleted on activation.
const VERSION = "v2";
const PRECACHE = `campuslink-precache-${VERSION}`;
const STATIC_CACHE = `campuslink-static-${VERSION}`;
const PAGES_CACHE = `campuslink-pages-${VERSION}`;
const CURRENT_CACHES = [PRECACHE, STATIC_CACHE, PAGES_CACHE];

const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/badge-96.png",
  "/icons/apple-touch-icon.png",
];

const SYNC_TAG = "campuslink-outbox";
const DB_NAME = "campuslink";
const DB_VERSION = 1;

/** Without an answer after this delay, a navigation is served from the cache (when there is a copy). */
const NAVIGATION_TIMEOUT_MS = 6000;
/** A page saved less than this long ago is not fetched again in the background. */
const PAGE_REFRESH_MS = 10 * 60 * 1000;
/** Saved pages older than this are never served, and deleted. */
const PAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Expired or foreign copies are looked for at most this often. */
const PRUNE_INTERVAL_MS = 10 * 1000;

/** Set by proxy.ts on dashboard pages: the account (user id) the page was rendered for. */
const OWNER_HEADER = "x-cl-owner";
const SAVED_AT_HEADER = "x-cl-saved-at";
const PUBLIC_OWNER = "public";
/** Readable session cookie (lib/session.ts) holding the signed-in user's id. */
const OWNER_COOKIE = "cl_owner";

/** The landing page: no personal data, served to anyone. */
const PUBLIC_PAGES = ["/"];
/** Pages of the offline modules. Admin pages and /dashboard/account are never saved. */
const PRIVATE_PAGES = [
  /^\/dashboard$/,
  /^\/dashboard\/timetable$/,
  /^\/dashboard\/announcements$/,
  /^\/dashboard\/announcements\/[A-Za-z0-9_-]{1,64}$/,
  /^\/dashboard\/notifications$/,
];

const NEVER_CACHE_PREFIXES = ["/bff/", "/api/", "/auth/"];
const AUTH_PAGES = ["/login", "/signup", "/forgot-password", "/reset-password"];

const pageSavedAt = new Map();
let precacheCheckedAt = 0;
let prunedAt = 0;

// ---------------------------------------------------------------- helpers

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isNeverCached(url) {
  return (
    NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) ||
    AUTH_PAGES.some((page) => url.pathname === page || url.pathname.startsWith(`${page}/`))
  );
}

/** "public" (landing page), "private" (offline module pages, owner-bound) or null (never saved). */
function pageKind(url) {
  if (!isSameOrigin(url) || isNeverCached(url)) return null;
  if (PUBLIC_PAGES.includes(url.pathname)) return "public";
  if (PRIVATE_PAGES.some((pattern) => pattern.test(url.pathname))) return "private";
  return null;
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(?:woff2?|ttf|otf|eot)$/i.test(url.pathname) ||
    url.pathname === "/logo.png" ||
    url.pathname === "/favicon.ico"
  );
}

function isHtml(response) {
  return (response.headers.get("content-type") || "").includes("text/html");
}

function pageKey(url) {
  return `${url.origin}${url.pathname}${url.search}`;
}

/** Only same-site relative paths ("/dashboard/..."), never "//host" or "/\\host". */
function safeLink(link) {
  if (typeof link !== "string" || !link.startsWith("/") || link.startsWith("//") || link.startsWith("/\\")) return null;
  return link;
}

async function withLock(callback) {
  const locks = self.navigator && self.navigator.locks;
  return locks ? locks.request("campuslink-outbox", callback) : callback();
}

async function notifyClients(message) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) client.postMessage(message);
}

// ---------------------------------------------------------------- page owner

/** IndexedDB "meta" owner, read without ever creating the database. */
function readMetaOwner() {
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME);
    } catch {
      resolve(null);
      return;
    }
    // No database yet: abort its creation, nobody owns data on this device.
    request.onupgradeneeded = () => request.transaction.abort();
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      const done = (value) => {
        db.close();
        resolve(typeof value === "string" && value ? value : null);
      };
      try {
        if (!db.objectStoreNames.contains("meta")) {
          done(null);
          return;
        }
        const get = db.transaction("meta", "readonly").objectStore("meta").get("owner");
        get.onsuccess = () => done(get.result && get.result.value);
        get.onerror = () => done(null);
      } catch {
        done(null);
      }
    };
  });
}

/**
 * The account whose saved pages may be shown now, or null (then none is). The `cl_owner` cookie when the
 * Cookie Store API exists in workers (it disappears with the session cookies, e.g. when the browser closes a
 * session that was not remembered); otherwise the IndexedDB owner, which the end of a session wipes.
 */
async function currentOwner() {
  if (self.cookieStore && typeof self.cookieStore.get === "function") {
    try {
      const cookie = await self.cookieStore.get(OWNER_COOKIE);
      return cookie && cookie.value ? cookie.value : null;
    } catch {
      return null;
    }
  }
  return readMetaOwner();
}

/** May this saved copy be served to `owner` (the current account, or null)? */
function isServable(response, kind, owner) {
  const savedAt = Number(response.headers.get(SAVED_AT_HEADER));
  if (!Number.isFinite(savedAt) || savedAt <= 0 || Date.now() - savedAt > PAGE_MAX_AGE_MS) return false;
  const pageOwner = response.headers.get(OWNER_HEADER);
  if (kind === "public") return pageOwner === PUBLIC_OWNER;
  return kind === "private" && !!owner && pageOwner === owner;
}

/** Deletes saved pages that are expired, unlabelled, no longer saveable, or not the current account's. */
async function prunePages(force = false) {
  if (!force && Date.now() - prunedAt < PRUNE_INTERVAL_MS) return;
  prunedAt = Date.now();
  if (!(await caches.has(PAGES_CACHE))) return;
  const cache = await caches.open(PAGES_CACHE);
  const requests = await cache.keys();
  if (requests.length === 0) return;
  const owner = await currentOwner();
  await Promise.all(
    requests.map(async (request) => {
      const response = await cache.match(request, { ignoreVary: true });
      if (!response || !isServable(response, pageKind(new URL(request.url)), owner)) {
        await cache.delete(request, { ignoreVary: true });
        pageSavedAt.delete(request.url);
      }
    })
  );
}

// ---------------------------------------------------------------- precache

/** /_next/static files referenced by a page (scripts, styles, fonts, RSC chunks). */
async function cacheAssetsOf(html) {
  const urls = new Set();
  const pattern = /\/_next\/static\/[^"'\\\s)<>]+/g;
  let match;
  while ((match = pattern.exec(html))) urls.add(match[0].replace(/&amp;/g, "&"));
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        if (await cache.match(url)) return;
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response);
      } catch {
        // best effort
      }
    })
  );
}

async function precache() {
  const cache = await caches.open(PRECACHE);
  await Promise.all(
    PRECACHE_URLS.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "reload", credentials: "same-origin" });
        if (!response.ok) return;
        if (url === OFFLINE_URL) await cacheAssetsOf(await response.clone().text());
        await cache.put(url, response);
      } catch {
        // Offline during install: retried later (ensurePrecache).
      }
    })
  );
}

/** Re-creates the precache when it is missing (e.g. after logout cleared Cache Storage). */
async function ensurePrecache() {
  if (Date.now() - precacheCheckedAt < 60 * 1000) return;
  precacheCheckedAt = Date.now();
  if (!(await caches.match(OFFLINE_URL))) await precache();
}

// ---------------------------------------------------------------- lifecycle

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith("campuslink-") && !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key))
      );
      await prunePages(true).catch(() => undefined);
      await self.clients.claim();
    })()
  );
});

// ---------------------------------------------------------------- fetch

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = (await cache.match(request)) || (await caches.match(request));
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") await cache.put(request, response.clone());
  return response;
}

/**
 * The saved copy of `url` (same query first, then any query) that the current account may see. The copies
 * found that nobody may see any more (expired, another account's, no session) are deleted on the way.
 */
async function cachedPage(url, kind) {
  if (!(await caches.has(PAGES_CACHE))) return undefined;
  const cache = await caches.open(PAGES_CACHE);
  const exact = await cache.match(pageKey(url), { ignoreVary: true });
  const candidates = [
    ...(exact ? [{ request: pageKey(url), response: exact }] : []),
    ...(await cache.keys(`${url.origin}${url.pathname}`, { ignoreVary: true, ignoreSearch: true })).map((request) => ({ request })),
  ];
  if (candidates.length === 0) return undefined;
  const owner = kind === "private" ? await currentOwner() : null;
  for (const candidate of candidates) {
    const response = candidate.response || (await cache.match(candidate.request, { ignoreVary: true }));
    if (response && isServable(response, kind, owner)) return response;
    await cache.delete(candidate.request, { ignoreVary: true });
    pageSavedAt.delete(typeof candidate.request === "string" ? candidate.request : candidate.request.url);
  }
  return undefined;
}

/** Saves a page answer, labelled with its owner and save time. Private pages without an owner are not kept. */
async function savePage(url, response, kind) {
  if (!kind || !response.ok || response.type !== "basic" || response.redirected || !isHtml(response)) return;
  const owner = kind === "public" ? PUBLIC_OWNER : response.headers.get(OWNER_HEADER);
  if (!owner) return;
  const headers = new Headers(response.headers);
  // The body below is already decoded.
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set(OWNER_HEADER, owner);
  headers.set(SAVED_AT_HEADER, String(Date.now()));
  const body = await response.blob();
  const cache = await caches.open(PAGES_CACHE);
  await cache.put(pageKey(url), new Response(body, { status: response.status, statusText: response.statusText, headers }));
  pageSavedAt.set(pageKey(url), Date.now());
}

async function offlineFallback() {
  const offline = await caches.match(OFFLINE_URL, { ignoreVary: true });
  if (offline) return offline;
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CampusLink</title><h1>Offline · Hors ligne</h1>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

/**
 * Network first; after NAVIGATION_TIMEOUT_MS or on failure: the current account's saved copy, then /offline.
 * Navigations also prune the saved pages (at most once a minute).
 */
async function handleNavigation(event, url) {
  const kind = pageKind(url);
  const network = fetch(event.request);

  if (kind) {
    event.waitUntil(
      network
        .then((response) => savePage(url, response.clone(), kind))
        .catch(() => undefined)
    );
  }
  event.waitUntil(network.then(() => ensurePrecache()).catch(() => undefined));
  event.waitUntil(prunePages().catch(() => undefined));

  try {
    if (!kind) return await network;
    const cached = await cachedPage(url, kind).catch(() => undefined);
    if (!cached) return await network;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS));
    const winner = await Promise.race([network, timeout]);
    return winner || cached;
  } catch {
    if (kind) {
      const cached = await cachedPage(url, kind).catch(() => undefined);
      if (cached) return cached;
    }
    return offlineFallback();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Mutations, Server Actions (POST) and anything that is not a GET go straight to the network.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!isSameOrigin(url) || isNeverCached(url) || request.headers.has("next-action")) {
    if (request.mode === "navigate" && isSameOrigin(url)) {
      // Auth pages and /auth routes are never cached, but still get the offline page.
      event.respondWith(fetch(request).catch(() => offlineFallback()));
    }
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event, url));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith(fetch(request).catch(async () => (await caches.match(url.pathname)) || Response.error()));
  }
  // Everything else (RSC payloads, prefetches, images...) uses the network without caching.
});

// ---------------------------------------------------------------- messages from the pages

async function cachePageInBackground(path) {
  const url = new URL(path, self.location.origin);
  const kind = pageKind(url);
  if (!kind) return;
  const savedAt = pageSavedAt.get(pageKey(url));
  if (savedAt && Date.now() - savedAt < PAGE_REFRESH_MS) return;
  pageSavedAt.set(pageKey(url), Date.now());
  try {
    // x-cl-background: the proxy never refreshes (rotates) the session for these requests.
    const response = await fetch(pageKey(url), {
      credentials: "same-origin",
      redirect: "manual",
      headers: { Accept: "text/html", "x-cl-background": "1" },
    });
    await savePage(url, response, kind);
  } catch {
    pageSavedAt.delete(pageKey(url));
  }
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "CACHE_PAGE" && typeof data.url === "string") {
    event.waitUntil(Promise.all([cachePageInBackground(data.url), prunePages().catch(() => undefined)]));
  } else if (data.type === "PRECACHE") {
    precacheCheckedAt = 0;
    pageSavedAt.clear();
    event.waitUntil(precache());
  } else if (data.type === "REPLAY_OUTBOX") {
    event.waitUntil(replayOutbox().catch(() => undefined));
  } else if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ---------------------------------------------------------------- push

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof payload.title === "string" && payload.title ? payload.title : "CampusLink";
  const link = safeLink(payload.link);
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    data: { ...(payload.data && typeof payload.data === "object" ? payload.data : {}), link },
  };
  if (typeof payload.tag === "string" && payload.tag) options.tag = payload.tag;

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      await notifyClients({ type: "PUSH_RECEIVED", tag: options.tag || null, link });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = safeLink(event.notification.data && event.notification.data.link) || "/dashboard/notifications";
  const target = new URL(link, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows.find((candidate) => new URL(candidate.url).origin === self.location.origin);
      if (client) {
        await client.focus();
        try {
          await client.navigate(target);
        } catch {
          client.postMessage({ type: "NAVIGATE", url: link });
        }
        return;
      }
      await self.clients.openWindow(target);
    })()
  );
});

// ---------------------------------------------------------------- background sync (outbox replay)

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache", { keyPath: "key" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" }).createIndex("createdAt", "createdAt");
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

function storeRequest(db, storeName, mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = run(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function bffUrl(path) {
  if (path.startsWith("/bff/")) return path;
  if (path.startsWith("/api/")) return `/bff/${path.slice(5)}`;
  return `/bff${path.startsWith("/") ? path : `/${path}`}`;
}

/** Same rules as replayOutbox() in lib/offline/outbox.ts. Rejects when offline so the browser retries. */
async function replayOutbox() {
  await withLock(async () => {
    const db = await openDb();
    let sent = 0;
    try {
      const owner = ((await storeRequest(db, "meta", "readonly", (store) => store.get("owner"))) || {}).value;
      const records = ((await storeRequest(db, "outbox", "readonly", (store) => store.getAll())) || [])
        .filter((record) => record.owner === owner)
        .sort((a, b) => a.createdAt - b.createdAt);

      for (const record of records) {
        let response;
        try {
          response = await fetch(bffUrl(record.path), {
            method: record.method,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: record.body === undefined ? undefined : JSON.stringify(record.body),
            credentials: "same-origin",
          });
        } catch {
          throw new Error("offline");
        }
        if (response.ok) {
          await storeRequest(db, "outbox", "readwrite", (store) => store.delete(record.id));
          sent += 1;
          continue;
        }
        // Session over, server unreachable or busy: keep the rest for later.
        if (response.status === 401 || response.status === 429 || response.status >= 500) break;
        // Rejected for good (e.g. 404): drop it.
        await storeRequest(db, "outbox", "readwrite", (store) => store.delete(record.id));
      }
    } finally {
      db.close();
      if (sent > 0) await notifyClients({ type: "OUTBOX_CHANGED", sent });
    }
  });
}

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(replayOutbox());
});
