import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../server/db.mjs';
const base='http://127.0.0.1:3001/api';
async function request(url,body){const r=await fetch(base+url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:r.status,data:await r.json()};}
after(async()=>pool.end());
test('menu joins active deals and respects discount bounds',async()=>{
 const {status,data}=await request('/menu');assert.equal(status,200);assert.ok(data.items.length>=12);
 const active=data.items.filter(i=>i.deal_id);assert.equal(active.length,4);
 for(const d of active){assert.ok(d.selling_price<=d.regular_price_snapshot);assert.ok(d.selling_price>=d.regular_price_snapshot*.85-.01);}
});
test('daily generation is idempotent under concurrent calls',async()=>{
 const before=await pool.query('SELECT COUNT(*) n FROM deals');
 const responses=await Promise.all(Array.from({length:4},()=>request('/deals/generate',{period:'today'})));
 responses.forEach(r=>{assert.equal(r.status,200);assert.equal(r.data.created,0)});
 const [[afterCount]]=await pool.query('SELECT COUNT(*) n FROM deals');assert.equal(afterCount.n,before[0][0].n);
});
test('checkout rejects tampered prices without partial writes',async()=>{
 const {data}=await request('/menu');const m=data.items[0];const [[before]]=await pool.query('SELECT COUNT(*) n FROM orders');
 const result=await request('/orders',{name:'Integration test',request_key:randomUUID(),items:[{item_id:m.item_id,quantity:1,unit_price:.01}]});
 assert.equal(result.status,409);const [[afterCount]]=await pool.query('SELECT COUNT(*) n FROM orders');assert.equal(afterCount.n,before.n);
});
test('checkout preserves historical prices and handles duplicate submissions',async()=>{
 const {data}=await request('/menu');const m=data.items.find(i=>!i.deal_id);const key=randomUUID();let id,customer;
 try{
 const body={name:'Integration test',request_key:key,items:[{item_id:m.item_id,quantity:2,unit_price:m.selling_price}]};
 const results=await Promise.all([request('/orders',body),request('/orders',body)]);
 results.forEach(r=>assert.ok([200,201].includes(r.status)));assert.equal(results[0].data.order_id,results[1].data.order_id);id=results[0].data.order_id;
 const [[o]]=await pool.execute('SELECT customer_id FROM orders WHERE order_id=?',[id]);customer=o.customer_id;
 await pool.execute('UPDATE menu_items SET regular_price=regular_price+10 WHERE item_id=?',[m.item_id]);
 const receipt=await request('/orders/'+id);assert.equal(receipt.data.total_amount,m.selling_price*2);assert.equal(receipt.data.items[0].unit_price,m.selling_price);
 const [[audit]]=await pool.execute('SELECT COUNT(*) n FROM price_audit WHERE item_id=? AND old_price=? AND new_price=?',[m.item_id,m.regular_price,m.regular_price+10]);assert.ok(audit.n>=1);
 }finally{
 await pool.execute('UPDATE menu_items SET regular_price=? WHERE item_id=?',[m.regular_price,m.item_id]);
 if(id){await pool.execute('DELETE FROM order_items WHERE order_id=?',[id]);await pool.execute('DELETE FROM orders WHERE order_id=?',[id]);await pool.execute('DELETE FROM customers WHERE customer_id=?',[customer]);}
 }
});
test('unavailable dishes and invalid quantities are rejected',async()=>{
 const {data}=await request('/menu');const m=data.items[0];
 const body={name:'Integration test',request_key:randomUUID(),items:[{item_id:m.item_id,quantity:0,unit_price:m.selling_price}]};
 assert.equal((await request('/orders',body)).status,400);
 try{await pool.execute('UPDATE menu_items SET is_available=FALSE WHERE item_id=?',[m.item_id]);body.items[0].quantity=1;assert.equal((await request('/orders',body)).status,409);}
 finally{await pool.execute('UPDATE menu_items SET is_available=? WHERE item_id=?',[m.is_available,m.item_id]);}
});
