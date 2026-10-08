const express = require('express');
const handlers = require('../controllers/gradeController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

// Module 9 (assessments and grades), phase 2 contract section 3.2. Mounted at /api/grades in app.js.
const router = express.Router();

router.use(requireAuth);
const staff = requireRole('TEACHER', 'ADMIN');

router.get('/me', requireRole('STUDENT'), handlers.getMine);
router.get('/teaching', staff, handlers.listTeaching);

router.get('/assessments', staff, handlers.listAssessments);
router.post('/assessments', staff, handlers.createAssessment);
router.get('/assessments/:id', staff, handlers.getAssessment);
router.patch('/assessments/:id', staff, handlers.updateAssessment);
router.delete('/assessments/:id', staff, handlers.deleteAssessment);
router.get('/assessments/:id/grades', staff, handlers.getGrades);
router.put('/assessments/:id/grades', staff, handlers.saveGrades);
router.post('/assessments/:id/publish', staff, handlers.publishAssessment);

module.exports = router;
