const resStatus = require('../utils/resStatus');
const { verifyLoginToken } = require('../utils/authToken');

const FailedMessageMap = {
  expired: 'Token 已過期',
  invalid: '無效的 token',
  missing: '請先登入',
};

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  // 沒帶 token 或格式錯誤
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return resStatus({
      res,
      status: 401,
      message: FailedMessageMap.missing,
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    req.user = await verifyLoginToken(token);
  } catch (err) {
    // 非 token 錯誤（例如 DB 異常）交給錯誤處理，不當成 401
    if (!err.reason) return next(err);
    // 分辨過期與其他無效
    return resStatus({
      res,
      status: 401,
      message: FailedMessageMap[err.reason] || FailedMessageMap.invalid,
    });
  }
  next();
}

module.exports = verifyToken;
