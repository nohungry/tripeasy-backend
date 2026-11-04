-- TripEasy 的 view／function（共 21 個）。內容依據 docs/db-contract.md；
-- 識別字、欄位名稱、型別與列的語意以契約為準（混合大小寫的識別字加雙引號，restaurant_isclosed 不加）。
--
-- repeatable migration（R__）：內容一改，下次 flyway migrate 就重新套用，所以開頭先
-- DROP ... IF EXISTS ... CASCADE 全部 21 個物件，再依相依順序 CREATE。
-- 本檔目前放 A 組（商品與首頁）9 個、B 組（購物車、訂位、折扣、結帳）8 個、C 組（會員與後台）4 個。

-- 先 DROP 全部 21 個物件。依賴者排前面；CASCADE 兼收其餘相依。
-- function 的 DROP 要帶參數型別（簽章要吻合）。
DROP VIEW IF EXISTS "user_level_review_forHome" CASCADE;
DROP VIEW IF EXISTS "user_user_level" CASCADE;
DROP VIEW IF EXISTS "user_adminList" CASCADE;
DROP VIEW IF EXISTS "user_order_item" CASCADE;
DROP VIEW IF EXISTS "user_orders" CASCADE;
DROP VIEW IF EXISTS "user_favorite" CASCADE;
DROP VIEW IF EXISTS "user_orderList" CASCADE;
DROP VIEW IF EXISTS "user_level_point_coupon" CASCADE;
DROP VIEW IF EXISTS "user_couponList" CASCADE;
DROP VIEW IF EXISTS "user_cartList" CASCADE;
DROP VIEW IF EXISTS restaurant_business_parsed CASCADE;
DROP FUNCTION IF EXISTS restaurant_isclosed(timestamp, uuid) CASCADE;
DROP FUNCTION IF EXISTS restaurant_booking(timestamp, uuid) CASCADE;
DROP FUNCTION IF EXISTS hotel_booking(varchar, timestamp, timestamp, uuid) CASCADE;
DROP FUNCTION IF EXISTS tour_restaurant(uuid) CASCADE;
DROP FUNCTION IF EXISTS tour_hotel(uuid) CASCADE;
DROP FUNCTION IF EXISTS tour_tour_detail(uuid) CASCADE;
DROP FUNCTION IF EXISTS tour_travel_most_favorited(text, text) CASCADE;
DROP FUNCTION IF EXISTS tour_travel_popular(text, text) CASCADE;
DROP FUNCTION IF EXISTS tour_travel(uuid) CASCADE;
DROP VIEW IF EXISTS tour_base CASCADE;

-- ========== A 組：商品與首頁 ==========

-- 契約：docs/db-contract.md `tour_base`
-- 每個行程一列（含下架，#7）。促銷與異動各取 updated_at 最新一筆（#8），通知狀態促銷優先（#8）；
-- 通知狀態不判斷促銷期間（#9），促銷價錢只在 now() 落在促銷期間內才有值（#10）。
CREATE VIEW tour_base AS
SELECT
    t.tour_id AS "旅遊編號",
    t.status AS "上下架狀態",
    COALESCE(p.type, c.type) AS "通知狀態",
    t.title AS "旅遊名稱",
    t.slogan AS "旅遊標語",
    t.description AS "旅遊描述",
    t.type AS "大分類",
    t.item AS "小分類",
    t.country AS "所屬國家",
    t.region AS "所屬地區",
    t.created_at AS "建立時間",
    t.updated_at AS "更新時間",
    t.price AS "價錢",
    CASE WHEN now() BETWEEN p.start_date AND p.end_date THEN p.promo_price END AS "促銷價錢",
    p.start_date AS "促銷開始日期",
    p.end_date AS "促銷結束日期",
    t.tour_start_date AS "旅遊開始日期",
    t.tour_end_date AS "旅遊結束日期",
    t.days AS "旅遊天數",
    t.cover_image AS "旅遊代表圖 Url",
    t.preference1 AS "偏好分類1",
    t.preference2 AS "偏好分類2",
    t.preference3 AS "偏好分類3",
    c.change_desc AS "異動通知內容"
FROM tour t
LEFT JOIN LATERAL (
    SELECT n.* FROM notification n
    WHERE n.tour_id = t.tour_id AND n.type = '促銷'
    ORDER BY n.updated_at DESC, n.notification_id LIMIT 1
) p ON true
LEFT JOIN LATERAL (
    SELECT n.* FROM notification n
    WHERE n.tour_id = t.tour_id AND n.type = '異動'
    ORDER BY n.updated_at DESC, n.notification_id LIMIT 1
) c ON true;

