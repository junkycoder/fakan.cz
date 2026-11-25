-- Jeden člověk, víc zařízení. Každé vpuštěné zařízení (id žádosti, je v cookie
-- pristup) patří jednomu člověku z members. Dan je člověk 'spravce'.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  approved_at INTEGER NOT NULL,
  -- 1 = vpuštěno samo podle ověřené adresy, 0 = Dan potvrdil
  auto INTEGER NOT NULL DEFAULT 0
);
INSERT INTO devices (id, member_id, approved_at) SELECT id, id, approved_at FROM members WHERE id <> 'spravce';
CREATE INDEX devices_member ON devices (member_id);

-- Ověřené adresy lidí: žádost z takové adresy s platným DKIM podpisem projde sama.
CREATE TABLE emails (
  email TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  added_at INTEGER NOT NULL
);

-- Prošel e-mail žádosti kontrolou DKIM (podpis domény odesílatele)?
ALTER TABLE requests ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
