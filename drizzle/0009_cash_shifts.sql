-- A shift is the accounting boundary for a physical location. Payment rows remain
-- immutable; the entry table binds each captured payment to exactly one open shift.
CREATE TABLE IF NOT EXISTS cash_shifts (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_float INTEGER NOT NULL CHECK (opening_float >= 0),
  opened_by TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_by TEXT,
  closed_at TEXT,
  counted_cash INTEGER CHECK (counted_cash IS NULL OR counted_cash >= 0),
  close_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (organization_id, location_id, id),
  FOREIGN KEY (organization_id, location_id) REFERENCES locations(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS cash_shifts_one_open
  ON cash_shifts(organization_id, location_id) WHERE status='open';
CREATE INDEX IF NOT EXISTS cash_shifts_scope_date
  ON cash_shifts(organization_id, location_id, business_date);

CREATE TABLE IF NOT EXISTS cash_shift_entries (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  shift_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  method TEXT NOT NULL CHECK (method IN ('cash','card')),
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, location_id, id),
  UNIQUE (organization_id, location_id, payment_id),
  FOREIGN KEY (organization_id, location_id, shift_id)
    REFERENCES cash_shifts(organization_id, location_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, location_id, payment_id)
    REFERENCES payments(organization_id, location_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS cash_shift_entries_shift
  ON cash_shift_entries(organization_id, location_id, shift_id, created_at);

CREATE TRIGGER IF NOT EXISTS cash_shift_entries_immutable_update
BEFORE UPDATE ON cash_shift_entries
BEGIN SELECT RAISE(ABORT, 'cash shift entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS cash_shift_entries_immutable_delete
BEFORE DELETE ON cash_shift_entries
BEGIN SELECT RAISE(ABORT, 'cash shift entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS cash_shift_entries_open_guard
BEFORE INSERT ON cash_shift_entries
WHEN NOT EXISTS (
  SELECT 1 FROM cash_shifts s
  JOIN payments p ON p.organization_id=s.organization_id AND p.location_id=s.location_id
  WHERE s.organization_id=NEW.organization_id AND s.location_id=NEW.location_id AND s.id=NEW.shift_id
    AND s.status='open' AND p.organization_id=NEW.organization_id AND p.location_id=NEW.location_id
    AND p.id=NEW.payment_id AND p.amount=NEW.amount AND p.method=NEW.method AND p.status='captured'
)
BEGIN SELECT RAISE(ABORT, 'payment must belong to an open shift'); END;

CREATE TRIGGER IF NOT EXISTS cash_shifts_closed_immutable
BEFORE UPDATE ON cash_shifts
WHEN OLD.status='closed' AND (
  NEW.status<>OLD.status OR NEW.opening_float<>OLD.opening_float OR NEW.opened_by<>OLD.opened_by
  OR NEW.opened_at<>OLD.opened_at OR COALESCE(NEW.closed_by,'')<>COALESCE(OLD.closed_by,'')
  OR COALESCE(NEW.closed_at,'')<>COALESCE(OLD.closed_at,'') OR COALESCE(NEW.counted_cash,-1)<>COALESCE(OLD.counted_cash,-1)
  OR NEW.close_note<>OLD.close_note OR NEW.version<>OLD.version
)
BEGIN SELECT RAISE(ABORT, 'closed cash shifts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS cash_shifts_delete_guard
BEFORE DELETE ON cash_shifts
BEGIN SELECT RAISE(ABORT, 'cash shifts are immutable'); END;
