USE meta_menu;
DROP TRIGGER IF EXISTS audit_menu_price;
DELIMITER $$
CREATE TRIGGER audit_menu_price AFTER UPDATE ON menu_items FOR EACH ROW
BEGIN
 IF OLD.regular_price <> NEW.regular_price THEN
 INSERT INTO price_audit(item_id,old_price,new_price) VALUES(NEW.item_id,OLD.regular_price,NEW.regular_price);
 END IF;
END$$
DROP PROCEDURE IF EXISTS generate_daily_deals$$
CREATE PROCEDURE generate_daily_deals(IN target_date DATE)
proc: BEGIN
 DECLARE pid INT;
 DECLARE locked INT DEFAULT 0;
 DECLARE EXIT HANDLER FOR SQLEXCEPTION
 BEGIN ROLLBACK; IF locked=1 THEN DO RELEASE_LOCK('metamenu_deal_generation'); END IF; RESIGNAL; END;
 IF target_date IS NULL OR target_date < CURRENT_DATE OR target_date > CURRENT_DATE + INTERVAL 1 DAY THEN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Generate deals only for today or tomorrow';
 END IF;
 SELECT GET_LOCK('metamenu_deal_generation',10) INTO locked;
 IF locked IS NULL OR locked <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Deal generation is busy'; END IF;
 START TRANSACTION;
 SELECT MAX(period_id) INTO pid FROM deal_periods WHERE starts_at=target_date;
 IF pid IS NOT NULL THEN
 COMMIT; DO RELEASE_LOCK('metamenu_deal_generation'); SELECT pid period_id,0 created; LEAVE proc;
 END IF;
 INSERT INTO deal_periods(starts_at,ends_at,evaluation_starts_at,evaluation_ends_at)
 VALUES(target_date,target_date+INTERVAL 1 DAY,CURRENT_DATE-INTERVAL 7 DAY,CURRENT_DATE);
 SET pid=LAST_INSERT_ID();
 INSERT INTO deals(period_id,item_id,regular_price_snapshot,deal_price,units_in_window)
 WITH sales AS (
 SELECT oi.item_id,SUM(oi.quantity) units FROM order_items oi JOIN orders o ON o.order_id=oi.order_id
 WHERE o.status='completed' AND o.placed_at >= CURRENT_DATE-INTERVAL 7 DAY AND o.placed_at < CURRENT_DATE
 GROUP BY oi.item_id
 ), ranked AS (
 SELECT m.*,COALESCE(s.units,0) units,
 SUM(COALESCE(s.units,0)) OVER(PARTITION BY m.category_id) category_units,
 ROW_NUMBER() OVER(PARTITION BY m.category_id ORDER BY COALESCE(s.units,0),m.item_id) position_in_category
 FROM menu_items m LEFT JOIN sales s ON s.item_id=m.item_id
 WHERE m.is_available=TRUE AND m.max_discount_pct>0 AND m.created_at <= CURRENT_DATE-INTERVAL 7 DAY
 )
 SELECT pid,item_id,regular_price,ROUND(regular_price*(1-LEAST(15,max_discount_pct)/100),2),units
 FROM ranked WHERE position_in_category=1 AND category_units>0;
 COMMIT;
 DO RELEASE_LOCK('metamenu_deal_generation');
 SELECT pid period_id,1 created;
END$$
DELIMITER ;
