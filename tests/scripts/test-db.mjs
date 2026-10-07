// Throwaway MongoDB for the test run (started by playwright.config.ts, first webServer).
// It also resets tests/.tmp, so every run starts with an empty database and an empty mail outbox.
// Usage: node scripts/test-db.mjs [port]   (default 27018)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(here, '..', '.tmp');
const dbPath = path.join(tmpDir, 'mongodb');
const outboxFile = path.join(tmpDir, 'outbox.jsonl');
const port = Number(process.argv[2]) || 27018;

fs.rmSync(dbPath, { recursive: true, force: true });
fs.mkdirSync(dbPath, { recursive: true });
fs.rmSync(outboxFile, { force: true });

const mongod = await MongoMemoryServer.create({
  instance: {
    ip: '127.0.0.1',
    port,
    dbPath,
    dbName: 'campuslink-test',
    launchTimeout: 60_000,
    // Small, non-preallocated journal files (the default preallocates 200 MB on disk).
    args: ['--wiredTigerEngineConfigString=log=(prealloc=false,file_max=10MB)'],
  },
});

console.log(`[test-db] MongoDB ready at ${mongod.getUri()}`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  try {
    await mongod.stop({ doCleanup: false });
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// Keep the process alive until Playwright stops it.
setInterval(() => {}, 60 * 60 * 1000);
