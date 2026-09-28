-- v11 (V11-D1): a sealed legend keeps only its GitHub user id, rank and creature (the Privacy page's
-- promise). The username was written by the import and read by nothing.
ALTER TABLE legend DROP COLUMN login;
