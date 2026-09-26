-- v5 (V5-D2, V5-D8): only developers who signed in have a Gitemon on the map. Every unclaimed
-- Gitemon seeded from public profiles is hidden (reversible; claim() un-hides on sign-in). Their
-- stored snapshots are deleted once sign-in works (build file 02, second step).
UPDATE gitemon SET hidden = 1 WHERE status != 'claimed';
-- logins other people searched for: never hatched now, so the queue goes
DELETE FROM pending;