-- 契約：docs/db-contract.md `tour_travel`
-- tour_base 的欄位 ＋ 收藏狀態；只回 status = 1（#7）；傳 NULL 時收藏狀態為 false（#28）。
CREATE FUNCTION tour_travel(使用者編號 uuid)
RETURNS TABLE(
    "旅遊編號" uuid,
    "上下架狀態" smallint,
    "通知狀態" varchar,
    "旅遊名稱" varchar,
    "旅遊標語" varchar,
    "旅遊描述" text,
    "大分類" varchar,
    "小分類" varchar,
    "所屬國家" varchar,
    "所屬地區" varchar,
    "建立時間" timestamptz,
    "更新時間" timestamptz,
    "價錢" integer,
    "促銷價錢" double precision,
    "促銷開始日期" timestamp,
    "促銷結束日期" timestamp,
    "旅遊開始日期" timestamp,
    "旅遊結束日期" timestamp,
    "旅遊天數" integer,
    "旅遊代表圖 Url" text,
    "偏好分類1" smallint,
    "偏好分類2" smallint,
    "偏好分類3" smallint,
    "異動通知內容" text,
    "收藏狀態" boolean
)
LANGUAGE sql STABLE AS $$
SELECT
    tb."旅遊編號", tb."上下架狀態", tb."通知狀態", tb."旅遊名稱", tb."旅遊標語", tb."旅遊描述",
    tb."大分類", tb."小分類", tb."所屬國家", tb."所屬地區", tb."建立時間", tb."更新時間",
    tb."價錢", tb."促銷價錢", tb."促銷開始日期", tb."促銷結束日期", tb."旅遊開始日期",
    tb."旅遊結束日期", tb."旅遊天數", tb."旅遊代表圖 Url", tb."偏好分類1", tb."偏好分類2",
    tb."偏好分類3", tb."異動通知內容",
    EXISTS (SELECT 1 FROM favorite f WHERE f.user_id = tour_travel.使用者編號 AND f.tour_id = tb."旅遊編號") AS "收藏狀態"
FROM tour_base tb
WHERE tb."上下架狀態" = 1
$$;

-- 契約：docs/db-contract.md `tour_travel_popular`
-- 只算 payment_status = 1 的 order_item 列數（#4，列數而非 quantity 加總）；只回 status = 1（#7）；沒有的行程也出現、計數 0（#23）；
-- ROW_NUMBER() 並以 tour_id 升冪當次要排序（#24），型別 integer（#25）。
CREATE FUNCTION tour_travel_popular(大分類 text, 小分類 text)
RETURNS TABLE(tour_id uuid, "購買排行" integer)
LANGUAGE sql STABLE AS $$
SELECT t.tour_id,
       (ROW_NUMBER() OVER (ORDER BY count(oi.order_item_id) DESC, t.tour_id ASC))::integer
FROM tour t
LEFT JOIN order_item oi ON oi.tour_id = t.tour_id AND oi.payment_status = 1
WHERE t.status = 1 AND t.type = tour_travel_popular.大分類 AND t.item = tour_travel_popular.小分類
GROUP BY t.tour_id
$$;

-- 契約：docs/db-contract.md `tour_travel_most_favorited`
-- 依 favorite 筆數；只回 status = 1（#7）；沒有的行程也出現、計數 0（#23）；
-- ROW_NUMBER() 並以 tour_id 升冪當次要排序（#24），型別 integer（#25）。
CREATE FUNCTION tour_travel_most_favorited(大分類 text, 小分類 text)
RETURNS TABLE(tour_id uuid, "收藏排行" integer)
LANGUAGE sql STABLE AS $$
SELECT t.tour_id,
       (ROW_NUMBER() OVER (ORDER BY count(f.favorite_id) DESC, t.tour_id ASC))::integer
FROM tour t
LEFT JOIN favorite f ON f.tour_id = t.tour_id
WHERE t.status = 1 AND t.type = tour_travel_most_favorited.大分類 AND t.item = tour_travel_most_favorited.小分類
GROUP BY t.tour_id
$$;

