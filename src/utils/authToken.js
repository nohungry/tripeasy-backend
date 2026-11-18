const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

// 密碼指紋 pwv：HMAC-SHA256(key = JWT_SECRET, msg = password ?? '') 的 hex 前 16 字元。
// password 是 user.password 欄位原值（bcrypt 字串或 NULL，NULL 也有固定指紋）。
function passwordFingerprint(password) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(password ?? '')
    .digest('hex')
    .slice(0, 16);
}

function signLoginToken(user) {
  const payload = {
    id: user.user_id,
    role: user.role,
    typ: 'login',
    pwv: passwordFingerprint(user.password),
  };
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_DAY || '7d',
  });
}

function signResetToken(user) {
  const payload = { id: user.user_id, typ: 'reset', pwv: passwordFingerprint(user.password) };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
}

function tokenError(reason) {
  const error = new Error(`token ${reason}`);
  error.reason = reason;
  return error;
}

// 驗簽章、用途（typ）、會員仍存在、pwv 與目前密碼相符。失敗丟 Error，error.reason 為 'expired' | 'invalid'。
async function verifyToken(token, typ) {
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    throw tokenError(err.name === 'TokenExpiredError' ? 'expired' : 'invalid');
  }

  if (!decoded || decoded.typ !== typ || typeof decoded.pwv !== 'string') {
    throw tokenError('invalid');
  }

  const result = await pool.query('SELECT password, role FROM "user" WHERE user_id = $1', [decoded.id]);
  if (result.rows.length === 0) throw tokenError('invalid');

  const expected = Buffer.from(passwordFingerprint(result.rows[0].password));
  const actual = Buffer.from(decoded.pwv);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw tokenError('invalid');
  }

  // role 以 DB 為準，不信任 token 內的值（降級後舊 token 不再有舊權限）
  return { ...decoded, role: result.rows[0].role, password: result.rows[0].password };
}

async function verifyLoginToken(token) {
  const decoded = await verifyToken(token, 'login');
  return { id: decoded.id, role: decoded.role };
}

async function verifyResetToken(token) {
  const decoded = await verifyToken(token, 'reset');
  // password 為驗證當下讀到的值，供呼叫端做 compare-and-swap（讓同一個 reset token 只能用一次）
  return { id: decoded.id, password: decoded.password };
}

module.exports = {
  passwordFingerprint,
  signLoginToken,
  signResetToken,
  verifyLoginToken,
  verifyResetToken,
};
