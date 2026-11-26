const resStatus = require('../utils/resStatus');
const { pool } = require('../config/database');
const {
  computePayable,
  orderTimeoutMinutes,
  orderDeadlineSql,
  paymentInProgressSql,
  tradeLimitSeconds,
} = require('../utils/trade');
const { orderStatusLabel, paymentResultLabel } = require('../utils/orderStatus');

// 會員端讀取：不開交易、不加鎖、不寫入、不呼叫 expireIfOverdue。
// 期限與付款進行中用 utils/trade.js 的同一段 SQL；can_continue_payment／is_overdue 在 SQL 以 now() 比對（F1）。
// 參數：$1 = 期限分鐘、$2 = 藍新交易時限秒
function orderColumns(alias) {
  const deadline = orderDeadlineSql(`${alias}.created_at`, '$1');
  const inProgress = `(${alias}.payment_status IN (-1, 0) AND ${paymentInProgressSql(`${alias}.order_id`, '$2')})`;
  return `${alias}.order_id, ${alias}.created_at, ${alias}.payment_status,
    ${deadline} AS deadline,
    ${inProgress} AS payment_in_progress,
    (${alias}.payment_status IN (-1, 0) AND NOT ${inProgress} AND now() < ${deadline}) AS can_continue_payment,
    (${alias}.payment_status IN (-1, 0) AND NOT ${inProgress} AND now() >= ${deadline}) AS is_overdue`;
}

function baseFields(row) {
  return {
    order_id: row.order_id,
    created_at: row.created_at,
    payment_status: row.payment_status,
    status_label: orderStatusLabel(row.payment_status, row.payment_in_progress),
    payment_in_progress: row.payment_in_progress,
    can_continue_payment: row.can_continue_payment,
    is_overdue: row.is_overdue,
    deadline: row.deadline,
  };
}

// [GET] 我的訂單列表
async function get_orders(req, res, next) {
  try {
    const { id } = req.user;
    const { page, limit } = req.query;
    const params = [orderTimeoutMinutes(), tradeLimitSeconds()];

    const list = await pool.query(
      `SELECT ${orderColumns('o')},
         (SELECT COUNT(*)::int FROM public."order_item" oi WHERE oi.order_id = o.order_id) AS item_count,
         first.title, first.cover_image
       FROM public."orders" o
       LEFT JOIN LATERAL (
         SELECT t.title, t.cover_image
         FROM public."order_item" oi JOIN public."tour" t ON t.tour_id = oi.tour_id
         WHERE oi.order_id = o.order_id
         ORDER BY oi.created_at, oi.order_item_id LIMIT 1
       ) first ON TRUE
       WHERE o.user_id = $3
       ORDER BY o.created_at DESC, o.order_id
       LIMIT $4 OFFSET $5`,
      [...params, id, limit, (page - 1) * limit]
    );
    const count = await pool.query('SELECT COUNT(*)::int AS total FROM public."orders" WHERE user_id = $1', [id]);

    const data = [];
    for (const row of list.rows) {
      const money = await computePayable(pool, row.order_id);
      data.push({
        ...baseFields(row),
        ...money,
        item_count: row.item_count,
        first_item: row.title === null ? null : { title: row.title, cover_image: row.cover_image },
      });
    }

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

// [GET] 我的訂單明細
async function get_order(req, res, next) {
  try {
    const { id } = req.user;
    const { order_id } = req.params;
    const params = [orderTimeoutMinutes(), tradeLimitSeconds()];

    // 擁有者條件寫在 SQL；查無（含他人的訂單）一律 404
    const orderRepo = await pool.query(
      `SELECT ${orderColumns('o')}, o.address, o.phone, o.payment_type
       FROM public."orders" o WHERE o.order_id = $3 AND o.user_id = $4`,
      [...params, order_id, id]
    );
    if (orderRepo.rowCount === 0) {
      return resStatus({ res, status: 404, message: '查無此訂單項目' });
    }
    const row = orderRepo.rows[0];

    const items = await pool.query(
      `SELECT oi.order_item_id, oi.tour_id, t.title, t.cover_image, oi.quantity, oi.start_date,
              oi.end_date, oi.room_type, oi.total_price, oi.discount_price
       FROM public."order_item" oi JOIN public."tour" t ON t.tour_id = oi.tour_id
       WHERE oi.order_id = $1
       ORDER BY oi.created_at, oi.order_item_id`,
      [order_id]
    );
    const payments = await pool.query(
      `SELECT p.created_at, p.result_time, p.payment_status,
              (p.result_time IS NULL AND p.created_at + make_interval(secs => $2) > now()) AS in_window
       FROM public."payment" p WHERE p.order_id = $1 ORDER BY p.created_at DESC`,
      [order_id, tradeLimitSeconds()]
    );
    const money = await computePayable(pool, order_id);

    resStatus({
      res,
      status: 200,
      message: '查詢成功',
      dbdata: {
        ...baseFields(row),
        shipping: { address: row.address, phone: row.phone, payment_type: row.payment_type },
        money,
        items: items.rows,
        payments: payments.rows.map((p) => ({
          created_at: p.created_at,
          result_time: p.result_time,
          result: paymentResultLabel(p),
        })),
      },
    });
  } catch (error) {
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  }
}

module.exports = { get_orders, get_order };
