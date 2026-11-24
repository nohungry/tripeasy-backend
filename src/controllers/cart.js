const resStatus = require('../utils/resStatus');
const { pool } = require('../config/database');

// cart.total_price 每次寫入後以 user_cartList 重算寫回（新程式不讀它）
async function recalcCartTotal(client, cart_id) {
  await client.query(
    `UPDATE public."cart" SET total_price = COALESCE(
       (SELECT SUM("singleTotal_Price") FROM public."user_cartList" WHERE cart_id = $1), 0)
     WHERE cart_id = $1`,
    [cart_id]
  );
}

// [POST] 編號 28 : 使用者加入項目至購物車
async function post_cartItem(req, res, next) {
  const { id } = req.user;
  const { tour_id } = req.params;
  const { people, options } = req.body;
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    let cart_id;
    const user_cartRepo = await client.query(
      'SELECT cart_id FROM public."cart" WHERE user_id = $1 FOR UPDATE',
      [id]
    );
    if (user_cartRepo.rowCount === 0) {
      const created = await client.query(
        'INSERT INTO public."cart" (user_id,total_price) VALUES ($1,0) RETURNING cart_id',
        [id]
      );
      cart_id = created.rows[0].cart_id;
    } else {
      cart_id = user_cartRepo.rows[0].cart_id;
    }

    // 同會員、同行程、同開始日期、同房型（NULL 視為相同）：合併數量，否則新增
    const existing = await client.query(
      `SELECT cart_item_id FROM public."cart_item"
       WHERE cart_id = $1 AND tour_id = $2 AND start_date = $3::timestamp
         AND room_type IS NOT DISTINCT FROM $4::varchar
       FOR UPDATE`,
      [cart_id, tour_id, options.start_date, options.room_type ?? null]
    );

    let cartItemRepo;
    if (existing.rowCount > 0) {
      cartItemRepo = await client.query(
        'UPDATE public."cart_item" SET quantity = quantity + $2 WHERE cart_item_id = $1 RETURNING *',
        [existing.rows[0].cart_item_id, people]
      );
    } else {
      cartItemRepo = await client.query(
        'INSERT INTO public."cart_item" (cart_id,tour_id,quantity,start_date,end_date,room_type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [cart_id, tour_id, people, options.start_date, options.end_date, options.room_type]
      );
    }

    await recalcCartTotal(client, cart_id);

    await client.query('COMMIT');

    if (cartItemRepo.rowCount > 0) {
      return resStatus({
        res,
        status: 201,
        message: '加入購物車成功',
      });
    } else {
      return resStatus({
        res,
        status: 201,
        message: '加入購物車失敗',
      });
    }
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  } finally {
    client?.release();
  }
}

// [DELETE] 編號 29 : 使用者取消購物車項目
async function delete_cartItem(req, res, next) {
  const { cart_item_id } = req.params;
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const deleteRepo = await client.query(
      'DELETE FROM public."cart_item" WHERE cart_item_id = $1 RETURNING *',
      [cart_item_id]
    );

    if (deleteRepo.rowCount > 0) {
      await recalcCartTotal(client, deleteRepo.rows[0].cart_id);
    }

    await client.query('COMMIT');

    if (deleteRepo.rowCount > 0) {
      return resStatus({
        res,
        status: 200,
        message: '移除購物車項目成功',
      });
    } else {
      return resStatus({
        res,
        status: 200,
        message: '移除購物車項目失敗',
      });
    }
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  } finally {
    client?.release();
  }
}

// [PATCH] 編號 30 : 使用者編輯購物車內容
async function patch_cartItem(req, res, next) {
  const { cart_item_id } = req.params;
  const { people, options } = req.body;
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    await client.query(
      'SELECT cart_item_id FROM public."cart_item" WHERE cart_item_id = $1 FOR UPDATE',
      [cart_item_id]
    );
    const updateRepo = await client.query(
      'Update public."cart_item" set quantity = $2,start_date = $3,end_date = $4,room_type = $5 WHERE cart_item_id = $1 RETURNING *',
      [cart_item_id, people, options.start_date, options.end_date, options.room_type]
    );

    if (updateRepo.rowCount > 0) {
      await recalcCartTotal(client, updateRepo.rows[0].cart_id);
    }

    await client.query('COMMIT');

    if (updateRepo.rowCount > 0) {
      return resStatus({
        res,
        status: 200,
        message: '購物車項目修改成功',
      });
    } else {
      return resStatus({
        res,
        status: 200,
        message: '購物車項目修改失敗',
      });
    }
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  } finally {
    client?.release();
  }
}

// [GET] 編號 31 : 使用者查看購物車內容
async function get_cartItem(req, res, next) {
  const { id } = req.user;
  const { page, limit, lang } = req.query;

  try {
    const cartData = await pool.query(
      `select * from public."user_cartList"
            where user_id = $1
            ORDER BY cart_id ASC LIMIT $2 OFFSET $3;`,
      [id, limit, (page - 1) * limit]
    );

    const data = cartData.rows.map((item) => {
      return {
        cart_id: item.cart_id,
        cart_item_id: item.cart_item_id,
        tour_id: item.tour_id,
        type: item['大分類'],
        item: item['小分類'],
        title: item['旅遊名稱'],
        image_url: item['旅遊代表圖 Url'],
        price: item['價錢'],
        promo_price: item['促銷價錢'],
        options: {
          people: item.quantity,
          start_date: item.start_date,
          end_date: item.end_date,
          room_type: item.room_type || '',
        },
        total_price: Number(item.singleTotal_Price),
      };
    });

    // summary 為該會員全部項目（與分頁無關）
    const totals = await pool.query(
      `SELECT COUNT(*)::int AS total_items, COALESCE(SUM("singleTotal_Price"), 0) AS total_price
       FROM public."user_cartList" WHERE user_id = $1`,
      [id]
    );
    const summary = {
      total_items: totals.rows[0].total_items,
      total_price: Number(totals.rows[0].total_price),
    };

    if (cartData.rowCount > 0) {
      return resStatus({
        res,
        status: 200,
        message: '查詢成功',
        dbdata: {
          data,
          summary,
        },
      });
    } else {
      return resStatus({
        res,
        status: 200,
        message: '查無資料',
      });
    }
  } catch (error) {
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  }
}

module.exports = {
  post_cartItem,
  delete_cartItem,
  patch_cartItem,
  get_cartItem,
};
