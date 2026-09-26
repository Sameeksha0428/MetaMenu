CREATE DATABASE IF NOT EXISTS meta_menu CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE meta_menu;
CREATE TABLE IF NOT EXISTS categories (
 category_id INT PRIMARY KEY AUTO_INCREMENT,
 name VARCHAR(60) NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS menu_items (
 item_id INT PRIMARY KEY AUTO_INCREMENT,
 category_id INT NOT NULL,
 name VARCHAR(100) NOT NULL,
 description VARCHAR(300) NOT NULL,
 regular_price DECIMAL(10,2) NOT NULL CHECK (regular_price > 0),
 max_discount_pct DECIMAL(5,2) NOT NULL DEFAULT 15 CHECK (max_discount_pct BETWEEN 0 AND 30),
 is_available BOOLEAN NOT NULL DEFAULT TRUE,
 is_vegetarian BOOLEAN NOT NULL DEFAULT TRUE,
 image_url VARCHAR(500),
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (category_id) REFERENCES categories(category_id)
);
CREATE TABLE IF NOT EXISTS customers (
 customer_id INT PRIMARY KEY AUTO_INCREMENT,
 name VARCHAR(100) NOT NULL
);
CREATE TABLE IF NOT EXISTS deal_periods (
 period_id INT PRIMARY KEY AUTO_INCREMENT,
 starts_at DATETIME NOT NULL UNIQUE,
 ends_at DATETIME NOT NULL,
 evaluation_starts_at DATETIME NOT NULL,
 evaluation_ends_at DATETIME NOT NULL,
 CHECK (ends_at > starts_at),
 CHECK (evaluation_ends_at > evaluation_starts_at)
);
CREATE TABLE IF NOT EXISTS deals (
 deal_id INT PRIMARY KEY AUTO_INCREMENT,
 period_id INT NOT NULL,
 item_id INT NOT NULL,
 regular_price_snapshot DECIMAL(10,2) NOT NULL,
 deal_price DECIMAL(10,2) NOT NULL,
 units_in_window INT NOT NULL,
 UNIQUE (period_id,item_id),
 FOREIGN KEY (period_id) REFERENCES deal_periods(period_id),
 FOREIGN KEY (item_id) REFERENCES menu_items(item_id),
 CHECK (deal_price > 0 AND deal_price <= regular_price_snapshot)
);
CREATE TABLE IF NOT EXISTS orders (
 order_id INT PRIMARY KEY AUTO_INCREMENT,
 customer_id INT NULL,
 placed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 status ENUM('completed','cancelled') NOT NULL DEFAULT 'completed',
 payment_status ENUM('pending','paid') NOT NULL DEFAULT 'pending',
 payment_method ENUM('cash','demo') NOT NULL DEFAULT 'cash',
 request_key VARCHAR(64) UNIQUE,
 FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
 INDEX idx_orders_sales (status,placed_at)
);
CREATE TABLE IF NOT EXISTS order_items (
 order_item_id INT PRIMARY KEY AUTO_INCREMENT,
 order_id INT NOT NULL,
 item_id INT NOT NULL,
 deal_id INT NULL,
 quantity INT NOT NULL CHECK (quantity BETWEEN 1 AND 99),
 unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price > 0),
 item_name_snapshot VARCHAR(100) NOT NULL,
 FOREIGN KEY (order_id) REFERENCES orders(order_id),
 FOREIGN KEY (item_id) REFERENCES menu_items(item_id),
 FOREIGN KEY (deal_id) REFERENCES deals(deal_id),
 UNIQUE (order_id,item_id),
 INDEX idx_items_sales (item_id,order_id)
);
CREATE TABLE IF NOT EXISTS price_audit (
 audit_id INT PRIMARY KEY AUTO_INCREMENT,
 item_id INT NOT NULL,
 old_price DECIMAL(10,2) NOT NULL,
 new_price DECIMAL(10,2) NOT NULL,
 changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (item_id) REFERENCES menu_items(item_id)
);
CREATE OR REPLACE VIEW current_menu AS
 SELECT m.*,c.name category_name,d.deal_id,d.deal_price,d.regular_price_snapshot,p.ends_at deal_ends_at,
 COALESCE(d.deal_price,m.regular_price) selling_price
 FROM menu_items m JOIN categories c ON c.category_id=m.category_id
 LEFT JOIN (deals d JOIN deal_periods p ON p.period_id=d.period_id
 AND CURRENT_TIMESTAMP >= p.starts_at AND CURRENT_TIMESTAMP < p.ends_at) ON d.item_id=m.item_id;
CREATE OR REPLACE VIEW order_totals AS
 SELECT o.order_id,o.customer_id,o.placed_at,o.status,o.payment_status,o.payment_method,
 SUM(oi.quantity*oi.unit_price) total_amount,SUM(oi.quantity) item_count
 FROM orders o JOIN order_items oi ON oi.order_id=o.order_id GROUP BY o.order_id;
