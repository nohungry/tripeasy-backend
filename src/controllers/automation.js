const resStatus = require('../utils/resStatus');
const { pool } = require('../config/database');

// 「系統提供的選項」：上架行程（status = 1）的 (country, region)。
// regions 清單與 price-tracking 的驗證共用這段，兩邊不會各說各話（R2）。
// 注意：搜尋端（controllers/product.js）用 ILIKE '%x%' 部分比對，這裡是等值比對。
const LISTED_REGION_SQL =
  'FROM public."tour" WHERE status = 1 AND country IS NOT NULL AND region IS NOT NULL';

const REGION_ERROR = '「國家」與「地區」不是系統提供的選項';
const PRICE_ERROR = '「預算上限」必須是 0 以上的整數';

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// [GET] 編號 14 : 使用者取得自動化設定狀態
async function get_allnotifiSettings(req, res, next) {
  try {
    const user_id = req.user.id;
    const notiSettings = await pool.query(
      'SELECT early_notify, flexible_notify, country, region, price FROM public."auto_setting" where user_id = $1',
      [user_id]
    );

    const row = notiSettings.rows[0];
    // [HTTP 200] 沒有資料時回預設值；開關欄位（smallint）輸出布林
    resStatus({
      res: res,
      status: 200,
      message: '查詢成功',
      dbdata: {
        notifi_settings_enabled: row ? row.early_notify !== 0 : false,
        price_tracking: {
          price_tracking_enabled: row ? row.flexible_notify !== 0 : false,
          country: row ? row.country : null,
          region: row ? row.region : null,
          max_price: row ? row.price : null,
        },
      },
    });
  } catch (error) {
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  }
}

// [GET] 價格追蹤可選的國家與地區（上架行程的組合）：[{ country, regions }]
async function get_trackingRegions(req, res, next) {
  try {
    const result = await pool.query(`SELECT DISTINCT country, region ${LISTED_REGION_SQL}`);
    const grouped = new Map();
    for (const { country, region } of result.rows) {
      if (!grouped.has(country)) grouped.set(country, []);
      grouped.get(country).push(region);
    }
    const dbdata = [...grouped.keys()]
      .sort(byCode)
      .map((country) => ({ country, regions: grouped.get(country).sort(byCode) }));

    resStatus({ res, status: 200, message: '查詢成功', dbdata });
  } catch (error) {
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  }
}

// [PATCH] 編號 15 : 使用者勾選要有旅遊提醒
// 單一語句 upsert（user_id 有唯一約束），不開交易
async function patch_early_notifiSettings(req, res, next) {
  try {
    const user_id = req.user.id;
    const setting = req.body.notifi_settings_enabled;

    await pool.query(
      `INSERT INTO public."auto_setting" (user_id, early_notify) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET early_notify = EXCLUDED.early_notify, updated_at = now()`,
      [user_id, setting ? 1 : 0]
    );

    // [HTTP 200] 呈現資料
    resStatus({
      res: res,
      status: 200,
      message: '提醒設定已更新',
    });
  } catch (error) {
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  }
}

// [PATCH] 編號 16 : 使用者勾選預期價格通知提醒
async function patch_price_notifiSettings(req, res, next) {
  try {
    const user_id = req.user.id;
    const { price_tracking_enabled, country, region, max_price } = req.body;

    if (price_tracking_enabled) {
      // 與會員目前存的值完全相同就放行（R2a、F2）：地區下架、seed 的 1200.5 不能讓原樣重存被擋下
      const current = (
        await pool.query(
          'SELECT country, region, price FROM public."auto_setting" WHERE user_id = $1',
          [user_id]
        )
      ).rows[0];

      const sameRegion = current && current.country === country && current.region === region;
      if (!sameRegion) {
        const listed = await pool.query(
          `SELECT 1 ${LISTED_REGION_SQL} AND country = $1 AND region = $2 LIMIT 1`,
          [country, region]
        );
        if (listed.rowCount === 0) {
          return resStatus({ res, status: 400, message: REGION_ERROR });
        }
      }

      const samePrice = current && current.price !== null && Number(current.price) === max_price;
      if (!Number.isInteger(max_price) && !samePrice) {
        return resStatus({ res, status: 400, message: PRICE_ERROR });
      }
    }

    // 單一語句 upsert，不開交易；關閉時三欄寫 NULL
    await pool.query(
      `INSERT INTO public."auto_setting" (user_id, flexible_notify, country, region, price)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET flexible_notify = EXCLUDED.flexible_notify,
         country = EXCLUDED.country, region = EXCLUDED.region, price = EXCLUDED.price,
         updated_at = now()`,
      [
        user_id,
        price_tracking_enabled ? 1 : 0,
        price_tracking_enabled ? country : null,
        price_tracking_enabled ? region : null,
        price_tracking_enabled ? max_price : null,
      ]
    );

    // [HTTP 200] 呈現資料
    resStatus({
      res: res,
      status: 200,
      message: '彈性價格提醒狀態已更新',
    });
  } catch (error) {
    // [HTTP 500] 伺服器異常
    console.error('❌ 伺服器內部錯誤:', error);
    next(error);
  }
}

module.exports = {
  get_allnotifiSettings,
  get_trackingRegions,
  patch_early_notifiSettings,
  patch_price_notifiSettings,
};
