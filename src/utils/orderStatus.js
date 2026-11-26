// 會員端訂單狀態、付款紀錄結果的中文標籤（P5 共用約定）

const STATUS_LABELS = { 1: '已付款', 2: '已取消', 3: '已退款', 4: '已逾時' };

// -1、0 → 待付款；付款進行中（只有待付款訂單會有）→ 付款處理中
function orderStatusLabel(status, inProgress) {
  if (status === -1 || status === 0) return inProgress ? '付款處理中' : '待付款';
  return STATUS_LABELS[status] ?? '未知狀態';
}

// payment_status = 1 → 成功；result_time 不為 NULL → 失敗；仍在交易時限內 → 處理中；其他 → 未完成
function paymentResultLabel({ payment_status, result_time, in_window }) {
  if (payment_status === 1) return '成功';
  if (result_time !== null && result_time !== undefined) return '失敗';
  if (in_window) return '處理中';
  return '未完成';
}

module.exports = { orderStatusLabel, paymentResultLabel };
