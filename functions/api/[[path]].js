const json=(obj,status=200,headers={})=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const enc=new TextEncoder();
async function hmac(secret,msg){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,enc.encode(msg));return [...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function admin(req,env){if(!env.ADMIN_PASSWORD)return false;const raw=(req.headers.get('cookie')||'').match(/(?:^|;\s*)mixoy_session=([^;]+)/)?.[1];if(!raw)return false;const [exp,mac]=decodeURIComponent(raw).split('.');if(!/^\d+$/.test(exp)||Number(exp)<Date.now())return false;return mac===await hmac(env.ADMIN_PASSWORD,exp)}
const limit=(s,n)=>String(s??'').slice(0,n);
async function read(req){const len=Number(req.headers.get('content-length')||0);if(len>1200000)throw Error('ข้อมูลมีขนาดใหญ่เกิน 1.2 MB');return await req.json()}
export async function onRequest({request,env,params}){
 try{
  if(!env.DB)return json({error:'ยังไม่ได้ผูกฐานข้อมูล D1 (DB)'},503);
  const route=(params.path||[]).join('/');const method=request.method;const isAdmin=await admin(request,env);
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
   const id=crypto.randomUUID(),token=crypto.randomUUID(),items=JSON.stringify(b.items.map(x=>limit(x,100)));await env.DB.prepare('INSERT INTO orders(id,token,items,created_at) VALUES(?,?,?,?)').bind(id,token,items,new Date().toISOString()).run();return json({ok:true,id,token})
  }
  if(route==='orders'&&method==='GET'){if(!isAdmin)return json({error:'เฉพาะเจ้าของร้าน'},401);const rows=await env.DB.prepare('SELECT id,items,created_at,status FROM orders ORDER BY created_at DESC LIMIT 100').all();return json({orders:rows.results})}
  if(route.startsWith('orders/')&&method==='GET'){const id=route.split('/')[1],token=new URL(request.url).searchParams.get('token');const row=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();if(!row||(!isAdmin&&token!==row.token))return json({error:'ไม่พบคำสั่งซื้อ'},404);return json({order:{id:row.id,items:JSON.parse(row.items),status:row.status,created_at:row.created_at}})}
  if(route==='messages'&&method==='GET'){
   const url=new URL(request.url),id=url.searchParams.get('order'),token=url.searchParams.get('token');const order=await env.DB.prepare('SELECT token FROM orders WHERE id=?').bind(id).first();if(!order||(!isAdmin&&token!==order.token))return json({error:'ไม่มีสิทธิ์เข้าถึงแชท'},403);const rows=await env.DB.prepare('SELECT id,sender,body,created_at FROM messages WHERE order_id=? ORDER BY created_at LIMIT 200').bind(id).all();return json({messages:rows.results})
  }
  if(route==='messages'&&method==='POST'){
   const b=await read(request),order=await env.DB.prepare('SELECT token FROM orders WHERE id=?').bind(b.order).first();if(!order||(!isAdmin&&b.token!==order.token))return json({error:'ไม่มีสิทธิ์ส่งข้อความ'},403);if(!String(b.body||'').trim())return json({error:'กรุณาพิมพ์ข้อความ'},400);await env.DB.prepare('INSERT INTO messages(id,order_id,sender,body,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),b.order,isAdmin?'shop':'customer',limit(b.body,2000),new Date().toISOString()).run();return json({ok:true},201)
  }
  return json({error:'ไม่พบ API'},404)
 }catch(e){return json({error:e.message||'เกิดข้อผิดพลาด'},500)}
}
