const Joi = require('joi');
const { strictDate, strictLocalDateTime, todayInTaipei } = require('../dateRules');

// ✅ 可集中管理所有支援語言
const supportedLanguages = ['zh-TW', 'en-US'];

// 出發日期（日期部分）不得早於今天（Asia/Taipei）
function notPast(value, helpers) {
  if (value.slice(0, 10) < todayInTaipei()) {
    return helpers.error('date.past');
  }
  return value;
}

// 結束日期不得早於出發日期
function notBeforeStart(value, helpers) {
  const start = helpers.state.ancestors[0]?.start_date;
  if (typeof start === 'string' && value < start.slice(0, 10)) {
    return helpers.error('date.beforeStart');
  }
  return value;
}

const startDate = () =>
  strictDate('出發日期')
    .custom(notPast)
    .messages({ 'date.past': '出發日期不能早於今天' });

const endDate = () =>
  strictDate('結束日期')
    .custom(notBeforeStart)
    .messages({ 'date.beforeStart': '結束日期不能早於出發日期' });

const hotelSchema = Joi.object({
  start_date: startDate(),
  end_date: endDate(),
  room_type: Joi.string().required().messages({
    'any.required': '請選擇「房型」',
    'string.base': '「房型」必須是文字',
  }),
});

const foodSchema = Joi.object({
  start_date: strictLocalDateTime('預約時間')
    .custom(notPast)
    .messages({ 'date.past': '出發日期不能早於今天' }),
});

const travelSchema = Joi.object({
  start_date: startDate(),
  end_date: endDate(),
});

const baseSchema = Joi.object({
  type: Joi.string().valid('backpacker', 'tourgroup').required(),
  item: Joi.string().valid('hotel', 'food', 'spot', 'travel').required(),
  people: Joi.number().integer().min(1).required().messages({
    'any.required': '請填寫「人數」',
    'number.base': '「人數」必須是數字',
    'number.min': '「人數」至少為 1 人',
  }),
  options: Joi.when('item', {
    switch: [
      { is: 'hotel', then: hotelSchema },
      { is: 'food', then: foodSchema },
      { is: 'spot', then: travelSchema },
      { is: 'travel', then: travelSchema },
    ],
    otherwise: Joi.forbidden().messages({ 'any.unknown': '未知的 options 組合' }),
  })
    .not(null)
    .required()
    .messages({
      'any.invalid': '「options」不可為 null',
      'any.required': '請提供 options 設定',
    }),
})
  .custom((value, helpers) => {
    const { type, item } = value;

    const allowedCombos = {
      backpacker: ['hotel', 'food', 'spot'],
      tourgroup: ['travel'],
    };

    if (!allowedCombos[type]?.includes(item)) {
      return helpers.error('any.invalidCombo');
    }

    return value;
  }, 'Type-Item Combo Validation')
  .messages({
    'any.invalidCombo': '「type」與「item」的組合不合法',
  });

const paramsSchema = Joi.object({
  tour_id: Joi.string().uuid({ version: 'uuidv4' }).required().messages({
    'string.base': '「tour_id」必須是文字',
    'string.guid': '「tour_id」必須是有效的 UUID 格式',
    'any.required': '「tour_id」為必填欄位',
  }),
});

const cartIDSchema = Joi.object({
  cart_item_id: Joi.string().uuid({ version: 'uuidv4' }).required().messages({
    'string.base': '「cart_item_id」必須是文字',
    'string.guid': '「cart_item_id」必須是有效的 UUID 格式',
    'any.required': '「cart_item_id」為必填欄位',
  }),
});

const commonSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1).messages({
    'number.base': '「page」必須是數字',
    'number.integer': '「page」必須是整數',
    'number.min': '「page」至少是 1',
    'any.required': '「page」為必填欄位',
  }),

  limit: Joi.number().integer().min(1).default(4).messages({
    'number.base': '「limit」必須是數字',
    'number.integer': '「limit」必須是整數',
    'number.min': '「limit」至少是 1',
    'any.required': '「limit」為必填欄位',
  }),

  lang: Joi.string()
    .valid(...supportedLanguages)
    .default('zh-TW')
    .messages({
      'any.only': `「lang」僅支援：${supportedLanguages.join(', ')}`,
      'string.base': '「lang」必須是文字',
      'any.required': '「lang」為必填欄位',
    }),
});

module.exports = {
  baseSchema,
  paramsSchema,
  cartIDSchema,
  commonSchema,
};
