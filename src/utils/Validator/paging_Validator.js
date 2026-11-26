const { commonSchema } = require('./cart_Validator');

// 分頁：page 預設 1、limit 預設 4（上限 50）、lang 預設 zh-TW；訊息沿用 cart 的 commonSchema
const pagingSchema = commonSchema.fork('limit', (schema) =>
  schema.max(50).messages({ 'number.max': '「每頁筆數」不可超過 50' })
);

module.exports = { pagingSchema };
