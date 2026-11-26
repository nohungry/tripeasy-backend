-- P5 spec §3：收藏、購物車、通知設定各補一個唯一約束
-- 順序：(1) cart、auto_setting 預檢，有重複就停下（不自動合併）；(2) favorite 清重複；(3) 加約束

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cart GROUP BY user_id HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'V6：cart 有同一會員多列，請先手動處理（P5 spec §3）';
    END IF;
    IF EXISTS (SELECT 1 FROM auto_setting GROUP BY user_id HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'V6：auto_setting 有同一會員多列，請先手動處理（P5 spec §3）';
    END IF;
END $$;

-- 同一 (user_id, tour_id) 保留 (created_at, favorite_id) 最小者
DELETE FROM favorite f
USING favorite keep
WHERE f.user_id = keep.user_id
  AND f.tour_id = keep.tour_id
  AND (keep.created_at, keep.favorite_id) < (f.created_at, f.favorite_id);

ALTER TABLE favorite ADD CONSTRAINT favorite_user_tour_key UNIQUE (user_id, tour_id);
ALTER TABLE cart ADD CONSTRAINT cart_user_id_key UNIQUE (user_id);
ALTER TABLE auto_setting ADD CONSTRAINT auto_setting_user_id_key UNIQUE (user_id);
