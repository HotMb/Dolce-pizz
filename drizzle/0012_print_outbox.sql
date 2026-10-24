CREATE TABLE print_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  printed_at TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  provider_job_id TEXT,
  FOREIGN KEY (organization_id, location_id, order_id) REFERENCES orders(organization_id, location_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, location_id) REFERENCES locations(organization_id, id) ON DELETE CASCADE,
  CHECK (job_type IN ('kitchen_ticket', 'customer_receipt')),
  CHECK (status IN ('pending', 'printing', 'printed', 'failed', 'unknown'))
);
CREATE UNIQUE INDEX print_outbox_operation ON print_outbox(operation_id);
CREATE INDEX print_outbox_pending ON print_outbox(status, available_at);
CREATE INDEX print_outbox_scope_status ON print_outbox(organization_id, location_id, status, available_at);
CREATE INDEX print_outbox_lease ON print_outbox(status, lease_expires_at);
