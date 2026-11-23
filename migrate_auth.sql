-- Execute once in the existing 3mixoy-db D1 Console. Keep existing tables/data.
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customer_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_user ON customer_sessions(user_id);
ALTER TABLE orders ADD COLUMN user_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);
