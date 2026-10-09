const path = require('path');

// Load backend/.env first (variables already set in the environment take precedence).
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const logger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');
const scheduler = require('./service/scheduler');
const { isSmtpConfigured } = require('./service/mailService');
const { isProduction, trustProxySetting } = require('./utils/env');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const academicRoutes = require('./routes/academic');
const notificationRoutes = require('./routes/notifications');
const pushRoutes = require('./routes/push');
const auditRoutes = require('./routes/audit');
const timetableRoutes = require('./routes/timetable');
const announcementRoutes = require('./routes/announcements');
const resourceRoutes = require('./routes/resources');
const bookingRoutes = require('./routes/bookings');
const forumRoutes = require('./routes/forum');
const attendanceRoutes = require('./routes/attendance');
const gradeRoutes = require('./routes/grades');
const analyticsRoutes = require('./routes/analytics');
const carpoolRoutes = require('./routes/carpool');
const marketplaceRoutes = require('./routes/marketplace');
const alumniRoutes = require('./routes/alumni');
const realtimeRoutes = require('./routes/realtime');
const ForumRoutes = require('./routes/forumRoutes');

const realtime = require('./service/realtime');

const REQUIRED_ENV = ['MONGO_URI', 'JWT_SECRET'];

const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
app.disable('x-powered-by');
// req.ip is the real client IP behind the Next.js BFF / a reverse proxy (TRUST_PROXY, default "loopback").
app.set('trust proxy', trustProxySetting());

// Requests without an Origin header (mobile app, curl) are not affected by CORS.
app.use(cors({ origin: corsOrigins }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(logger);

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/academic', academicRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api/forum', ForumRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/grades', gradeRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/carpool', carpoolRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/alumni', alumniRoutes);
app.use('/api/realtime', realtimeRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' });
});

app.use(errorHandler);

const start = async () => {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(
      `Missing required environment variable(s): ${missing.join(', ')}. Set them in backend/.env (see backend/.env.example).`
    );
    process.exit(1);
  }
  if (isProduction() && !isSmtpConfigured()) {
    console.warn('[mail] NODE_ENV=production without SMTP_USER/SMTP_PASS: emails (2FA codes, reset links) will fail.');
  }

  const port = Number(process.env.PORT) || 4000;

  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  } catch (error) {
    console.error(`Could not connect to MongoDB (check MONGO_URI): ${error.message}`);
    process.exit(1);
  }
  try {
    // Make sure every index (unique, TTL, ...) of every registered model exists before serving requests.
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  } catch (error) {
    console.error(`Could not create the MongoDB indexes: ${error.message}`);
    process.exit(1);
  }

  // Background jobs registered by the modules (e.g. scheduled announcements).
  scheduler.start();

  // Express 5 calls this callback with an error when the server cannot start (e.g. port in use).
  const server = app.listen(port, (error) => {
    if (error) {
      console.error(`Could not start the HTTP server on port ${port}: ${error.message}`);
      process.exit(1);
    }
    console.log(`CampusLink API listening on http://localhost:${port}`);
  });
  // Real-time layer (Socket.IO) on the same HTTP server (phase 3 contract section 1).
  realtime.init(server);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Do not wait forever for open keep-alive connections or running jobs.
    setTimeout(() => process.exit(0), 8000).unref();
    const jobsStopped = scheduler.stop();
    server.close(() => {
      jobsStopped.finally(() => mongoose.disconnect().finally(() => process.exit(0)));
    });
    server.closeIdleConnections?.();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

if (require.main === module) {
  start();
}

module.exports = app;
