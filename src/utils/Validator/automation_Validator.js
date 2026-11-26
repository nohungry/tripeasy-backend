const Joi = require('joi');

const early_schema = Joi.object({
  notifi_settings_enabled: Joi.boolean().required().messages({
    'any.required': '「旅遊提醒」為必填欄位',
    'boolean.base': '「旅遊提醒」必須是 true 或 false',
  }),
});

// 開啟價格追蹤時，國家／地區／預算上限都必填；關閉時可省略（寫入時一律清成 NULL）。
function textField(label) {
  return Joi.string()
    .when('price_tracking_enabled', {
      is: true,
      then: Joi.required().messages({
        'any.required': `開啟價格追蹤時「${label}」為必填欄位`,
        'string.empty': `開啟價格追蹤時「${label}」為必填欄位`,
      }),
      otherwise: Joi.optional(),
    })
    .messages({
      'string.base': `「${label}」必須是文字`,
      'string.empty': `「${label}」不可為空`,
    });
}

// 「必須是整數」不在這裡擋：已存的舊值（例如 seed 的 1200.5）原樣重存要放行，
// 需要比對 DB 目前的值，由 controller 負責（F2）。
const PRICE_MSG = '「預算上限」必須是 0 以上的整數';

const price_schema = Joi.object({
  price_tracking_enabled: Joi.boolean().required().messages({
    'any.required': '「價格追蹤」為必填欄位',
    'boolean.base': '「價格追蹤」必須是 true 或 false',
  }),

  country: textField('國家'),
  region: textField('地區'),

  max_price: Joi.number()
    .min(0)
    .when('price_tracking_enabled', {
      is: true,
      then: Joi.required().messages({
        'any.required': '開啟價格追蹤時「預算上限」為必填欄位',
      }),
      otherwise: Joi.optional(),
    })
    .messages({
      'number.base': PRICE_MSG,
      'number.min': PRICE_MSG,
      'number.unsafe': PRICE_MSG,
      'number.infinity': PRICE_MSG,
    }),
});

module.exports = {
  early_schema,
  price_schema,
};
