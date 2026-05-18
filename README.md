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
└── private/        zamčené, dokud to nepustím
```

## Tonalita

Píšu o sobě v první osobě, čtenáři tykám. Bez emoji, bez marketingových klišé.
Krátké věty. Detaily v [CLAUDE.md](CLAUDE.md).

## Licence obsahu

Texty jsou moje, kód je MIT. Použij, co potřebuješ.
