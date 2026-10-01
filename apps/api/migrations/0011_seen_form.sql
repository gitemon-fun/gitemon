-- v19 build 02 (V19-D3): the last form the player saw, so the evolution moment plays once, on any device.
-- NULL = the form they have now (nobody gets a false moment on the day this ships).
ALTER TABLE gitemon ADD COLUMN seen_form INTEGER;
