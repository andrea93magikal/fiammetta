# Fiammetta

App web di amministrazione e finanza di Magikal srl: liquidità, scadenziario (finanziamenti, SIMEST, piani di rientro fornitori, rateizzazioni AdER), conto economico trimestrale e posizione finanziaria netta.

- `index.html` — l'app (una sola pagina: HTML, CSS e JavaScript).
- `config.js` — indirizzo e chiave pubblicabile del progetto Supabase «Fiammetta».
- `supabase.js` — libreria supabase-js (copia locale, UMD).

I dati arrivano dal gestionale NTS Business tramite lo script notturno `fiammetta-gestionale.ps1` sul server (sola lettura) e dalle tabelle dell'app su Supabase. L'accesso è riservato al team (Supabase Auth + regole RLS). Fiammetta non scrive mai nel gestionale.

Pubblicata con GitHub Pages dal ramo `main`.
