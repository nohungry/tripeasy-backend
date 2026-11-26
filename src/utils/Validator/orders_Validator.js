const Joi = require('joi');

const orderIDSchema = Joi.object({
  order_id: Joi.string().uuid({ version: 'uuidv4' }).required().messages({
    'string.guid': '「訂單編號」必須是有效的 UUID 格式',
    'string.base': '「訂單編號」必須是文字',
    'string.empty': '「訂單編號」不可為空',
    'any.required': '「訂單編號」為必填欄位',
  }),
});

module.exports = { orderIDSchema };
