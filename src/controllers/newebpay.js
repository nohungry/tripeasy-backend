const { pool } = require('../config/database');
const resStatus = require('../utils/resStatus');
const {
  ORDER_STATUS,
  TradeError,
  lockOrder,
  computePayable,
  expireIfOverdue,
  settlePaidOrder,
  tradeLimitSeconds,
} = require('../utils/trade');
const {
  encryptTradeInfo,
  decryptTradeInfo,
  tradeSha,
  verifyTradeSha,
  escapeHtml,
  newMerchantOrderNo,
} = require('../utils/newebpay');

const ITEM_DESC_MAX = 50;

// [POST] 編號 37 : 藍新金流交易處理（金額由後端算，全部參數放進加密的 TradeInfo）
async function post_newebpay_payment(req, res, next) {
  const { id } = req.user;
  const { order_id } = req.body;

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const locked = await lockOrder(client, order_id, id);
    if (!locked) throw new TradeError(404, '查無此訂單項目');
    if (await expireIfOverdue(client, locked)) {
      // 逾時轉 4 與釋放保留是狀態修正，必須 COMMIT 才不會被回滾
      await client.query('COMMIT');
      return resStatus({ res, status: 409, message: '訂單已逾時' });
    }
    if (locked.payment_status !== ORDER_STATUS.PENDING) {
      throw new TradeError(409, '訂單狀態不允許此操作');
    }

    const { payable: amt } = await computePayable(client, order_id);
    const titles = await client.query(
      `SELECT t.title FROM public."order_item" oi JOIN public."tour" t ON t.tour_id = oi.tour_id
       WHERE oi.order_id = $1 ORDER BY oi.created_at, oi.order_item_id`,
      [order_id]
    );
    const itemDesc = Array.from(titles.rows.map((row) => row.title).join('、'))
      .slice(0, ITEM_DESC_MAX)
      .join('');
    const owner = await client.query('SELECT email FROM public."user" WHERE user_id = $1', [id]);

    const merchantOrderNo = newMerchantOrderNo();
    await client.query(
      `INSERT INTO public."payment"
         (user_id, order_id, address, phone, payment_method, payment_status, discount_price, merchant_order_no)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7)`,
      [id, order_id, locked.address, locked.phone, locked.payment_type, amt, merchantOrderNo]
    );
    await client.query('COMMIT');

    const { MerchantID, Version, RespondType, PayGateWay, NotifyUrl, ReturnUrl } = process.env;
    const tradeInfo = encryptTradeInfo({
      MerchantID,
      RespondType,
      TimeStamp: Math.floor(Date.now() / 1000),
      Version,
      MerchantOrderNo: merchantOrderNo,
      Amt: amt,
      ItemDesc: itemDesc,
      Email: owner.rows[0].email,
      ReturnURL: ReturnUrl,
      NotifyURL: NotifyUrl,
      TradeLimit: tradeLimitSeconds(),
      CREDIT: 1,
    });

    const hidden = (name, value) =>
      `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`;
    res.status(200).type('html').send(`<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8"><title>Redirecting...</title></head>
  <body>
    <form id="payForm" method="post" action="${escapeHtml(PayGateWay)}">
      ${hidden('MerchantID', MerchantID)}
      ${hidden('TradeInfo', tradeInfo)}
      ${hidden('TradeSha', tradeSha(tradeInfo))}
      ${hidden('Version', Version)}
    </form>
    <script>document.getElementById('payForm').submit();</script>
  </body>
</html>`);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error instanceof TradeError) {
      return resStatus({ res, status: error.status, message: error.message });
    }
    console.error('❌ 建立付款表單時錯誤:', error);
    next(error);
  } finally {
    client?.release();
  }
}

