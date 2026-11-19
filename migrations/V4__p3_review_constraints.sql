-- P3 spec §4.1：評論一人一行程一則（web 評論 tour_id 為 NULL 不受限）、評分限 1–5
CREATE UNIQUE INDEX review_user_tour_key ON review (user_id, tour_id) WHERE tour_id IS NOT NULL;
ALTER TABLE review ADD CONSTRAINT review_rating_range CHECK (rating BETWEEN 1 AND 5);
