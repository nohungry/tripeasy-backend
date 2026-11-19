const express = require('express');
const router = express.Router();
const controller = require('../controllers/product');

// middleware 的內容
const mw = require('../middlewares/product/index');
const auth_not_manda = require('../middlewares/auth_not_mandatory');
const auth = require('../middlewares/auth');
const authRole = require('../middlewares/authorizeRoles');

// 掛在 /api/v1/user/product/search。管理者的商品路由在 routes/product_admin.js

// [GET] 編號 22 : 使用者查詢旅遊項目
router.get('/', auth_not_manda, mw.get_tourData, controller.get_tourData);

// [GET] 編號 23 : 使用者查看旅遊項目詳細資料
router.get('/:tour_id', auth_not_manda, mw.get_tourDetail, controller.get_tourDetails);

// [GET] 編號 24 : 使用者查看細項資料好評分數、評論
router.get('/:tour_id/reviews', auth_not_manda, mw.get_tourReview, controller.get_tourReview);

// [GET] 編號 25 : 使用者查看細項資料隱藏玩法
router.get(
  '/:tour_id/hidden-shares',
  auth_not_manda,
  mw.get_tourHiddenPlay,
  controller.get_tourHiddenPlay
);

// [GET] 購買資格查詢（會員）
router.get('/:tour_id/eligibility', auth, authRole('User'), mw.get_tourEligibility, controller.get_tourEligibility);

// [POST] 寫評論（購買過的會員）
router.post('/:tour_id/reviews', auth, authRole('User'), mw.post_tourReview, controller.post_tourReview);

// [POST] 分享隱藏玩法（購買過的會員）
router.post(
  '/:tour_id/hidden-shares',
  auth,
  authRole('User'),
  mw.post_tourHiddenShare,
  controller.post_tourHiddenShare
);

module.exports = router;
