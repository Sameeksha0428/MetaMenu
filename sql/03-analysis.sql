USE meta_menu;
-- A LEFT JOIN keeps dishes with no completed sales in the result.
WITH recent_sales AS (
 SELECT oi.item_id,SUM(oi.quantity) units,SUM(oi.quantity*oi.unit_price) revenue
 FROM orders o JOIN order_items oi ON oi.order_id=o.order_id
 WHERE o.status='completed' AND o.placed_at>=CURRENT_DATE-INTERVAL 7 DAY
 GROUP BY oi.item_id
)
SELECT m.name,c.name category,COALESCE(s.units,0) units,COALESCE(s.revenue,0) revenue,
 DENSE_RANK() OVER(PARTITION BY c.category_id ORDER BY COALESCE(s.units,0) DESC) popularity_rank
FROM menu_items m JOIN categories c USING(category_id) LEFT JOIN recent_sales s USING(item_id);
-- Immutable sale prices make historical receipts independent of menu changes.
SELECT o.order_id,c.name,oi.item_name_snapshot,oi.quantity,oi.unit_price,
 oi.quantity*oi.unit_price line_total
FROM orders o LEFT JOIN customers c USING(customer_id) JOIN order_items oi USING(order_id)
ORDER BY o.order_id DESC;
-- Inspect index usage rather than claiming an unmeasured performance improvement.
EXPLAIN SELECT order_id FROM orders WHERE status='completed' AND placed_at>=CURRENT_DATE-INTERVAL 7 DAY;
