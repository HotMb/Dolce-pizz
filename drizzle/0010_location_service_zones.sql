CREATE TABLE location_service_zones (
  organization_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, location_id, postal_code),
  FOREIGN KEY (organization_id, location_id) REFERENCES locations(organization_id, id) ON DELETE CASCADE,
  CHECK (postal_code GLOB '[0-9][0-9][0-9][0-9][0-9]')
);
CREATE INDEX location_service_zones_postal ON location_service_zones(organization_id, postal_code, enabled);
CREATE TRIGGER location_service_zones_immutable_scope
BEFORE UPDATE OF organization_id, location_id, postal_code ON location_service_zones
BEGIN SELECT RAISE(ABORT, 'service zone scope is immutable'); END;
