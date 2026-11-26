const resStatus = require('../utils/resStatus');
const { pool } = require('../config/database');
const { reversePreferenceMap } = require('../utils/Validator/userprofile_Validator');
const { findListedTour } = require('../utils/purchase');

// 收藏列表不分頁，伺服器端上限 100 筆（F4／F5）
const LIST_LIMIT = 100;

const collectionController = {
  // [GET] 17 : 使用者查看收藏項目（唯讀：不開交易、不加鎖）
  async get_collection(req, res, next) {
    try {
      const user_id = req.user.id;

      const collectionRepo = await pool.query(
        `SELECT * FROM public."user_favorite" WHERE 收藏人員編號 = $1
         ORDER BY 建立時間 DESC, favorite_id LIMIT $2`,
        [user_id, LIST_LIMIT]
      );
      const countRepo = await pool.query(
        'SELECT COUNT(*)::int AS total FROM public."favorite" WHERE user_id = $1',
        [user_id]
      );
      const total = countRepo.rows[0].total;

      if (collectionRepo.rowCount === 0) {
        return resStatus({
          res: res,
          status: 200,
          message: '查無資料',
          dbdata: { data: [], total },
        });
      }

      const transformedRows = collectionRepo.rows.map((row) => {
        // 將偏好分類數字轉換為文字陣列
        const preferences = [
          reversePreferenceMap[row.偏好分類1],
          reversePreferenceMap[row.偏好分類2],
          reversePreferenceMap[row.偏好分類3],
        ];

        // 回傳新的物件，保留其他欄位，並加入「偏好分類」欄位，同時移除 1/2/3
        const { 偏好分類1, 偏好分類2, 偏好分類3, ...rest } = row;
        return { ...rest, 偏好分類: preferences };
      });

      resStatus({
        res: res,
        status: 200,
        message: '查詢成功',
        dbdata: { data: transformedRows, total },
      });
    } catch (error) {
      console.error('❌ 伺服器內部錯誤:', error);
      next(error);
    }
  },

  // [POST] 18 : 使用者加入收藏項目
  // 唯一約束 favorite_user_tour_key (user_id, tour_id)：INSERT ... ON CONFLICT DO NOTHING，
  // 同時到達的請求只有一個插入成功（201），其餘查出原本那筆（200）。
  async post_collection(req, res, next) {
    try {
      const { tour_id } = req.params;
      const user_id = req.user.id;

      const tour = await findListedTour(tour_id);
      if (!tour) {
        return resStatus({ res: res, status: 404, message: '查無此旅遊項目' });
      }

      // DO NOTHING 之後 SELECT 查不到（那筆剛好被同時刪掉）：回到 INSERT，最多 3 輪（首次加 2 次重試），3 輪都查不到就丟錯（500）
      for (let attempt = 0; attempt < 3; attempt++) {
        const inserted = await pool.query(
          `INSERT INTO public."favorite" (user_id, tour_id) VALUES ($1, $2)
           ON CONFLICT (user_id, tour_id) DO NOTHING RETURNING favorite_id`,
          [user_id, tour_id]
        );
        if (inserted.rowCount > 0) {
          return resStatus({
            res: res,
            status: 201,
            message: '收藏成功',
            dbdata: { favorite_id: inserted.rows[0].favorite_id },
          });
        }

        const existing = await pool.query(
          'SELECT favorite_id FROM public."favorite" WHERE user_id = $1 AND tour_id = $2',
          [user_id, tour_id]
        );
        if (existing.rowCount > 0) {
          return resStatus({
            res: res,
            status: 200,
            message: '已收藏過此行程',
            dbdata: { favorite_id: existing.rows[0].favorite_id },
          });
        }
      }
      throw new Error('收藏寫入反覆衝突後仍查無該筆');
    } catch (error) {
      console.error('❌ 伺服器內部錯誤:', error);
      next(error);
    }
  },

  // [DELETE] 19 : 使用者取消收藏項目（擁有者條件寫在 SQL）
  async delete_collection(req, res, next) {
    try {
      const { favorite_id } = req.params;
      const user_id = req.user.id;

      const deleted = await pool.query(
        'DELETE FROM public."favorite" WHERE favorite_id = $1 AND user_id = $2 RETURNING favorite_id',
        [favorite_id, user_id]
      );
      if (deleted.rowCount === 0) {
        return resStatus({ res: res, status: 404, message: '查無此收藏項目' });
      }
      resStatus({
        res: res,
        status: 200,
        message: '刪除成功',
      });
    } catch (error) {
      console.error('❌ 伺服器內部錯誤:', error);
      next(error);
    }
  },
};

module.exports = collectionController;