// [POST] 編號 38 : notify（P4 spec §5.5 步驟 1–7）
async function post_newebpay_notify(req, res, next) {
  const { TradeInfo, TradeSha } = req.body ?? {};

  // 1. 先驗簽再解密
  if (!verifyTradeSha(TradeInfo, TradeSha)) return res.status(400).send('Bad Request');
  let data;
  try {
    data = decryptTradeInfo(TradeInfo);
  } catch (error) {
    return res.status(400).send('Bad Request');
  }
  const result = data?.Result;
  const merchantOrderNo = result?.MerchantOrderNo;
  if (typeof merchantOrderNo !== 'string' || merchantOrderNo === '') {
    return res.status(400).send('Bad Request');
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // 2. 用 MerchantOrderNo 找 payment 與訂單
    const found = await client.query(
      'SELECT order_id FROM public."payment" WHERE merchant_order_no = $1',
      [merchantOrderNo]
    );
    if (found.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).send('Bad Request');
    }
    const orderId = found.rows[0].order_id;

    // 3. 鎖訂單後才讀 payment 狀態；已處理過就直接回 200（冪等）
    const order = await lockOrder(client, orderId);
    const payment = (
      await client.query(
        'SELECT payment_id, payment_status FROM public."payment" WHERE merchant_order_no = $1 FOR UPDATE',
        [merchantOrderNo]
      )
    ).rows[0];
    if (payment.payment_status === 1) {
      await client.query('COMMIT');
      return res.status(200).send('OK');
    }

    // 4. 金額核對（應付金額只來自 computePayable）；記錄後要 COMMIT 才不會被回滾
    const { payable } = await computePayable(client, orderId);
    if (Number(result.Amt) !== payable) {
      await client.query(
        'UPDATE public."payment" SET result_info = $2, updated_at = now() WHERE payment_id = $1',
        [payment.payment_id, `金額不符：notify=${result.Amt} payable=${payable}`]
      );
      await client.query('COMMIT');
      return res.status(400).send('Amount Mismatch');
    }

    const message = data.Message || data.Status || '';
    if (data.Status !== 'SUCCESS') {
      // 6. 失敗通知：只記錄，訂單維持原狀
      await client.query(
        'UPDATE public."payment" SET result_info = $2, result_time = now(), updated_at = now() WHERE payment_id = $1',
        [payment.payment_id, message]
      );
    } else if (order.payment_status === ORDER_STATUS.PENDING) {
      // 5. 成功且訂單為 0：payment → 1 並結算（同一個交易內）
      await client.query(
        `UPDATE public."payment"
         SET payment_status = 1, return_data = $2, return_time = now(),
             result_info = $3, result_time = now(), updated_at = now()
         WHERE payment_id = $1`,
        [payment.payment_id, JSON.stringify(data), message]
      );
      await settlePaidOrder(client, orderId);
    } else {
      // 7. 訂單已不是 0 卻收到成功通知：只記錄，payment_status 維持 0（人工退款，屬已知限制）
      await client.query(
        'UPDATE public."payment" SET result_info = $2, result_time = now(), updated_at = now() WHERE payment_id = $1',
        [payment.payment_id, `訂單狀態為 ${order.payment_status}，成功通知僅記錄未結算：${message}`]
      );
    }

    await client.query('COMMIT');
    res.status(200).send('OK');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('❌ notify 處理錯誤:', error);
    next(error);
  } finally {
    client?.release();
  }
}

// [POST] 編號 39 : return（不改資料，只導回前端結果頁）
async function post_newebpay_return(req, res, next) {
  const resultPage = `${process.env.FRONTEND_PATH}/#/pay/result`;
  const { TradeInfo, TradeSha } = req.body ?? {};

  try {
    if (!verifyTradeSha(TradeInfo, TradeSha)) return res.redirect(302, resultPage);
    let merchantOrderNo;
    try {
      merchantOrderNo = decryptTradeInfo(TradeInfo)?.Result?.MerchantOrderNo;
    } catch (error) {
      return res.redirect(302, resultPage);
    }
    if (typeof merchantOrderNo !== 'string' || merchantOrderNo === '') {
      return res.redirect(302, resultPage);
    }
    const found = await pool.query(
      'SELECT order_id FROM public."payment" WHERE merchant_order_no = $1',
      [merchantOrderNo]
    );
    if (found.rowCount === 0) return res.redirect(302, resultPage);
    return res.redirect(302, `${resultPage}?order=${found.rows[0].order_id}`);
  } catch (error) {
    console.error('❌ return 處理錯誤:', error);
    next(error);
  }
}

module.exports = {
  post_newebpay_payment,
  post_newebpay_notify,
  post_newebpay_return,
};
