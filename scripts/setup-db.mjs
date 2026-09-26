import mysql from 'mysql2/promise';
import {readFile,writeFile,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import 'dotenv/config';
const fresh=!(await access('.env').then(()=>true).catch(()=>false));
const password=fresh?randomBytes(24).toString('hex'):process.env.DB_PASSWORD;
const db=await mysql.createConnection({host:'127.0.0.1',port:3307,user:fresh?'root':'metamenu',password:fresh?'':password,multipleStatements:true});
if(fresh){
 await db.query("CREATE DATABASE IF NOT EXISTS meta_menu");
 await db.query("CREATE USER 'metamenu'@'localhost' IDENTIFIED BY ?",[password]);
 await db.query("GRANT ALL PRIVILEGES ON meta_menu.* TO 'metamenu'@'localhost'");
 await db.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?",[randomBytes(32).toString('hex')]);
 await writeFile('.env',`DB_HOST=127.0.0.1\nDB_PORT=3307\nDB_USER=metamenu\nDB_PASSWORD=${password}\nDB_NAME=meta_menu\nPORT=3001\n`);
}
await db.query(await readFile('sql/01-schema.sql','utf8'));
let delimiter=';',buffer='';
for(const line of (await readFile('sql/02-routines.sql','utf8')).split(/\r?\n/)){
 if(line.startsWith('DELIMITER ')){delimiter=line.slice(10).trim();continue;}
 buffer+=line+'\n';
 if(buffer.trimEnd().endsWith(delimiter)){await db.query(buffer.trimEnd().slice(0,-delimiter.length));buffer='';}
}
const [[{n}]]=await db.query('SELECT COUNT(*) n FROM menu_items');
if(n===0){
 await db.query("INSERT INTO categories(name) VALUES ('Small plates'),('Mains'),('Desserts'),('Drinks')");
 const items=[
 [1,'Burrata & tomatoes','Creamy burrata, ripe tomatoes, basil oil and toasted sourdough.',325,true,'photo-1608897013039-887f21d8c804'],
 [1,'Crispy corn ribs','Sweet corn, smoked paprika, lime and a little chilli heat.',195,true,'photo-1551754655-cd27e38d2076'],
 [1,'Herbed potato wedges','Golden potatoes with rosemary, sea salt and garlic dip.',175,true,'photo-1573080496219-bb080dd4f877'],
 [2,'Garden pesto pasta','Basil pesto, cherry tomatoes and parmesan over penne.',345,true,'photo-1473093295043-cdd812d0e601'],
 [2,'Margherita pizza','Stone-baked dough, San Marzano tomatoes and fresh mozzarella.',395,true,'photo-1579751626657-72bc17010498'],
 [2,'Grilled chicken bowl','Lemon chicken, herbed rice, crunchy greens and tahini.',425,false,'photo-1546069901-ba9599a7e63c'],
 [3,'Classic tiramisu','Espresso-soaked layers, mascarpone and a dusting of cocoa.',245,true,'photo-1571877227200-a0d98ea607e9'],
 [3,'Chocolate brownie','Warm dark chocolate brownie with vanilla ice cream.',225,true,'photo-1606313564200-e75d5e30476c'],
 [3,'Seasonal fruit bowl','A colourful selection of fresh seasonal fruit.',185,true,'photo-1490474418585-ba9bad8fd0ea'],
 [4,'Iced latte','Double espresso, cold milk and ice. Smooth and simple.',165,true,'photo-1461023058943-07fcbe16d735'],
 [4,'Mint lime cooler','Fresh lime, muddled mint and sparkling water.',145,true,'photo-1513558161293-cdaf765edfd7'],
 [4,'Berry iced tea','Brewed tea, mixed berries and a squeeze of lemon.',155,true,'photo-1544145945-f90425340c7e']
 ];
 for(const [cat,name,desc,price,veg,photo] of items) await db.query('INSERT INTO menu_items(category_id,name,description,regular_price,is_vegetarian,image_url,created_at) VALUES(?,?,?,?,?,?,CURRENT_DATE-INTERVAL 30 DAY)',[cat,name,desc,price,veg,`https://images.unsplash.com/${photo}?auto=format&fit=crop&w=900&q=85`]);
 await db.query("INSERT INTO customers(name) VALUES ('Sample guest')");
 // Deterministic sample data, separate from real orders: one order per day/dish.
 for(let day=1;day<=7;day++) for(let i=0;i<items.length;i++){
 const quantity=[5,1,3,2,6,4,4,5,1,6,2,3][i];
 const [o]=await db.query("INSERT INTO orders(customer_id,placed_at,payment_status,payment_method,request_key) VALUES(1,CURRENT_DATE-INTERVAL ? DAY+INTERVAL 13 HOUR,'paid','demo',?)",[day,`seed-${day}-${i}`]);
 await db.query('INSERT INTO order_items(order_id,item_id,quantity,unit_price,item_name_snapshot) VALUES(?,?,?,?,?)',[o.insertId,i+1,quantity,items[i][3],items[i][1]]);
 }
}
await db.query('CALL generate_daily_deals(CURRENT_DATE)');
console.log('Database ready: schema, routines, sample sales, and today’s deals.');
await db.end();
