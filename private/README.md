---
title: Private
slug: private
access: locked
---

# private/

Zamčená sekce. Obsah se ukáže až po přihlášení.

Backend, který tu autentizaci řeší, zatím není — `index.html` je placeholder,
který vždycky vrátí „backend ještě neběží". Až přijde Cloudflare Worker
(viz roadmapa mindmap [fakan/README.md](https://github.com/junkycoder/fakan/blob/main/README.md)
sekce „Backend"), tahle složka se rozsvítí.

## Co tu má být

- Pracovní deník, který nepatří do veřejného blogu.
- Šablony klientských dokumentů (smlouvy, NDA, faktury).
- Drafty textů, dokud nejsou hotové.

Nic z toho samozřejmě v gitu na veřejném repu — `private/` v tomhle repu
je **struktura, ne obsah**. Skutečný obsah žije v privátním paralelním repu,
který se namountuje na stejný path.
