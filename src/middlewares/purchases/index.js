const resStatus = require('../../utils/resStatus.js');
const { pool } = require('../../config/database');

// 資料驗證相關模組
const purchases_Validator = require('../../utils/Validator/purchases_Validator.js');
const { userMessage } = require('../../utils/Validator/joiMessage.js');

// [GET] 編號 20 : 使用者已購買項目清單
// 無

// [GET] 編號 21 : 使用者查看訂單明細
async function getpurchasesOrder(req, res, next) {
  const { error: paramsError, value: paramsValue } = purchases_Validator.paramSchema.validate(
    req.params
  );
  const { error: queryError, value: queryValue } = purchases_Validator.querySchema.validate(
    req.query
  );

  // [HTTP 400] 資料錯誤
  if (paramsError || queryError) {
    return resStatus({
      res: res,
      status: 400,
      message: userMessage(paramsError || queryError),
    });
  }

  // [HTTP 404] 查無此訂單項目（不存在或不是本人的；擁有者條件寫在 SQL）
  const dataRepo = await pool.query(
    `SELECT 1 FROM public."order_item" oi JOIN public."orders" o USING (order_id)
     WHERE oi.order_item_id = $1 AND o.user_id = $2`,
    [paramsValue.order_item_id, req.user.id]
  );
  if (dataRepo.rowCount === 0) {
    return resStatus({
      res: res,
      status: 404,
      message: '查無此訂單項目',
    });
  }

  // ✅ 將驗證後的資料存回 req 供後續使用
  req.validatedParams = paramsValue;
  req.validatedQuery = queryValue;
  next();
}

module.exports = {
  getpurchasesOrder,
};
