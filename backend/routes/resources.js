const express = require('express');
const controller = require('../controllers/resourceController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

// Module 5 (resources: equipment), phase 2 contract section 1.1. Mounted at /api/resources.
// Rooms stay in /api/academic/rooms. Reading: any authenticated user. Changes: ADMIN.
const router = express.Router();

router.use(requireAuth);
const adminOnly = requireRole('ADMIN');

router.get('/equipment', controller.listEquipment);
router.get('/equipment/:id', controller.getEquipment);
router.post('/equipment', adminOnly, controller.createEquipment);
router.patch('/equipment/:id', adminOnly, controller.updateEquipment);
router.delete('/equipment/:id', adminOnly, controller.deleteEquipment);

module.exports = router;