-- 契約：docs/db-contract.md `tour_tour_detail`
-- 一個行程一列；tour_detail 用 LEFT JOIN（#30）；只回 status = 1（#7）。
CREATE FUNCTION tour_tour_detail(使用者編號 uuid)
RETURNS TABLE(
    "旅遊編號" uuid,
    "旅遊名稱" varchar,
    "旅遊標語" varchar,
    "大分類" varchar,
    "小分類" varchar,
    "旅遊代表圖 Url" text,
    "旅遊圖1 描述" varchar,
    "旅遊圖2 描述" varchar,
    "旅遊圖3 描述" varchar,
    "旅遊圖4 描述" varchar,
    "旅遊圖5 描述" varchar,
    "旅遊圖6 描述" varchar,
    "旅遊圖1 Url" text,
    "旅遊圖2 Url" text,
    "旅遊圖3 Url" text,
    "旅遊圖4 Url" text,
    "旅遊圖5 Url" text,
    "旅遊圖6 Url" text,
    "價錢" integer,
    "旅遊開始日期" timestamp,
    "旅遊結束日期" timestamp,
    "所屬國家" varchar,
    "所屬地區" varchar,
    "地址" text,
    "Google Map Url" varchar,
    "旅遊描述" text,
    "偏好設定分類 1" smallint,
    "偏好設定分類 2" smallint,
    "偏好設定分類 3" smallint,
    "收藏狀態" boolean,
    "異動通知內容" text,
    "促銷價錢" double precision,
    "通知狀態" varchar,
    "促銷開始日期" timestamp,
    "促銷結束日期" timestamp,
    "特色圖1 描述" varchar,
    "特色圖2 描述" varchar,
    "特色圖3 描述" varchar,
    "特色圖1 url" text,
    "特色圖2 url" text,
    "特色圖3 url" text,
    "行程規劃" text
)
LANGUAGE sql STABLE AS $$
SELECT
    tb."旅遊編號" AS "旅遊編號",
    tb."旅遊名稱" AS "旅遊名稱",
    tb."旅遊標語" AS "旅遊標語",
    tb."大分類" AS "大分類",
    tb."小分類" AS "小分類",
    tb."旅遊代表圖 Url" AS "旅遊代表圖 Url",
    t.img1_desc AS "旅遊圖1 描述",
    t.img2_desc AS "旅遊圖2 描述",
    t.img3_desc AS "旅遊圖3 描述",
    t.img4_desc AS "旅遊圖4 描述",
    t.img5_desc AS "旅遊圖5 描述",
    t.img6_desc AS "旅遊圖6 描述",
    t.img1 AS "旅遊圖1 Url",
    t.img2 AS "旅遊圖2 Url",
    t.img3 AS "旅遊圖3 Url",
    t.img4 AS "旅遊圖4 Url",
    t.img5 AS "旅遊圖5 Url",
    t.img6 AS "旅遊圖6 Url",
    tb."價錢" AS "價錢",
    tb."旅遊開始日期" AS "旅遊開始日期",
    tb."旅遊結束日期" AS "旅遊結束日期",
    tb."所屬國家" AS "所屬國家",
    tb."所屬地區" AS "所屬地區",
    t.address AS "地址",
    t.google_map_url AS "Google Map Url",
    tb."旅遊描述" AS "旅遊描述",
    tb."偏好分類1" AS "偏好設定分類 1",
    tb."偏好分類2" AS "偏好設定分類 2",
    tb."偏好分類3" AS "偏好設定分類 3",
    EXISTS (SELECT 1 FROM favorite f WHERE f.user_id = tour_tour_detail.使用者編號 AND f.tour_id = tb."旅遊編號") AS "收藏狀態",
    tb."異動通知內容" AS "異動通知內容",
    tb."促銷價錢" AS "促銷價錢",
    tb."通知狀態" AS "通知狀態",
    tb."促銷開始日期" AS "促銷開始日期",
    tb."促銷結束日期" AS "促銷結束日期",
    td.feature_desc1 AS "特色圖1 描述",
    td.feature_desc2 AS "特色圖2 描述",
    td.feature_desc3 AS "特色圖3 描述",
    td.feature_img1 AS "特色圖1 url",
    td.feature_img2 AS "特色圖2 url",
    td.feature_img3 AS "特色圖3 url",
    td.itinerary AS "行程規劃"
FROM tour_base tb
JOIN tour t ON t.tour_id = tb."旅遊編號"
LEFT JOIN LATERAL (
    SELECT d.* FROM tour_detail d WHERE d.tour_id = t.tour_id
    ORDER BY d.updated_at DESC, d.tour_detail_id LIMIT 1
) td ON true
WHERE tb."上下架狀態" = 1
$$;

