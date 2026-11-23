const json=(obj,status=200,headers={})=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const enc=new TextEncoder();
async function hmac(secret,msg){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,enc.encode(msg));return [...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function admin(req,env){if(!env.ADMIN_PASSWORD)return false;const raw=(req.headers.get('cookie')||'').match(/(?:^|;\s*)mixoy_session=([^;]+)/)?.[1];if(!raw)return false;const [exp,mac]=decodeURIComponent(raw).split('.');if(!/^\d+$/.test(exp)||Number(exp)<Date.now())return false;return mac===await hmac(env.ADMIN_PASSWORD,exp)}
const limit=(s,n)=>String(s??'').slice(0,n);
async function read(req){const len=Number(req.headers.get('content-length')||0);if(len>1200000)throw Error('ข้อมูลมีขนาดใหญ่เกิน 1.2 MB');return await req.json()}

const bytesToHex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);return bytesToHex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:210000,hash:'SHA-256'},key,256))}
function cookie(req,name){return (req.headers.get('cookie')||'').match(new RegExp('(?:^|;\\s*)'+name+'=([^;]+)'))?.[1]||''}
async function currentUser(req,db){const token=cookie(req,'mixoy_customer');if(!/^[a-f0-9-]{36}$/.test(token))return null;const row=await db.prepare('SELECT u.id,u.email FROM customer_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?').bind(token,new Date().toISOString()).first();return row||null}
const customerCookie=(token,maxAge)=>`mixoy_customer=${token}; Path=/api; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
async function startSession(db,userId){const token=crypto.randomUUID();await db.prepare('INSERT INTO customer_sessions(id,user_id,expires_at) VALUES(?,?,?)').bind(token,userId,new Date(Date.now()+30*86400000).toISOString()).run();return token}
export async function onRequest({request,env,params}){
 try{
  if(!env.DB)return json({error:'ยังไม่ได้ผูกฐานข้อมูล D1 (DB)'},503);
  const route=(params.path||[]).join('/');const method=request.method;const isAdmin=await admin(request,env);
  const user=await currentUser(request,env.DB);
  if(route==='customer/me'&&method==='GET')return json({user});
  if(route==='customer/register'&&method==='POST'){
   const b=await read(request),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');
   if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<10||password.length>128)return json({error:'ใช้อีเมลที่ถูกต้องและรหัสผ่านอย่างน้อย 10 ตัวอักษร'},400);
   if(await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first())return json({error:'อีเมลนี้มีบัญชีแล้ว'},409);
   const id=crypto.randomUUID(),salt=crypto.randomUUID(),hash=await passwordHash(password,salt);
   await env.DB.prepare('INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,?,?)').bind(id,email,salt,hash,new Date().toISOString()).run();
   const token=await startSession(env.DB,id);return json({ok:true,user:{id,email}},201,{'set-cookie':customerCookie(token,2592000)});
  }
  if(route==='customer/login'&&method==='POST'){
   const b=await read(request),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');
   const account=await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
   if(!account||password.length>128||await passwordHash(password,account.password_salt)!==account.password_hash)return json({error:'อีเมลหรือรหัสผ่านไม่ถูกต้อง'},401);
   const token=await startSession(env.DB,account.id);return json({ok:true,user:{id:account.id,email:account.email}},200,{'set-cookie':customerCookie(token,2592000)});
  }
  if(route==='customer/logout'&&method==='POST'){
   const token=cookie(request,'mixoy_customer');if(token)await env.DB.prepare('DELETE FROM customer_sessions WHERE id=?').bind(token).run();
   return json({ok:true},200,{'set-cookie':customerCookie('',0)});
  }
  if(route==='customer/orders'&&method==='GET'){
   if(!user)return json({error:'กรุณาเข้าสู่ระบบ'},401);
   const rows=await env.DB.prepare('SELECT id,items,created_at,status FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 200').bind(user.id).all();
   return json({orders:rows.results.map(o=>({...o,items:JSON.parse(o.items)}))});
  }
  if(route==='health')return json({ok:true,database:true,adminConfigured:!!env.ADMIN_PASSWORD});
  if(route==='login'&&method==='POST'){
   if(!env.ADMIN_PASSWORD)return json({error:'กรุณาตั้งค่า ADMIN_PASSWORD ก่อน'},503);
   const body=await read(request);if(body.password!==env.ADMIN_PASSWORD)return json({error:'รหัสผ่านไม่ถูกต้อง'},401);
   const exp=String(Date.now()+86400000);const token=exp+'.'+await hmac(env.ADMIN_PASSWORD,exp);
   return json({ok:true},200,{'set-cookie':`mixoy_session=${token}; Path=/api; Max-Age=86400; HttpOnly; Secure; SameSite=Strict`});
  }
  if(route==='session')return json({admin:isAdmin});
  if(route==='logout'&&method==='POST')return json({ok:true},200,{'set-cookie':'mixoy_session=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Strict'});
  if(route==='site'&&method==='GET'){const row=await env.DB.prepare("SELECT value FROM kv WHERE key='site'").first();return json({site:row?JSON.parse(row.value):null})}
  if(route==='site'&&method==='PUT'){
   if(!isAdmin)return json({error:'เฉพาะเจ้าของร้าน'},401);
   const body=await read(request);const site=body.site;if(!site||typeof site!=='object'||JSON.stringify(site).length>900000)return json({error:'ข้อมูลร้านไม่ถูกต้องหรือใหญ่เกินไป'},400);
   await env.DB.prepare("INSERT INTO kv(key,value) VALUES('site',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(site)).run();return json({ok:true});
  }
  if(route==='reviews'&&method==='GET'){const rows=await env.DB.prepare('SELECT * FROM reviews ORDER BY created_at DESC LIMIT 200').all();return json({reviews:rows.results.map(r=>({id:r.id,customer:r.name,text:r.text,rating:r.rating,photo:r.photo||'',profile:r.profile||'',approved:true,date:r.created_at}))})}
  if(route==='reviews'&&method==='POST'){
   const b=await read(request);const rating=Number(b.rating);if(!Number.isInteger(rating)||rating<1||rating>5||!limit(b.text,1001).trim()||String(b.text).length>1000)return json({error:'กรุณาใส่ข้อความและคะแนน 1–5 ดาว'},400);
   if((b.photo||'').length>350000||(b.profile||'').length>350000)return json({error:'รูปใหญ่เกินไป กรุณาเลือกรูปเล็กลง'},400);
   const id=crypto.randomUUID(),date=new Date().toISOString();await env.DB.prepare('INSERT INTO reviews(id,name,text,rating,photo,profile,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,limit(b.customer||'ลูกค้า',80),limit(b.text,1000),rating,b.photo||'',b.profile||'',date).run();return json({ok:true,review:{id,customer:limit(b.customer||'ลูกค้า',80),text:limit(b.text,1000),rating,photo:b.photo||'',profile:b.profile||'',approved:true,date}},201)
  }
  if(route.startsWith('reviews/')&&method==='DELETE'){if(!isAdmin)return json({error:'เฉพาะเจ้าของร้าน'},401);await env.DB.prepare('DELETE FROM reviews WHERE id=?').bind(route.split('/')[1]).run();return json({ok:true})}
  if(route==='orders'&&method==='POST'){
   const b=await read(request);if(!Array.isArray(b.items)||!b.items.length||b.items.length>50)return json({error:'รายการสินค้าไม่ถูกต้อง'},400);
   const id=crypto.randomUUID(),token=crypto.randomUUID(),items=JSON.stringify(b.items.map(x=>limit(x,100)));if(!user)return json({error:'กรุณาเข้าสู่ระบบก่อนสั่งซื้อ'},401);await env.DB.prepare('INSERT INTO orders(id,token,items,created_at,user_id) VALUES(?,?,?,?,?)').bind(id,token,items,new Date().toISOString(),user.id).run();return json({ok:true,id,token})
  }
  if(route==='orders'&&method==='GET'){if(!isAdmin)return json({error:'เฉพาะเจ้าของร้าน'},401);const rows=await env.DB.prepare('SELECT id,items,created_at,status FROM orders ORDER BY created_at DESC LIMIT 100').all();return json({orders:rows.results})}
  if(route.startsWith('orders/')&&method==='GET'){const id=route.split('/')[1],token=new URL(request.url).searchParams.get('token');const row=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();if(!row||(!isAdmin&&(!user||row.user_id!==user.id)&&token!==row.token))return json({error:'ไม่พบคำสั่งซื้อ'},404);return json({order:{id:row.id,items:JSON.parse(row.items),status:row.status,created_at:row.created_at}})}
  if(route==='messages'&&method==='GET'){
   const url=new URL(request.url),id=url.searchParams.get('order'),token=url.searchParams.get('token');const order=await env.DB.prepare('SELECT token,user_id FROM orders WHERE id=?').bind(id).first();if(!order||(!isAdmin&&(!user||order.user_id!==user.id)&&token!==order.token))return json({error:'ไม่มีสิทธิ์เข้าถึงแชท'},403);const rows=await env.DB.prepare('SELECT id,sender,body,created_at FROM messages WHERE order_id=? ORDER BY created_at LIMIT 200').bind(id).all();return json({messages:rows.results})
  }
  if(route==='messages'&&method==='POST'){
   const b=await read(request),order=await env.DB.prepare('SELECT token,user_id FROM orders WHERE id=?').bind(b.order).first();if(!order||(!isAdmin&&(!user||order.user_id!==user.id)&&b.token!==order.token))return json({error:'ไม่มีสิทธิ์ส่งข้อความ'},403);if(!String(b.body||'').trim())return json({error:'กรุณาพิมพ์ข้อความ'},400);await env.DB.prepare('INSERT INTO messages(id,order_id,sender,body,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),b.order,isAdmin?'shop':'customer',limit(b.body,2000),new Date().toISOString()).run();return json({ok:true},201)
  }
  return json({error:'ไม่พบ API'},404)
 }catch(e){return json({error:e.message||'เกิดข้อผิดพลาด'},500)}
}
