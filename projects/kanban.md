---
title: kanban
slug: kanban
tags: tool, productivity, web, cloudflare
---

# kanban

Vlastní kanban pro denní práci. Vznikl proto, že žádný hotový mi neseděl —
Trello je moc kliků, Linear moc opinionated, Jira je Jira.

Veřejně na **[kanban.fakan.cz](https://kanban.fakan.cz)**.

## Stack

- **Cloudflare Workers + D1** — SQLite na okraji sítě, žádný vlastní server.
- **R2** — přílohy ke kartám, jeden bucket, signed URLs.
- **KV** — sessions.
- **Front** — vanilla JS, žádný framework, žádný build.

## Auth

Magic linky přes Resend. Žádné heslo, žádný OAuth provider mezi tebou a kanbanem.
Klikneš na e-mail, máš session v KV.

## Co umí, co jiní neumí

- **Fractional indexing** kartiček — drag&drop nikdy nepřeskládá víc než dvě
  sousední karty. Žádné „přepočítat všechny pořadí" při každém přesunu.
- Přílohy přímo v R2, ne v třetí službě.
- Multi-board, sdílení boardů na link.

## Stav

Používám denně. Pár drobností v backlogu, ale core dělá to, co potřebuju.
Pokud se chceš podívat zevnitř, [napiš](../contacts/email.md) — pošlu invite.
