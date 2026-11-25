-- Osobní feed na fakan.cz: lidé, které Dan pustil dál, jejich příspěvky a hlasy.

-- id = id žádosti o přístup (tajné, nikdy neopouští server), 'spravce' = Dan.
-- Navenek se člověk pozná jen podle rowid.
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  approved_at INTEGER NOT NULL
);
INSERT INTO members (rowid, id, name, approved_at) VALUES (1, 'spravce', 'fakan', 0);

-- Média leží v R2 fakan-feed pod n/<key>
CREATE TABLE posts (
  key TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL CHECK (kind IN ('i', 'v')),
  content_type TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX posts_created ON posts (created_at DESC);

-- post = 'n:<key>' (nový příspěvek) nebo 'a:<číslo>' (archiv 9GAG)
CREATE TABLE votes (
  post TEXT NOT NULL,
  voter TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post, voter)
);
