// P4 交易共用邏輯。所有函式的第一個參數是已 BEGIN 的 client，呼叫端負責 COMMIT／ROLLBACK。

const ORDER_STATUS = { CREATED: -1, PENDING: 0, PAID: 1, CANCELLED: 2, REFUNDED: 3, EXPIRED: 4 };

const POINT_VALUE = 0.8; // 1 點 = 0.8 元

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

class TradeError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'TradeError';
    this.status = status;
  }
}

// 鎖定訂單（FOR UPDATE）；userId 非 null 時限定擁有者；查無回 null
async function lockOrder(client, orderId, userId = null) {
  const result =
    userId === null
      ? await client.query('SELECT * FROM public."orders" WHERE order_id = $1 FOR UPDATE', [orderId])
      : await client.query(
          'SELECT * FROM public."orders" WHERE order_id = $1 AND user_id = $2 FOR UPDATE',
          [orderId, userId]
        );
  return result.rows[0] ?? null;
}

// 應付金額的唯一來源：summary、preview、付款、notify 都用它
async function computePayable(client, orderId) {
  const sums = await client.query(
    `SELECT COALESCE(SUM(total_price), 0)::float8 AS total_price,
            COALESCE(SUM(COALESCE(NULLIF(discount_price, 0), total_price)), 0)::float8 AS promo_subtotal
     FROM public."order_item" WHERE order_id = $1`,
    [orderId]
  );
  const order = await client.query(
    'SELECT payment_status FROM public."orders" WHERE order_id = $1',
    [orderId]
  );
  const paid = order.rows[0]?.payment_status === ORDER_STATUS.PAID;
  const couponStatus = paid ? 1 : -1;
  const pointType = paid ? '減少' : '減少_確認中';

  const coupon = await client.query(
    `SELECT COALESCE(SUM(c.discount), 0)::float8 AS discount, COUNT(*)::int AS n
     FROM public."user_coupon" uc JOIN public."coupon" c ON c.coupon_id = uc.coupon_id
     WHERE uc.order_id = $1 AND uc.status = $2`,
    [orderId, couponStatus]
  );
  const point = await client.query(
    `SELECT COALESCE(SUM(-point), 0)::float8 AS used, COUNT(*)::int AS n
     FROM public."point_record" WHERE order_id = $1 AND type = $2`,
    [orderId, pointType]
  );

  let discountType = 'none';
  let discountAmount = 0;
  if (coupon.rows[0].n > 0) {
    discountType = 'coupon';
    discountAmount = coupon.rows[0].discount;
  } else if (point.rows[0].n > 0) {
    discountType = 'point';
    discountAmount = point.rows[0].used * POINT_VALUE;
  }

  const totalPrice = Math.round(sums.rows[0].total_price);
  const promoSubtotal = Math.round(sums.rows[0].promo_subtotal);
  const discount = Math.round(discountAmount);
  return {
    total_price: totalPrice,
    promo_subtotal: promoSubtotal,
    discount_amount: discount,
    payable: promoSubtotal - discount,
    discount_type: discountType,
  };
}

// 釋放訂單保留的點數與優惠券
async function releaseReservations(client, orderId) {
  await client.query(
    `DELETE FROM public."point_record" WHERE order_id = $1 AND type = '減少_確認中'`,
    [orderId]
  );
  await client.query(
    `UPDATE public."user_coupon" SET status = 0, order_id = NULL, updated_at = now()
     WHERE order_id = $1 AND status = -1`,
    [orderId]
  );
}

async function setOrderStatus(client, orderId, status) {
  await client.query(
    'UPDATE public."orders" SET payment_status = $2, updated_at = now() WHERE order_id = $1',
    [orderId, status]
  );
  await client.query(
    'UPDATE public."order_item" SET payment_status = $2, updated_at = now() WHERE order_id = $1',
    [orderId, status]
  );
}

// 付款進行中：payment_status = 0、尚未收到結果、且仍在藍新交易時限內
async function paymentInProgress(client, orderId) {
  const limit = envNumber('NEWEBPAY_TRADE_LIMIT_SECONDS', 600);
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM public."payment"
       WHERE order_id = $1 AND payment_status = 0 AND result_time IS NULL
         AND created_at + make_interval(secs => $2) > now()
     ) AS in_progress`,
    [orderId, limit]
  );
  return result.rows[0].in_progress;
}

// 呼叫端必須已在交易內以 lockOrder 鎖住該訂單再傳入
async function expireIfOverdue(client, order) {
  if (order.payment_status !== ORDER_STATUS.CREATED && order.payment_status !== ORDER_STATUS.PENDING) {
    return false;
  }
  const minutes = envNumber('ORDER_PAYMENT_TIMEOUT_MINUTES', 60);
  const overdue = await client.query(
    `SELECT created_at + make_interval(mins => $2) < now() AS overdue
     FROM public."orders" WHERE order_id = $1`,
    [order.order_id, minutes]
  );
  if (!overdue.rows[0]?.overdue) return false;
  if (await paymentInProgress(client, order.order_id)) return false;

  await setOrderStatus(client, order.order_id, ORDER_STATUS.EXPIRED);
  await releaseReservations(client, order.order_id);
  return true;
}

// 取消該會員所有未付款（-1／0）訂單並釋放保留，回筆數
async function cancelPendingOrders(client, userId, exceptOrderId = null) {
  const pending = await client.query(
    `SELECT order_id FROM public."orders"
     WHERE user_id = $1 AND payment_status IN (-1, 0)
       AND ($2::uuid IS NULL OR order_id <> $2::uuid)
     ORDER BY created_at FOR UPDATE`,
    [userId, exceptOrderId]
  );
  for (const row of pending.rows) {
    await setOrderStatus(client, row.order_id, ORDER_STATUS.CANCELLED);
    await releaseReservations(client, row.order_id);
  }
  return pending.rowCount;
}

module.exports = {
  ORDER_STATUS,
  TradeError,
  lockOrder,
  computePayable,
  releaseReservations,
  setOrderStatus,
  paymentInProgress,
  expireIfOverdue,
  cancelPendingOrders,
};
