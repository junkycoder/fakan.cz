// fakan.cz — statika z public/ + média osobního feedu z R2 (bucket justpost-media).
// Worker jen čte, do R2 nic nezapisuje.
//
// Osobní část je zamčená. Návštěvník pošle Danovi e-mail s odkazem /pustit/<id>,
// Dan odkaz otevře, potvrdí a člověk se zapíše do D1 (members). Prohlížeč
// návštěvníka se pak ptá na /osobni/stav a dostane podepsanou cookie s přístupem.
// Vpuštění (i Dan) přidávají příspěvky (média v R2 fakan-feed) a hlasují.
//
// Pošta na jsem@fakan.cz chodí sem (Email Routing → Worker). Žádost o přístup se
// zapíše do D1 (requests). Přišla-li z adresy, kterou Dan už jednou pustil (emails),
// a sedí DKIM podpis, zařízení se pustí samo (devices). Jinak Danovi odejde
// oznámení s tlačítkem Pustit dál (binding OZNAMENI). Ostatní zprávy se Danovi
// přepošlou. Danova adresa je v secretu PRESMEROVAT_NA (ověřená v Email Routing).

import { EmailMessage } from "cloudflare:email";

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
const SITE = "https://fakan.cz";
const NOTIFY_FROM = "jsem@fakan.cz";
const MAX_QUOTED = 2000;
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
  // jsem@fakan.cz: známou ověřenou adresu pustit, jinak žádost oznámit Danovi, ostatní přeposlat
  async email(message, env) {
    if (!env.PRESMEROVAT_NA) {
      message.setReject("Schránka jsem@fakan.cz teď nepřijímá poštu.");
      return;
    }
    try {
      const bytes = message.rawSize <= MAX_PARSED_EMAIL ? new Uint8Array(await new Response(message.raw).arrayBuffer()) : null;
      const raw = bytes ? new TextDecoder().decode(bytes) : "";
      const match = REQUEST_LINK.exec(mimeText(raw));
      if (match) {
        const id = match[1];
        const sender = parseAddress(message.headers.get("from")) || { email: message.from, name: "" };
        const email = sender.email.toLowerCase().slice(0, 200);
        const verified = await dkimVerified(binaryString(bytes), email, env);
        const known = verified
          ? await env.DB.prepare("SELECT member_id FROM emails WHERE email = ?").bind(email).first()
          : null;
        console.log("zadost e-mailem", { domena: email.split("@")[1], dkim: verified, znamy: Boolean(known) });
        const statements = [
          env.DB.prepare(
            `INSERT INTO requests (id, email, name, received_at, verified) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = excluded.name,
               received_at = excluded.received_at, verified = excluded.verified`,
          ).bind(id, email, sender.name.slice(0, MAX_NAME), Date.now(), verified ? 1 : 0),
        ];
        // Známý člověk na dalším zařízení: pustit bez Dana
        if (known) statements.push(approveDevice(env, id, known.member_id, true));
        await env.DB.batch(statements);
        if (known) return;
        // Vlastní oznámení místo přeposlání: má nové Message-ID, takže ho Gmail ukáže,
        // i když žádost poslal Dan sám sobě, a tlačítko Pustit dál je hned nahoře
        const notice = requestNotice(id, sender, plainBody(raw), env.PRESMEROVAT_NA, verified);
        await env.OZNAMENI.send(new EmailMessage(NOTIFY_FROM, env.PRESMEROVAT_NA, notice));
        return;
      }
    } catch (error) {
      // Když oznámení nevyjde, Dan dostane aspoň původní zprávu
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
    if (url.pathname.startsWith("/p/")) return sharedPost(request, env, url);
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

// Kdo se ptá podle podepsané cookie: { admin: true } (Dan přes /spravce),
// { device } (vpuštěné zařízení), jinak null. Id zařízení je tajné, ven ho neposíláme.
async function viewer(request, env) {
  if (!env.PODPIS_KLIC) return null;
  const cookies = readCookies(request);
  if (await isAdmin(cookies, env)) return { admin: true };
  const [id, signature] = (cookies[COOKIE.access] || "").split(".");
  if (REQUEST_ID.test(id || "") && (await verify(env, `pristup:${id}`, signature))) return { device: id };
  return null;
}

// Feed a média stačí ověřit podpisem, bez dotazu do databáze
async function hasAccess(request, env) {
  return Boolean(await viewer(request, env));
}

// Člověk za zařízením. Zápis (příspěvek, hlas, mazání) jen pro toho, kdo je pořád v devices.
async function member(request, env) {
  const who = await viewer(request, env);
  if (!who) return null;
  const row = who.admin
    ? await env.DB.prepare("SELECT rowid AS num, id, name FROM members WHERE id = ?").bind(ADMIN_ID).first()
    : await env.DB.prepare(
      "SELECT m.rowid AS num, m.id, m.name FROM devices d JOIN members m ON m.id = d.member_id WHERE d.id = ?",
    ).bind(who.device).first();
  return row ? { id: row.id, num: row.num, name: row.name, admin: row.id === ADMIN_ID } : null;
}

async function isAdmin(cookies, env) {
  return Boolean(env.PODPIS_KLIC && cookies[COOKIE.admin]) && verify(env, "spravce", cookies[COOKIE.admin]);
}

// Zařízení (id žádosti) patří člověku; auto = pustilo se samo podle ověřené adresy
function approveDevice(env, id, memberId, auto) {
  return env.DB.prepare(
    `INSERT INTO devices (id, member_id, approved_at, auto) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET member_id = excluded.member_id`,
  ).bind(id, memberId, Date.now(), auto ? 1 : 0);
}

// GET /osobni/stav — stránka se ptá, jestli už může načíst feed
async function accessState(request, env) {
  if (await hasAccess(request, env)) return json({ pristup: true });
  const id = readCookies(request)[COOKIE.request];
  if (!REQUEST_ID.test(id || "") || !env.PODPIS_KLIC) return json({ pristup: false });
  const device = await env.DB.prepare("SELECT member_id FROM devices WHERE id = ?").bind(id).first();
  if (!device) return json({ pristup: false, zadost: id });
  const response = json({ pristup: true });
  response.headers.append("set-cookie", cookie(COOKIE.access, `${id}.${await sign(env, `pristup:${id}`)}`, 365 * DAY));
  response.headers.append("set-cookie", cookie(COOKIE.request, "", 0));
  // Danovo zařízení umí rovnou i schvalovat
  if (device.member_id === ADMIN_ID) {
    response.headers.append("set-cookie", cookie(COOKIE.admin, await sign(env, "spravce"), 365 * DAY));
  }
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

// ——— sdílený kousek: fakan.cz/p/<id> ———
// Veřejná stránka jednoho memu s OG náhledem (WhatsApp, iMessage, Messenger…).
// Id je 9GAG id (archiv) nebo náhodný klíč nového příspěvku, ne pořadové číslo,
// takže se přes /p/ nedá projít celý feed. Kdo má přístup, skončí rovnou ve feedu.

const SHARE_ID = /^([A-Za-z0-9]{5,12}|[a-z0-9]{8,10}-[A-Za-z0-9_-]{8})$/;
const PUBLIC_CSP =
  "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
let archiveIndex = null;

async function sharedPost(request, env, url) {
  const [, , id, part, extra] = url.pathname.split("/");
  if (!SHARE_ID.test(id || "") || extra !== undefined || (part !== undefined && part !== "media")) {
    return new Response("Not Found", { status: 404 });
  }
  const post = await findShared(env, url, id);
  if (!post) return sharePage(url, null, 404);

  if (part === "media") {
    const response = await serveMedia(request, post.bucket, post.key);
    if (response.status === 200 || response.status === 206) response.headers.set("cache-control", "public, max-age=86400");
    return response;
  }
  // Vpuštěný člověk patří do feedu, rovnou k tomu kousku
  if (await hasAccess(request, env)) return Response.redirect(new URL(`/osobni#${post.anchor}`, url), 302);
  return sharePage(url, { ...post, id });
}

async function findShared(env, url, id) {
  if (id.includes("-")) {
    const keys = Object.values(UPLOAD_TYPES).map(([ext]) => `${id}.${ext}`);
    const row = await env.DB.prepare(
      `SELECT p.key, p.kind, p.content_type, p.caption, m.name, m.id AS member FROM posts p JOIN members m ON m.id = p.author_id
       WHERE p.key IN (${keys.map(() => "?").join(", ")})`,
    ).bind(...keys).first();
    if (!row) return null;
    return {
      bucket: env.FEED, key: `n/${row.key}`, kind: row.kind, type: row.content_type, caption: row.caption,
      author: row.member === ADMIN_ID ? "fakan" : row.name || "host", anchor: `n-${id}`,
      meta: row.member === ADMIN_ID ? "" : `od ${row.name || "host"}`,
    };
  }
  // Archiv: 9GAG id → položka z feed.json (načtený jednou za běh isolate)
  if (!archiveIndex) {
    const response = await env.ASSETS.fetch(new Request(new URL("/feed.json", url)));
    const items = response.ok ? (await response.json()).items || [] : [];
    archiveIndex = new Map(items.map((item) => [item[1], item]));
  }
  const item = archiveIndex.get(id);
  if (!item) return null;
  const [index, , kind, ext] = item;
  const extension = ext || (kind === "v" ? "mp4" : "jpg");
  return {
    bucket: env.MEDIA, key: `${MEDIA_PREFIX}${String(index).padStart(4, "0")}_${id}.${extension}`, kind,
    type: kind === "v" ? "video/mp4" : `image/${extension === "jpg" ? "jpeg" : extension}`,
    caption: "", author: "fakan", anchor: `p-${index}`, meta: "z archivu 9GAG",
  };
}

function sharePage(url, post, status = 200) {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": PUBLIC_CSP,
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex",
    "cache-control": "public, max-age=300",
  });
  const title = post ? (post.caption || "Meme z fakan.cz") : "Tenhle kousek tu už není";
  const description = post
    ? "Kousek z fakan.cz, osobního feedu Dana Hromady a lidí, které pustil dál."
    : "Možná ho autor smazal.";
  const media = post ? `${url.origin}/p/${post.id}/media` : "";
  const og = post
    ? post.kind === "v"
      ? `<meta property="og:type" content="video.other">
  <meta property="og:video" content="${media}">
  <meta property="og:video:secure_url" content="${media}">
  <meta property="og:video:type" content="${post.type}">
  <meta name="twitter:card" content="player">`
      : `<meta property="og:type" content="article">
  <meta property="og:image" content="${media}">
  <meta property="og:image:type" content="${post.type}">
  <meta property="og:image:alt" content="${escapeHtml(title)}">
  <meta name="twitter:card" content="summary_large_image">`
    : "";
  const figure = post
    ? post.kind === "v"
      ? `<video src="/p/${post.id}/media" controls playsinline loop muted autoplay preload="metadata"></video>`
      : `<img src="/p/${post.id}/media" alt="${escapeHtml(title)}">`
    : "";
  const html = `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(title)} · fakan</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:site_name" content="fakan.cz">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${post ? `${url.origin}/p/${post.id}` : url.origin}">
  <meta property="og:locale" content="cs_CZ">
  ${og}
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    :root { color-scheme: light dark; --bg: #fff; --fg: #15151a; --muted: #6b6b73; --line: #e6e5df; --field: #d6d5ce;
      --card: #f4f3ef; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #000; --fg: #f2f2f2; --muted: #9a9aa2; --line: #232327; --field: #34343a; --card: #141416; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100dvh; background: var(--bg); color: var(--fg);
      font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    main { max-width: 600px; margin: 0 auto; padding: max(20px, env(safe-area-inset-top)) 0 40px; }
    .head { display: flex; align-items: center; gap: 9px; padding: 0 16px 14px; font-size: 14px; }
    .avatar { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--fg); color: var(--bg);
      font: 700 13px/1 ui-monospace, Menlo, monospace; }
    .head a { color: inherit; font-weight: 600; text-decoration: none; }
    .muted { color: var(--muted); }
    h1 { margin: 0; padding: 0 16px 12px; font-size: 19px; line-height: 1.3; overflow-wrap: anywhere; }
    figure { margin: 0; background: #0d0d0f; }
    img, video { display: block; width: 100%; height: auto; max-height: 80dvh; object-fit: contain; }
    .invite { margin: 18px 16px 0; padding: 22px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); }
    .invite p { margin: 0 0 14px; color: var(--muted); }
    .invite b { color: var(--fg); }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .btn { display: inline-flex; padding: 12px 18px; border-radius: 10px; background: var(--fg); color: var(--bg); font-weight: 600;
      text-decoration: none; }
    .btn.ghost { background: transparent; color: var(--fg); border: 1px solid var(--field); }
    @media (min-width: 640px) { figure { border-radius: 12px; overflow: hidden; } .head, h1 { padding-left: 0; padding-right: 0; }
      .invite { margin-left: 0; margin-right: 0; } }
  </style>
</head>
<body>
  <main>
    <header class="head"><span class="avatar" aria-hidden="true">f</span><a href="/osobni">fakan</a>
      <span class="muted">${post ? escapeHtml(post.meta) : ""}</span></header>
    ${post?.caption ? `<h1>${escapeHtml(post.caption)}</h1>` : ""}
    ${figure ? `<figure>${figure}</figure>` : ""}
    <section class="invite">
      <p><b>${post ? "Tohle je kousek z&nbsp;fakan.cz." : "Tenhle kousek tu už není."}</b> Je to můj osobní feed s&nbsp;memy
        a&nbsp;příspěvky lidí, které jsem pustil dál. Dovnitř pouštím jen známé, stačí napsat.</p>
      <div class="actions">
        <a class="btn" href="/osobni">Chci víc</a>
        ${post ? `<a class="btn ghost" href="/p/${post.id}/media" download>stáhnout</a>` : ""}
      </div>
    </section>
  </main>
</body>
</html>`;
  return new Response(html, { status, headers });
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

// /pustit/<id> — odkaz z oznámení. Nepřihlášeného Dana pošle nejdřív na přihlášení,
// pak Dan vybere, kdo to je (nový člověk, někdo známý, nebo on sám), a potvrdí.
async function approvePage(request, env, url, id) {
  if (!REQUEST_ID.test(id)) return page("Neplatný odkaz", "<p>Tenhle odkaz nevede na žádnou žádost.</p>", 404);
  if (!env.PODPIS_KLIC || !env.SPRAVCE_KLIC) {
    return page("Zámek není nastavený", "<p>Chybí klíče <code>PODPIS_KLIC</code> a <code>SPRAVCE_KLIC</code> ve Workeru.</p>", 503);
  }
  if (!(await isAdmin(readCookies(request), env))) {
    if (request.method !== "GET" && request.method !== "HEAD") return page("Nepovoleno", "<p>Nejdřív se přihlas.</p>", 403);
    return loginPage(`/pustit/${id}`, "<p>Někdo tě prosí o&nbsp;přístup do osobní části fakan.cz. Přihlas se a uvidíš, kdo to je.</p>");
  }

  const sender = await env.DB.prepare(
    "SELECT r.email, r.name, r.verified, e.member_id FROM requests r LEFT JOIN emails e ON e.email = r.email WHERE r.id = ?",
  ).bind(id).first();
  // Jméno do tabu se nepíše: vezme se křestní jméno z e-mailu, změnit si ho může sám
  const newName = (sender?.name || "").split(" ")[0].slice(0, MAX_NAME);
  let error = "";

  if (request.method === "POST") {
    if (!sameOrigin(request, url)) return page("Nepovoleno", "<p>Formulář musí přijít z fakan.cz.</p>", 403);
    const form = await request.formData().catch(() => new FormData());
    const choice = String(form.get("kdo") || "novy");
    const existing = choice === "novy"
      ? null
      : await env.DB.prepare("SELECT id, name FROM members WHERE rowid = ?").bind(Number(choice) || 0).first();
    if (choice !== "novy" && !existing) {
      error = '<p class="error" role="alert">Tohoto člověka už nenacházím. Vyber znovu.</p>';
    } else {
      const memberId = existing ? existing.id : id;
      const statements = [];
      if (!existing) {
        statements.push(env.DB.prepare("INSERT INTO members (id, name, approved_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING")
          .bind(id, newName, Date.now()));
      }
      statements.push(approveDevice(env, id, memberId, false));
      // Ověřenou adresu si zapamatujeme: příští zařízení z ní projde samo
      statements.push(env.DB.prepare(
        `INSERT INTO emails (email, member_id, added_at)
         SELECT email, ?, ? FROM requests WHERE id = ? AND verified = 1
         ON CONFLICT (email) DO UPDATE SET member_id = excluded.member_id`,
      ).bind(memberId, Date.now(), id));
      await env.DB.batch(statements);
      const remembered = sender?.verified
        ? `<p>${memberId === ADMIN_ID ? "Tvoji" : "Jeho"} adresu si pamatuju, další zařízení z&nbsp;ní pustím sám.</p>`
        : "";
      const done = memberId === ADMIN_ID
        ? "<p>Hotovo, tohle zařízení je tvoje. Jestli máš fakan.cz/osobni otevřené, feed se během chvíle načte sám.</p>"
        : `<p>Hotovo, pustil jsi ho dál. Jestli má fakan.cz/osobni otevřené, feed se mu během chvíle načte sám.
           Jinak ho uvidí, až se vrátí ve stejném prohlížeči.</p>`;
      return page(memberId === ADMIN_ID ? "Jsi uvnitř" : "Je vpuštěný",
        `${done}${remembered}<a class="go" href="/osobni">Do feedu</a><p class="muted">Žádost ${id}</p>`);
    }
  } else if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, POST" } });
  }

  const approved = await env.DB.prepare(
    "SELECT m.name, m.id FROM devices d JOIN members m ON m.id = d.member_id WHERE d.id = ?",
  ).bind(id).first();
  if (approved) {
    const who = approved.id === ADMIN_ID ? "tvoje zařízení" : escapeHtml(approved.name || "host");
    return page("Už je vpuštěný",
      `<p>Tuhle žádost už máš vyřízenou: ${who}.</p><a class="go" href="/osobni">Do feedu</a><p class="muted">Žádost ${id}</p>`);
  }
  const people = (await env.DB.prepare("SELECT rowid AS num, id, name FROM members ORDER BY rowid").all()).results;
  const from = sender
    ? `<p>Žádost poslal <b>${escapeHtml(sender.name || sender.email)}</b>${sender.name ? ` <span class="muted">${escapeHtml(sender.email)}</span>` : ""}.</p>
       ${sender.verified ? "" : '<p class="error">Adresu odesílatele se nepodařilo ověřit (chybí platný podpis DKIM), mohl ji někdo podvrhnout. Pusť ho, jen když víš, že je to on.</p>'}`
    : "<p>Někdo tě prosí o přístup do osobní části fakan.cz. Kdo to je, vidíš v&nbsp;e-mailu, ze kterého jsi přišel.</p>";
  // Předvybrat jen u ověřené adresy, podvržená nesmí nabídnout cizí účet
  const preselect = sender?.verified ? sender.member_id : null;
  const choice = (value, label, checked) =>
    `<label class="choice"><input type="radio" name="kdo" value="${value}"${checked ? " checked" : ""}><span>${label}</span></label>`;
  const choices = [
    choice("novy", `nový člověk${newName ? ` <span class="muted">(v&nbsp;tabu jako ${escapeHtml(newName)})</span>` : ""}`, !preselect),
    ...people
      .sort((a, b) => (b.id === ADMIN_ID) - (a.id === ADMIN_ID))
      .map((person) => choice(person.num, person.id === ADMIN_ID ? "já (fakan)" : escapeHtml(person.name || "host"), person.id === preselect)),
  ].join("");
  return page("Pustit dál?", `
    ${from}
    ${error}
    <form method="post">
      <fieldset><legend>Kdo to je</legend>${choices}</fieldset>
      <button type="submit">Pustit dál</button>
    </form>
    <p class="muted">Když ho pustit nechceš, stačí stránku zavřít. Žádost ${id}</p>`, error ? 400 : 200);
}

// Přihlašovací formulář, jak ho poznají iOS a správci hesel: viditelný uživatel + heslo
function loginPage(next, intro = "", error = "", status = 200) {
  return page("Přihlášení", `
    ${intro}
    ${error}
    <form method="post" action="/spravce">
      <input type="hidden" name="dalsi" value="${escapeHtml(next)}">
      <label><span>Uživatel</span>
        <input type="text" name="username" value="dan" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
      <label><span>Heslo</span>
        <input type="password" name="klic" autocomplete="current-password" required></label>
      <button type="submit">Přihlásit</button>
    </form>`, status);
}

// /spravce — Dan se přihlásí (a vrátí se, odkud přišel) a má přístup k feedu i bez žádosti
async function adminPage(request, env, url) {
  if (!env.PODPIS_KLIC || !env.SPRAVCE_KLIC) {
    return page("Zámek není nastavený", "<p>Chybí klíče <code>PODPIS_KLIC</code> a <code>SPRAVCE_KLIC</code> ve Workeru.</p>", 503);
  }
  if (request.method === "POST") {
    if (!sameOrigin(request, url)) return page("Nepovoleno", "<p>Formulář musí přijít z fakan.cz.</p>", 403);
    const form = await request.formData().catch(() => new FormData());
    // Vrátit jen na vlastní stránky, ne na libovolnou adresu
    const requested = String(form.get("dalsi") || "");
    const next = /^\/(pustit\/[A-Za-z0-9_-]{22}|osobni)$/.test(requested) ? requested : "/osobni";
    if (await passwordMatches(String(form.get("klic") || ""), env.SPRAVCE_KLIC)) {
      const headers = new Headers({ location: next });
      headers.append("set-cookie", cookie(COOKIE.admin, await sign(env, "spravce"), 365 * DAY));
      return new Response(null, { status: 303, headers });
    }
    return loginPage(next, "", '<p class="error" role="alert">Heslo nesedí.</p>', 403);
  }
  if (await isAdmin(readCookies(request), env)) {
    return page("Jsi přihlášený", '<p>Na tomhle zařízení máš přístup.</p><a class="go" href="/osobni">Do feedu</a>');
  }
  return loginPage("/osobni");
}

function page(title, body, status = 200, headers = new Headers()) {
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex");
  headers.set("content-security-policy", ADMIN_CSP);
  // same-origin: adresa s id žádosti neodejde jinam, ale formulář dostane Origin (u no-referrer by byl "null")
  headers.set("referrer-policy", "same-origin");
  headers.set("x-content-type-options", "nosniff");
  const html = `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · fakan</title>
  <style>
    /* Světlé i tmavé podle systému, stejně jako osobní feed */
    :root { color-scheme: light dark; --bg: #fff; --fg: #15151a; --muted: #6b6b73; --line: #e6e5df; --field: #d6d5ce;
      --card: #f4f3ef; --accent: #2a018a; --picked: #ece8f8; --error: #b3261e; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #000; --fg: #f2f2f2; --muted: #9a9aa2; --line: #232327; --field: #34343a; --card: #0b0b0d;
        --accent: #b899ff; --picked: #17132a; --error: #ff8f8f; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 16px;
      background: var(--bg); color: var(--fg); font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    main { width: 100%; max-width: 440px; padding: 24px; border: 1px solid var(--line); border-radius: 14px; background: var(--card);
      overflow-wrap: anywhere; }
    h1 { margin: 0 0 12px; font-size: 22px; letter-spacing: -.01em; }
    p { margin: 0 0 14px; }
    a { color: var(--accent); }
    label { display: grid; gap: 6px; margin-bottom: 14px; font-size: 14px; color: var(--muted); }
    input[type="text"], input[type="password"] { width: 100%; padding: 11px 12px; border: 1px solid var(--field); border-radius: 9px;
      background: var(--bg); color: var(--fg); font: inherit; }
    fieldset { margin: 0 0 16px; padding: 0; border: 0; }
    legend { margin-bottom: 8px; padding: 0; font-size: 14px; color: var(--muted); }
    .choice { display: flex; align-items: center; gap: 12px; margin: 0 0 8px; padding: 13px 14px; border: 1px solid var(--field);
      border-radius: 10px; color: var(--fg); font-size: 16px; cursor: pointer; }
    .choice:has(input:checked) { border-color: var(--accent); background: var(--picked); }
    .choice input { width: 20px; height: 20px; margin: 0; accent-color: var(--accent); flex: none; }
    button { width: 100%; padding: 12px 16px; border: 0; border-radius: 10px; background: var(--fg); color: var(--bg);
      font-family: inherit; font-size: 15px; font-weight: 600; line-height: 1; cursor: pointer; }
    form { margin: 0 0 14px; }
    .muted { color: var(--muted); font-size: 13px; }
    .error { color: var(--error); }
    .home { display: inline-flex; align-items: center; gap: 8px; margin: 0 0 16px; color: var(--fg); font-weight: 600;
      font-size: 14px; text-decoration: none; }
    .home::before { content: "f"; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%;
      background: var(--fg); color: var(--bg); font: 700 12px/1 ui-monospace, Menlo, monospace; }
    .go { display: block; margin: 4px 0 14px; padding: 12px 16px; border-radius: 10px; background: var(--fg); color: var(--bg);
      font-weight: 600; text-align: center; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <a class="home" href="/osobni">fakan</a>
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

// Text, který žadatel napsal (část text/plain), bez podpisu s odkazem pro Dana
function plainBody(raw) {
  for (const block of raw.split(/\r?\n--[^\r\n]*\r?\n/)) {
    const split = block.search(/\r?\n\r?\n/);
    if (split < 0) continue;
    const head = block.slice(0, split);
    const type = /content-type:[ \t]*([^;\s]+)/i.exec(head)?.[1].toLowerCase();
    if (type && type !== "text/plain") continue;
    if (!type && !/^(from|to|subject|date|mime-version|content-transfer-encoding):/im.test(head)) continue;
    let body = block.slice(split).replace(/^\s+/, "");
    const encoding = /content-transfer-encoding:[ \t]*([\w-]+)/i.exec(head)?.[1].toLowerCase();
    try {
      if (encoding === "base64") body = utf8(atob(body.replace(/\s+/g, "")));
      else if (encoding === "quoted-printable") body = utf8(qpBinary(body));
    } catch {
      continue;
    }
    return body
      .replace(/\r\n/g, "\n")
      .split(/\n-- ?\n|\nOdkaz pro Dana/)[0]
      .replace("(napiš, kdo jsi a odkud se známe)", "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_QUOTED);
  }
  return "";
}

// Quoted-printable → bajty jako znaky (dekódují se až jako UTF-8)
function qpBinary(text) {
  const bytes = encodeURIComponent(text.replace(/=\r?\n/g, "")).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return bytes.replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function utf8(binary) {
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

// Oznámení Danovi: text i HTML s tlačítkem, odpověď jde rovnou žadateli
// ——— DKIM: e-mail opravdu poslala doména odesílatele (RFC 6376, rsa-sha256) ———

const dkimKeys = new Map();

async function dkimVerified(binary, fromEmail, env) {
  const domain = fromEmail.split("@")[1];
  if (!binary || !domain) return false;
  const message = binary.replace(/\r?\n/g, "\r\n");
  const end = message.indexOf("\r\n\r\n");
  if (end < 0) return false;
  const headers = parseHeaders(message.slice(0, end));
  const body = message.slice(end + 4);
  for (const header of headers.filter((entry) => entry.name === "dkim-signature")) {
    try {
      if (await verifyDkim(header, headers, body, domain, env)) return true;
    } catch (error) {
      console.error("dkim", error);
    }
  }
  return false;
}

// Hlavičky i se zalomenými řádky, tak jak přišly (kvůli kanonizaci "simple")
function parseHeaders(block) {
  const headers = [];
  for (const line of block.split("\r\n")) {
    if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1].raw += `\r\n${line}`;
    else if (line.includes(":")) headers.push({ raw: line });
  }
  for (const header of headers) header.name = header.raw.slice(0, header.raw.indexOf(":")).trim().toLowerCase();
  return headers;
}

async function verifyDkim(header, headers, body, fromDomain, env) {
  const tags = {};
  for (const part of header.raw.slice(header.raw.indexOf(":") + 1).split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) tags[part.slice(0, eq).trim()] = part.slice(eq + 1).replace(/\s+/g, "");
  }
  if (tags.v !== "1" || tags.a?.toLowerCase() !== "rsa-sha256" || !tags.d || !tags.s || !tags.b || !tags.bh || !tags.h) return false;
  // Podpis musí patřit doméně z From (nebo její nadřazené doméně)
  const signer = tags.d.toLowerCase();
  if (fromDomain !== signer && !fromDomain.endsWith(`.${signer}`)) return false;
  const signed = tags.h.toLowerCase().split(":").filter(Boolean);
  if (!signed.includes("from")) return false;
  if (tags.x && Number(tags.x) * 1000 < Date.now()) return false;
  const [headerMode, bodyMode = "simple"] = (tags.c || "simple/simple").toLowerCase().split("/");

  let canonicalBody = bodyMode === "relaxed" ? relaxedBody(body) : simpleBody(body);
  if (tags.l !== undefined) canonicalBody = canonicalBody.slice(0, Number(tags.l));
  const bodyHash = new Uint8Array(await crypto.subtle.digest("SHA-256", binaryBytes(canonicalBody)));
  if (btoa(String.fromCharCode(...bodyHash)) !== tags.bh) return false;

  // Každou podepsanou hlavičku bereme odspodu, každý výskyt nejvýš jednou
  const used = new Set();
  let data = "";
  for (const name of signed) {
    for (let index = headers.length - 1; index >= 0; index--) {
      if (headers[index].name !== name || used.has(index) || headers[index] === header) continue;
      used.add(index);
      data += `${canonicalHeader(headers[index], headerMode)}\r\n`;
      break;
    }
  }
  const blank = { name: header.name, raw: header.raw.replace(/([:;]\s*b\s*=)[^;]*/, "$1") };
  data += canonicalHeader(blank, headerMode);

  const key = await dkimKey(`${tags.s}._domainkey.${signer}`, env);
  if (!key) return false;
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, binaryBytes(atob(tags.b)), binaryBytes(data));
}

function canonicalHeader(header, mode) {
  if (mode !== "relaxed") return header.raw;
  const value = header.raw.slice(header.raw.indexOf(":") + 1).replace(/\r\n/g, "").replace(/[ \t]+/g, " ").trim();
  return `${header.name}:${value}`;
}

function relaxedBody(body) {
  const lines = body.split("\r\n").map((line) => line.replace(/[ \t]+/g, " ").replace(/ $/, ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length ? `${lines.join("\r\n")}\r\n` : "";
}

function simpleBody(body) {
  return `${body.replace(/(\r\n)+$/, "")}\r\n`;
}

// Veřejný klíč z DNS (TXT <selektor>._domainkey.<doména>) přes DNS over HTTPS
async function dkimKey(name, env) {
  if (dkimKeys.has(name)) return dkimKeys.get(name);
  // Jen pro lokální testy (.dev.vars), ostrý Worker tuhle proměnnou nemá
  let record = env.DKIM_TEST_KEYS ? JSON.parse(env.DKIM_TEST_KEYS)[name] : null;
  if (!record) {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
      headers: { accept: "application/dns-json" },
    });
    const answers = response.ok ? (await response.json()).Answer || [] : [];
    record = answers
      .filter((answer) => answer.type === 16)
      .map((answer) => answer.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""))
      .find((text) => /(^|;)\s*p=/.test(text));
  }
  const publicKey = /(?:^|;)\s*p=([^;]*)/.exec(record || "")?.[1].replace(/\s+/g, "");
  if (!publicKey) return null;
  const key = await crypto.subtle.importKey(
    "spki", binaryBytes(atob(publicKey)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
  );
  dkimKeys.set(name, key);
  return key;
}

function binaryString(bytes) {
  if (!bytes) return "";
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return binary;
}

function binaryBytes(binary) {
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function requestNotice(id, sender, text, to, verified) {
  const who = sender.name || sender.email;
  const link = `${SITE}/pustit/${id}`;
  const warning = verified ? "" : "Pozor: adresu odesílatele se nepodařilo ověřit, mohl ji někdo podvrhnout.";
  const plain = [
    `${who}${sender.name ? ` <${sender.email}>` : ""} tě prosí o přístup do osobní části fakan.cz.`,
    ...(warning ? [warning] : []),
    "",
    ...(text ? ["Píše:", text, ""] : []),
    `Pustit dál: ${link}`,
    "Když ho pustit nechceš, nic nedělej. Odpovědí napíšeš přímo jemu.",
    "",
  ].join("\r\n");
  const html = `<!doctype html><html lang="cs"><body style="margin:0;padding:24px;background:#f4f3ef;font:16px/1.5 -apple-system,'Segoe UI',sans-serif;color:#0c0d16">
<div style="max-width:520px;margin:0 auto;padding:24px;background:#fff;border-radius:14px">
<p style="margin:0 0 6px;color:#6b6b74;font-size:13px">fakan.cz · žádost o přístup</p>
<p style="margin:0 0 16px;font-size:18px"><b>${escapeHtml(who)}</b>${sender.name ? ` <span style="color:#6b6b74">${escapeHtml(sender.email)}</span>` : ""} tě prosí o přístup do osobní části.</p>
${warning ? `<p style="margin:0 0 16px;color:#b3261e;font-size:14px">${warning}</p>` : ""}
${text ? `<blockquote style="margin:0 0 20px;padding:12px 14px;border-left:3px solid #2a018a;background:#f4f3ef;white-space:pre-wrap">${escapeHtml(text)}</blockquote>` : ""}
<p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;padding:13px 22px;border-radius:10px;background:#2a018a;color:#fff;font-weight:600;text-decoration:none">Pustit dál</a></p>
<p style="margin:0;color:#6b6b74;font-size:13px">Když ho pustit nechceš, nic nedělej. Odpovědí napíšeš přímo jemu.</p>
</div></body></html>`;
  const boundary = `fakan-${crypto.randomUUID()}`;
  return [
    `From: ${encodeWord("fakan.cz")} <${NOTIFY_FROM}>`,
    `To: <${to}>`,
    `Reply-To: ${sender.name ? `${encodeWord(sender.name)} ` : ""}<${sender.email}>`,
    `Subject: ${encodeWord(`Žádost o přístup: ${who}`)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@fakan.cz>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(plain),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

// Hlavička s diakritikou (RFC 2047)
function encodeWord(text) {
  return /^[\x20-\x7e]*$/.test(text) && !/[=?"<>]/.test(text) ? text : `=?UTF-8?B?${base64Utf8(text)}?=`;
}

function base64Utf8(text) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function base64Lines(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/.{76}/g, "$&\r\n");
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
