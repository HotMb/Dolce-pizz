-- Pickup payment ledger. This migration stores no card number, terminal secret or PAN.
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  method TEXT NOT NULL CHECK (method IN ('cash','card')),
  status TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','refunded','voided')),
  provider TEXT NOT NULL DEFAULT 'cashier',
  provider_reference TEXT,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, location_id, idempotency_key),
  UNIQUE (organization_id, location_id, id),
  FOREIGN KEY (organization_id, location_id, order_id)
    REFERENCES orders(organization_id, location_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS payments_order
  ON payments(organization_id, location_id, order_id, created_at);

CREATE TRIGGER IF NOT EXISTS payments_immutable_update
BEFORE UPDATE ON payments
BEGIN
  SELECT RAISE(ABORT, 'payments are immutable');
END;

CREATE TRIGGER IF NOT EXISTS payments_immutable_delete
BEFORE DELETE ON payments
BEGIN
  SELECT RAISE(ABORT, 'payments are immutable');
END;

-- A captured receipt is only valid for a pickup order in the same tenant/site.
-- The API also checks this condition before inserting, while this trigger protects
-- direct SQL maintenance and future adapters.
CREATE TRIGGER IF NOT EXISTS payments_order_scope_guard
BEFORE INSERT ON payments
WHEN NOT EXISTS (
  SELECT 1 FROM orders o
  WHERE o.id=NEW.order_id
    AND o.organization_id=NEW.organization_id
    AND o.location_id=NEW.location_id
    AND o.fulfillment='pickup'
    AND o.status='ready'
    AND o.payment_status='due_at_pickup'
    AND o.total=NEW.amount
)
BEGIN
  SELECT RAISE(ABORT, 'payment order is not ready or amount is incorrect');
END;