-- 說明：飯店一列一個房型，沒有房型的飯店仍出現一列、房型欄位為 NULL（#33）。
-- 契約：docs/db-contract.md `tour_hotel`
CREATE FUNCTION tour_hotel(使用者編號 uuid)
RETURNS TABLE(
    "旅遊編號" uuid,
    "旅遊名稱" varchar,
    "旅遊標語" varchar,
    "大分類" varchar,
    "小分類" varchar,
    "旅遊代表圖 Url" text,
    "旅遊圖1 描述" varchar,
    "旅遊圖2 描述" varchar,
    "旅遊圖3 描述" varchar,
    "旅遊圖4 描述" varchar,
    "旅遊圖5 描述" varchar,
    "旅遊圖6 描述" varchar,
    "旅遊圖1 Url" text,
    "旅遊圖2 Url" text,
    "旅遊圖3 Url" text,
    "旅遊圖4 Url" text,
    "旅遊圖5 Url" text,
    "旅遊圖6 Url" text,
    "價錢" integer,
    "旅遊開始日期" timestamp,
    "旅遊結束日期" timestamp,
    "所屬國家" varchar,
    "所屬地區" varchar,
    "地址" text,
    "Google Map Url" varchar,
    "旅遊描述" text,
    "偏好設定分類 1" smallint,
    "偏好設定分類 2" smallint,
    "偏好設定分類 3" smallint,
    "收藏狀態" boolean,
    "異動通知內容" text,
    "促銷價錢" double precision,
    "通知狀態" varchar,
    "促銷開始日期" timestamp,
    "促銷結束日期" timestamp,
    "房型名稱" varchar,
    "房型描述" varchar,
    "房型容納人數" integer,
    "房型數量" integer,
    "房型代表圖 url" text,
    "基本設施與服務" text,
    "餐飲相關服務" text,
    "客房與設施" text,
    "交通與停車" text,
    "其他便利服務" text
)
LANGUAGE sql STABLE AS $$
SELECT
    tb."旅遊編號" AS "旅遊編號",
    tb."旅遊名稱" AS "旅遊名稱",
    tb."旅遊標語" AS "旅遊標語",
    tb."大分類" AS "大分類",
    tb."小分類" AS "小分類",
    tb."旅遊代表圖 Url" AS "旅遊代表圖 Url",
    t.img1_desc AS "旅遊圖1 描述",
    t.img2_desc AS "旅遊圖2 描述",
    t.img3_desc AS "旅遊圖3 描述",
    t.img4_desc AS "旅遊圖4 描述",
    t.img5_desc AS "旅遊圖5 描述",
    t.img6_desc AS "旅遊圖6 描述",
    t.img1 AS "旅遊圖1 Url",
    t.img2 AS "旅遊圖2 Url",
    t.img3 AS "旅遊圖3 Url",
    t.img4 AS "旅遊圖4 Url",
    t.img5 AS "旅遊圖5 Url",
    t.img6 AS "旅遊圖6 Url",
    tb."價錢" AS "價錢",
    tb."旅遊開始日期" AS "旅遊開始日期",
    tb."旅遊結束日期" AS "旅遊結束日期",
    tb."所屬國家" AS "所屬國家",
    tb."所屬地區" AS "所屬地區",
    t.address AS "地址",
    t.google_map_url AS "Google Map Url",
    tb."旅遊描述" AS "旅遊描述",
    tb."偏好分類1" AS "偏好設定分類 1",
    tb."偏好分類2" AS "偏好設定分類 2",
    tb."偏好分類3" AS "偏好設定分類 3",
    EXISTS (SELECT 1 FROM favorite f WHERE f.user_id = tour_hotel.使用者編號 AND f.tour_id = tb."旅遊編號") AS "收藏狀態",
    tb."異動通知內容" AS "異動通知內容",
    tb."促銷價錢" AS "促銷價錢",
    tb."通知狀態" AS "通知狀態",
    tb."促銷開始日期" AS "促銷開始日期",
    tb."促銷結束日期" AS "促銷結束日期",
    r.title AS "房型名稱",
    r.image_desc AS "房型描述",
    r.capacity AS "房型容納人數",
    r.room_count AS "房型數量",
    r.image AS "房型代表圖 url",
    h.facility_desc AS "基本設施與服務",
    h.food_desc AS "餐飲相關服務",
    h.room_desc AS "客房與設施",
    h.traffic_desc AS "交通與停車",
    h.other_desc AS "其他便利服務"
FROM tour_base tb
JOIN tour t ON t.tour_id = tb."旅遊編號"
JOIN hotel h ON h.tour_id = t.tour_id
LEFT JOIN hotel_room r ON r.hotel_id = h.hotel_id
WHERE tb."上下架狀態" = 1
$$;

