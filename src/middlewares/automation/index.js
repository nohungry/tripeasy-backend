const resStatus = require('../../utils/resStatus');
const { userMessage } = require('../../utils/Validator/joiMessage.js');

const automation_Validator = require('../../utils/Validator/automation_Validator.js');

// [GET] 編號 14 : 使用者取得自動化設定狀態
// 無

// [PATCH] 編號 15 : 使用者勾選要有旅遊提醒
async function patchearlyNoti(req, res, next) {
  const { error, value } = automation_Validator.early_schema.validate(req.body);

  // [HTTP 400] 資料錯誤
  if (error) {
    resStatus({ res, status: 400, message: userMessage(error) });
    return;
  }

  req.body = value;
  next();
}

// [PATCH] 編號 16 : 使用者勾選預期價格通知提醒
async function patchpriceNoti(req, res, next) {
  const { error, value } = automation_Validator.price_schema.validate(req.body);

  // [HTTP 400] 資料錯誤
  if (error) {
    resStatus({ res, status: 400, message: userMessage(error) });
    return;
  }

  req.body = value;
  next();
}

module.exports = {
  patchearlyNoti,
  patchpriceNoti,
};
