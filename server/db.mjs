import 'dotenv/config';
import mysql from 'mysql2/promise';
export const pool=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3307),user:process.env.DB_USER||'metamenu',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'meta_menu',waitForConnections:true,connectionLimit:8,decimalNumbers:true,dateStrings:true});
