const express = require('express');
const router = express.Router();
const controller = require('../controllers/newebpay');

// middleware 的內容
const auth = require('../middlewares/auth');
const authRole = require('../middlewares/authorizeRoles');
const mw = require('../middlewares/newebpay');

// [POST] 編號 37 : 藍新金流交易處理
router.post('/payment', auth, authRole('User'), mw.post_newebpayPayment, controller.post_newebpay_payment);

// [POST] 編號 38 : notify（藍新伺服器呼叫，不需登入，靠 TradeSha 驗證）
router.post('/notify', controller.post_newebpay_notify);

// [POST] 編號 39 : return（瀏覽器從藍新導回，只做導向）
router.post('/return', controller.post_newebpay_return);

module.exports = router;
