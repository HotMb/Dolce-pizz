DROP TRIGGER IF EXISTS `payments_order_scope_guard`;--> statement-breakpoint
CREATE TRIGGER `payments_order_scope_guard`
BEFORE INSERT ON `payments`
WHEN NOT EXISTS (
  SELECT 1 FROM orders o
  WHERE o.id=NEW.order_id
    AND o.organization_id=NEW.organization_id
    AND o.location_id=NEW.location_id
    AND o.fulfillment='pickup'
    AND o.status='ready'
    AND o.payment_status IN ('due_at_pickup','partially_paid')
    AND NEW.amount > 0
    AND o.paid_total + NEW.amount <= o.total
)
BEGIN
  SELECT RAISE(ABORT, 'payment order is not ready or amount exceeds remaining balance');
END;--> statement-breakpoint
