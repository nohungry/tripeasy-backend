const Joi = require('joi');

// 姓名規則（P5 R4）：去頭尾空白後 2 到 20 個 Unicode 字元，不限字元種類，拒絕控制字元（\p{Cc}）。
const NAME_MIN = 2;
const NAME_MAX = 20;

// 檢查用（不加 g，避免 lastIndex 狀態）；移除用的 g 版本只給 replace 使用（F16）
const HAS_CONTROL_CHAR = /\p{Cc}/u;
const CONTROL_CHARS_G = /\p{Cc}/gu;

const MSG_BLANK = '「姓名」不得為空白';
const MSG_LENGTH = `「姓名」需為 ${NAME_MIN} 到 ${NAME_MAX} 個字`;
const MSG_CONTROL = '「姓名」不得包含控制字元';

function nameLength(s) {
  return [...s].length;
}

// 呼叫端自行 .required()／.optional()
function nameSchema() {
  return Joi.string()
    .trim()
    .custom((value, helpers) => {
      if (HAS_CONTROL_CHAR.test(value)) return helpers.message(MSG_CONTROL);
      const len = nameLength(value);
      if (len < NAME_MIN || len > NAME_MAX) return helpers.message(MSG_LENGTH);
      return value;
    })
    .messages({
      'string.empty': MSG_BLANK,
      'string.base': '「姓名」必須是文字',
      'any.required': '「姓名」為必填欄位',
    });
}

function clip(s) {
  return [...s].slice(0, NAME_MAX).join('').trim();
}

// Google 名字：先移除控制字元；去空白後 >= 2 字取前 20 字（截斷後再去空白）；
// 否則（含截斷後不足 2 字）改用 email 的 @ 前段（同樣移除控制字元、取前 20 字、去空白）；前段仍 < 2 字則「旅客」加前段
function googleDisplayName(name, email) {
  const cleaned = typeof name === 'string' ? name.replace(CONTROL_CHARS_G, '').trim() : '';
  if (nameLength(cleaned) >= NAME_MIN) {
    const clipped = clip(cleaned);
    if (nameLength(clipped) >= NAME_MIN) return clipped;
  }
  const local = clip(String(email).split('@')[0].replace(CONTROL_CHARS_G, ''));
  return nameLength(local) >= NAME_MIN ? local : `旅客${local}`;
}

module.exports = {
  NAME_MIN,
  NAME_MAX,
  nameLength,
  HAS_CONTROL_CHAR,
  CONTROL_CHARS_G,
  nameSchema,
  googleDisplayName,
};
