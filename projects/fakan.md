---
title: fakan (renderer)
slug: fakan
tags: web, infra
---

# fakan (renderer)

fakan není projekt, který tu žije — je to **renderer**. Mindmap-styled web, který
si vsadí kazetu (`.md` soubory s frontmatterem) a vykreslí ji jako prolézatelný
ASCII strom. Chodí se po něm šipkami, panely jsou listy `.md`.

Tenhle repo (`fakan.cz`) je jedna z kazet — kanonická, moje vlastní. Stejný
obsah si přečteš jako statický web (otevři `index.html`) nebo jako mindmapu
(otevři fakan a nasměruj ho sem).

- **Repo rendereru**: [github.com/junkycoder/fakan](https://github.com/junkycoder/fakan)
- **Stack**: vanilla JS (ES modules), `<pre>` ASCII grid, Python skript na
  generování `tree.json` z adresářové struktury. Žádný build.
- **Hosting**: Cloudflare Pages.

## Proč dvě UI nad stejným obsahem

Lineární web čte návštěvník, kterému poslal jsem odkaz. Mindmap čtu já, když
hledám něco vlastního a chci to mít po ruce jako celek. Stejné `.md` soubory,
dvě UI, jeden zdroj pravdy.