-- 說明：每列只帶一筆菜單或一筆營業時間，另一邊為 NULL（#34）；兩者都沒有時保留一列（#33）。
-- 契約：docs/db-contract.md `tour_restaurant`
CREATE FUNCTION tour_restaurant(使用者編號 uuid)
RETURNS TABLE(
    "旅遊編號" uuid,
    "旅遊名稱" varchar,
    "旅遊標語" varchar,
    "大分類" varchar,
    "小分類" varchar,
    "旅遊代表圖 Url" text,
    "旅遊圖1 描述" varchar,
    "旅遊圖2 描述" varchar,
    "旅遊圖3 描述" varchar,
    "旅遊圖4 描述" varchar,
    "旅遊圖5 描述" varchar,
    "旅遊圖6 描述" varchar,
    "旅遊圖1 Url" text,
    "旅遊圖2 Url" text,
    "旅遊圖3 Url" text,
    "旅遊圖4 Url" text,
    "旅遊圖5 Url" text,
    "旅遊圖6 Url" text,
    "價錢" integer,
    "旅遊開始日期" timestamp,
    "旅遊結束日期" timestamp,
    "所屬國家" varchar,
    "所屬地區" varchar,
    "地址" text,
    "Google Map Url" varchar,
    "旅遊描述" text,
    "偏好設定分類 1" smallint,
    "偏好設定分類 2" smallint,
    "偏好設定分類 3" smallint,
    "收藏狀態" boolean,
    "異動通知內容" text,
    "促銷價錢" double precision,
    "通知狀態" varchar,
    "促銷開始日期" timestamp,
    "促銷結束日期" timestamp,
    "餐廳人員限制" integer,
    "官網介紹" text,
    "官網 url" varchar,
    "菜單名稱" varchar,
    "菜單描述" text,
    "菜單價錢" double precision,
    "營業星期" varchar,
    "營業時間" text
)
LANGUAGE sql STABLE AS $$
SELECT
    tb."旅遊編號" AS "旅遊編號",
    tb."旅遊名稱" AS "旅遊名稱",
    tb."旅遊標語" AS "旅遊標語",
    tb."大分類" AS "大分類",
    tb."小分類" AS "小分類",
    tb."旅遊代表圖 Url" AS "旅遊代表圖 Url",
    t.img1_desc AS "旅遊圖1 描述",
    t.img2_desc AS "旅遊圖2 描述",
    t.img3_desc AS "旅遊圖3 描述",
    t.img4_desc AS "旅遊圖4 描述",
    t.img5_desc AS "旅遊圖5 描述",
    t.img6_desc AS "旅遊圖6 描述",
    t.img1 AS "旅遊圖1 Url",
    t.img2 AS "旅遊圖2 Url",
    t.img3 AS "旅遊圖3 Url",
    t.img4 AS "旅遊圖4 Url",
    t.img5 AS "旅遊圖5 Url",
    t.img6 AS "旅遊圖6 Url",
    tb."價錢" AS "價錢",
    tb."旅遊開始日期" AS "旅遊開始日期",
    tb."旅遊結束日期" AS "旅遊結束日期",
    tb."所屬國家" AS "所屬國家",
    tb."所屬地區" AS "所屬地區",
    t.address AS "地址",
    t.google_map_url AS "Google Map Url",
    tb."旅遊描述" AS "旅遊描述",
    tb."偏好分類1" AS "偏好設定分類 1",
    tb."偏好分類2" AS "偏好設定分類 2",
    tb."偏好分類3" AS "偏好設定分類 3",
    EXISTS (SELECT 1 FROM favorite f WHERE f.user_id = tour_restaurant.使用者編號 AND f.tour_id = tb."旅遊編號") AS "收藏狀態",
    tb."異動通知內容" AS "異動通知內容",
    tb."促銷價錢" AS "促銷價錢",
    tb."通知狀態" AS "通知狀態",
    tb."促銷開始日期" AS "促銷開始日期",
    tb."促銷結束日期" AS "促銷結束日期",
    rs.reservation_limit AS "餐廳人員限制",
    rs.website_info AS "官網介紹",
    rs.website_url AS "官網 url",
    x.menu_name AS "菜單名稱",
    x.menu_desc AS "菜單描述",
    x.menu_price AS "菜單價錢",
    x.week AS "營業星期",
    x.business_hours AS "營業時間"
FROM tour_base tb
JOIN tour t ON t.tour_id = tb."旅遊編號"
JOIN restaurant rs ON rs.tour_id = t.tour_id
CROSS JOIN LATERAL (
    SELECT m.name AS menu_name, m.description AS menu_desc, m.price AS menu_price,
           NULL::varchar AS week, NULL::text AS business_hours
    FROM restaurant_menu m WHERE m.restaurant_id = rs.restaurant_id
    UNION ALL
    SELECT NULL::varchar, NULL::text, NULL::double precision, b.week, b.business_hours
    FROM restaurant_business b WHERE b.restaurant_id = rs.restaurant_id
    UNION ALL
    SELECT NULL::varchar, NULL::text, NULL::double precision, NULL::varchar, NULL::text
    WHERE NOT EXISTS (SELECT 1 FROM restaurant_menu m WHERE m.restaurant_id = rs.restaurant_id)
      AND NOT EXISTS (SELECT 1 FROM restaurant_business b WHERE b.restaurant_id = rs.restaurant_id)
) x
WHERE tb."上下架狀態" = 1
$$;

-- 契約：docs/db-contract.md `user_user_level`
-- 每位使用者一列；LEFT JOIN user_level，多筆取 updated_at 最新一筆（#22）。
CREATE VIEW "user_user_level" AS
SELECT
    u.user_id AS "使用者編號",
    u.name AS "名稱",
    u.avatar_url AS "個人照片 Url",
    ul.level AS "旅遊等級",
    ul.name AS "旅遊等級名稱",
    ul.badge_url AS "旅遊徽章 Url"
FROM "user" u
LEFT JOIN LATERAL (
    SELECT l.* FROM user_level l WHERE l.user_id = u.user_id
    ORDER BY l.updated_at DESC, l.level_id LIMIT 1
) ul ON true;

-- 契約：docs/db-contract.md `user_level_review_forHome`
-- 只含 review.type = 'web'（#48）；欄位集合依 #11；評論者沒有 user_level 仍出現（#22）。
CREATE VIEW "user_level_review_forHome" AS
SELECT
    r.review_id AS "評論編號",
    r.created_at AS "評論時間",
    uu."名稱",
    uu."個人照片 Url",
    uu."旅遊等級",
    uu."旅遊等級名稱",
    uu."旅遊徽章 Url",
    r.rating AS "評分",
    r.content AS "評論內容"
FROM review r
JOIN "user_user_level" uu ON uu."使用者編號" = r.user_id
WHERE r.type = 'web';

-- ========== B 組：購物車、訂位、折扣、結帳 ==========

