-- SYNTHETIC STAGING ONLY. Not the production checkout schema.
CREATE TABLE IF NOT EXISTS cod_lab_skus (sku TEXT PRIMARY KEY, price_paise INTEGER NOT NULL CHECK(price_paise>0), available INTEGER NOT NULL CHECK(available>=0));

CREATE TABLE IF NOT EXISTS cod_lab_pincodes (pin TEXT PRIMARY KEY, shipping_paise INTEGER NOT NULL CHECK(shipping_paise>=0));

CREATE TABLE IF NOT EXISTS cod_lab_orders (id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, sku TEXT NOT NULL REFERENCES cod_lab_skus(sku), qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 10), pin TEXT NOT NULL REFERENCES cod_lab_pincodes(pin), total_paise INTEGER NOT NULL CHECK(total_paise>0), status TEXT NOT NULL DEFAULT 'placed' CHECK(status IN ('placed','cancelled')), method TEXT NOT NULL DEFAULT 'cash_on_delivery' CHECK(method='cash_on_delivery'));

CREATE TRIGGER IF NOT EXISTS cod_lab_reserve AFTER INSERT ON cod_lab_orders BEGIN SELECT CASE WHEN NEW.total_paise != (SELECT price_paise FROM cod_lab_skus WHERE sku=NEW.sku)*NEW.qty+(SELECT shipping_paise FROM cod_lab_pincodes WHERE pin=NEW.pin) THEN RAISE(ABORT,'PRICE_MISMATCH') END; UPDATE cod_lab_skus SET available=available-NEW.qty WHERE sku=NEW.sku AND available>=NEW.qty; SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'INSUFFICIENT_STOCK') END; END;

CREATE TRIGGER IF NOT EXISTS cod_lab_release AFTER UPDATE OF status ON cod_lab_orders WHEN OLD.status='placed' AND NEW.status='cancelled' BEGIN UPDATE cod_lab_skus SET available=available+OLD.qty WHERE sku=OLD.sku; END;
