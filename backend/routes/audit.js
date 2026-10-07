const express = require('express');
const { listAuditLogs, listAuditActions } = require('../controllers/auditController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

const router = express.Router();

// Mounted at /api/audit. ADMIN only.
router.use(requireAuth, requireRole('ADMIN'));

router.get('/', listAuditLogs);
router.get('/actions', listAuditActions);

module.exports = router;
