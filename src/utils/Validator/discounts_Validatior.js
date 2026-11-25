const Joi = require('joi');

const baseschema = Joi.object({
  type: Joi.string().valid('coupon', 'point').required().messages({
    'any.required': '請填寫「優惠方式」',
    'string.base': '「優惠方式」必須是文字',
    'any.only': '「優惠方式」只能是優惠券或旅遊積分',
    'string.empty': '「優惠方式」只能是優惠券或旅遊積分',
  }),
  discount: Joi.object({
    coupon: Joi.string()
      .pattern(/^[A-Z0-9]{6}$/)
      .messages({
        'string.base': '「優惠券代碼」必須是文字',
        'string.empty': '「優惠券代碼」不可為空',
        'string.pattern.base': '「優惠券代碼」必須是 6 碼大寫英數組合',
      }),
    point: Joi.number().integer().min(0).messages({
      'number.base': '「旅遊積分」必須是數字',
      'number.integer': '「旅遊積分」必須是整數',
      'number.min': '「旅遊積分」最小值為 0',
    }),
  })
    .xor('coupon', 'point')
    .required()
    .messages({
      'object.xor': '「優惠券代碼」與「旅遊積分」只能擇一填寫',
      'object.missing': '「優惠券代碼」與「旅遊積分」必須擇一填寫',
      'any.required': '「優惠內容」為必填欄位',
      'object.base': '「優惠內容」必須是物件',
      'object.unknown': '「優惠內容」含有不支援的欄位',
    }),
}).messages({
  'object.base': '請求內容必須是物件',
  'object.unknown': '請求內容含有不支援的欄位',
});

const orderIDSchema = Joi.object({
  order_id: Joi.string().uuid({ version: 'uuidv4' }).required().messages({
    'string.base': '「訂單編號」必須是文字',
    'string.guid': '「訂單編號」必須是有效的 UUID 格式',
    'any.required': '「訂單編號」為必填欄位',
  }),
});

module.exports = {
  baseschema,
  orderIDSchema,
};
