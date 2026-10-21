const express = require('express');
const router = express.Router();
const controller = require('../controllers/product');

// middleware 的內容
const mw = require('../middlewares/product/index');
const auth = require('../middlewares/auth');
const authRole = require('../middlewares/authorizeRoles');

// 掛在 /api/v1/admin/product。公開的商品路由在 routes/product.js

// [POST] 編號 46 : 管理者新增旅遊項目
router.post('/add', auth, authRole('admin'), mw.productImageUpload(), mw.post_Product, controller.post_admin_product);
// X [POST] 46 : 管理者新增旅遊項目
// router.post('/add', auth, authRole('admin'),/* mw.,*/ controller.post_Touradd);

// [GET] 47 : 管理者查看刊登的旅遊項目
router.get('/', auth, authRole('admin'), mw.get_tourSearch, controller.get_tourSearch);

// [PATCH] 50 : 管理者上架刊登旅遊項目
// 必須宣告在 PATCH /:tour_id 之前，否則 "status" 會被當成 tour_id
router.patch('/status', auth, authRole('admin'), mw.patch_tourStatus, controller.patch_tourStatus);

// [GET] 48 : 管理者查看旅遊項目詳細內容
router.get('/:tour_id', auth, authRole('admin'), mw.get_admin_tourDetail, controller.get_tourDetail);

// [PATCH] 49 : 管理者修改旅遊項目細項內容
router.patch('/:tour_id', auth, authRole('admin'), mw.patch_admin_tourDetail, controller.patch_tourInfo);

// [DELETE] 51 : 管理者刪除旅遊項目
router.delete('/', auth, authRole('admin'), mw.delete_tourProduct, controller.delete_tourProduct);

module.exports = router;
