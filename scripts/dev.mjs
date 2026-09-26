import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import net from 'node:net';
const children=[];
const listening=()=>new Promise(resolve=>{const s=net.connect(3307,'127.0.0.1');s.on('connect',()=>{s.destroy();resolve(true)});s.on('error',()=>resolve(false));});
if(!await listening()){
 const exe=process.env.MYSQLD_PATH||'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqld.exe';
 if(!existsSync(exe)||!existsSync('.local/mysql')) throw Error('Set up the local MySQL instance first; see README.md.');
 children.push(spawn(exe,['--no-defaults',`--datadir=${process.cwd().replaceAll('\\','/')}/.local/mysql`,'--port=3307','--bind-address=127.0.0.1','--mysqlx=0','--console'],{stdio:'inherit',windowsHide:true}));
 for(let i=0;i<30&&!await listening();i++)await new Promise(r=>setTimeout(r,500));
}
children.push(spawn(process.execPath,['server/index.mjs'],{stdio:'inherit',windowsHide:true}));
children.push(spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit',windowsHide:true}));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{children.forEach(c=>c.kill());process.exit()});
