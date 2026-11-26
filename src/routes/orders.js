const express = require('express');
const router = express.Router();
const controller = require('../controllers/orders');

const auth = require('../middlewares/auth');
const mw = require('../middlewares/orders/index');
const authRole = require('../middlewares/authorizeRoles');

// [GET] 我的訂單列表
router.get('/', auth, authRole('User'), mw.getOrders, controller.get_orders);

// [GET] 我的訂單明細
router.get('/:order_id', auth, authRole('User'), mw.getOrder, controller.get_order);

module.exports = router;
