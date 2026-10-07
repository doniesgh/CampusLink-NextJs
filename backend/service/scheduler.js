const { envNumber } = require('../utils/env');

/*
 * Tiny in-process job scheduler. Modules register jobs when they are loaded; app.js starts them
 * once MongoDB is connected and stops them on shutdown. Jobs never overlap with themselves
 * (the next run is planned when the previous one ends), timers are unref'd (they never keep the
 * process alive) and errors are logged, never thrown.
 *
 *   const scheduler = require('../service/scheduler');
 *   scheduler.registerJob('announcements.publish-due', scheduler.defaultIntervalMs(), async () => { ... });
 *
 * With several backend instances every instance runs the jobs: claim work atomically
 * (findOneAndUpdate) so nothing is processed twice.
 */

const jobs = new Map();
let started = false;

// SCHEDULER_INTERVAL_MS (default 30000).
const defaultIntervalMs = () => envNumber('SCHEDULER_INTERVAL_MS', 30000);

const plan = (job, delay) => {
  if (!started || job.stopped) return;
  job.timer = setTimeout(() => runJob(job), delay);
  job.timer.unref();
};

const runJob = async (job) => {
  job.timer = null;
  if (!started || job.stopped) return;
  job.running = (async () => {
    try {
      await job.fn();
    } catch (error) {
      console.error(`[scheduler] Job "${job.name}" failed:`, error);
    }
  })();
  await job.running;
  job.running = null;
  job.lastRunAt = new Date();
  plan(job, job.intervalMs);
};

/**
 * Registers a job (names are unique: registering a name again replaces the previous job).
 * @param {string} name
 * @param {number} intervalMs  delay between the end of a run and the start of the next one
 * @param {() => Promise<void>|void} fn
 * @param {{ runOnStart?: boolean }} [options]  runOnStart (default true): first run 1 s after start
 * @returns {{ stop: () => void, runNow: () => Promise<void> }}
 */
const registerJob = (name, intervalMs, fn, { runOnStart = true } = {}) => {
  if (typeof name !== 'string' || !name) throw new Error('registerJob: name is required');
  if (typeof fn !== 'function') throw new Error('registerJob: fn must be a function');
  const interval = Number(intervalMs) > 0 ? Number(intervalMs) : defaultIntervalMs();

  if (jobs.has(name)) unregister(name);
  const job = { name, intervalMs: interval, fn, runOnStart, timer: null, running: null, stopped: false, lastRunAt: null };
  jobs.set(name, job);
  if (started) plan(job, runOnStart ? Math.min(1000, interval) : interval);

  return {
    stop: () => unregister(name),
    // Runs the job immediately (e.g. in a script); errors are logged.
    runNow: async () => {
      try {
        await fn();
      } catch (error) {
        console.error(`[scheduler] Job "${name}" failed:`, error);
      }
    },
  };
};

const unregister = (name) => {
  const job = jobs.get(name);
  if (!job) return;
  job.stopped = true;
  if (job.timer) clearTimeout(job.timer);
  jobs.delete(name);
};

// Starts every registered job (called by app.js after the database connection).
const start = () => {
  if (started) return;
  started = true;
  jobs.forEach((job) => plan(job, job.runOnStart ? Math.min(1000, job.intervalMs) : job.intervalMs));
  if (jobs.size > 0) console.log(`[scheduler] Started ${jobs.size} job(s): ${[...jobs.keys()].join(', ')}`);
};

// Stops planning new runs and waits (up to timeoutMs) for running jobs to finish.
const stop = async (timeoutMs = 5000) => {
  started = false;
  const running = [];
  jobs.forEach((job) => {
    if (job.timer) clearTimeout(job.timer);
    job.timer = null;
    if (job.running) running.push(job.running);
  });
  if (running.length === 0) return;
  await Promise.race([Promise.allSettled(running), new Promise((resolve) => setTimeout(resolve, timeoutMs).unref())]);
};

const listJobs = () =>
  [...jobs.values()].map(({ name, intervalMs, lastRunAt }) => ({ name, intervalMs, lastRunAt }));

module.exports = { registerJob, start, stop, listJobs, defaultIntervalMs, isStarted: () => started };
