const express = require('express');
const handlers = require('../controllers/marketplaceController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { userRateLimit } = require('../middleware/rateLimit');

// Module 3 (notes marketplace), phase 3 contract section 3. Mounted at /api/marketplace in app.js.
// Any signed-in user browses, downloads, buys, reviews and reports; STUDENT, TEACHER and ADMIN upload;
// moderation is for ADMINs. See docs/marketplace.md.
const router = express.Router();

router.use(requireAuth);
const admin = requireRole('ADMIN');
const uploaders = requireRole('STUDENT', 'TEACHER', 'ADMIN');
// ADMINs are not limited (moderation, catalog seeding).
const isAdminRequest = (req) => req.user?.role === 'ADMIN';

// Every upload is a file to store and (for non-admins) a review request for the admins.
const uploadLimit = userRateLimit({
  name: 'market-upload',
  limitEnv: 'RATE_LIMIT_MARKET_UPLOAD_MAX',
  defaultLimit: 10,
  windowEnv: 'RATE_LIMIT_MARKET_WINDOW_MS',
  defaultWindowMs: 60 * 60 * 1000,
  skip: isAdminRequest,
  message: 'Too many uploads, please try again later',
});
const reportLimit = userRateLimit({
  name: 'market-report',
  limitEnv: 'RATE_LIMIT_MARKET_REPORT_MAX',
  defaultLimit: 20,
  windowEnv: 'RATE_LIMIT_MARKET_WINDOW_MS',
  defaultWindowMs: 60 * 60 * 1000,
  skip: isAdminRequest,
  message: 'Too many reports, please try again later',
});

router.get('/config', handlers.getConfig);
router.get('/wallet', handlers.getWallet);

// Documents (the rate limit runs before the multipart body is read).
router.get('/documents', handlers.listDocuments);
router.post('/documents', uploaders, uploadLimit, handlers.uploadFile, handlers.createDocument);
router.get('/documents/:id', handlers.getDocument);
router.patch('/documents/:id', handlers.updateDocument);
router.delete('/documents/:id', handlers.deleteDocument);
router.get('/documents/:id/file', handlers.downloadFile);
router.post('/documents/:id/purchase', handlers.purchaseDocument);

// Reviews.
router.get('/documents/:id/reviews', handlers.listReviews);
router.put('/documents/:id/review', handlers.saveReview);
router.delete('/documents/:id/review', handlers.deleteOwnReview);
router.delete('/reviews/:id', admin, handlers.deleteReview);

// Reports and moderation.
router.post('/documents/:id/report', reportLimit, handlers.reportDocument);
router.post('/documents/:id/approve', admin, handlers.approveDocument);
router.post('/documents/:id/reject', admin, handlers.rejectDocument);
router.post('/documents/:id/unpublish', admin, handlers.unpublishDocument);
router.get('/reports', admin, handlers.listReports);
router.post('/reports/:id/resolve', admin, handlers.resolveReport);

module.exports = router;
