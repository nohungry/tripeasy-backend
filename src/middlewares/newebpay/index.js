const Joi = require('joi');
const resStatus = require('../../utils/resStatus.js');
const { userMessage } = require('../../utils/Validator/joiMessage.js');

// body 只認 order_id，其他鍵忽略（金額等一律由後端計算）
const paymentSchema = Joi.object({
  order_id: Joi.string().uuid({ version: 'uuidv4' }).required().messages({
    'string.base': '「訂單編號」必須是文字',
    'string.guid': '「訂單編號」必須是有效的 UUID 格式',
    'any.required': '「訂單編號」為必填欄位',
    'string.empty': '「訂單編號」為必填欄位',
  }),
}).unknown(true);

// [POST] 編號 37 : 藍新金流交易處理
function post_newebpayPayment(req, res, next) {
  const { error } = paymentSchema.validate(req.body ?? {});
  if (error) {
    return resStatus({ res, status: 400, message: userMessage(error) });
  }
  next();
}

module.exports = {
  paymentSchema,
  post_newebpayPayment,
};
