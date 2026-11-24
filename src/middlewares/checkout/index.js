const resStatus = require('../../utils/resStatus');
const { pool } = require('../../config/database');

const checkout_Vaildator = require('../../utils/Validator/checkout_Vaildator');

// [POST] 編號 89 : 使用者進入填寫畫面後產生訂單
async function post_userOrder(req, res, next) {
  const { error } = checkout_Vaildator.cartIDSchema.validate(req.params);

  // [HTTP 400] 資料錯誤
  if (error) {
    const message = error?.details?.[0]?.message || '欄位驗證錯誤';
    resStatus({
      res: res,
      status: 400,
      message: message,
    });
    return;
  }

  // [HTTP 404] 查無此購物車項目
  const { cart_id } = req.params;
  const cartRepo = await pool.query(
    'SELECT * FROM public."cart" WHERE cart_id = $1 AND user_id = $2',
    [cart_id, req.user.id]
  );
  if (cartRepo.rowCount === 0) {
    return resStatus({
      res,
      status: 404,
      message: '查無此購物車項目',
    });
  }

  next();
}

// [GET] 編號 34 : 使用者進入填寫畫面後預帶使用者資訊
async function get_userOrderPrfile(req, res, next) {
  const { error } = checkout_Vaildator.orderIDSchema.validate(req.params);

  // [HTTP 400] 資料錯誤
  if (error) {
    const message = error?.details?.[0]?.message || '欄位驗證錯誤';
    resStatus({
      res: res,
      status: 400,
      message: message,
    });
    return;
  }

  // [HTTP 404] 查無此訂單項目
  const { order_id } = req.params;
  const orderRepo = await pool.query(
    'SELECT * FROM public."orders" WHERE order_id = $1 AND user_id = $2',
    [order_id, req.user.id]
  );
  if (orderRepo.rowCount === 0) {
    return resStatus({
      res,
      status: 404,
      message: '查無此訂單項目',
    });
  }

  next();
}

// [PATCH] 編號 35 : 使用者輸入個人資料、選擇想要付款方式
async function patch_userOrderPreview(req, res, next) {
  const { error: paramsError } = checkout_Vaildator.orderIDSchema.validate(req.params);
  const { error: bodyError } = checkout_Vaildator.postSchema.validate(req.body);

  // [HTTP 400] 資料錯誤
  if (paramsError || bodyError) {
    const message =
      paramsError?.details?.[0]?.message || bodyError?.details?.[0]?.message || '欄位驗證錯誤';
    resStatus({
      res: res,
      status: 400,
      message: message,
    });
    return;
  }

  // [HTTP 404] 查無此使用者
  const userRepo = await pool.query('SELECT * FROM public."user" WHERE lower(email) = lower($1)', [
    req.body.user.email,
  ]);
  if (userRepo.rowCount === 0) {
    return resStatus({
      res,
      status: 404,
      message: '查無此使用者',
    });
  }

  next();
}

// [GET] 編號 36 : 使用者確認購買項目、總金額
async function get_userCheckOrder(req, res, next) {
  const { error } = checkout_Vaildator.orderIDSchema.validate(req.params);

  // [HTTP 400] 資料錯誤
  if (error) {
    const message = error?.details?.[0]?.message || '欄位驗證錯誤';
    resStatus({
      res: res,
      status: 400,
      message: message,
    });
    return;
  }

  // [HTTP 404] 查無此訂單項目
  const { order_id } = req.params;
  const orderRepo = await pool.query(
    'SELECT * FROM public."orders" WHERE order_id = $1 AND user_id = $2',
    [order_id, req.user.id]
  );
  if (orderRepo.rowCount === 0) {
    return resStatus({
      res,
      status: 404,
      message: '查無此訂單項目',
    });
  }

  next();
}

module.exports = {
  post_userOrder,
  get_userOrderPrfile,
  patch_userOrderPreview,
  get_userCheckOrder,
};
