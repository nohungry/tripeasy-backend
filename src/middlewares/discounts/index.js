const resStatus = require('../../utils/resStatus.js');

const discounts_Validatior = require('../../utils/Validator/discounts_Validatior.js');
const { userMessage } = require('../../utils/Validator/joiMessage.js');

// [POST] 編號 32 : 使用者輸入優惠卷、累積積分
async function postDiscounts(req, res, next) {
  const { error: bodyError } = discounts_Validatior.baseschema.validate(req.body);
  const { error: orderError } = discounts_Validatior.orderIDSchema.validate(req.params);

  // [HTTP 400] 資料錯誤
  if (bodyError || orderError) {
    const message = userMessage(bodyError || orderError);
    resStatus({
      res: res,
      status: 400,
      message: message,
    });
    return;
  }

  next();
}

// [GET] 編號 33 : 使用者取消優惠卷、累積積分
async function getDiscounts(req, res, next) {
  const { error } = discounts_Validatior.orderIDSchema.validate(req.params);

  // [HTTP 400] 資料錯誤
  if (error) {
    const message = userMessage(error);
    resStatus({
      res: res,
      status: 400,
      message: message,
    });
    return;
  }

  next();
}

module.exports = {
  postDiscounts,
  getDiscounts,
};
