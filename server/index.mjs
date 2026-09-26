import express from 'express';
import path from 'node:path';
import {pool} from './db.mjs';
const app=express();
app.use(express.json({limit:'100kb'}));
// Local demo: writes must originate from this application's local UI.
app.use('/api',(req,res,next)=>{
 const origin=req.headers.origin;
 if(origin&&!['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:3001','http://localhost:3001'].includes(origin))return res.status(403).json({error:'Origin is not allowed'});
 next();
});
app.get('/api/health',async(req,res)=>{await pool.query('SELECT 1');res.json({status:'ok',database:'MySQL'});});
app.get('/api/menu',async(req,res)=>{
 const [items]=await pool.query('SELECT * FROM current_menu ORDER BY category_id,item_id');
 const [categories]=await pool.query('SELECT * FROM categories');
 res.json({items,categories});
});
app.get('/api/dashboard',async(req,res)=>{
 const [[stats]]=await pool.query(`SELECT COUNT(*) orders,COALESCE(SUM(total_amount),0) revenue,COALESCE(SUM(item_count),0) units FROM order_totals WHERE status='completed' AND placed_at>=CURRENT_DATE`);
 const [sales]=await pool.query(`SELECT m.item_id,m.name,c.name category,COALESCE(SUM(CASE WHEN o.order_id IS NOT NULL THEN oi.quantity ELSE 0 END),0) units FROM menu_items m JOIN categories c USING(category_id) LEFT JOIN order_items oi ON oi.item_id=m.item_id LEFT JOIN orders o ON o.order_id=oi.order_id AND o.status='completed' AND o.placed_at>=CURRENT_DATE-INTERVAL 7 DAY AND o.placed_at<CURRENT_DATE GROUP BY m.item_id ORDER BY units DESC,m.item_id`);
 const [periods]=await pool.query(`SELECT p.*,COUNT(d.deal_id) deal_count FROM deal_periods p LEFT JOIN deals d USING(period_id) GROUP BY p.period_id ORDER BY starts_at DESC LIMIT 14`);
 const [deals]=await pool.query(`SELECT d.*,m.name,c.name category,p.starts_at,p.ends_at FROM deals d JOIN menu_items m USING(item_id) JOIN categories c USING(category_id) JOIN deal_periods p USING(period_id) ORDER BY p.starts_at DESC,c.category_id LIMIT 56`);
 const [orders]=await pool.query(`SELECT ot.*,COALESCE(c.name,'Guest') customer_name FROM order_totals ot LEFT JOIN customers c USING(customer_id) ORDER BY order_id DESC LIMIT 12`);
 res.json({stats,sales,periods,deals,orders});
});
app.post('/api/deals/generate',async(req,res)=>{
 if(!['today','tomorrow'].includes(req.body.period))return res.status(400).json({error:'Choose today or tomorrow'});
 const [result]=await pool.query(`CALL generate_daily_deals(CURRENT_DATE ${req.body.period==='tomorrow'?'+ INTERVAL 1 DAY':''})`);
 res.json(result[0][0]);
});
function validateItem(b){return typeof b.name==='string'&&b.name.trim().length>0&&b.name.length<=100&&typeof b.description==='string'&&b.description.length<=300&&Number.isInteger(Number(b.category_id))&&Number(b.regular_price)>0&&Number(b.regular_price)<=100000&&Number(b.max_discount_pct)>=0&&Number(b.max_discount_pct)<=30&&typeof b.is_available==='boolean'&&typeof b.is_vegetarian==='boolean';}
app.post('/api/items',async(req,res)=>{
 if(!validateItem(req.body))return res.status(400).json({error:'Check the name, category, price and discount limit (0–30%).'});
 const b=req.body;const [r]=await pool.execute('INSERT INTO menu_items(category_id,name,description,regular_price,max_discount_pct,is_available,is_vegetarian) VALUES(?,?,?,?,?,?,?)',[Number(b.category_id),b.name.trim(),b.description,Number(b.regular_price),Number(b.max_discount_pct),b.is_available,b.is_vegetarian]);res.status(201).json({item_id:r.insertId});
});
app.put('/api/items/:id',async(req,res)=>{
 if(!validateItem(req.body))return res.status(400).json({error:'Check the name, category, price and discount limit (0–30%).'});
 const b=req.body;const [r]=await pool.execute('UPDATE menu_items SET category_id=?,name=?,description=?,regular_price=?,max_discount_pct=?,is_available=?,is_vegetarian=? WHERE item_id=?',[Number(b.category_id),b.name.trim(),b.description,Number(b.regular_price),Number(b.max_discount_pct),b.is_available,b.is_vegetarian,req.params.id]);
 if(!r.affectedRows)return res.status(404).json({error:'Dish not found'});res.json({ok:true});
});
app.post('/api/orders',async(req,res)=>{
 const {name,items,request_key}=req.body;
 if(typeof name!=='string'||!name.trim()||name.length>100||!Array.isArray(items)||!items.length||items.length>50||typeof request_key!=='string'||!/^[a-zA-Z0-9-]{10,64}$/.test(request_key)||items.some(i=>!Number.isInteger(i.item_id)||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>99||!Number.isFinite(i.unit_price))||new Set(items.map(i=>i.item_id)).size!==items.length)return res.status(400).json({error:'Enter your name and valid order quantities.'});
 const conn=await pool.getConnection();
 try{
 await conn.beginTransaction();
 const [[prior]]=await conn.execute('SELECT order_id FROM orders WHERE request_key=?',[request_key]);
 if(prior){await conn.rollback();return res.json({order_id:prior.order_id});}
 const ids=items.map(i=>i.item_id).sort((a,b)=>a-b);
 const marks=ids.map(()=>'?').join(',');
 await conn.execute(`SELECT item_id FROM menu_items WHERE item_id IN (${marks}) ORDER BY item_id FOR UPDATE`,ids);
 const [menu]=await conn.execute(`SELECT * FROM current_menu WHERE item_id IN (${marks})`,ids);
 for(const i of items){const m=menu.find(m=>m.item_id===i.item_id);if(!m||!m.is_available){const e=Error('A dish is no longer available. Refresh your menu.');e.status=409;throw e;}if(Math.round(i.unit_price*100)!==Math.round(m.selling_price*100)){const e=Error('A menu price changed. Review the refreshed cart before confirming.');e.status=409;throw e;}}
 const [customer]=await conn.execute('INSERT INTO customers(name) VALUES(?)',[name.trim()]);
 const [order]=await conn.execute('INSERT INTO orders(customer_id,request_key) VALUES(?,?)',[customer.insertId,request_key]);
 for(const i of items){const m=menu.find(m=>m.item_id===i.item_id);await conn.execute('INSERT INTO order_items(order_id,item_id,deal_id,quantity,unit_price,item_name_snapshot) VALUES(?,?,?,?,?,?)',[order.insertId,i.item_id,m.deal_id,i.quantity,m.selling_price,m.name]);}
 await conn.commit();res.status(201).json({order_id:order.insertId});
 }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY'){const [[prior]]=await conn.execute('SELECT order_id FROM orders WHERE request_key=?',[request_key]);if(prior)return res.json({order_id:prior.order_id});}throw e;}finally{conn.release();}
});
app.get('/api/orders/:id',async(req,res)=>{
 const [[order]]=await pool.execute('SELECT ot.*,c.name customer_name FROM order_totals ot LEFT JOIN customers c USING(customer_id) WHERE order_id=?',[req.params.id]);
 if(!order)return res.status(404).json({error:'Order not found'});
 const [items]=await pool.execute('SELECT item_name_snapshot name,quantity,unit_price,quantity*unit_price line_total FROM order_items WHERE order_id=?',[req.params.id]);res.json({...order,items});
});
app.use(express.static(path.resolve('dist')));
app.use((err,req,res,next)=>{console.error(err.message);res.status(err.status||500).json({error:err.status?err.message:'The request could not be completed. Please try again.'});});
const port=Number(process.env.PORT||3001);
app.listen(port,'127.0.0.1',()=>console.log(`Meta Menu API: http://127.0.0.1:${port}`));
