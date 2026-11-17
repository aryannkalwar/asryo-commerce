-- Existing ASRYO schema adapted for EMPTY D1 staging. No data migration.
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, type TEXT NOT NULL,
    image TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price_paise INTEGER,
    stock INTEGER, active INTEGER NOT NULL DEFAULT 0, options_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    verified_at TEXT, verify_token_hash TEXT, verify_expires_at INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(id), public_token_hash TEXT NOT NULL,
    status TEXT NOT NULL, payment_status TEXT NOT NULL, payment_method TEXT NOT NULL DEFAULT 'cash_on_delivery', total_paise INTEGER NOT NULL,
    shipping_paise INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR',
    shipping_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS early_access (
    email TEXT PRIMARY KEY,
    consent_at TEXT NOT NULL,
    verified_at TEXT,
    verify_token_hash TEXT,
    verify_expires_at INTEGER,
    last_sent_at INTEGER,
    unsubscribe_token_hash TEXT,
    unsubscribed_at TEXT,
    design_preference TEXT,
    size_preference TEXT
  );
  CREATE INDEX IF NOT EXISTS early_access_verified ON early_access(verified_at);
  CREATE TABLE IF NOT EXISTS order_items (
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id TEXT NOT NULL,
    product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price_paise INTEGER NOT NULL,
    PRIMARY KEY(order_id, product_id)
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS orders_customer_created ON orders(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_skus (
  product_id TEXT PRIMARY KEY REFERENCES products(id), parent_id TEXT NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL UNIQUE, size TEXT NOT NULL, colour TEXT NOT NULL, reorder_point INTEGER,
  created_at TEXT NOT NULL, UNIQUE(parent_id,size,colour)
 );
 CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), delta INTEGER NOT NULL,
  reason TEXT NOT NULL, reference TEXT NOT NULL, payload_hash TEXT, stock_after INTEGER,
  created_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS inventory_movements_product ON inventory_movements(product_id,created_at);

CREATE TABLE IF NOT EXISTS commerce_listings (
    product_id TEXT PRIMARY KEY REFERENCES products(id), profile_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commerce_checkouts (
    order_id TEXT PRIMARY KEY REFERENCES orders(id), key_hash TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL, access_seed TEXT NOT NULL, email TEXT NOT NULL,
    gateway_order_id TEXT UNIQUE, gateway_payment_id TEXT UNIQUE,
    gateway_state TEXT NOT NULL DEFAULT 'none', snapshot_json TEXT NOT NULL,
    released INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commerce_events (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
    kind TEXT NOT NULL, detail_json TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commerce_webhooks (
    event_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, event_type TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commerce_refunds (
    order_id TEXT PRIMARY KEY REFERENCES orders(id), request_id TEXT NOT NULL UNIQUE,
    gateway_refund_id TEXT UNIQUE, state TEXT NOT NULL, amount_paise INTEGER NOT NULL,
    reason TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commerce_shipments (
    order_id TEXT PRIMARY KEY REFERENCES orders(id), carrier TEXT NOT NULL,
    tracking_number TEXT NOT NULL, tracking_url TEXT, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commerce_notifications (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), kind TEXT NOT NULL,
    state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
    UNIQUE(order_id,kind)
  );
  CREATE INDEX IF NOT EXISTS commerce_events_order ON commerce_events(order_id,created_at);

CREATE TABLE IF NOT EXISTS ops_staff (
  id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,
  role TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS ops_staff_sessions (
  token_hash TEXT PRIMARY KEY,staff_id TEXT NOT NULL REFERENCES ops_staff(id),expires_at INTEGER NOT NULL,created_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS ops_suppliers (
  id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL,
  notes TEXT NOT NULL,active INTEGER NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS ops_purchase_orders (
  id TEXT PRIMARY KEY,supplier_id TEXT NOT NULL REFERENCES ops_suppliers(id),snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL,
  total_paise INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS ops_expenses (
  id TEXT PRIMARY KEY,date TEXT NOT NULL,category TEXT NOT NULL,amount_paise INTEGER NOT NULL,
  included_gst_paise INTEGER NOT NULL,description TEXT NOT NULL,reference TEXT NOT NULL,
  voided_at TEXT,revision INTEGER NOT NULL,created_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS ops_unit_costs (
  product_id TEXT PRIMARY KEY REFERENCES products(id),unit_cost_paise INTEGER NOT NULL,
  reference TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS ops_coupons (
  code TEXT PRIMARY KEY,kind TEXT NOT NULL,value INTEGER NOT NULL,min_subtotal_paise INTEGER NOT NULL,
  max_discount_paise INTEGER NOT NULL,max_uses INTEGER NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,
  active INTEGER NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS ops_coupon_redemptions (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),code TEXT NOT NULL REFERENCES ops_coupons(code),
  discount_paise INTEGER NOT NULL,released INTEGER NOT NULL DEFAULT 0
 );
 CREATE TABLE IF NOT EXISTS ops_audit (
  id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,created_at TEXT NOT NULL
 );

CREATE TABLE IF NOT EXISTS asryo_cost_profiles(
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  assumptions_json TEXT NOT NULL,updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS studio_projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, design_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS studio_history (
    project_id TEXT NOT NULL REFERENCES studio_projects(id), revision INTEGER NOT NULL,
    event TEXT NOT NULL, at TEXT NOT NULL, snapshot_json TEXT NOT NULL,
    PRIMARY KEY(project_id,revision)
  );
  CREATE TABLE IF NOT EXISTS studio_imports (
    project_id TEXT PRIMARY KEY REFERENCES studio_projects(id), product_id TEXT NOT NULL UNIQUE REFERENCES products(id),
    approved_revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS cofounder_automation_events(
    id TEXT PRIMARY KEY,
    rule_key TEXT NOT NULL,
    business_day TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(rule_key,business_day)
  );

CREATE TABLE IF NOT EXISTS cofounder_drafts (id TEXT PRIMARY KEY,kind TEXT NOT NULL,product_id TEXT,title TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS cofounder_drafts_created ON cofounder_drafts(created_at DESC);
