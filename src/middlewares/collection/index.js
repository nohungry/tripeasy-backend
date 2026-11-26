const resStatus = require('../../utils/resStatus');
const isValidator = require('../../utils/Validator/collection_Validator.js');
const { userMessage } = require('../../utils/Validator/joiMessage.js');

// [GET] 編號 17 : 使用者查看收藏項目
async function getCollection(req, res, next) {
  const { error, value } = isValidator.listSchema.validate(req.query, { stripUnknown: true });
  if (error) {
    return resStatus({ res, status: 400, message: userMessage(error) });
  }
  req.query = value;
  next();
}

// [POST] 編號 18 : 使用者加入收藏項目（行程是否存在、是否上架由 controller 判斷）
async function postCollection(req, res, next) {
  const { error } = isValidator.tourIDSchema.validate(req.params, { stripUnknown: true });
  if (error) {
    return resStatus({ res, status: 400, message: userMessage(error) });
  }
  next();
}

// [DELETE] 編號 19 : 使用者刪除收藏項目（擁有者條件寫在 controller 的 SQL）
async function deleteCollection(req, res, next) {
  const { error } = isValidator.favoriteIDSchema.validate(req.params, { stripUnknown: true });
  if (error) {
    return resStatus({ res, status: 400, message: userMessage(error) });
  }
  next();
}

module.exports = {
  getCollection,
  postCollection,
  deleteCollection,
};