-- 契約：docs/db-contract.md `user_cartList`
-- 每個 cart_item 一列，帶 cart.user_id；tour_base 含全部行程（#7），INNER JOIN 與 LEFT JOIN 結果相同。
-- 促銷價錢直接取 tour_base（只在促銷期間內有值，#10）；singleTotal_Price ＝ 有效單價 × quantity（#12）；多帶 cart_item_id（#35）。
CREATE VIEW "user_cartList" AS
SELECT
    c.user_id,
    c.cart_id,
    ci.tour_id,
    tb."大分類",
    tb."小分類",
    tb."旅遊名稱",
    tb."旅遊代表圖 Url",
    tb."價錢",
    tb."促銷價錢",
    ci.quantity,
    ci.start_date,
    ci.end_date,
    ci.room_type,
    (COALESCE(tb."促銷價錢", tb."價錢") * ci.quantity)::double precision AS "singleTotal_Price",
    ci.cart_item_id
FROM cart_item ci
JOIN cart c ON c.cart_id = ci.cart_id
JOIN tour_base tb ON tb."旅遊編號" = ci.tour_id;

-- 契約：docs/db-contract.md `hotel_booking`
-- 恆回 1 列（#18）：找不到 (行程, 房型) 時 booking_count、room_count 都是 0。
-- booking_count 數 order_item 列數，payment_status IN (-1, 0, 1)（#5），日期區間為半開 [入住, 退房)（#17），型別 integer（#25）。
-- 契約沒有說 hotel 的 booking_count 要不要加總 quantity（#15 只定了餐廳）；hotel 的 quantity 是人數，所以數列數（一列一間）。
CREATE FUNCTION hotel_booking(房型 varchar, 入住日期 timestamp, 退房日期 timestamp, 旅遊編號 uuid)
RETURNS TABLE(booking_count integer, room_count integer)
LANGUAGE sql STABLE AS $$
SELECT
    CASE WHEN room.n > 0 THEN (
        SELECT count(*)::integer FROM order_item oi
        WHERE oi.tour_id = hotel_booking.旅遊編號
          AND oi.room_type = hotel_booking.房型
          AND oi.payment_status IN (-1, 0, 1)
          AND oi.start_date < hotel_booking.退房日期
          AND oi.end_date > hotel_booking.入住日期
    ) ELSE 0 END,
    COALESCE(room.total, 0)::integer
FROM (
    SELECT count(*) AS n, sum(hr.room_count) AS total
    FROM hotel h
    JOIN hotel_room hr ON hr.hotel_id = h.hotel_id
    WHERE h.tour_id = hotel_booking.旅遊編號 AND hr.title = hotel_booking.房型
) room
$$;

-- 契約：docs/db-contract.md `restaurant_booking`
-- 找得到該行程的餐廳才回 1 列。忽略參數 1（#16，controller 恆傳 NULL）；booking_count ＝ order_item.quantity 加總（#15），
-- payment_status IN (-1, 0, 1)（#5），型別 integer（#25）。
CREATE FUNCTION restaurant_booking(預約時間 timestamp, 旅遊編號 uuid)
RETURNS TABLE(booking_count integer, reservation_limit integer)
LANGUAGE sql STABLE AS $$
SELECT
    COALESCE((
        SELECT sum(oi.quantity) FROM order_item oi
        WHERE oi.tour_id = r.tour_id AND oi.payment_status IN (-1, 0, 1)
    ), 0)::integer,
    r.reservation_limit
FROM restaurant r
WHERE r.tour_id = restaurant_booking.旅遊編號
$$;

-- 契約：docs/db-contract.md `restaurant_isClosed`（識別字小寫，不加引號）
-- 恆回 1 列（controller 讀 rows[0].isclosed）。#19：只看 restaurant_business 有沒有對應星期的列，沒有＝公休；
-- 預約時間為 NULL 或餐廳不存在時回 false。星期用與 restaurant_business_parsed 相同的 TRIM(TO_CHAR(..., 'FMDay'))。
CREATE FUNCTION restaurant_isclosed(預約時間 timestamp, 旅遊編號 uuid)
RETURNS TABLE(isclosed boolean)
LANGUAGE sql STABLE AS $$
SELECT CASE
    WHEN restaurant_isclosed.預約時間 IS NULL THEN false
    WHEN NOT EXISTS (SELECT 1 FROM restaurant r WHERE r.tour_id = restaurant_isclosed.旅遊編號) THEN false
    ELSE NOT EXISTS (
        SELECT 1 FROM restaurant r
        JOIN restaurant_business b ON b.restaurant_id = r.restaurant_id
        WHERE r.tour_id = restaurant_isclosed.旅遊編號
          AND b.week = TRIM(TO_CHAR(restaurant_isclosed.預約時間, 'FMDay'))
    )
END
$$;

-- 契約：docs/db-contract.md `restaurant_business_parsed`
-- 每個 (餐廳, 星期, 營業時段) 一列。business_hours 以 ',' 分時段、'~' 分起訖；結束 00:00 視為 24:00，轉成 23:59:59（#20）；
-- 無法解析的時段忽略（#21）。先用正規表示式篩出合法時段，才轉 time，所以不會因壞資料丟例外。
CREATE VIEW restaurant_business_parsed AS
SELECT
    r.tour_id,
    b.week,
    (m.parts[1] || ':' || m.parts[2])::time AS start_time,
    CASE WHEN (m.parts[3] || ':' || m.parts[4])::time = time '00:00' THEN time '23:59:59'
         ELSE (m.parts[3] || ':' || m.parts[4])::time END AS end_time
