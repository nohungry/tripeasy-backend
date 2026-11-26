const express = require('express');
const router = express.Router();
const controller = require('../controllers/points');

const auth = require('../middlewares/auth');
const mw = require('../middlewares/points/index');
const authRole = require('../middlewares/authorizeRoles');

// [GET] 我的點數紀錄
router.get('/records', auth, authRole('User'), mw.getRecords, controller.get_records);

module.exports = router;
