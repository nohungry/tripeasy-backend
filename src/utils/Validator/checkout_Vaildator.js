const Joi = require('joi');
const { nameSchema } = require('./../nameRule');

const cartIDSchema = Joi.object({
  cart_id: Joi.string().uuid({ version: 'uuidv4' }).required().messages({
    'string.base': '「購物車編號」必須是文字',
    'string.empty': '「購物車編號」必須是有效的 UUID 格式',
    'string.guid': '「購物車編號」必須是有效的 UUID 格式',
    'any.required': '「購物車編號」為必填欄位',
  }),
});

const orderIDSchema = Joi.object({
  order_id: Joi.string().uuid({ version: 'uuidv4' }).required().messages({
    'string.base': '「訂單編號」必須是文字',
    'string.guid': '「訂單編號」必須是有效的 UUID 格式',
    'any.required': '「訂單編號」為必填欄位',
  }),
});

const postSchema = Joi.object({
  user: Joi.object({
    name: nameSchema().required(),

    email: Joi.string().email().required().messages({
      'string.email': 'Email 格式錯誤',
      'string.base': 'Email 必須是文字',
      'string.empty': 'Email 為必填欄位',
      'any.required': 'Email 為必填欄位',
    }),

    address: Joi.string().required().messages({
      'string.base': '地址需為文字',
      'string.empty': '地址為必填欄位',
      'any.required': '地址為必填欄位',
    }),

    phone_number: Joi.string()
      .pattern(/^[0-9]{8,12}$/)
      .required()
      .messages({
        'string.pattern.base': '電話僅允許 8~12 碼的數字',
        'string.base': '電話必須是文字',
        'string.empty': '電話為必填欄位',
        'any.required': '電話為必填欄位',
      }),
  }).required().messages({
    'object.base': '使用者資料必須是物件',
    'any.required': '使用者資料為必填欄位',
  }),

  payment_method: Joi.string().valid('credit_card', 'atm', 'cvs').required().messages({
    'any.only': '付款方式僅支援 credit_card、atm、cvs',
    'any.required': '付款方式為必填欄位',
  }),

  installment: Joi.alternatives().conditional('payment_method', {
    is: 'credit_card',
    then: Joi.number().valid(3, 6, 12).messages({
      'number.base': '分期付款必須是數字',
      'any.only': '分期付款僅支援 3、6、12 期',
    }),
    otherwise: Joi.forbidden().messages({
      'any.unknown': '只有在使用信用卡付款時才能選擇分期',
    }),
  }),

  discount: Joi.object({
    type: Joi.string().valid('coupon', 'point').optional().messages({
      'any.only': '優惠方式只能是 coupon 或 point',
    }),

    coupon_id: Joi.alternatives().conditional('type', {
      is: 'coupon',
      then: Joi.string().uuid({ version: 'uuidv4' }).required().messages({
        'any.required': '優惠券代碼為必填',
        'string.guid': '優惠券代碼格式需為 UUIDv4',
        'string.base': '優惠券代碼必須是文字',
      }),
      otherwise: Joi.string().allow('', null).optional().messages({
        'string.base': '優惠券代碼必須是文字',
      }),
    }),

    used_point: Joi.number().integer().min(0).optional().messages({
      'number.base': '旅遊積分必須是數字',
      'number.integer': '旅遊積分必須是整數',
      'number.unsafe': '旅遊積分數值超出範圍',
      'number.min': '旅遊積分不得小於 0',
    }),
  }).optional().messages({
    'object.base': '優惠內容必須是物件',
  }),

  agree_terms: Joi.boolean().optional().messages({
    'boolean.base': '是否願意接受通知格式錯誤',
  }),
});

module.exports = {
  cartIDSchema,
  orderIDSchema,
  postSchema,
};
