const { pool } = require('../config/database');

// order_item.payment_status：1 = 已付款（P3 spec §4.2 R1）
const PAID_STATUS = 1;

// 「購買過」的唯一實作：本人的訂單中，有該行程且 order_item 已付款
async function hasPurchased(userId, tourId) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM public."orders" o
       JOIN public."order_item" oi ON oi.order_id = o.order_id
       WHERE o.user_id = $1 AND oi.tour_id = $2 AND oi.payment_status = $3
     ) AS purchased`,
    [userId, tourId, PAID_STATUS]
  );
  return result.rows[0].purchased;
}

async function hasReviewed(userId, tourId) {
  const result = await pool.query(
    'SELECT EXISTS (SELECT 1 FROM public."review" WHERE user_id = $1 AND tour_id = $2) AS reviewed',
    [userId, tourId]
  );
  return result.rows[0].reviewed;
}

// 上架中（status = 1）的行程；不存在或下架回 null
async function findListedTour(tourId) {
  const result = await pool.query(
    'SELECT tour_id, item FROM public."tour" WHERE tour_id = $1 AND status = 1',
    [tourId]
  );
  return result.rows[0] || null;
}

module.exports = { PAID_STATUS, hasPurchased, hasReviewed, findListedTour };
