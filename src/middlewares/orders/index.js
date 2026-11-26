const resStatus = require('../../utils/resStatus.js');
const paging_Validator = require('../../utils/Validator/paging_Validator.js');
const orders_Validator = require('../../utils/Validator/orders_Validator.js');
const { userMessage } = require('../../utils/Validator/joiMessage.js');

// [GET] 我的訂單列表
async function getOrders(req, res, next) {
  const { error, value } = paging_Validator.pagingSchema.validate(req.query);
  if (error) {
    return resStatus({ res, status: 400, message: userMessage(error) });
  }
  req.query = value;
  next();
}

// [GET] 我的訂單明細
async function getOrder(req, res, next) {
  const { error } = orders_Validator.orderIDSchema.validate(req.params);
  if (error) {
    return resStatus({ res, status: 400, message: userMessage(error) });
  }
  next();
}

module.exports = { getOrders, getOrder };
