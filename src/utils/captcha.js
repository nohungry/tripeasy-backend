const crypto = require('crypto');

const TTL_MS = 5 * 60 * 1000;

// cookie 值格式：'<expiresMs>.<hex64>'
// 簽章 = HMAC-SHA256(key = CAPTCHA_SECRET, msg = `${answer.toLowerCase()}.${expiresMs}`)
function sign(answer, expiresMs) {
  return crypto
    .createHmac('sha256', process.env.CAPTCHA_SECRET)
    .update(`${String(answer).toLowerCase()}.${expiresMs}`)
    .digest('hex');
}

function signCaptcha(answer, now = Date.now()) {
  const expiresMs = now + TTL_MS;
  return `${expiresMs}.${sign(answer, expiresMs)}`;
}

// 回傳 'ok' | 'expired' | 'mismatch'；缺 cookie 視為 expired，格式不符或簽章不符視為 mismatch。
function verifyCaptcha(cookieValue, input, now = Date.now()) {
  if (!cookieValue) return 'expired';
  const match = /^(\d+)\.([0-9a-f]{64})$/.exec(String(cookieValue));
  if (!match || typeof input !== 'string') return 'mismatch';

  const expected = Buffer.from(sign(input, match[1]));
  const actual = Buffer.from(match[2]);
  if (!crypto.timingSafeEqual(expected, actual)) return 'mismatch';

  return Number(match[1]) < now ? 'expired' : 'ok';
}

function cookieOptions() {
  return {
    httpOnly: true,
    maxAge: TTL_MS,
    sameSite: process.env.COOKIE_SAMESITE || 'Lax',
    secure: process.env.COOKIE_SECURE === 'true',
  };
}

module.exports = { signCaptcha, verifyCaptcha, cookieOptions };
