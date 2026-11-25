-- Žádosti o přístup, které přišly e-mailem na jsem@fakan.cz (Worker je zapíše
-- při příjmu zprávy). Dan pak na /pustit/<id> vidí, od koho žádost je.
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  received_at INTEGER NOT NULL
);
