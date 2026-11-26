const Joi = require('joi');

const supportedLanguages = ['zh-TW', 'en-US'];

// GET /info/all：不分頁，只認 lang（其他鍵由 middleware 的 stripUnknown 忽略）
const listSchema = Joi.object({
  lang: Joi.string()
    .valid(...supportedLanguages)
    .default('zh-TW')
    .messages({
      'any.only': `「語言」僅支援：${supportedLanguages.join(', ')}`,
      'string.base': '「語言」必須是文字',
      'string.empty': '「語言」不可為空',
    }),
});

const uuidField = (label) =>
  Joi.string()
    .uuid({ version: 'uuidv4' })
    .required()
    .messages({
      'string.guid': `「${label}」必須是有效的 UUID 格式`,
      'string.base': `「${label}」必須是文字`,
      'string.empty': `「${label}」不可為空`,
      'any.required': `「${label}」為必填欄位`,
    });

// POST /info/:tour_id
const tourIDSchema = Joi.object({
  tour_id: uuidField('行程編號'),
});

// DELETE /info/:favorite_id
const favoriteIDSchema = Joi.object({
  favorite_id: uuidField('收藏編號'),
});

module.exports = {
  listSchema,
  tourIDSchema,
  favoriteIDSchema,
};
