# CLAUDE.md

Pokyny pro Claude Code v tomto repu. Čti to celé před první změnou.

## Projekt

Osobní web a profil. Zdroj na GitHubu, hosting Cloudflare Pages/Workers. Markdown se renderuje frontmatter-driven šablonou (viz `meta-*` v hlavičkách). Estetika: terminálová, minimalistická, žádné cookie bannery, žádný tracking kromě Cloudflare Web Analytics.

Tenhle repo je **kazeta** — obsah, který se vsadí do dvou rendererů: statický web (`index.html` v rootu i v každé složce) a mindmap [github.com/junkycoder/fakan](https://github.com/junkycoder/fakan), který stejné `.md` soubory vykreslí jako prolézatelný ASCII strom. Frontmatter (`title`, `slug`, `tags`, `meta-*`) je společný kontrakt obou.

## Tech pravidla — neporušovat

- **Žádné frameworky.** Pure HTML, CSS, JS. Bez Vue, Reactu, Sveltu, Astra, Next, Nuxt, jQuery.
- **Žádný build step.** Co je v repu, to běží. Žádný Vite, Webpack, Rollup, Parcel.
- **Žádné `node_modules` ve produkci.** Pokud sahám po skriptu, je to ESM přes `<script type="module">` nebo inline.
- **CSS:** vanilla, custom properties, `:where()`/`:has()` ano. Tailwind ne. PostCSS ne.
- **Backend (pokud relevantní):** Cloudflare Workers, D1, KV, R2, Durable Objects, Queues. Žádné Express, Fastify, Node servery.
- **Auth:** magic linky přes Resend + KV sessions. Žádné Auth0, Clerk, Supabase Auth.
- **Email:** Resend. Tečka.

## Markdown konvence

- Soubory jsou `lower-case` bez diakritiky v názvu, `kebab-case` pokud víc slov
- Frontmatter v YAML mezi `---`, povinné: `title`. Volitelné: `base`, `meta-viewport`, vlastní `meta-*`
- Nadpisy `lower-case` bez teček na konci, hierarchie max `##` a `###`
- Bez emoji
- Odkazy jako `[text](url)`, ne raw URL
- Žádný HTML uvnitř MD pokud to fakt nepotřebuju

## Tón obsahu

- **Česky.** Neformální, přímý, lehce sebeironický
- Krátké věty. Bez "v dnešní rychle se měnící době"
- Bez korporátních slov: synergie, scalable, leveraging, robust, cutting-edge, world-class
- Bez "full-stack senior". Vývojář stačí
- Humor ano, marketing ne

## Workflow

- Před editem si přečti `index.md` (nebo soubor, co řeším), pochop strukturu
- Diff malý, commit zpráva česky, imperativ: `přidej sekci stack`, `oprav překlep`
- Po editu řekni 1 větou co se změnilo. Ne výčet ve třech bulletech.
- Když si nejsi jistý, raději se zeptej než vymýšlej

## Co nedělat

- Neinstalovat balíčky bez explicitního pokynu
- Neměnit hostingovou konfiguraci (`wrangler.toml`, `_headers`, `_redirects`) bez ptaní
- Neoptimalizovat to, co fakt nikdo nečte (SEO meta tagy 50 řádků apod.)
- Negenerovat `og:image` v PNG, stačí SVG nebo nic
- Nepřidávat analytics, hotjar, intercom, ani je nenavrhovat