FROM restaurant_business b
JOIN restaurant r ON r.restaurant_id = b.restaurant_id
CROSS JOIN LATERAL unnest(string_to_array(b.business_hours, ',')) AS slot(txt)
CROSS JOIN LATERAL (
    SELECT regexp_match(btrim(slot.txt), '^([01]?[0-9]|2[0-3]):([0-5][0-9])\s*~\s*([01]?[0-9]|2[0-3]):([0-5][0-9])$') AS parts
) m
WHERE m.parts IS NOT NULL;

-- 契約：docs/db-contract.md `user_couponList`
-- 每個 user_coupon 一列，帶 coupon 內容；不過濾 status、不過濾過期（-1 原樣輸出，#37）；
-- expire_date 與 expired_date 同值（#36）；discount 原值輸出（折抵金額，#1）。
CREATE VIEW "user_couponList" AS
SELECT
    uc.user_id,
    uc.coupon_id,
    c.code,
    c.discount,
    c.description,
    c.expire_date,
    c.expire_date AS expired_date,
    uc.status,
    uc.order_id
FROM user_coupon uc
JOIN coupon c ON c.coupon_id = uc.coupon_id;

-- 契約：docs/db-contract.md `user_level_point_coupon`
-- 每位使用者的每張可用優惠卷一列：只列 status = 0 且未過期（#39，到期時刻本身仍算未過期，同 controller 的 now > expire_date）；
-- 優惠卷採 LEFT JOIN，沒有可用優惠卷的使用者仍保留 1 列、優惠卷欄位為 NULL（#40）；
-- user_level 採 LEFT JOIN、多筆取 updated_at 最新一筆（#22）；使用者旅遊積分 ＝ user_level.travel_point（#2）。
CREATE VIEW "user_level_point_coupon" AS
SELECT
    u.user_id AS "使用者編號",
    u.name AS "名稱",
    u.email AS "信箱",
    u.role AS "角色",
    u.avatar_url AS "個人照片 Url",
    u.preference1 AS "個人偏好 1",
    u.preference2 AS "個人偏好 2",
    u.preference3 AS "個人偏好 3",
    ul.level AS "旅遊等級",
    ul.name AS "旅遊等級名稱",
    ul.badge_url AS "旅遊徽章 Url",
    ul.travel_point AS "使用者旅遊積分",
    cp.coupon_id AS "優惠卷編號",
    cp.code AS "優惠卷代碼",
    cp.discount AS "優惠卷折扣",
    cp.description AS "優惠卷描述",
    cp.expire_date AS "優惠卷期限"
FROM "user" u
LEFT JOIN LATERAL (
    SELECT l.* FROM user_level l WHERE l.user_id = u.user_id
    ORDER BY l.updated_at DESC, l.level_id LIMIT 1
) ul ON true
LEFT JOIN (
    SELECT uc.user_id, c.coupon_id, c.code, c.discount, c.description, c.expire_date
    FROM user_coupon uc
    JOIN coupon c ON c.coupon_id = uc.coupon_id
    WHERE uc.status = 0 AND c.expire_date >= now()
) cp ON cp.user_id = u.user_id;

-- 契約：docs/db-contract.md `user_orderList`
-- 每個 order_item 一列，帶 tour_base；不篩 payment_status（#14）。
-- 價錢、促銷價錢取下單當時的單價（#13）：total_price／NULLIF(quantity, 0)、NULLIF(discount_price, 0)／NULLIF(quantity, 0)；
-- singleTotal_Price ＝ order_item.total_price（#12）；total_count ＝ 同訂單項目數，integer（#25）。
CREATE VIEW "user_orderList" AS
SELECT
    oi.order_id,
    oi.tour_id,
    tb."大分類",
    tb."小分類",
    tb."旅遊名稱",
    tb."旅遊代表圖 Url",
    oi.total_price / NULLIF(oi.quantity, 0) AS "價錢",
    NULLIF(oi.discount_price, 0) / NULLIF(oi.quantity, 0) AS "促銷價錢",
    oi.quantity,
    oi.start_date,
    oi.end_date,
    oi.room_type,
    oi.total_price AS "singleTotal_Price",
    (count(*) OVER (PARTITION BY oi.order_id))::integer AS total_count
FROM order_item oi
JOIN tour_base tb ON tb."旅遊編號" = oi.tour_id;

-- ========== C 組：會員與後台 ==========

