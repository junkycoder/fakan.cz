---
title: AI email agenti
slug: ai-email-agenti
tags: ai, email, cloudflare, claude
---

# AI email agenti

Pět specializovaných agentů, kteří se pohybují v mojí schránce. Místo jednoho
gigantického „dělej všechno" prompta mám pět menších, každý s úzkým záběrem.

## Architektura

Žádný server, žádný cron, žádný polling. Jen pošta a Cloudflare.

```
inbound e-mail
   ↓
Cloudflare Email Routing
   ↓
Worker (router)  ──→  vybere agenta podle pravidel
   ↓
Worker (agent)   ──→  Claude API + případně KV/D1 pro stav
   ↓
akce: odpověď, archivace, štítek, založení tasku, ...
```

Každý agent je samostatný Worker s vlastním promptem a vlastními oprávněními.
Router je tenký — rozhoduje hlavně podle adresy, předmětu a domény odesílatele.

## Proč pět agentů místo jednoho

- **Menší kontext** = stabilnější výstup. Agent na fakturaci nepotřebuje vědět,
  jak vypadá moje agenda na blogu.
- **Separace selhání** — když se jeden agent chová divně, vypnu jen jeho.
- **Levnější** — větší část mailu odbavuju levnějším modelem, jen pár věcí
  routuje na Opus.

## Konkrétní role

Detail rolí dopíšu, až rozhrabu repo a podívám se, jak je teď fakticky
nakonfigurované. Záměrně nepíšu zpaměti — pět agentů se časem trochu
přeskupilo a nechci tu mít fabulaci.
