const resStatus = require('../utils/resStatus');
const { pool } = require('../config/database');
const {
  TradeError,
  lockOrder,
  computePayable,
  expireIfOverdue,
  cancelPendingOrders,
} = require('../utils/trade');

// [POST] 編號 89 : 使用者進入填寫畫面後產生訂單（整車建單，每個購物車項目一列 order_item）
async function post_user_Order(req, res, next) {
  const { id } = req.user;
  const { cart_id } = req.params;

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // 以使用者列序列化同一會員的併發建單，避免兩個分頁各自留下一張未付款訂單
    await client.query('SELECT 1 FROM public."user" WHERE user_id = $1 FOR UPDATE', [id]);

    const cartRepo = await client.query(
      'SELECT cart_id FROM public."cart" WHERE cart_id = $1 AND user_id = $2',
      [cart_id, id]
    );
    if (cartRepo.rowCount === 0) throw new TradeError(404, '查無此購物車項目');

    const lines = await client.query(
      `SELECT ci.tour_id, ci.quantity, ci.start_date, ci.end_date, ci.room_type,
              (tb."價錢" * ci.quantity)::float8 AS total_price,
              (tb."促銷價錢" * ci.quantity)::float8 AS discount_price
       FROM public."cart_item" ci
       JOIN public."tour_base" tb ON tb."旅遊編號" = ci.tour_id
       WHERE ci.cart_id = $1
       ORDER BY ci.cart_item_id`,
      [cart_id]
    );
    if (lines.rowCount === 0) throw new TradeError(400, '購物車沒有項目');

    await cancelPendingOrders(client, id);

    const totalPrice = lines.rows.reduce((sum, row) => sum + row.total_price, 0);
    const orderRepo = await client.query(
      `INSERT INTO public."orders" (user_id, payment_status, total_price)
       VALUES ($1, -1, $2) RETURNING order_id, total_price`,
      [id, totalPrice]
    );
    const orderId = orderRepo.rows[0].order_id;

    for (const row of lines.rows) {
      await client.query(
        `INSERT INTO public."order_item"
           (order_id, tour_id, payment_status, total_price, discount_price, quantity, start_date, end_date, room_type)
         VALUES ($1, $2, -1, $3, $4, $5, $6, $7, $8)`,
        [
          orderId,
          row.tour_id,
          row.total_price,
          row.discount_price,
          row.quantity,
          row.start_date,
          row.end_date,
          row.room_type,
        ]
      );
    }

    await client.query('COMMIT');

    resStatus({
      res,
      status: 200,
      message: '訂單產生成功',
      dbdata: {
        order_id: orderId,
        cart_id: cartRepo.rows[0].cart_id,
        total_price: orderRepo.rows[0].total_price,
      },
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

// [GET] 編號 34 : 使用者進入填寫畫面後預帶使用者資訊
async function get_user_CheckoutUserInfo(req, res, next) {
  const { id } = req.user;
  const { order_id } = req.params;

  try {
    const orderRepo = await pool.query(
      'SELECT order_id FROM public."orders" WHERE order_id = $1 AND user_id = $2',
      [order_id, id]
    );
    if (orderRepo.rowCount === 0) {
      return resStatus({ res, status: 404, message: '查無此訂單項目' });
    }

    const result = await pool.query(`select * from public."user" where user_id = $1`, [id]);

    // [HTTP 200] 查詢成功
    if (result.rowCount > 0) {
      resStatus({
        res,
        status: 200,
        message: '查詢成功',
        dbdata: {
          user_id: id,
          name: result.rows[0].name,
          email: result.rows[0].email,
        },
      });
    } else {
      resStatus({
        res,
        status: 200,
        message: '查無此資料',
      });
    }
  } catch (error) {
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  }
}

// [PATCH] 編號 35 : 使用者輸入個人資料、選擇想要付款方式
async function patch_user_CheckoutUserInfo(req, res, next) {
  const { id } = req.user;
  const { address, phone_number } = req.body.user;
  const { payment_method, installment } = req.body;
  const { type, coupon_id, used_point } = req.body.discount;
  const { order_id } = req.params;

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const orderRepo = await client.query(
      `UPDATE public."orders" SET address = $1, phone = $2,payment_type = $3,discount_type = $4,payment_status = $5 WHERE order_id = $6 and user_id = $7 RETURNING *`,
      [address, phone_number, payment_method, type, 0, order_id, id]
    );

    await client.query(
      `UPDATE public."order_item" SET payment_status = $1 WHERE order_id = $2 RETURNING *`,
      [0, order_id]
    );

    if (type === 'coupon') {
      const couponRepo = await client.query(
        `SELECT * FROM public."user_couponList" where coupon_id = $1 and user_id = $2`,
        [coupon_id, id]
      );

      await client.query(
        `UPDATE public."user_coupon" SET status = $1, order_id = $4 WHERE coupon_id = $2 and user_id = $3 RETURNING *`,
        [-1, coupon_id, id, order_id]
      );

      await client.query(
        `UPDATE public."orders" SET discount_price = $1 WHERE order_id = $2 and user_id = $3 RETURNING *`,
        [orderRepo.rows[0].total_price * couponRepo.rows[0].discount, order_id, id]
      );
    } else if (type === 'point') {
      await client.query(
        `Insert into public."point_record" (user_id,order_id,type,point) Values ($1,$2,$3,$4) RETURNING *`,
        [id, order_id, '減少_確認中', 0 - used_point]
      );

      await client.query(
        `UPDATE public."orders" SET discount_price = $1 WHERE order_id = $2 and user_id = $3 RETURNING *`,
        [orderRepo.rows[0].total_price - used_point * 0.8, order_id, id]
      );
    }

    const orderAllRepo = await client.query(
      `select * from public."orders" WHERE order_id = $1 and user_id = $2`,
      [order_id, id]
    );

    const orderItemRepo = await client.query(
      `select * from public."order_item" WHERE order_id = $1`,
      [order_id]
    );

    await client.query('COMMIT');

    resStatus({
      res,
      status: 200,
      message: '資料更新成功',
      dbdata: {
        order_id: orderAllRepo.rows[0].order_id,
        total_price: orderAllRepo.rows[0].total_price,
        discount_price: orderAllRepo.rows[0].discount_price,
      },
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  } finally {
    client?.release();
  }
}

// [GET] 編號 36 : 使用者確認購買項目、總金額
async function get_user_CheckoutOrder(req, res, next) {
  const { id } = req.user;
  const { order_id } = req.params;

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // GC14：先鎖訂單再判斷逾時
    const locked = await lockOrder(client, order_id, id);
    if (!locked) throw new TradeError(404, '查無此訂單項目');
    const expired = await expireIfOverdue(client, locked);
    const paymentStatus = expired ? 4 : locked.payment_status;

    // 金額一律來自 computePayable（單一來源），orders.discount_price 只原樣回傳
    const money = await computePayable(client, order_id);

    const userRepo = await client.query(`select * from public."user" where user_id = $1`, [id]);
    const orderItemRepo = await client.query(
      `select * from public."user_orderList" where order_id = $1`,
      [order_id]
    );
    const couponRepo = await client.query(
      `select * from public."user_couponList" where user_id = $1 and order_id = $2 and status = -1`,
      [id, order_id]
    );
    const pointRepo = await client.query(
      `select * from public."point_record" where user_id = $1 and order_id = $2 and type = '減少_確認中'`,
      [id, order_id]
    );

    await client.query('COMMIT');

    resStatus({
      res,
      status: 200,
      message: '查詢成功',
      dbdata: {
        user: {
          name: userRepo.rows[0].name,
          email: userRepo.rows[0].email,
          address: locked.address,
          phone_number: locked.phone,
        },
        payment_method: locked.payment_type,
        discount: {
          type: locked.discount_type,
          coupon_id: couponRepo.rowCount > 0 ? couponRepo.rows[0].coupon_id : null,
          coupon: couponRepo.rowCount > 0 ? couponRepo.rows[0].code : null,
          used_point: pointRepo.rowCount > 0 ? Math.abs(pointRepo.rows[0].point) : 0,
        },
        orders: orderItemRepo.rows.map((item) => ({
          order_id: item.order_id,
          tour_id: item.tour_id,
          type: item.大分類,
          item: item.小分類,
          title: item.旅遊名稱,
          cover_image: item['旅遊代表圖 Url'],
          price: item.價錢,
          discount_price: item.促銷價錢,
          options: {
            people: item.quantity,
            start_date: item.start_date,
            end_date: item.end_date,
            room_type: item.room_type,
          },
          total_price: item.singleTotal_Price,
        })),
        summary: {
          total_items: orderItemRepo.rowCount,
          total_price: money.total_price,
          promo_subtotal: money.promo_subtotal,
          discount_amount: money.discount_amount,
          payable: money.payable,
          discount_price: locked.discount_price,
          get_point: Math.floor(money.payable / 10),
          payment_status: paymentStatus,
        },
      },
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
  post_user_Order,
  get_user_CheckoutUserInfo,
  patch_user_CheckoutUserInfo,
  get_user_CheckoutOrder,
};
