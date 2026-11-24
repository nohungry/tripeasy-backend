-- P4 spec §3：付款編號（藍新 MerchantOrderNo）與「每張訂單最多一筆成功付款」
ALTER TABLE payment ADD COLUMN merchant_order_no VARCHAR(30) NULL;
ALTER TABLE payment ADD CONSTRAINT payment_merchant_order_no_key UNIQUE (merchant_order_no);
CREATE UNIQUE INDEX payment_order_paid_key ON payment (order_id) WHERE payment_status = 1;
