-- is_visible = false was being shown as "Private", but it only meant "returned no data".
-- Reset it; the next collection run re-marks accounts that return data as visible.
UPDATE accounts SET is_visible = true WHERE is_visible = false;
