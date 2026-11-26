const preferenceMap = require('../preferenceMap');
const Joi = require('joi');
const { nameSchema } = require('../nameRule');

// 建立數字 → 文字的對應 map
const reversePreferenceMap = Object.entries(preferenceMap).reduce((acc, [key, value]) => {
  acc[value] = key;
  return acc;
}, {});

// 自定義不允許空字串或空陣列
const updateProfile_schema = Joi.object({
  name: nameSchema().optional(),

  preference: Joi.array()
    .items(Joi.string())
    .optional()
    .custom((value, helpers) => {
      if (!Array.isArray(value) || value.length === 0) {
        return helpers.error('any.customEmptyPreference');
      }
      if (value.length !== 3) {
        return helpers.error('array.exactLength');
      }
      return value;
    })
    .messages({
      'any.customEmptyPreference': '「個人偏好」不得為空陣列',
      'array.exactLength': '「個人偏好」需包含 3 個項目',
    }),
})
  .or('name', 'preference')
  .messages({
    'object.missing': '請至少填寫「姓名」或「個人偏好」其中一項',
  });

module.exports = {
  reversePreferenceMap,
  updateProfile_schema,
};
