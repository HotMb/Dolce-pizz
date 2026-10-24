CREATE UNIQUE INDEX devices_scope_id ON devices(organization_id, location_id, id);
CREATE TABLE device_credentials (
  token_hash TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  FOREIGN KEY (organization_id, location_id, device_id) REFERENCES devices(organization_id, location_id, id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (expires_at > 0),
  CHECK (revoked_at IS NULL OR revoked_at > 0)
);
CREATE INDEX device_credentials_device_status ON device_credentials(organization_id, location_id, device_id, revoked_at);
CREATE TRIGGER device_credentials_scope_immutable
BEFORE UPDATE OF token_hash, organization_id, location_id, device_id, created_by, created_at ON device_credentials
BEGIN SELECT RAISE(ABORT, 'device credential scope is immutable'); END;
