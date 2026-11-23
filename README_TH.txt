3Mixoy - Cloudflare Pages + D1 (เวอร์ชันใช้งานออนไลน์)

1. สร้างฐานข้อมูล D1 ชื่อ 3mixoy-db ใน Cloudflare Dashboard > Workers & Pages > D1.
2. ใช้ SQL จาก schema.sql ใน D1 > Console เพื่อสร้างตาราง.
3. สร้าง Pages project แบบเชื่อม Git (แนะนำ) แล้วอัปโหลดโฟลเดอร์นี้เข้า GitHub repository.
   สำคัญ: การอัปโหลด ZIP ผ่าน Pages Direct Upload อย่างเดียวอาจไม่ deploy Pages Functions; ใช้ Wrangler หรือ Git deployment เพื่อให้ /api ทำงาน.
4. Pages > Settings > Bindings > Add D1 binding: Variable name DB, database 3mixoy-db.
5. Pages > Settings > Variables and Secrets > Add secret: ADMIN_PASSWORD เป็นรหัสใหม่ที่เดายาก (ไม่ใช่ 1234).
6. Deploy อีกครั้ง แล้วเปิด https://<project>.pages.dev/api/health ต้องเห็น {"ok":true,"database":true,"adminConfigured":true}.
7. เปิดหน้าเว็บ > ตั้งค่า > ใส่ ADMIN_PASSWORD เพื่อแก้ไขข้อมูลร้าน.

คำสั่ง Wrangler (ทางเลือก):
  npm install -g wrangler
  wrangler login
  wrangler d1 create 3mixoy-db
  wrangler d1 execute 3mixoy-db --remote --file=schema.sql
  wrangler pages project create 3mixoy-live
  wrangler pages deploy . --project-name=3mixoy-live
  แล้วตั้ง DB binding และ ADMIN_PASSWORD ใน Dashboard และ deploy ซ้ำ

ข้อจำกัด: ระบบแชทใช้การรีเฟรชข้อความทุก 8 วินาที; ลูกค้าเก็บ token ของคำสั่งซื้อใน sessionStorage จึงควรใช้เครื่องเดิมระหว่างแชท. ยังไม่มีระบบบัญชีลูกค้า, การยืนยันชำระเงินจริง, หรือแยกหลายร้าน. ภาพถูกเก็บเป็น data URL ใน D1; ควรย้ายไป R2 หากมีผู้ใช้มาก. ต้องทดสอบระบบบน Cloudflare จริงก่อนรับลูกค้า.
