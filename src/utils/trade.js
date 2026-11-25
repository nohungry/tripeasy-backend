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
    'SELECT payment_status, discount_type FROM public."orders" WHERE order_id = $1',
    [orderId]
  );
  const orderStatus = order.rows[0]?.payment_status;
  const paid = orderStatus === ORDER_STATUS.PAID;

  // 已退款：券與保留已釋放，應付金額取成功付款（payment_status = 1）當時實付的金額
  if (orderStatus === ORDER_STATUS.REFUNDED) {
    const charged = await client.query(
      `SELECT discount_price::float8 AS amount FROM public."payment"
       WHERE order_id = $1 AND payment_status = 1 AND discount_price IS NOT NULL LIMIT 1`,
      [orderId]
    );
    if (charged.rowCount > 0) {
      const totalPrice = Math.round(sums.rows[0].total_price);
      const promoSubtotal = Math.round(sums.rows[0].promo_subtotal);
      const payable = Math.round(charged.rows[0].amount);
      return {
        total_price: totalPrice,
        promo_subtotal: promoSubtotal,
        discount_amount: promoSubtotal - payable,
        payable,
        discount_type: order.rows[0].discount_type ?? 'none',
      };
    }
  }
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

// 藍新交易時限（秒）：TradeInfo 的 TradeLimit 與「付款進行中」判斷共用同一個值
// 與閘道一致夾限：1–59 視為 60、大於 900 視為 900
function tradeLimitSeconds() {
  return Math.min(Math.max(envNumber('NEWEBPAY_TRADE_LIMIT_SECONDS', 600), 60), 900);
}

// 訂單自己的期限（created_at + ORDER_PAYMENT_TIMEOUT_MINUTES）是否已過；不改任何狀態
async function pastOrderDeadline(client, orderId) {
  const minutes = envNumber('ORDER_PAYMENT_TIMEOUT_MINUTES', 60);
  const result = await client.query(
    `SELECT created_at + make_interval(mins => $2) < now() AS overdue
     FROM public."orders" WHERE order_id = $1`,
    [orderId, minutes]
  );
  return Boolean(result.rows[0]?.overdue);
}

// 付款進行中：payment_status = 0、尚未收到結果、且仍在藍新交易時限內
async function paymentInProgress(client, orderId) {
  const limit = tradeLimitSeconds();
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
  if (!(await pastOrderDeadline(client, order.order_id))) return false;
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

// notify 成功時的結算（同一個交易內）。呼叫前訂單已鎖且狀態為 0。
// payable 要在任何轉換之前算（computePayable 會依訂單狀態讀保留或已使用的紀錄）。
async function settlePaidOrder(client, orderId) {
  const { payable } = await computePayable(client, orderId);
  const owner = await client.query('SELECT user_id FROM public."orders" WHERE order_id = $1', [orderId]);
  const userId = owner.rows[0].user_id;

  await setOrderStatus(client, orderId, ORDER_STATUS.PAID);

  await client.query(
    `UPDATE public."user_coupon" SET status = 1, updated_at = now() WHERE order_id = $1 AND status = -1`,
    [orderId]
  );

  const used = await client.query(
    `UPDATE public."point_record" SET type = '減少', updated_at = now()
     WHERE order_id = $1 AND type = '減少_確認中' RETURNING point`,
    [orderId]
  );
  const usedPoints = used.rows.reduce((sum, row) => sum + Math.abs(row.point), 0);

  const reward = Math.floor(payable * 0.1);
  if (reward > 0) {
    await client.query(
      `INSERT INTO public."point_record" (user_id, order_id, type, point) VALUES ($1, $2, '新增', $3)`,
      [userId, orderId, reward]
    );
  }
  await client.query(
    `UPDATE public."user_level" SET travel_point = travel_point + $2, updated_at = now()
     WHERE level_id = (SELECT level_id FROM public."user_level" WHERE user_id = $1 ORDER BY created_at LIMIT 1)`,
    [userId, reward - usedPoints]
  );

  // 清掉購物車中已買的項目（同行程、同出發日、同房型），其餘保留，再重算總額
  // 先鎖 cart 列，與加入購物車（cart → cart_item）同一個順序，避免死結
  await client.query('SELECT cart_id FROM public."cart" WHERE user_id = $1 ORDER BY cart_id FOR UPDATE', [userId]);
  await client.query(
    `DELETE FROM public."cart_item" ci
     USING public."cart" c, public."order_item" oi
     WHERE ci.cart_id = c.cart_id AND c.user_id = $1 AND oi.order_id = $2
       AND ci.tour_id = oi.tour_id
       AND ci.start_date IS NOT DISTINCT FROM oi.start_date
       AND ci.room_type IS NOT DISTINCT FROM oi.room_type`,
    [userId, orderId]
  );
  await client.query(
    `UPDATE public."cart" SET total_price = COALESCE(
       (SELECT SUM("singleTotal_Price") FROM public."user_cartList" WHERE cart_id = public."cart".cart_id), 0)
     WHERE user_id = $1`,
    [userId]
  );

  return { payable, reward };
}

// 管理員退款（R2：手動標記，不呼叫藍新）。呼叫端 BEGIN／COMMIT。
// 鎖順序（GC14）：orders → orders／order_item → user_coupon／point_record → user_level
async function refundOrder(client, orderId) {
  const order = await lockOrder(client, orderId);
  if (!order) throw new TradeError(404, '查無此訂單項目');
  if (order.payment_status !== ORDER_STATUS.PAID) {
    throw new TradeError(409, '只有已付款的訂單可以退款');
  }

  await setOrderStatus(client, orderId, ORDER_STATUS.REFUNDED);

  await client.query(
    `UPDATE public."user_coupon" SET status = 0, order_id = NULL, updated_at = now() WHERE order_id = $1`,
    [orderId]
  );

  const sums = await client.query(
    `SELECT COALESCE(SUM(-point) FILTER (WHERE type = '減少'), 0)::int AS used,
            COALESCE(SUM(point) FILTER (WHERE type = '新增'), 0)::int AS reward
     FROM public."point_record" WHERE order_id = $1`,
    [orderId]
  );
  const { used, reward } = sums.rows[0];

  if (used > 0) {
    await client.query(
      `INSERT INTO public."point_record" (user_id, order_id, type, point) VALUES ($1, $2, '退款退回', $3)`,
      [order.user_id, orderId, used]
    );
  }
  if (reward > 0) {
    await client.query(
      `INSERT INTO public."point_record" (user_id, order_id, type, point) VALUES ($1, $2, '退款收回', $3)`,
      [order.user_id, orderId, -reward]
    );
  }
  // 與 settlePaidOrder 同一列（最早建立的 user_level）；餘額允許為負（Q2）
  await client.query(
    `UPDATE public."user_level" SET travel_point = travel_point + $2, updated_at = now()
     WHERE level_id = (SELECT level_id FROM public."user_level" WHERE user_id = $1 ORDER BY created_at LIMIT 1)`,
    [order.user_id, used - reward]
  );

  return { returned_point: used, clawed_back: reward };
}

module.exports = {
  refundOrder,
  ORDER_STATUS,
  tradeLimitSeconds,
  pastOrderDeadline,
  settlePaidOrder,
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
