-- Pilot-only operational seed: the public Dolce Pizz' demo identifies Ronchin as 59790.
-- Tourcoing remains intentionally unconfigured until its address and service area are verified.
INSERT OR IGNORE INTO location_service_zones
  (organization_id, location_id, postal_code, enabled, priority, created_at, updated_at)
SELECT 'dolce-pizza', 'ronchin', '59790', 1, 0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (
  SELECT 1 FROM locations
  WHERE organization_id='dolce-pizza' AND id='ronchin' AND status='active'
    AND postal_code='59790'
);
