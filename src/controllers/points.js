const resStatus = require('../utils/resStatus');
const { pool } = require('../config/database');

const POINT_REASON = {
  新增: '購物回饋',
  減少: '點數折抵',
  退款收回: '退款收回回饋',
  退款退回: '退款退還折抵',
};

// 會員端讀取：不開交易、不加鎖、不寫入。
// 「減少_確認中」與 point = 0（註冊時寫的 新增 0）在 SQL 排除（R3），前端不另外過濾。
const VISIBLE = `user_id = $1 AND type <> '減少_確認中' AND point <> 0`;

// [GET] 我的點數紀錄
async function get_records(req, res, next) {
  try {
    const { id } = req.user;
    const { page, limit } = req.query;

    const list = await pool.query(
      `SELECT created_at, point, type, order_id
       FROM public."point_record"
       WHERE ${VISIBLE}
       ORDER BY created_at DESC, point_id
       LIMIT $2 OFFSET $3`,
      [id, limit, (page - 1) * limit]
    );
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public."point_record" WHERE ${VISIBLE}`,
      [id]
    );

    const data = list.rows.map((row) => ({
      created_at: row.created_at,
      point: row.point,
      type: row.type,
      reason: Object.hasOwn(POINT_REASON, row.type) ? POINT_REASON[row.type] : row.type,
      order_id: row.order_id,
    }));

    resStatus({
      res,
      status: 200,
      message: '查詢成功',
      dbdata: { data, total: count.rows[0].total },
    });
  } catch (error) {
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  }
}

module.exports = { get_records };
