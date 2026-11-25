// fakan.cz — statika z public/ + média osobního feedu z R2 (bucket justpost-media).
// Worker jen čte, do R2 nic nezapisuje.

const MEDIA_PREFIX = "posts/imported/";
// Název souboru z 9GAG exportu: 0001_ayNOnMM.jpg / 0002_azx0EnB.mp4
const MEDIA_NAME = /^\d{4}_[A-Za-z0-9]+\.(jpg|mp4|png|gif|webp)$/;

// Stránky, které obsluhuje index.html (přepínač profesní / osobní)
const APP_PATHS = new Set(["/", "/osobni"]);

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/m/")) {
      return serveMedia(request, env, decodeURIComponent(url.pathname.slice(3)));
    }

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

async function serveMedia(request, env, name) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  if (!MEDIA_NAME.test(name)) return new Response("Not Found", { status: 404 });

  // Range kvůli videím (Safari bez něj mp4 nepřehraje), onlyIf kvůli 304
  const range = parseRange(request.headers.get("range"));
  const object = await env.MEDIA.get(MEDIA_PREFIX + name, {
    ...(range ? { range } : {}),
    onlyIf: request.headers,
  });
  if (!object) return new Response("Not Found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=31536000, immutable");
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

function withHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
