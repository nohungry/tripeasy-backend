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
// discountAmount 有傳時（試算）取代保留紀錄算出的折抵，其餘邏輯共用
async function computePayable(client, orderId, { discountAmount: assumed } = {}) {
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
  const discount = Math.round(assumed ?? discountAmount);
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

// 試算折扣（不寫 DB）。type：'coupon' | 'point' | 'none'；couponId 或 couponCode 擇一。
// 優惠券 discount 是折抵金額（元）；點數 1 點 = POINT_VALUE 元。
async function evaluateDiscount(client, { userId, orderId, type, couponId, couponCode, usedPoint }) {
  const none = { discount_amount: 0, coupon: null, used_point: 0 };
  if (type !== 'coupon' && type !== 'point') return none;

  const { promo_subtotal: promoSubtotal } = await computePayable(client, orderId);
  let result;

  if (type === 'coupon') {
    const found = couponId
      ? await client.query(
          `SELECT ucl.*, (ucl.expire_date < now()) AS is_expired, (ucl.order_id = $3::uuid) AS same_order
           FROM public."user_couponList" ucl WHERE ucl.user_id = $1 AND ucl.coupon_id = $2`,
          [userId, couponId, orderId]
        )
      : await client.query(
          `SELECT ucl.*, (ucl.expire_date < now()) AS is_expired, (ucl.order_id = $3::uuid) AS same_order
           FROM public."user_couponList" ucl WHERE ucl.user_id = $1 AND ucl.code = $2
           ORDER BY ucl.status DESC, ucl.expire_date DESC LIMIT 1`,
          [userId, couponCode ?? null, orderId]
        );
    const coupon = found.rows[0];
    if (!coupon) throw new TradeError(404, '查無此優惠卷');
    if (coupon.status === 1) throw new TradeError(409, '優惠券已使用');
    if (coupon.is_expired) throw new TradeError(409, '優惠券已過期');
    if (coupon.status === -1 && !coupon.same_order) {
      throw new TradeError(409, '優惠券已被其他訂單保留');
    }
    result = { discount_amount: Math.round(coupon.discount), coupon, used_point: 0 };
  } else {
    const points = Number(usedPoint ?? 0);
    if (points % 5 !== 0) throw new TradeError(400, '旅遊積分必須是 5 的倍數');
    const balance = await client.query(
      `SELECT travel_point FROM public."user_level" WHERE user_id = $1 ORDER BY created_at LIMIT 1`,
      [userId]
    );
    const reserved = await client.query(
      `SELECT COALESCE(SUM(-pr.point), 0)::int AS reserved
       FROM public."point_record" pr JOIN public."orders" o ON o.order_id = pr.order_id
       WHERE pr.user_id = $1 AND pr.type = '減少_確認中'
         AND o.payment_status IN (-1, 0) AND pr.order_id <> $2`,
      [userId, orderId]
    );
    const available = Math.max(balance.rows[0]?.travel_point ?? 0, 0) - reserved.rows[0].reserved;
    if (points > available) throw new TradeError(409, '超出可使用的點數');
    result = { discount_amount: Math.round(points * POINT_VALUE), coupon: null, used_point: points };
  }

  if (result.discount_amount > 0 && promoSubtotal - result.discount_amount < 1) {
    throw new TradeError(400, '折抵後金額至少需 1 元');
  }
  return result;
}

// 以新折扣取代訂單目前的保留。呼叫端必須已 lockOrder。
// 先鎖 user_coupon／user_level 列再重新評估，擋住兩張訂單搶同一張券或同一筆點數。
async function reserveDiscount(client, orderId, userId, evaluated) {
  const type = evaluated.coupon ? 'coupon' : evaluated.used_point > 0 ? 'point' : 'none';
  let current = evaluated;

  if (type === 'coupon') {
    await client.query(
      'SELECT user_coupon_id FROM public."user_coupon" WHERE user_id = $1 AND coupon_id = $2 FOR UPDATE',
      [userId, evaluated.coupon.coupon_id]
    );
    current = await evaluateDiscount(client, {
      userId,
      orderId,
      type,
      couponId: evaluated.coupon.coupon_id,
    });
  } else if (type === 'point') {
    await client.query(
      'SELECT level_id FROM public."user_level" WHERE user_id = $1 ORDER BY level_id FOR UPDATE',
      [userId]
    );
    current = await evaluateDiscount(client, {
      userId,
      orderId,
      type,
      usedPoint: evaluated.used_point,
    });
  }

  await releaseReservations(client, orderId);

  if (type === 'coupon') {
    await client.query(
      `UPDATE public."user_coupon" SET status = -1, order_id = $1, updated_at = now()
       WHERE user_id = $2 AND coupon_id = $3`,
      [orderId, userId, current.coupon.coupon_id]
    );
  } else if (type === 'point') {
    await client.query(
      `INSERT INTO public."point_record" (user_id, order_id, type, point)
       VALUES ($1, $2, '減少_確認中', $3)`,
      [userId, orderId, -current.used_point]
    );
  }

  const money = await computePayable(client, orderId);
  await client.query(
    'UPDATE public."orders" SET discount_type = $2, discount_price = $3, updated_at = now() WHERE order_id = $1',
    [orderId, type, type === 'none' ? null : money.payable]
  );
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
  evaluateDiscount,
  reserveDiscount,
};
