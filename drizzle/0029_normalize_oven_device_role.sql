-- Keep the enrolled-device vocabulary aligned with the production station vocabulary.
-- Older pilot records used the French label as the identifier (`four`).
UPDATE devices SET role='oven' WHERE role='four';
