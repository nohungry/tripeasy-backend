// 藍新金流的加解密與簽章。全專案只有這個檔案可以呼叫 createDecipheriv（有測試檢查）。
const crypto = require('crypto');

function keys() {
  const { HASHKEY, HASHIV } = process.env;
  return { key: HASHKEY, iv: HASHIV };
}

// TradeInfo：參數轉 URLSearchParams 字串後 AES-256-CBC 加密，輸出 hex
function encryptTradeInfo(params) {
  const { key, iv } = keys();
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  return cipher.update(new URLSearchParams(params).toString(), 'utf8', 'hex') + cipher.final('hex');
}

// 解密藍新回傳的 TradeInfo（hex）並 JSON.parse；格式不對會丟錯
function decryptTradeInfo(hex) {
  const { key, iv } = keys();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const plain = decipher.update(hex, 'hex', 'utf8') + decipher.final('utf8');
  return JSON.parse(plain);
}

function tradeSha(hex) {
  const { key, iv } = keys();
  return crypto
    .createHash('sha256')
    .update(`HashKey=${key}&${hex}&HashIV=${iv}`)
    .digest('hex')
    .toUpperCase();
}

// 以固定時間比較簽章；型別不對一律視為不符
function verifyTradeSha(hex, sha) {
  if (typeof hex !== 'string' || typeof sha !== 'string') return false;
  const expected = Buffer.from(tradeSha(hex));
  const actual = Buffer.from(sha);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 'T' + YYMMDDHHmmss（UTC）+ 8 位大寫 hex，共 21 字元
function newMerchantOrderNo() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    pad(d.getUTCFullYear() % 100) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds());
  return `T${stamp}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

module.exports = {
  encryptTradeInfo,
  decryptTradeInfo,
  tradeSha,
  verifyTradeSha,
  escapeHtml,
  newMerchantOrderNo,
};
