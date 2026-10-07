const path = require('path');

// Load backend/.env first (variables already set in the environment take precedence).
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const logger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const User = require('./models/userModel');
const RefreshToken = require('./models/refreshTokenModel');

const REQUIRED_ENV = ['MONGO_URI', 'JWT_SECRET'];

const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
app.disable('x-powered-by');

// Requests without an Origin header (mobile app, curl) are not affected by CORS.
app.use(cors({ origin: corsOrigins }));
app.use(express.json({ limit: '1mb' }));
app.use(logger);

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

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

  const port = Number(process.env.PORT) || 4000;

  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    // Make sure the unique email index and the refresh token TTL index exist before serving requests.
    await Promise.all([User.init(), RefreshToken.init()]);
  } catch (error) {
    console.error(`Could not connect to MongoDB (check MONGO_URI): ${error.message}`);
    process.exit(1);
  }

  // Express 5 calls this callback with an error when the server cannot start (e.g. port in use).
  const server = app.listen(port, (error) => {
    if (error) {
      console.error(`Could not start the HTTP server on port ${port}: ${error.message}`);
      process.exit(1);
    }
    console.log(`CampusLink API listening on http://localhost:${port}`);
  });

  const shutdown = () => {
    server.close(() => {
      mongoose.disconnect().finally(() => process.exit(0));
    });
    // Do not wait forever for open keep-alive connections.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

if (require.main === module) {
  start();
}

module.exports = app;
