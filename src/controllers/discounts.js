const resStatus = require('../utils/resStatus');
const { pool } = require('../config/database');
const {
  ORDER_STATUS,
  TradeError,
  lockOrder,
  computePayable,
  releaseReservations,
  expireIfOverdue,
  evaluateDiscount,
} = require('../utils/trade');

function summaryOf(money, discountAmount) {
  const payable = money.promo_subtotal - discountAmount;
  return {
    total_price: money.total_price,
    promo_subtotal: money.promo_subtotal,
    discount_amount: discountAmount,
    payable,
    discount_price: payable,
  };
}

// [POST] 編號 32 : 使用者輸入優惠卷、累積積分（只試算，不寫入保留）
async function post_user_discounts(req, res, next) {
  const userId = req.user.id;
  const { order_id } = req.params;
  const { type, discount } = req.body;

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // GC14：先鎖訂單再判斷逾時
    const locked = await lockOrder(client, order_id, userId);
    if (!locked) throw new TradeError(404, '查無此訂單項目');
    if (await expireIfOverdue(client, locked)) {
      // 逾時轉 4 與釋放保留是狀態修正，必須 COMMIT 才不會被回滾
      await client.query('COMMIT');
      return resStatus({ res, status: 409, message: '訂單已逾時' });
    }
    if (locked.payment_status !== ORDER_STATUS.CREATED && locked.payment_status !== ORDER_STATUS.PENDING) {
      throw new TradeError(409, '訂單狀態不允許此操作');
    }

    const evaluated = await evaluateDiscount(client, {
      userId,
      orderId: order_id,
      type,
      couponCode: discount.coupon,
      usedPoint: discount.point,
    });
    const money = await computePayable(client, order_id);

    let discountInfo;
    if (type === 'coupon') {
      discountInfo = {
        coupon_id: evaluated.coupon.coupon_id,
        type: 'coupon',
        name: evaluated.coupon.code,
        discount: evaluated.coupon.discount,
        description: evaluated.coupon.description,
        date_period: evaluated.coupon.expired_date,
      };
    } else {
      const balance = await client.query(
        `SELECT travel_point FROM public."user_level" WHERE user_id = $1 ORDER BY created_at LIMIT 1`,
        [userId]
      );
      const userPoint = balance.rows[0]?.travel_point ?? 0;
      discountInfo = {
        type: 'point',
        user_point: userPoint,
        point: evaluated.used_point,
        remaining_point: userPoint - evaluated.used_point,
      };
    }

    await client.query('COMMIT');

    resStatus({
      res,
      status: 200,
      message: '優惠成功',
      dbdata: { discount: discountInfo, summary: summaryOf(money, evaluated.discount_amount) },
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error instanceof TradeError) {
      return resStatus({ res, status: error.status, message: error.message });
    }
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  } finally {
    client?.release();
  }
}

// [GET] 編號 33 : 使用者取消優惠卷、累積積分
async function get_user_discounts(req, res, next) {
  const userId = req.user.id;
  const { order_id } = req.params;

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const locked = await lockOrder(client, order_id, userId);
    if (!locked) throw new TradeError(404, '查無此訂單項目');

    await releaseReservations(client, order_id);
    await client.query(
      `UPDATE public."orders" SET discount_type = 'none', discount_price = NULL, updated_at = now()
       WHERE order_id = $1`,
      [order_id]
    );
    const money = await computePayable(client, order_id);

    await client.query('COMMIT');

    // [HTTP 200] 查詢成功
    resStatus({
      res,
      status: 200,
      message: '查詢成功',
      dbdata: { discount: null, summary: summaryOf(money, money.discount_amount) },
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error instanceof TradeError) {
      return resStatus({ res, status: error.status, message: error.message });
    }
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  } finally {
    client?.release();
  }
}

module.exports = {
  post_user_discounts,
  get_user_discounts,
};
