---
title: CRM/ATS pro mBlue
slug: crm-ats
tags: b2b, crm, ats, cloudflare
---

# CRM/ATS pro mBlue

Vlastní CRM/ATS pro personální agenturu **[mBlue](https://mblue.cz)**. Hotové
nářadí (Recruitee, Teamio, Bullhorn) jim neumělo to, co potřebují, a měsíční
předplatné rostlo rychleji než zisk z toho, na co se to vlastně používá.

## Záběr

- **Devět modulů** — kandidáti, klienti, pozice, výběrová řízení, smlouvy,
  fakturace, reporting, interní agenda, integrace.
- **80+ tasků** na backlogu — část za námi, část před námi. Iterujeme.
- **Napojení na ARES** — ověření IČO klientů jedním klikem, vyplnění
  fakturačních údajů automaticky.

## Stack

Cloudflare Workers + D1, KV pro sessions, R2 pro přílohy (CV, smlouvy). Front
vanilla. Magic-link auth. Jeden Worker per modul, společný router. Žádný build
step na frontě.

## Proč to dává smysl

Personálka má specifický workflow, který je hodně český (ARES, daňová specifika,
struktura smluv pro DPP/DPČ). Hotové nástroje to řeší obecně a nepřesně.
Vlastní CRM bere data tak, jak je personalisté potřebují, a integruje se na to,
co je v Česku reálně dostupné.
