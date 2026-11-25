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
- **Osobní:** feed ve stylu 9GAG. Archiv 1 864 mých upvotů je v `web/public/feed.json`,
  média čte Worker z R2 bucketu `justpost-media` (`posts/imported/`), jen čtení.
- Podklady: zdroje v `web/podklady/` (`cv.html`, `reference.html`), výstupy
  v `web/public/podklady/`. Po změně textů: `sh web/podklady/vyrob.sh` (PDF přes Chrome).
- Lokálně: `cd web && npx wrangler dev` (R2 jde vzdáleně, je potřeba přihlášený wrangler).
- Nasazení: `cd web && npx wrangler deploy` (custom domain `fakan.cz`). Mindmapa (Worker
  `fakan-cz`) se 25. 11. 2026 přestěhovala z fakan.cz na mindmap.fakan.cz.

## Tonalita

Píšu o sobě v první osobě, čtenáři tykám. Bez emoji, bez marketingových klišé.
Krátké věty. Detaily v [CLAUDE.md](CLAUDE.md).

## Licence obsahu

Texty jsou moje, kód je MIT. Použij, co potřebuješ.
