const Joi = require('joi');
const resStatus = require('../../utils/resStatus.js');

// body 只認 order_id，其他鍵忽略（金額等一律由後端計算）
const paymentSchema = Joi.object({
  order_id: Joi.string().uuid({ version: 'uuidv4' }).required().messages({
    'string.base': '「order_id」必須是文字',
    'string.guid': '「order_id」必須是有效的 UUID 格式',
    'any.required': '「order_id」為必填欄位',
    'string.empty': '「order_id」為必填欄位',
  }),
}).unknown(true);

// [POST] 編號 37 : 藍新金流交易處理
function post_newebpayPayment(req, res, next) {
  const { error } = paymentSchema.validate(req.body ?? {});
  if (error) {
    return resStatus({ res, status: 400, message: error.details?.[0]?.message || '欄位驗證錯誤' });
  }
  next();
}

module.exports = {
  post_newebpayPayment,
};