-- 契約：docs/db-contract.md `user_favorite`
-- 每筆 favorite 一列，帶 tour_base 的欄位（#11）；tour_base 含全部行程，下架行程的收藏也出現（#41、#7）；
-- 建立時間 ＝ favorite.created_at（#43），不帶 tour_base 的 建立時間／更新時間；偏好分類取自行程（#42）。
CREATE VIEW "user_favorite" AS
SELECT
    f.user_id AS "收藏人員編號",
    f.created_at AS "建立時間",
    f.favorite_id,
    tb."旅遊編號", tb."上下架狀態", tb."通知狀態", tb."旅遊名稱", tb."旅遊標語", tb."旅遊描述",
    tb."大分類", tb."小分類", tb."所屬國家", tb."所屬地區", tb."價錢", tb."促銷價錢",
    tb."促銷開始日期", tb."促銷結束日期", tb."旅遊開始日期", tb."旅遊結束日期", tb."旅遊天數",
    tb."旅遊代表圖 Url", tb."偏好分類1", tb."偏好分類2", tb."偏好分類3", tb."異動通知內容"
FROM favorite f
JOIN tour_base tb ON tb."旅遊編號" = f.tour_id;

-- 契約：docs/db-contract.md `user_orders`
-- 每個 order_item 一列（#44），只含 order_item.payment_status = 1（#6）；帶 tour_base 全部欄位（#11），
-- 下架行程的購買紀錄也出現（#41）；view 內 ORDER BY orders.created_at 由新到舊（#45）。
CREATE VIEW "user_orders" AS
SELECT
    o.user_id AS "使用者編號",
    oi.order_item_id,
    tb."旅遊編號", tb."上下架狀態", tb."通知狀態", tb."旅遊名稱", tb."旅遊標語", tb."旅遊描述",
    tb."大分類", tb."小分類", tb."所屬國家", tb."所屬地區", tb."建立時間", tb."更新時間",
    tb."價錢", tb."促銷價錢", tb."促銷開始日期", tb."促銷結束日期", tb."旅遊開始日期",
    tb."旅遊結束日期", tb."旅遊天數", tb."旅遊代表圖 Url", tb."偏好分類1", tb."偏好分類2",
    tb."偏好分類3", tb."異動通知內容",
    oi.payment_status AS "付款狀態",
    oi.quantity AS "數量",
    oi.start_date AS "出發日期",
    oi.total_price AS "小計",
    oi.discount_price AS "促銷小計"
FROM order_item oi
JOIN orders o ON o.order_id = oi.order_id
JOIN tour_base tb ON tb."旅遊編號" = oi.tour_id
WHERE oi.payment_status = 1
ORDER BY o.created_at DESC;

-- 契約：docs/db-contract.md `user_order_item`
-- 每個 order_item 一列（#46，只 JOIN 一對一的 orders、tour）；與 user_orders 同一個篩選：payment_status = 1（#6）；
-- 欄位全部英文（#11）：order_item 的欄位 ＋ tour 的欄位（tour_id 只出現一次；created_at／updated_at 取 order_item，2026-11-01 使用者決定），多帶 使用者編號 ＝ orders.user_id、
-- 不帶 orders 的地址電話（#47）。下架行程的項目也出現（#41）。
CREATE VIEW "user_order_item" AS
SELECT
    oi.order_item_id,
    o.user_id AS "使用者編號",
    oi.order_id,
    oi.tour_id,
    oi.payment_status,
    oi.total_price,
    oi.discount_price,
    oi.quantity,
    oi.start_date,
    oi.end_date,
    oi.room_type,
    t.type, t.item, t.status, t.title, t.slogan, t.tour_start_date, t.tour_end_date,
    t.days, t.price, t.country, t.region, t.address, t.google_map_url, t.calendar_url,
    t.preference1, t.preference2, t.preference3, t.notice, t.description, t.cover_image,
    t.img1, t.img1_desc, t.img2, t.img2_desc, t.img3, t.img3_desc,
    t.img4, t.img4_desc, t.img5, t.img5_desc, t.img6, t.img6_desc,
    oi.created_at, oi.updated_at
FROM order_item oi
JOIN orders o ON o.order_id = oi.order_id
JOIN tour t ON t.tour_id = oi.tour_id
WHERE oi.payment_status = 1;

-- 契約：docs/db-contract.md `user_adminList`
-- 每位使用者一列；欄位 ＝ user ＋ user_level，鏡射 user_level_point_coupon 去掉優惠卷（#11），不含 password 等；
-- 偏好為 smallint 數字（#49）；user_level 採 LEFT JOIN、多筆取 updated_at 最新一筆（#22）；積分 ＝ travel_point（#2）。
CREATE VIEW "user_adminList" AS
SELECT
    u.user_id AS "使用者編號",
    u.name AS "名稱",
    u.email AS "信箱",
    u.role AS "角色",
    u.avatar_url AS "個人照片 Url",
    u.preference1 AS "個人偏好 1",
    u.preference2 AS "個人偏好 2",
    u.preference3 AS "個人偏好 3",
    ul.level AS "旅遊等級",
    ul.name AS "旅遊等級名稱",
    ul.badge_url AS "旅遊徽章 Url",
    ul.travel_point AS "使用者旅遊積分"
FROM "user" u
LEFT JOIN LATERAL (
    SELECT l.* FROM user_level l WHERE l.user_id = u.user_id
    ORDER BY l.updated_at DESC, l.level_id LIMIT 1
) ul ON true;
