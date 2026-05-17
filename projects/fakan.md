---
title: fakan
slug: fakan
tags: web, osobni, hraci
---

# fakan

Osobní web jako mindmapa. Místo stránek strom, kterým se chodí do čtyř stran.
Listy jsou `.md` soubory s frontmatterem. Větve půjde sdílet, zamknout
a zpoplatnit.

- **Stack**: vanilla JS (ES modules), `<pre>` ASCII grid, Python skript na
  generování `tree.json` z adresářové struktury. Žádný build.
- **Hosting**: Cloudflare Pages.
- **Repo**: [github.com/junkycoder/fakan](https://github.com/junkycoder/fakan).

## Stav

Funguje navigace, panely, klávesnice, dark mode. Backend (sdílení, paywall,
custom domény) je rozpracovaný — Cloudflare Worker je v roadmapě.

## Proč

Chtěl jsem jednu homepage, kde se schází profil, texty, projekty a denní
práce. Bez Wordpressu, bez Notion, bez témat. Otevírám si to jako homepage.
