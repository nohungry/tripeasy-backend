-- P2 會員：Google 會員不再存共用預設密碼（spec §2.1）、email 不分大小寫唯一（spec §2.2）
ALTER TABLE "user" ALTER COLUMN password DROP NOT NULL;
CREATE UNIQUE INDEX user_email_lower_key ON "user" (lower(email));
