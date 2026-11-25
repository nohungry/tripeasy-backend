// 把 Joi 驗證錯誤轉成可以顯示給使用者的訊息。
//
// 本專案的自訂訊息（.messages()、helpers.message()）一律是中文，不含 ASCII 雙引號。
// Joi 內建的預設訊息一律以 {{#label}} 開頭，而 Joi 17 預設把 label 包在 ASCII 雙引號裡
// （例如 `"people" must be a safe number`），所以含有 ASCII `"` 就是沒被自訂的預設訊息，
// 會洩漏原始參數名，一律改用固定的通用訊息。
// 這個規則不依賴錯誤代碼清單，新增任何 Joi 規則都不會再漏。
const FALLBACK = '輸入的資料格式不正確';

function userMessage(joiError) {
  const message = joiError?.details?.[0]?.message;
  if (typeof message !== 'string' || message === '' || message.includes('"')) {
    return FALLBACK;
  }
  return message;
}

module.exports = { userMessage, FALLBACK };
