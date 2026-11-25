# fakan.cz

Můj osobní web. Bio, projekty, kontakt, blog a pár soukromých zákoutí.

Žádný build, žádný framework. Složky, `.md` soubory a pět `index.html` s drobnou
interaktivitou. Otevři `index.html` v rootu, nebo si pusť `python3 -m http.server 5173`
a chodí to jako normální web.

## Repo je kazeta

Tenhle repo je **obsahová kazeta**. Stejné `.md` soubory konzumují dva renderery:

1. **Statický web** — `index.html` v rootu i v každé složce. Žádný build, nasaď na
   Cloudflare Pages, nebo si to otevři lokálně. Lineární čtení odshora dolů.
2. **Mindmap** — projekt [fakan](https://github.com/junkycoder/fakan) si tenhle repo
   vsadí jako zdroj a vykreslí ho jako prolézatelný ASCII strom, kterým se chodí
   šipkami. Stejný obsah, jiné UI.

Frontmatter (`title`, `slug`, případně `tags`, `meta-*`) je společný kontrakt obou.

## Co kde je

```
fakan.cz/
├── index.html      hlavní rozcestník (statická verze)
├── index.md        kanonický obsah homepage (kazeta pro mindmap)
├── styles.css      paleta + monospace base, sdílené napříč
├── about/          kdo jsem, hodnoty, CV
├── projects/       co stavím
├── services/       v čem jsem k mání pro ostatní
├── contacts/       jak mě chytíš
├── blog/           texty, poznámky
├── private/        zamčené, dokud to nepustím
└── web/            web na fakan.cz: vizitka + osobní feed (Cloudflare Worker)
```

## web/ — fakan.cz

Jedna stránka s přepínačem **profesní / osobní** (`/` a `/osobni`), Worker `fakan-web`.

- **Profesní:** vizitka, která je celá tlačítko. Po kliknutí postupně stáhne CV, reference
  a kontakt a soubory přitom odletí k ikoně stahování prohlížeče (na počítači vpravo
  nahoře, na telefonu dolů).
- **Osobní:** feed ve stylu 9GAG, **zamčený**. Kdo chce dovnitř, klikne na „Požádat
  o přístup e-mailem“ a pošle e-mail na `jsem@fakan.cz` s odkazem `/pustit/<id>`. Pošta na
  tuhle adresu jde přes Email Routing do Workeru: ten si žádost i odesílatele zapíše (D1
  `requests`) a pošle mi vlastní oznámení s tlačítkem Pustit dál (binding `OZNAMENI`,
  odpověď jde rovnou žadateli). Ostatní poštu z jsem@ mi přepošle (secret `PRESMEROVAT_NA`).
- Jeden člověk, víc zařízení (`devices`). Při schválení vyberu, kdo to je: nový člověk, někdo
  známý, nebo já. Jeho adresu si Worker zapamatuje (`emails`) a další zařízení z ní pustí sám,
  ale jen když e-mail nese platný DKIM podpis domény odesílatele (Worker ho ověřuje sám,
  klíč bere z DNS). Bez podpisu přijde oznámení s varováním, že adresa může být podvržená. Odkaz otevřu, uvidím, kdo žádá,
  potvrdím (poprvé na zařízení i heslem) a jeho prohlížeč se sám odemkne. Na `/spravce` se
  přihlásím bez žádosti.
- Taby jako na 9GAG: **Nejlepší** (příspěvky s aspoň 2 hlasy, `TOP_MIN` v `index.html`),
  **Všichni** a pak každý člověk zvlášť. Tlačítko **Přidat** dole nahrává fotky a videa,
  smazat může autor nebo já.
- U každého příspěvku **stáhnout** (soubor) a **sdílet** (odkaz `fakan.cz/p/<id>` s OG náhledem
  memu). Kdo nemá přístup, uvidí jen ten kousek a pozvánku dovnitř; vpuštěný skončí ve feedu.
  Id je 9GAG id nebo náhodný klíč příspěvku, ne pořadové číslo, takže se přes `/p/` nedá projít feed.
- Osobní část i stránky pro mě jsou světlé nebo tmavé podle systému.
- Data: lidé, příspěvky a hlasy v D1 `fakan-feed` (schéma v `web/migrations/`), média nových
  příspěvků v R2 `fakan-feed`. Archiv 1 864 mých upvotů je v `web/public/feed.json`, média čte
  Worker z R2 `justpost-media` (`posts/imported/`), jen čtení.
- Secrets Workeru: `PODPIS_KLIC` (náhodný, podepisuje cookies; změna = všichni ven),
  `SPRAVCE_KLIC` (moje heslo, v 1Passwordu „fakan.cz – správce“) a `PRESMEROVAT_NA` (kam
  přeposílat poštu z jsem@; musí být ověřená adresa v Email Routing). Změna hesla:
  `op read "op://Employee/fakan.cz – správce/password" | tr -d '\n' | npx wrangler secret put SPRAVCE_KLIC`.
  Lokálně všechny v `web/.dev.vars` (mimo git). Test pošty lokálně:
  `curl -X POST 'http://localhost:8795/cdn-cgi/handler/email?from=a@example.com&to=jsem@fakan.cz' --data-binary @zprava.eml`.
- Vyhodit člověka: smazat jeho řádek v `members` (`npx wrangler d1 execute fakan-feed --remote`),
  pak už nic nepřidá; feed uvidí, dokud se nezmění `PODPIS_KLIC`.
- Podklady: zdroje v `web/podklady/` (`cv.html`, `reference.html`), výstupy
  v `web/public/podklady/`. Po změně textů: `sh web/podklady/vyrob.sh` (PDF přes Chrome).
- Lokálně: `cd web && npx wrangler d1 migrations apply fakan-feed --local && npx wrangler dev`
  (archiv z R2 jde vzdáleně, je potřeba přihlášený wrangler).
- Nasazení: `cd web && npx wrangler deploy` (custom domain `fakan.cz`). Mindmapa (Worker
  `fakan-cz`) se 25. 11. 2026 přestěhovala z fakan.cz na mindmap.fakan.cz.

## Tonalita

Píšu o sobě v první osobě, čtenáři tykám. Bez emoji, bez marketingových klišé.
Krátké věty. Detaily v [CLAUDE.md](CLAUDE.md).

## Licence obsahu

Texty jsou moje, kód je MIT. Použij, co potřebuješ.
