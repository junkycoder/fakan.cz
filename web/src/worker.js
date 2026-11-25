// fakan.cz — statika z public/ + média osobního feedu z R2 (bucket justpost-media).
// Worker jen čte, do R2 nic nezapisuje.
//
// Osobní část je zamčená. Návštěvník pošle Danovi e-mail s odkazem /pustit/<id>,
// Dan odkaz otevře, potvrdí a člověk se zapíše do D1 (members). Prohlížeč
// návštěvníka se pak ptá na /osobni/stav a dostane podepsanou cookie s přístupem.
// Vpuštění (i Dan) přidávají příspěvky (média v R2 fakan-feed) a hlasují.
//
// Pošta na jsem@fakan.cz chodí sem (Email Routing → Worker). Žádost o přístup se
// zapíše do D1 (requests) a každá zpráva se přepošle Danovi (secret PRESMEROVAT_NA).

const MEDIA_PREFIX = "posts/imported/";
// Název souboru z 9GAG exportu: 0001_ayNOnMM.jpg / 0002_azx0EnB.mp4
const MEDIA_NAME = /^\d{4}_[A-Za-z0-9]+\.(jpg|mp4|png|gif|webp)$/;

// Stránky, které obsluhuje index.html (přepínač profesní / osobní)
const APP_PATHS = new Set(["/", "/osobni"]);

// Žádost o přístup: 16 náhodných bajtů v base64url
const REQUEST_ID = /^[A-Za-z0-9_-]{22}$/;
const DAY = 60 * 60 * 24;
const COOKIE = { request: "zadost", access: "pristup", admin: "spravce" };
const ADMIN_ID = "spravce";

