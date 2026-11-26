const resStatus = require('../../utils/resStatus.js');
const paging_Validator = require('../../utils/Validator/paging_Validator.js');
const { userMessage } = require('../../utils/Validator/joiMessage.js');

// [GET] 我的點數紀錄
async function getRecords(req, res, next) {
  const { error, value } = paging_Validator.pagingSchema.validate(req.query);
  if (error) {
    return resStatus({ res, status: 400, message: userMessage(error) });
  }
  req.query = value;
  next();
}

module.exports = { getRecords };
