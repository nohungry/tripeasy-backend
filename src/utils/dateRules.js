const Joi = require('joi');

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

function isRealDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// 只接受 YYYY-MM-DD 且為真實日期
function strictDate(label) {
  const message = `「${label}」必須是 YYYY-MM-DD 的合法日期`;
  return Joi.string()
    .required()
    .custom((value, helpers) => {
      const m = DATE_RE.exec(value);
      if (!m || !isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
        return helpers.error('any.invalid');
      }
      return value;
    })
    .messages({
      'any.required': `請填寫「${label}」`,
      'any.invalid': message,
      'string.base': message,
      'string.empty': message,
    });
}

// 只接受 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm（不得帶時區或秒）
function strictLocalDateTime(label) {
  const message = `「${label}」必須是 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm 的合法時間`;
  return Joi.string()
    .required()
    .custom((value, helpers) => {
      const m = LOCAL_DATETIME_RE.exec(value);
      if (!m || !isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
        return helpers.error('any.invalid');
      }
      if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59)) {
        return helpers.error('any.invalid');
      }
      return value;
    })
    .messages({
      'any.required': `請填寫「${label}」`,
      'any.invalid': message,
      'string.base': message,
      'string.empty': message,
    });
}

// 以 Asia/Taipei 取今天（YYYY-MM-DD）
function todayInTaipei() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

module.exports = { strictDate, strictLocalDateTime, todayInTaipei };
