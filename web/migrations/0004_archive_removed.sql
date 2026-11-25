-- Kousky z archivu 9GAG, které Dan smazal z feedu. Soubory v R2 justpost-media
-- zůstávají (patří aplikaci just post, Worker z něj jen čte), takže jde smazání vrátit.
CREATE TABLE archive_removed (
  num INTEGER PRIMARY KEY,
  removed_at INTEGER NOT NULL
);