// Nové příspěvky: povolené typy médií a limity (Worker bere tělo do 100 MB)
const UPLOAD_TYPES = {
  "image/jpeg": ["jpg", "i"], "image/png": ["png", "i"], "image/gif": ["gif", "i"], "image/webp": ["webp", "i"],
  "video/mp4": ["mp4", "v"], "video/quicktime": ["mov", "v"], "video/webm": ["webm", "v"],
};
const MAX_IMAGE = 25 * 1024 * 1024;
const MAX_VIDEO = 95 * 1024 * 1024;
const MAX_CAPTION = 500;
const MAX_NAME = 40;
const POST_KEY = /^[a-z0-9]{8,10}-[A-Za-z0-9_-]{8}\.(jpg|png|gif|webp|mp4|mov|webm)$/;
// Odkaz na schválení v textu žádosti (i v HTML části a po dekódování MIME)
const REQUEST_LINK = /\/pustit\/([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/;
const MAX_PARSED_EMAIL = 2 * 1024 * 1024;
const VOTE_REF = /^(a:\d{1,6}|n:[a-z0-9]{8,10}-[A-Za-z0-9_-]{8}\.(jpg|png|gif|webp|mp4|mov|webm))$/;

// Stránky pro Dana (schválení, přihlášení) potřebují odeslat formulář
const ADMIN_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy":
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

export default {
  // jsem@fakan.cz: zapsat žádost o přístup a přeposlat Danovi
  async email(message, env) {
    if (!env.PRESMEROVAT_NA) {
      message.setReject("Schránka jsem@fakan.cz teď nepřijímá poštu.");
      return;
    }
    try {
      const raw = message.rawSize <= MAX_PARSED_EMAIL ? await new Response(message.raw).text() : "";
      const match = REQUEST_LINK.exec(mimeText(raw));
      if (match) {
        const sender = parseAddress(message.headers.get("from")) || { email: message.from, name: "" };
        await env.DB.prepare(
          `INSERT INTO requests (id, email, name, received_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = excluded.name, received_at = excluded.received_at`,
        ).bind(match[1], sender.email.slice(0, 200), sender.name.slice(0, MAX_NAME), Date.now()).run();
      }
    } catch (error) {
      // Zápis žádosti je bonus, zpráva musí Danovi dojít vždycky
      console.error("zadost z e-mailu", error);
    }
    await message.forward(env.PRESMEROVAT_NA);
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/m/")) {
      if (!(await hasAccess(request, env))) return locked();
      const name = decodeURIComponent(url.pathname.slice(3));
      if (!MEDIA_NAME.test(name)) return new Response("Not Found", { status: 404 });
      return serveMedia(request, env.MEDIA, MEDIA_PREFIX + name);
    }

    if (url.pathname.startsWith("/n/")) {
      if (!(await hasAccess(request, env))) return locked();
      const key = url.pathname.slice(3);
      if (!POST_KEY.test(key)) return new Response("Not Found", { status: 404 });
      return serveMedia(request, env.FEED, `n/${key}`);
    }

    if (url.pathname === "/feed.json") {
      if (!(await hasAccess(request, env))) return locked();
      const response = withHeaders(await env.ASSETS.fetch(request));
      response.headers.set("cache-control", "private, no-cache");
      return response;
    }

    if (url.pathname === "/osobni/stav") return accessState(request, env);
    if (url.pathname === "/osobni/zadost") return storeRequest(request, env, url);
    if (url.pathname === "/osobni/prispevky") return listPosts(request, env);
    if (url.pathname === "/osobni/prispevek") return createPost(request, env, url);
    if (url.pathname.startsWith("/osobni/prispevek/")) return deletePost(request, env, url, url.pathname.slice(18));
    if (url.pathname === "/osobni/hlas") return vote(request, env, url);
    if (url.pathname.startsWith("/pustit/")) return approvePage(request, env, url, url.pathname.slice(8));
    if (url.pathname === "/spravce") return adminPage(request, env, url);

    if (url.pathname === "/osobni/") {
      return Response.redirect(new URL("/osobni", url), 301);
    }

    // /osobni vrací stejnou stránku jako /, režim si přečte skript z adresy
    const assetRequest = APP_PATHS.has(url.pathname)
      ? new Request(new URL("/", url), request)
      : request;
    const response = await env.ASSETS.fetch(assetRequest);
    return withHeaders(response);
  },
};

async function serveMedia(request, bucket, key) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  // Range kvůli videím (Safari bez něj mp4 nepřehraje), onlyIf kvůli 304
  const range = parseRange(request.headers.get("range"));
  const object = await bucket.get(key, {
    ...(range ? { range } : {}),
    onlyIf: request.headers,
  });
  if (!object) return new Response("Not Found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  // private: média jsou jen pro vpuštěné, sdílené cache je nesmí držet
  headers.set("cache-control", "private, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");

  // Podmínka onlyIf nesplněna → objekt bez těla
  if (!("body" in object)) return new Response(null, { status: 304, headers });

  const bytes = range ? resolveRange(range, object.size) : null;
  if (range && !bytes) {
    headers.set("content-range", `bytes */${object.size}`);
    return new Response(null, { status: 416, headers });
  }
  if (bytes) {
    headers.set("content-range", `bytes ${bytes.start}-${bytes.end}/${object.size}`);
    headers.set("content-length", String(bytes.end - bytes.start + 1));
    return new Response(request.method === "HEAD" ? null : object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

// "bytes=0-99" → {offset, length}, "bytes=100-" → {offset}, "bytes=-500" → {suffix}.
// Víc rozsahů najednou neumíme, ty se obslouží celým souborem.
function parseRange(header) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") return { suffix: Number(match[2]) };
  const offset = Number(match[1]);
  if (match[2] === "") return { offset };
  const end = Number(match[2]);
  return end >= offset ? { offset, length: end - offset + 1 } : null;
}

// Skutečné bajty podle velikosti souboru; null = rozsah mimo soubor (416)
function resolveRange(range, size) {
  if ("suffix" in range) {
    if (range.suffix === 0) return null;
    return { start: Math.max(size - range.suffix, 0), end: size - 1 };
  }
  if (range.offset >= size) return null;
  const end = range.length === undefined ? size - 1 : Math.min(range.offset + range.length, size) - 1;
  return { start: range.offset, end };
}

// ——— zámek osobní části ———

function locked() {
  return json({ zamceno: true }, 401);
}

// Kdo se ptá: { id, admin } podle podepsané cookie, jinak null.
// id je tajné id žádosti (nebo "spravce"), ven ho nikdy neposíláme.
async function viewer(request, env) {
  if (!env.PODPIS_KLIC) return null;
  const cookies = readCookies(request);
  if (await isAdmin(cookies, env)) return { id: ADMIN_ID, admin: true };
  const [id, signature] = (cookies[COOKIE.access] || "").split(".");
  if (REQUEST_ID.test(id || "") && (await verify(env, `pristup:${id}`, signature))) return { id, admin: false };
  return null;
}

// Feed a média stačí ověřit podpisem, bez dotazu do databáze
async function hasAccess(request, env) {
  return Boolean(await viewer(request, env));
}

// Zápis (příspěvek, hlas, mazání) jen pro toho, kdo je pořád v members
async function member(request, env) {
  const who = await viewer(request, env);
  if (!who) return null;
  const row = await env.DB.prepare("SELECT rowid AS num, name FROM members WHERE id = ?").bind(who.id).first();
  return row ? { ...who, num: row.num, name: row.name } : null;
}

async function isAdmin(cookies, env) {
  return Boolean(env.PODPIS_KLIC && cookies[COOKIE.admin]) && verify(env, "spravce", cookies[COOKIE.admin]);
}

// GET /osobni/stav — stránka se ptá, jestli už může načíst feed
async function accessState(request, env) {
  if (await hasAccess(request, env)) return json({ pristup: true });
  const id = readCookies(request)[COOKIE.request];
  if (!REQUEST_ID.test(id || "") || !env.PODPIS_KLIC) return json({ pristup: false });
  const approved = await env.DB.prepare("SELECT 1 FROM members WHERE id = ?").bind(id).first();
  if (!approved) return json({ pristup: false, zadost: id });
  const response = json({ pristup: true });
  response.headers.append("set-cookie", cookie(COOKIE.access, `${id}.${await sign(env, `pristup:${id}`)}`, 365 * DAY));
  response.headers.append("set-cookie", cookie(COOKIE.request, "", 0));
  return response;
}

// POST /osobni/zadost — prohlížeč si zapamatuje id žádosti, které jde v e-mailu Danovi
async function storeRequest(request, env, url) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
  if (!sameOrigin(request, url)) return json({ chyba: "origin" }, 403);
  const body = await request.json().catch(() => ({}));
  if (!REQUEST_ID.test(body.zadost || "")) return json({ chyba: "zadost" }, 400);
  const response = json({ ok: true });
  response.headers.append("set-cookie", cookie(COOKIE.request, body.zadost, 90 * DAY));
  return response;
}

// ——— vlastní feed: příspěvky, hlasy, lidé ———

// GET /osobni/prispevky — nové příspěvky, hlasy (i pro archiv) a lidé pro taby
async function listPosts(request, env) {
  const me = await member(request, env);
  if (!me) return locked();
  const [posts, votes, people] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.key, p.kind, p.caption, p.created_at, m.rowid AS author, p.author_id = ?1 AS own
       FROM posts p JOIN members m ON m.id = p.author_id ORDER BY p.created_at DESC`,
    ).bind(me.id),
    env.DB.prepare("SELECT post, COUNT(*) AS n, MAX(voter = ?1) AS mine FROM votes GROUP BY post").bind(me.id),
    env.DB.prepare("SELECT rowid AS num, name, id = ?1 AS dan FROM members ORDER BY rowid").bind(ADMIN_ID),
  ]);
  return json({
    ja: { cislo: me.num, jmeno: me.name, spravce: me.admin },
    prispevky: posts.results.map((row) => ({
      klic: row.key, druh: row.kind, popisek: row.caption, kdy: row.created_at,
      autor: row.author, muj: Boolean(row.own) || me.admin,
    })),
    hlasy: Object.fromEntries(votes.results.map((row) => [row.post, [row.n, Boolean(row.mine)]])),
    lide: people.results.map((row) => ({ cislo: row.num, jmeno: row.name, dan: Boolean(row.dan) })),
  });
}

// POST /osobni/prispevek — tělo je samotný soubor, popisek a jméno v hlavičkách
async function createPost(request, env, url) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
  if (!sameOrigin(request, url)) return json({ chyba: "origin" }, 403);
  const me = await member(request, env);
  if (!me) return locked();

  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const kind = UPLOAD_TYPES[type];
  if (!kind) return json({ chyba: "typ" }, 415);
  const length = Number(request.headers.get("content-length"));
  if (!length || !request.body) return json({ chyba: "prazdne" }, 411);
  if (length > (kind[1] === "v" ? MAX_VIDEO : MAX_IMAGE)) return json({ chyba: "velke" }, 413);
  const caption = header(request, "x-popisek").slice(0, MAX_CAPTION);
  const name = header(request, "x-jmeno").slice(0, MAX_NAME);

  const key = `${Date.now().toString(36)}-${base64url(crypto.getRandomValues(new Uint8Array(6)))}.${kind[0]}`;
  // R2 potřebuje znát délku streamu dopředu
  const { readable, writable } = new FixedLengthStream(length);
  request.body.pipeTo(writable).catch(() => {});
  await env.FEED.put(`n/${key}`, readable, { httpMetadata: { contentType: type } });

  const statements = [
    env.DB.prepare("INSERT INTO posts (key, author_id, kind, content_type, caption, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(key, me.id, kind[1], type, caption, Date.now()),
  ];
  // Vpuštěný si jméno pro svůj tab volí sám (Dan je vždy fakan)
  if (!me.admin && name && name !== me.name) {
    statements.push(env.DB.prepare("UPDATE members SET name = ? WHERE id = ?").bind(name, me.id));
  }
  try {
    await env.DB.batch(statements);
  } catch (error) {
    await env.FEED.delete(`n/${key}`);
    throw error;
  }
  return json({ ok: true, klic: key }, 201);
}

// DELETE /osobni/prispevek/<key> — smaže autor nebo Dan
async function deletePost(request, env, url, key) {
  if (request.method !== "DELETE") return new Response("Method Not Allowed", { status: 405, headers: { allow: "DELETE" } });
  if (!sameOrigin(request, url)) return json({ chyba: "origin" }, 403);
  if (!POST_KEY.test(key)) return json({ chyba: "klic" }, 404);
  const me = await member(request, env);
  if (!me) return locked();
  const post = await env.DB.prepare("SELECT author_id FROM posts WHERE key = ?").bind(key).first();
  if (!post) return json({ chyba: "neni" }, 404);
  if (post.author_id !== me.id && !me.admin) return json({ chyba: "cizi" }, 403);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM posts WHERE key = ?").bind(key),
    env.DB.prepare("DELETE FROM votes WHERE post = ?").bind(`n:${key}`),
  ]);
  await env.FEED.delete(`n/${key}`);
  return json({ ok: true });
}

// POST /osobni/hlas {post, hlas} — hlas nahoru, nebo jeho zrušení
async function vote(request, env, url) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
  if (!sameOrigin(request, url)) return json({ chyba: "origin" }, 403);
  const me = await member(request, env);
  if (!me) return locked();
  const body = await request.json().catch(() => ({}));
  const ref = String(body.post || "");
  if (!VOTE_REF.test(ref)) return json({ chyba: "post" }, 400);
  if (ref.startsWith("n:")) {
    const exists = await env.DB.prepare("SELECT 1 FROM posts WHERE key = ?").bind(ref.slice(2)).first();
    if (!exists) return json({ chyba: "neni" }, 404);
  }
  const change = body.hlas
    ? env.DB.prepare("INSERT OR IGNORE INTO votes (post, voter, created_at) VALUES (?, ?, ?)").bind(ref, me.id, Date.now())
    : env.DB.prepare("DELETE FROM votes WHERE post = ? AND voter = ?").bind(ref, me.id);
  const [, count] = await env.DB.batch([change, env.DB.prepare("SELECT COUNT(*) AS n FROM votes WHERE post = ?").bind(ref)]);
  return json({ hlasy: count.results[0].n, muj: Boolean(body.hlas) });
}

// Hlavička s textem z formuláře (klient ji posílá přes encodeURIComponent)
function header(request, name) {
  try {
    return decodeURIComponent(request.headers.get(name) || "").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

// /pustit/<id> — odkaz z e-mailu. Dan potvrdí tlačítkem, poprvé na daném zařízení i heslem.
async function approvePage(request, env, url, id) {
  if (!REQUEST_ID.test(id)) return page("Neplatný odkaz", "<p>Tenhle odkaz nevede na žádnou žádost.</p>", 404);
  if (!env.PODPIS_KLIC || !env.SPRAVCE_KLIC) {
    return page("Zámek není nastavený", "<p>Chybí klíče <code>PODPIS_KLIC</code> a <code>SPRAVCE_KLIC</code> ve Workeru.</p>", 503);
  }
  const cookies = readCookies(request);
  let admin = await isAdmin(cookies, env);
  const headers = new Headers();
  let error = "";

  if (request.method === "POST") {
    if (!sameOrigin(request, url)) return page("Nepovoleno", "<p>Formulář musí přijít z fakan.cz.</p>", 403);
    const form = await request.formData().catch(() => new FormData());
    if (!admin && (await passwordMatches(String(form.get("klic") || ""), env.SPRAVCE_KLIC))) {
      admin = true;
      headers.append("set-cookie", cookie(COOKIE.admin, await sign(env, "spravce"), 365 * DAY));
    } else if (!admin) {
      error = '<p class="error" role="alert">Heslo nesedí.</p>';
    }
    if (admin) {
      const name = String(form.get("jmeno") || "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
      await env.DB.prepare(
        `INSERT INTO members (id, name, approved_at) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = CASE WHEN excluded.name = '' THEN members.name ELSE excluded.name END`,
      ).bind(id, name, Date.now()).run();
      return page("Je vpuštěný", `<p>Hotovo, pustil jsi ho dál. Jestli má fakan.cz/osobni otevřené, feed se mu
        během chvíle načte sám. Jinak ho uvidí, až se vrátí ve stejném prohlížeči.</p>
        <p class="muted">Žádost ${id}</p>`, 200, headers);
    }
  } else if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, POST" } });
  }

  if (admin && (await env.DB.prepare("SELECT 1 FROM members WHERE id = ?").bind(id).first())) {
    return page("Už je vpuštěný", `<p>Tuhle žádost jsi už schválil.</p><p class="muted">Žádost ${id}</p>`);
  }
  // Od koho žádost je, víme jen když prošla přes jsem@fakan.cz; Danovi to ukážeme až po přihlášení
  const sender = admin ? await env.DB.prepare("SELECT email, name FROM requests WHERE id = ?").bind(id).first() : null;
  const from = sender
    ? `<p>Žádost poslal <b>${escapeHtml(sender.name || sender.email)}</b>${sender.name ? ` <span class="muted">${escapeHtml(sender.email)}</span>` : ""}.</p>`
    : "<p>Někdo tě prosí o přístup do osobní části fakan.cz. Kdo to je, vidíš v&nbsp;e-mailu, ze kterého jsi přišel.</p>";
  const password = admin ? "" : `
      <input type="text" name="username" value="dan" autocomplete="username" hidden>
      <label>Tvoje heslo pro fakan.cz
        <input type="password" name="klic" autocomplete="current-password" required autofocus></label>`;
  return page("Pustit dál?", `
    ${from}
    ${error}
    <form method="post">${password}
      <label><span>Kdo to je <span class="muted">(jméno v&nbsp;tabu, může si ho změnit)</span></span>
        <input type="text" name="jmeno" maxlength="${MAX_NAME}" placeholder="např. Petr" autocomplete="off"
          value="${escapeHtml(sender?.name?.split(" ")[0] || "")}"></label>
      <button type="submit">Pustit dál</button>
    </form>
    <p class="muted">Když ho pustit nechceš, stačí stránku zavřít. Žádost ${id}</p>`, error ? 403 : 200, headers);
}

// /spravce — Dan se přihlásí a má přístup k feedu i bez žádosti
async function adminPage(request, env, url) {
  if (!env.PODPIS_KLIC || !env.SPRAVCE_KLIC) {
    return page("Zámek není nastavený", "<p>Chybí klíče <code>PODPIS_KLIC</code> a <code>SPRAVCE_KLIC</code> ve Workeru.</p>", 503);
  }
  let error = "";
  if (request.method === "POST") {
    if (!sameOrigin(request, url)) return page("Nepovoleno", "<p>Formulář musí přijít z fakan.cz.</p>", 403);
    const form = await request.formData().catch(() => new FormData());
    if (await passwordMatches(String(form.get("klic") || ""), env.SPRAVCE_KLIC)) {
      const headers = new Headers({ location: "/osobni" });
      headers.append("set-cookie", cookie(COOKIE.admin, await sign(env, "spravce"), 365 * DAY));
      return new Response(null, { status: 303, headers });
    }
    error = '<p class="error" role="alert">Heslo nesedí.</p>';
  } else if (await isAdmin(readCookies(request), env)) {
    return page("Jsi přihlášený", '<p>Na tomhle zařízení máš přístup. <a href="/osobni">Do feedu</a></p>');
  }
  return page("Přihlášení", `
    ${error}
    <form method="post">
      <input type="text" name="username" value="dan" autocomplete="username" hidden>
      <label>Heslo pro fakan.cz
        <input type="password" name="klic" autocomplete="current-password" required autofocus></label>
      <button type="submit">Přihlásit</button>
    </form>`, error ? 403 : 200);
}

function page(title, body, status = 200, headers = new Headers()) {
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex");
  headers.set("content-security-policy", ADMIN_CSP);
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  const html = `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · fakan</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #000; color: #f2f2f2;
      font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    main { width: min(420px, 100% - 32px); padding: 28px; border: 1px solid #232327; border-radius: 14px; background: #0b0b0d; }
    h1 { margin: 0 0 12px; font-size: 22px; letter-spacing: -.01em; }
    p { margin: 0 0 14px; }
    a { color: #b899ff; }
    label { display: grid; gap: 6px; margin-bottom: 14px; font-size: 14px; color: #c9c9cf; }
    input { padding: 11px 12px; border: 1px solid #34343a; border-radius: 9px; background: #000; color: inherit; font: inherit; }
    button { width: 100%; padding: 12px 16px; border: 0; border-radius: 10px; background: #f2f2f2; color: #000;
      font-family: inherit; font-size: 15px; font-weight: 600; line-height: 1; cursor: pointer; }
    form { margin: 0 0 14px; }
    .muted { color: #9a9aa2; font-size: 13px; }
    .error { color: #ff8f8f; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    ${body}
  </main>
</body>
</html>`;
  return new Response(html, { status, headers });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

// Text e-mailu i s dekódovanými částmi (base64, quoted-printable), ať se najde odkaz na žádost
function mimeText(raw) {
  const texts = [raw, raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))];
  const base64Parts = /content-transfer-encoding:[ \t]*base64[^\n]*\n(?:[^\r\n]+\r?\n)*?\r?\n((?:[A-Za-z0-9+/=]+\r?\n?)+)/gi;
  for (const part of raw.matchAll(base64Parts)) {
    try {
      const bytes = Uint8Array.from(atob(part[1].replace(/\s+/g, "")), (char) => char.charCodeAt(0));
      texts.push(new TextDecoder().decode(bytes));
    } catch {}
  }
  return texts.join("\n");
}

// "Petr Novák <petr@example.com>" → { name, email }; jméno může být v RFC 2047 (=?UTF-8?B?…?=)
function parseAddress(header) {
  if (!header) return null;
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>\s]+@[^>\s]+)>\s*$/.exec(header) || /^\s*([^\s<>]+@[^\s<>]+)\s*$/.exec(header);
  if (!match) return null;
  const email = match[2] || match[1];
  const name = match[2] ? decodeWords(match[1] || "").trim() : "";
  return { email, name };
}

function decodeWords(text) {
  return text.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (whole, charset, encoding, data) => {
    try {
      const binary = encoding.toLowerCase() === "b"
        ? atob(data)
        : data.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      return new TextDecoder(charset).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    } catch {
      return whole;
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

// Formuláře a žádosti jen ze stejné domény (prohlížeč posílá Origin u POST)
function sameOrigin(request, url) {
  const origin = request.headers.get("origin");
  return !origin || origin === url.origin;
}

function readCookies(request) {
  const cookies = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

const encoder = new TextEncoder();
let signingKey = null;

async function sign(env, message) {
  if (!signingKey || signingKey.secret !== env.PODPIS_KLIC) {
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(env.PODPIS_KLIC), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    signingKey = { secret: env.PODPIS_KLIC, key };
  }
  const signature = await crypto.subtle.sign("HMAC", signingKey.key, encoder.encode(message));
  return base64url(new Uint8Array(signature));
}

async function verify(env, message, signature) {
  if (!signature) return false;
  return timingSafeEqual(await sign(env, message), signature);
}

// Heslo porovnáváme přes otisk, ať délka ani obsah neprosakují časem odpovědi
async function passwordMatches(given, expected) {
  const [a, b] = await Promise.all([given, expected].map((text) => crypto.subtle.digest("SHA-256", encoder.encode(text))));
  return crypto.subtle.timingSafeEqual(a, b);
}

function timingSafeEqual(a, b) {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  return left.length === right.length && crypto.subtle.timingSafeEqual(left, right);
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function withHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
