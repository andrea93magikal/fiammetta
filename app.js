'use strict';
if (!window.supabase) { document.getElementById('app').innerHTML = '<div class="loading">Non riesco a caricare la libreria di collegamento al database (supabase-js). Controlla la connessione e ricarica la pagina.</div>'; throw new Error('supabase-js non caricata'); }
// =====================================================================
// FIAMMETTA · amministrazione e finanza di Magikal srl · v1.1
// Una sola pagina: legge Supabase (copie di sola lettura del gestionale NTS
// + tabelle dell'app) e scrive solo nelle tabelle dell'app (rate, piani,
// saldi banca, mappa conti, parametri, incassi/pagamenti segnati, regole
// di incasso). Mai nel gestionale.
// =====================================================================
const C = window.FIAMMETTA_CONFIG;
const S = { sb: null, email: '', me: null, view: 'oggi', data: null, loadedAt: 0, modal: null, setPwd: false,
  filtroRate: 'piani', annoCE: null, mappa: null, cercaConto: '', soloMov: true, busy: false,
  partite: { tab: 'incassi', filtro: 'tutto', cerca: '', pfFiltro: 'aperte' }, clienti: null, dett: null };
const VISTE = [['oggi', 'Oggi'], ['partite', 'Crediti e debiti'], ['scadenziario', 'Scadenziario'], ['banche', 'Banche e PFN'], ['ce', 'Conto economico'], ['stato', 'Stato dati'], ['impostazioni', 'Impostazioni']];
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// de-DE: stesso formato italiano (punto per le migliaia, virgola per i decimali) ma raggruppa anche i numeri a 4 cifre
const n0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const n2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = v => (v == null || isNaN(v)) ? '–' : n0.format(Math.round(v) || 0) + ' €';
const eur2 = v => (v == null || isNaN(v)) ? '–' : n2.format(Math.abs(v) < 0.005 ? 0 : v) + ' €';
const pct = (a, b) => (!b || a == null) ? '–' : (100 * a / b).toFixed(1).replace('.', ',') + '%';
const fmtD = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('it-IT') : '–';
const fmtDT = d => d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
function isoLocal(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoLocal(d); }
function addMonths(iso, n) { const d = new Date(iso + 'T00:00:00'); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return isoLocal(d); }
const giorni = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const num = v => { const x = parseFloat(String(v == null ? '' : v).replace(/\./g, '').replace(',', '.')); return isNaN(x) ? null : x; };
const sum = (arr, f) => arr.reduce((a, r) => a + (Number(f ? f(r) : r) || 0), 0);
const OGGI = isoLocal();
let toastT; function toast(msg, ms) { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), ms || 2800); }

// ---------- Lettura dati ----------
async function all(table, build) {
  let out = [], from = 0; const page = 1000;
  for (;;) {
    let q = S.sb.from(table).select('*'); if (build) q = build(q);
    const { data, error } = await q.range(from, from + page - 1);
    if (error) throw error;
    out = out.concat(data || []); if (!data || data.length < page) break; from += page;
  }
  return out;
}
async function loadAll() {
  const [stato, ce, sp, banche, rate, piani, scad, par, saldi, team, movimenti, regole, proforme, stimaBanca, nuovi, anagBanche, fidi, ccUtil, oneri, uniti, cOrdini, cBolle, cFatture, cIncassi] = await Promise.all([
    S.sb.rpc('stato_dati').then(r => { if (r.error) throw r.error; return r.data; }),
    all('v_ce_mese'), all('v_sp_saldi'), all('v_banche_saldi'),
    all('v_rate', q => q.order('scadenza').order('n')), all('piani', q => q.order('tipo').order('nome')),
    all('v_scadenze_aperte', q => q.order('datsca')), all('parametri'),
    S.sb.from('saldi_banca').select('*').order('data', { ascending: false }).order('banca').limit(80).then(r => { if (r.error) throw r.error; return r.data; }),
    all('team'),
    all('movimenti_app', q => q.eq('stato', 'attesa').order('data', { ascending: false })),
    all('regole_incasso'), all('v_proforme', q => q.order('datdoc', { ascending: false })),
    all('v_banca_stima'), all('v_banca_nuovi', q => q.order('dataoperaz', { ascending: false })),
    all('erp_banche', q => q.order('codice')), all('fidi_banca'), all('v_cc_utilizzo'), all('v_oneri_banca'),
    all('conti_uniti').catch(() => []),
    all('v_catena_ordini').catch(() => []), all('v_catena_bolle').catch(() => []), all('v_catena_fatture').catch(() => []), all('v_incassi_banca').catch(() => [])
  ]);
  const P = {}; par.forEach(p => P[p.chiave] = typeof p.valore === 'number' ? p.valore : num(p.valore));
  const R = {}; regole.forEach(r => R[r.conto] = r);
  S.data = { stato, ce, sp, banche, rate, piani, scad, par, P, saldi, team, movimenti, regole, R, proforme, stimaBanca, nuovi, anagBanche, fidi, ccUtil, oneri, uniti,
    catena: { ordini: cOrdini, bolle: cBolle, fatture: cFatture, incassi: cIncassi } };
  collegaCatena();
  await riconcilia();
  arricchisci();
  S.loadedAt = Date.now();
}
async function reloadRate() { S.data.rate = await all('v_rate', q => q.order('scadenza').order('n')); S.data.piani = await all('piani', q => q.order('tipo').order('nome')); arricchisci(); }
async function reloadMovimenti() { S.data.movimenti = await all('movimenti_app', q => q.eq('stato', 'attesa').order('data', { ascending: false })); await riconcilia(); arricchisci(); }

// Collega gli incassi segnati in Fiammetta alle partite e chiude quelli che NTS ha ormai registrato
async function riconcilia() {
  const D = S.data, aperte = new Map(D.scad.map(s => [s.chiave, s]));
  const chiudi = [], collega = [];
  for (const m of D.movimenti) {
    if (m.chiave_partita) { if (!aperte.has(m.chiave_partita)) chiudi.push(m.id); continue; }
    if (m.chiave_doc) {
      const pf = D.proforme.find(p => p.chiave === m.chiave_doc);
      if (!pf) continue;
      if (pf.fatture && pf.fatture.length) {
        // la fattura vera e' uscita (collegata dalla catena ordine → bolla → fattura): la sua partita aperta prende l'incasso segnato;
        // se la fattura non ha piu' partite aperte NTS ha gia' registrato l'incasso
        const part = pf.fatture.flatMap(partiteDellaFattura);
        const cand = part.find(s => !D.movimenti.some(x => x.chiave_partita === s.chiave));
        if (cand) { m.chiave_partita = cand.chiave; collega.push(m); }
        else if (!part.length) chiudi.push(m.id);
      }
    }
  }
  try {
    for (const m of collega) await S.sb.from('movimenti_app').update({ chiave_partita: m.chiave_partita }).eq('id', m.id);
    if (chiudi.length) { await S.sb.from('movimenti_app').update({ stato: 'riconciliato', riconciliato_il: new Date().toISOString() }).in('id', chiudi); D.movimenti = D.movimenti.filter(m => !chiudi.includes(m.id)); }
  } catch (e) { console.error('riconciliazione', e); }
}
// ---------- Catena proforma → ordine → bolla → fattura → incasso ----------
// In NTS la proforma non genera nulla: è solo il documento che si manda al cliente per farsi pagare. Il percorso vero è
// ordine cliente (impegno) → bolla (nata dall'ordine) → fattura (anche differita) → incasso. NTS conosce i collegamenti
// ordine → bolla e bolla → fattura (viste v_catena_*); manca proforma → ordine, che si ricostruisce per importo e data.
// Ogni ordine, bolla e fattura serve a una sola proforma e si parte dagli importi più vicini: a 1 centesimo di distanza
// stanno due proforme diverse dello stesso cliente (Grimaldi n. 78 e n. 85), che un confronto «circa uguale» confondeva.
const TOL_ESATTA = () => 0.05, TOL_PICCOLA = t => Math.max(1, t * 0.01), TOL_LARGA = t => Math.max(10, t * 0.06);
function abbina(L, R, cand, tols) {
  const out = new Map(), usati = new Set();
  tols.forEach(tol => {
    const coppie = [];
    L.forEach(l => { if (out.has(l)) return; R.forEach(r => { if (usati.has(r)) return; const x = cand(l, r); if (!x) return; const diff = Math.round(Math.abs(x.a - x.b) * 100) / 100; if (diff <= tol(x.a)) coppie.push({ l, r, diff, dd: x.dd }); }); });
    coppie.sort((u, v) => u.diff - v.diff || u.dd - v.dd);
    coppie.forEach(q => { if (!out.has(q.l) && !usati.has(q.r)) { out.set(q.l, q.r); usati.add(q.r); } });
  });
  return out;
}
const partiteDellaFattura = f => S.data.scad.filter(s => s.tipo_cf === 'C' && s.conto === f.conto && s.numdoc === f.numdoc && (s.alfdoc || '') === (f.serie || '') && String(s.datdoc || '').slice(0, 4) === String(f.anno));
function collegaCatena() {
  const D = S.data, K = D.catena || {}, n_ = x => Number(x) || 0, PF = D.proforme;
  const ordini = (K.ordini || []).map(o => ({ ...o, totdoc: n_(o.totdoc), bolle: [], proforma: null }));
  const bolle = (K.bolle || []).map(b => ({ ...b, totdoc: n_(b.totdoc), ordiniObj: [], fatturaObj: null, direttaA: null }));
  const fatture = (K.fatture || []).map(f => ({ ...f, totdoc: n_(f.totdoc), aperto: n_(f.aperto) }));
  const ordK = new Map(ordini.map(o => [o.chiave, o])), fatK = new Map(fatture.map(f => [f.chiave, f]));
  // collegamenti esatti di NTS: righe della bolla → ordine, bolla → fattura
  bolle.forEach(b => { (b.ordini || []).forEach(k => { const o = ordK.get(k); if (o) { o.bolle.push(b); b.ordiniObj.push(o); } }); if (b.fattura) b.fatturaObj = fatK.get(b.fattura) || null; });
  PF.forEach(p => { p.totdoc = Number(p.totdoc); p.ordine = null; p.bolle = []; p.fatture = []; p.doppia = null; p.via = {}; });
  // 1. proforma → ordine: stesso cliente, ordine entro 300 giorni prima (o 15 dopo), importi più vicini per primi
  abbina(PF, ordini, (p, o) => p.conto === o.conto && o.datord <= addDays(p.datdoc, 15) && o.datord >= addDays(p.datdoc, -300) ? { a: p.totdoc, b: o.totdoc, dd: Math.abs(giorni(o.datord, p.datdoc)) } : null, [TOL_ESATTA, TOL_PICCOLA, TOL_LARGA])
    .forEach((o, p) => { p.ordine = o; o.proforma = p; });
  // 2. ordine → bolla: dove NTS non ha il collegamento (la maggior parte delle bolle) per importo; proforma senza ordine → bolla per importo
  abbina(ordini.filter(o => o.proforma && o.flevas === 'S' && !o.bolle.length), bolle.filter(b => !b.ordiniObj.length),
    (o, b) => o.conto === b.conto && b.datdoc >= addDays(o.datord, -3) && b.datdoc <= addDays(o.datord, 330) ? { a: o.totdoc, b: b.totdoc, dd: Math.abs(giorni(o.datord, b.datdoc)) } : null, [TOL_ESATTA, TOL_PICCOLA])
    .forEach((b, o) => { o.bolle.push(b); b.ordiniObj.push(o); });
  PF.forEach(p => { if (p.ordine) p.bolle = p.ordine.bolle; });
  abbina(PF.filter(p => !p.ordine), bolle.filter(b => b.ordiniObj.every(o => !o.proforma)),
    (p, b) => p.conto === b.conto && b.datdoc >= addDays(p.datdoc, -3) && b.datdoc <= addDays(p.datdoc, 240) ? { a: p.totdoc, b: b.totdoc, dd: Math.abs(giorni(p.datdoc, b.datdoc)) } : null, [TOL_ESATTA, TOL_PICCOLA, TOL_LARGA])
    .forEach((b, p) => { b.direttaA = p; p.bolle = [b]; p.ordine = b.ordiniObj[0] || null; p.via.bolla = true; });
  // proforma rimasta senza collegamenti ma con un candidato già preso da un'altra proforma: è una doppia (proforma rifatta)
  PF.filter(p => !p.ordine && !p.bolle.length).forEach(p => {
    const o = ordini.find(o => o.proforma && o.proforma !== p && o.conto === p.conto && o.datord <= addDays(p.datdoc, 15) && o.datord >= addDays(p.datdoc, -300) && Math.abs(o.totdoc - p.totdoc) <= TOL_LARGA(p.totdoc));
    const b = bolle.find(b => b.direttaA && b.direttaA !== p && b.conto === p.conto && b.datdoc >= addDays(p.datdoc, -3) && b.datdoc <= addDays(p.datdoc, 240) && Math.abs(b.totdoc - p.totdoc) <= TOL_LARGA(p.totdoc));
    p.doppia = o ? o.proforma : b ? b.direttaA : null;
  });
  // 3. bolla → fattura: il collegamento esatto c'è solo per le bolle da maggio 2026; prima, per importo
  const catB = [...new Set(PF.flatMap(p => p.bolle))], usateF = new Set(bolle.map(b => b.fatturaObj).filter(Boolean));
  abbina(catB.filter(b => b.flfatt === 'S' && !b.fatturaObj), fatture.filter(f => !usateF.has(f)),
    (b, f) => b.conto === f.conto && f.datdoc >= b.datdoc && f.datdoc <= addDays(b.datdoc, 150) ? { a: b.totdoc, b: f.totdoc, dd: Math.abs(giorni(b.datdoc, f.datdoc)) } : null, [TOL_ESATTA, TOL_PICCOLA, TOL_LARGA])
    .forEach((f, b) => { b.fatturaObj = f; });
  PF.forEach(p => { p.fatture = [...new Set(p.bolle.map(b => b.fatturaObj).filter(Boolean))]; });
  const usateF2 = new Set([...usateF, ...PF.flatMap(p => p.fatture)]);
  abbina(PF.filter(p => p.ordine && p.ordine.flevas === 'S' && !p.bolle.length), fatture.filter(f => !usateF2.has(f)),
    (p, f) => p.conto === f.conto && f.datdoc >= addDays(p.datdoc, -3) && f.datdoc <= addDays(p.datdoc, 240) ? { a: p.totdoc, b: f.totdoc, dd: Math.abs(giorni(p.datdoc, f.datdoc)) } : null, [TOL_ESATTA, TOL_PICCOLA, TOL_LARGA])
    .forEach((f, p) => { p.fatture = [f]; });
  // tappa raggiunta dalla proforma
  PF.forEach(p => {
    p.spedita_il = p.bolle.length ? p.bolle.map(b => b.datdoc).sort()[0] : null;
    p.fatturata_il = p.fatture.length ? p.fatture.map(f => f.datdoc).sort()[0] : null;
    p.tappa = p.fatture.length ? (sum(p.fatture, f => f.aperto) > 0.005 ? 'fatturata' : 'chiusa')
      : p.bolle.length ? (p.bolle.some(b => b.flfatt === 'S') ? 'fatturata' : 'spedita')
      : p.doppia ? 'doppia' : p.ordine ? (p.ordine.flevas === 'S' ? 'evasa_nd' : 'da_spedire') : 'senza_ordine';
  });
  // abitudine di pagamento per cliente: dall'incasso delle fatture chiuse rispetto alla data della bolla
  const ab = {};
  bolle.forEach(b => { const f = b.fatturaObj; if (!f || f.aperto > 0.005 || !f.incassata_il) return; const x = ab[b.conto] || (ab[b.conto] = { n: 0, dopo: 0, ritardi: [] }); const d = giorni(b.datdoc, f.incassata_il); x.n++; if (d > 2) { x.dopo++; x.ritardi.push(d); } });
  Object.values(ab).forEach(x => { x.ritardi.sort((u, v) => u - v); x.mediana = x.ritardi.length ? x.ritardi[Math.floor(x.ritardi.length / 2)] : 0; x.dopoSolito = x.dopo * 2 >= x.n; });
  D.abitudini = ab;
}
// Incassi delle proforme ancora da incassare: accrediti in banca che NTS non ha ancora registrato (uno a uno, per importo e nome)
// e incassi registrati in NTS ma non abbinati a una fattura. Un accredito già registrato ha chiuso una fattura: non paga una proforma aperta.
function pagamentiProforme() {
  const D = S.data, nuovi = D.nuovi || [];
  const riconosciuti = new Set(nuovi.filter(m => m.abb).map(m => m.codice_banca + '|' + m.progr));
  const txt = m => ' ' + norm((m.descr1 || '') + ' ' + (m.descr2 || '')) + ' ';
  const pool = [
    ...((D.catena && D.catena.incassi) || []).filter(m => !m.registrato && !riconosciuti.has(m.codice_banca + '|' + m.progr) && !/antic|finanz|mutuo|prestito/i.test((m.descr1 || '') + ' ' + (m.descr2 || '')))
      .map(m => ({ m, importo: Number(m.importo), data: m.dataoperaz, testo: txt(m) })),
    ...D.scad.filter(s => s.daAbbinare && s.tipo_cf === 'C' && s.importo < 0 && !s.copertura).map(s => ({ s, conto: s.conto, importo: -s.importo, data: String(s.datdoc || s.datsca).slice(0, 10) }))
  ];
  const daPag = D.proforme.filter(p => !p.copertura && ['da_spedire', 'spedita', 'senza_ordine', 'evasa_nd'].includes(p.tappa));
  abbina(daPag, pool, (p, x) => {
    if (x.data < addDays(p.datdoc, -2) || x.data > OGGI) return null;
    if (x.conto) { if (x.conto !== p.conto) return null; } else if (!nomeIn(p.controparte, x.testo) && Math.abs(p.totdoc - x.importo) > 0.05) return null;
    return { a: p.totdoc, b: x.importo, dd: Math.abs(giorni(p.datdoc, x.data)) };
  }, [TOL_ESATTA, t => Math.max(2, t * 0.006)]).forEach((x, p) => {
    p.pagata = x.data; p.pagata_da = x.m ? 'banca' : 'nts';
    if (x.m) { p.banca_pag = x.m; const n = nuovi.find(y => y.codice_banca === x.m.codice_banca && y.progr === x.m.progr); if (n) n.abb = { tipo: 'proforma', nome: p.controparte, rif: 'proforma ' + p.numdoc }; }
  });
}
// Stato della proforma per l'elenco e per i totali
//  attesa = ordine non ancora spedito e nessun pagamento · da_fatturare = spedita, non ancora fatturata e non pagata (entrambe contano come da incassare)
//  pagata = pagamento visto, merce da spedire o da fatturare · fatturata = il credito è già nelle fatture · chiusa = fattura incassata
//  doppia = proforma rifatta · verifica = nessun collegamento sicuro
function statoProforme() {
  const D = S.data;
  D.proforme.forEach(p => {
    const t = p.tappa, ab = D.abitudini[p.conto];
    p.abitudine = ab ? (ab.dopoSolito ? 'dopo' : 'prima') : null; p.abitudineDati = ab || null;
    // fattura ancora aperta in NTS ma già pagata con un acconto non abbinato: per Andrea la proforma è chiusa
    p.accontata = t === 'fatturata' && p.fatture.length > 0 && p.fatture.every(f => { const part = partiteDellaFattura(f); return part.length > 0 && part.every(x => x.accontoDa); });
    p.stato = p.copertura ? ((p.copertura.stato === 'annullato' || Number(p.copertura.importo) === 0) ? 'annullata' : 'incassata')
      : t === 'chiusa' || p.accontata ? 'chiusa' : t === 'fatturata' ? 'fatturata' : t === 'doppia' ? 'doppia' : p.pagata ? 'pagata'
      : t === 'da_spedire' ? 'attesa' : t === 'spedita' ? 'da_fatturare'
      : t === 'senza_ordine' ? (giorni(p.datdoc, OGGI) > 120 ? 'verifica' : 'attesa') : 'verifica';
    // quando si incassa: chi paga di solito dopo la consegna, dopo la consegna prevista (più i giorni di ritardo abituali); gli altri subito
    p.atteso = OGGI;
    if (p.abitudine === 'dopo' && (p.stato === 'attesa' || p.stato === 'da_fatturare')) {
      const base = p.stato === 'da_fatturare' ? p.spedita_il : (p.ordine && p.ordine.datcons) || OGGI;
      p.atteso = addDays(base > OGGI ? base : OGGI, ab.mediana);
    }
  });
}
// Calcoli derivati su partite e proforme (coperture, date attese, piani di rientro, movimenti bancari riconosciuti)
const norm = s =>(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const PAROLE_VUOTE = ['srl', 'spa', 'snc', 'sas', 'unipersonale', 'societa', 'socio', 'unico', 'store', 'group', 'italia'];
const nomeIn = (nome, testo) => norm(nome).split(' ').filter(w => w.length > 3 && !PAROLE_VUOTE.includes(w)).slice(0, 2).some(w => testo.includes(' ' + w + ' '));
const docRif = s => s.daAbbinare ? (s.accontoPer ? 'da abbinare a ft ' + s.accontoPer.numdoc : 'da abbinare') : s.apertura ? 'saldo 2025' : (s.numdoc ? 'ft ' + s.numdoc : '');
function arricchisci() {
  const D = S.data;
  const copertaPartita = {}, copertaDoc = {};
  D.movimenti.forEach(m => { if (m.chiave_partita) copertaPartita[m.chiave_partita] = m; if (m.chiave_doc) copertaDoc[m.chiave_doc] = m; });
  const pianiForn = D.piani.filter(p => p.tipo === 'fornitore' && p.stato === 'attivo');
  const inPiano = nome => { const n = norm(nome); if (!n) return null; return pianiForn.find(p => { const c = norm(p.controparte || p.nome); const k = c.split(' ')[0]; return c && ((' ' + n + ' ').includes(' ' + c + ' ') || (n.length > 3 && (' ' + c + ' ').includes(' ' + n + ' ')) || (k.length > 3 && (n === k || n.startsWith(k + ' ')))); }); };
  D.scad.forEach(s => {
    s.importo = Number(s.importo); s.copertura = copertaPartita[s.chiave] || null; s.banca_pag = null; s.accontoDa = null; s.accontoPer = null;
    s.daAbbinare = /\|1900\|/.test(s.chiave); // pagamento o incasso registrato in NTS senza abbinarlo alla fattura
    s.apertura = /\|2025\|\|9999\|/.test(s.chiave) || (s.numdoc === 0 && s.datsca <= '2026-01-01' && !s.daAbbinare);
    const r = D.R[s.conto];
    s.attesa = (s.tipo_cf === 'C' && r) ? addDays(r.base === 'scadenza' ? s.datsca : (s.datdoc || s.datsca), r.giorni) : s.datsca;
    s.ritardo = giorni(s.attesa, OGGI);
    s.piano = s.tipo_cf === 'F' ? inPiano(s.controparte) : null;
  });
  // Acconti e incassi che NTS ha registrato senza abbinarli alla fattura (partite «da abbinare»): se l'importo coincide con una fattura aperta
  // dello stesso cliente, la fattura è già pagata. Si abbinano uno a uno e le due partite si compensano (stessa data attesa, così cadono nello stesso gruppo).
  abbina(D.scad.filter(s => s.tipo_cf === 'C' && s.daAbbinare && s.importo < 0 && !s.copertura),
    D.scad.filter(s => s.tipo_cf === 'C' && !s.daAbbinare && !s.apertura && s.importo > 0 && !s.copertura),
    (c, f) => c.conto === f.conto ? { a: -c.importo, b: f.importo, dd: Math.abs(giorni(c.datdoc || c.datsca, f.datdoc || f.datsca)) } : null, [TOL_ESATTA])
    .forEach((f, c) => { f.accontoDa = c; c.accontoPer = f; c.attesa = f.attesa; c.ritardo = f.ritardo; });
  D.proforme.forEach(p => { p.totdoc = Number(p.totdoc); p.copertura = copertaDoc[p.chiave] || null; p.banca_pag = null; p.pagata = null; p.pagata_da = null; });
  // Movimenti bancari importati in NTS dopo l'ultima registrazione: li riconosco per importo (e nome, se c'è nella descrizione).
  // Una partita riconosciuta esce da scaduti e scadenze: il movimento è già nella liquidità stimata.
  const usate = new Set(), nuovi = D.nuovi || [];
  nuovi.forEach(m => { m.abb = null; m.addebito = Number(m.addebito) || 0; m.accredito = Number(m.accredito) || 0; });
  const forn = D.scad.filter(s => s.tipo_cf === 'F' && s.importo < 0 && !s.piano && !s.copertura);
  const cli = D.scad.filter(s => s.tipo_cf === 'C' && s.importo > 0 && !s.copertura && !s.accontoDa);
  nuovi.filter(m => m.addebito > 0).forEach(m => {
    const c = forn.filter(s => !usate.has(s.chiave) && Math.abs(-s.importo - m.addebito) < 0.01 && giorni(s.datsca, m.dataoperaz) <= 45 && giorni(s.datsca, m.dataoperaz) >= -10)
      .sort((a, b) => Math.abs(giorni(a.datsca, m.dataoperaz)) - Math.abs(giorni(b.datsca, m.dataoperaz)))[0];
    if (c) { usate.add(c.chiave); c.banca_pag = m; m.abb = { tipo: 'fornitore', nome: c.controparte, rif: docRif(c) }; }
  });
  nuovi.filter(m => m.accredito > 0).forEach(m => {
    const testo = ' ' + norm((m.descr1 || '') + ' ' + (m.descr2 || '')) + ' ';
    const cand = cli.filter(s => !usate.has(s.chiave) && Math.abs(s.importo - m.accredito) < 0.01 && giorni(s.datsca, m.dataoperaz) <= 240 && giorni(s.datsca, m.dataoperaz) >= -90);
    const c = cand.find(s => nomeIn(s.controparte, testo)) || cand[0];
    if (c) { usate.add(c.chiave); c.banca_pag = m; m.abb = { tipo: 'cliente', nome: c.controparte, rif: docRif(c) }; }
  });
  pagamentiProforme();
  statoProforme();
}
const partiteC = () => S.data.scad.filter(s => s.tipo_cf === 'C' && !s.copertura && !s.banca_pag);
const partiteF = () => S.data.scad.filter(s => s.tipo_cf === 'F' && !s.copertura && !s.banca_pag);
// fornitori: importi lordi, solo le partite in avere (decisione del 06/11: i saldi in dare non si analizzano)
const debitiF = () => partiteF().filter(s => s.importo < 0);
const proformeAttese = () => S.data.proforme.filter(p => p.stato === 'attesa' || p.stato === 'da_fatturare');

// ---------- Calcoli ----------
// Posizione contabile e stimata. La stima si fa CONTO PER CONTO: saldo contabile + movimenti bancari importati in NTS
// dopo l'ultima registrazione di quel conto + incassi/pagamenti segnati in Fiammetta dopo l'ultimo movimento importato.
// Poi: liquidità bancaria = c/c in attivo + accantonamenti; liquidità totale = bancaria + cassa contanti.
// Gli effetti SBF presentati (conti «c/incassi» in dare) non sono liquidità; se il conto è in avere gli effetti
// sono già stati accreditati in anticipo e il saldo è un debito verso la banca, come gli anticipi.
// La «carta di credito» è un conto transitorio e non entra nella liquidità.
// Conti uniti (tabella conti_uniti): per Cassa Padana il saldo del c/c è c/c + conto «c/incassi» (conto unico, indicazione di Andrea 09/11/2026):
// il conto unito entra nella riga del c/c e non conta più come effetti SBF. I movimenti banca contano solo quelli del c/c (rapporto 1 del file CBI).
// Il saldo dichiarato dalla banca nel file CBI (ctrl) serve da controllo: lo scarto = saldo Fiammetta senza segnati a mano − saldo della banca.
function posizione() {
  const D = S.data, sp = D.sp, stima = D.stimaBanca || [];
  const righe = D.banche.map(b => ({ conto: b.conto, descrizione: b.descrizione, categoria: b.categoria, ultima_registrazione: b.ultima_registrazione, contabile: Number(b.saldo) || 0, mov: 0, app: 0, nApp: 0, info: null, uniti: [], ctrl: null }));
  (D.uniti || []).forEach(u => {
    const i = righe.findIndex(y => Number(y.conto) === Number(u.conto_unito)), r = righe.find(y => Number(y.conto) === Number(u.conto_cc));
    if (i < 0 || !r) return;
    const x = righe.splice(i, 1)[0]; r.contabileCC = (r.contabileCC != null ? r.contabileCC : r.contabile); r.contabile += x.contabile;
    r.uniti.push({ conto: x.conto, descrizione: x.descrizione, contabile: x.contabile, ultima_registrazione: x.ultima_registrazione, nota: u.nota });
  });
  stima.forEach(x => {
    const r = righe.find(y => y.conto === x.sottoconto); if (!r) return;
    r.info = x; r.mov = Number(x.accrediti_dopo || 0) - Number(x.addebiti_dopo || 0);
    // il saldo della banca confronta bene solo se il file arriva fino all'ultimo giorno con movimenti
    if (x.saldo_banca != null && x.data_saldo_banca && (!x.ultimo_movimento || x.data_saldo_banca >= x.ultimo_movimento)) r.ctrl = { saldo: Number(x.saldo_banca), data: x.data_saldo_banca, scarto: 0 };
  });
  righe.forEach(r => { if (r.ctrl) r.ctrl.scarto = r.contabile + r.mov - r.ctrl.saldo; });
  const ultimoMov = stima.reduce((m, x) => (x.ultimo_movimento || '') > m ? x.ultimo_movimento : m, '');
  let senzaConto = 0, nIn = 0, nOut = 0; const dateApp = [];
  D.movimenti.filter(m => m.stato === 'attesa').forEach(m => {
    const v = (m.tipo === 'incasso' ? 1 : -1) * Number(m.importo || 0);
    const cc = righe.filter(x => x.categoria === 'cc' && m.banca && nomeBanca(x.descrizione) === m.banca);
    const r = m.banca === 'Cassa' ? righe.find(x => x.categoria === 'cassa') : (cc.find(x => x.info) || cc[0]);
    const ultimo = r && r.info ? r.info.ultimo_movimento : (r ? '' : ultimoMov);
    if (ultimo && m.data <= ultimo) return; // gia' compreso nei movimenti bancari importati
    if (r) { r.app += v; r.nApp++; } else senzaConto += v;
    if (v >= 0) nIn++; else nOut++; dateApp.push(m.data);
  });
  righe.forEach(r => { r.stimato = r.contabile + r.mov + r.app; });
  const quadro = k => {
    const di = c => righe.filter(x => x.categoria === c), tot = rows => sum(rows, x => x[k]);
    const cc = di('cc'), sbf = di('sbf');
    const q = { ccAttivi: tot(cc.filter(x => x[k] > 0)), scoperti: -tot(cc.filter(x => x[k] < 0)), acc: tot(di('accantonamento')), cassa: tot(di('cassa')),
      sbfPresentati: tot(sbf.filter(x => x[k] > 0)), sbfAnticipati: -tot(sbf.filter(x => x[k] < 0)), anticipiConti: -tot(di('anticipi')) };
    q.liqBanca = q.ccAttivi + q.acc; q.liquidita = q.liqBanca + q.cassa; q.anticipi = q.anticipiConti + q.sbfAnticipati;
    return q;
  };
  const c = quadro('contabile'), s = quadro('stimato');
  s.liquidita += senzaConto;
  const fin = -sum(sp.filter(x => x.voce === 'SP.DEB_FINANZIAMENTI'), x => x.saldo);
  const soci = -sum(sp.filter(x => x.voce === 'SP.DEB_SOCI'), x => x.saldo);
  const pfn = fin + c.anticipi + c.scoperti - c.liquidita, pfnStima = fin + s.anticipi + s.scoperti - s.liquidita;
  const dataStima = [ultimoMov, ...dateApp, D.stato.ultima_registrazione].filter(Boolean).sort().pop();
  return { c, s, righe, fin, soci, pfn, pfnStima, pfnTot: pfn + soci, pfnTotStima: pfnStima + soci, ultimoMov, dataStima, nIn, nOut, senzaConto,
    liquidita: c.liquidita, stima: s.liquidita, scoperti: c.scoperti, scopertiStima: s.scoperti, anticipi: s.anticipi,
    diversa: Math.abs(s.liquidita - c.liquidita) > 0.5 || Math.abs(s.scoperti - c.scoperti) > 0.5 };
}
// Controlli sui saldi: conti uniti registrati in ritardo sul c/c e scarti rispetto al saldo dichiarato dalla banca nel file CBI
const SOGLIA_SCARTO = 50;
function controlliBanca(pos) {
  const ritardi = [], scarti = [];
  pos.righe.filter(r => r.categoria === 'cc').forEach(r => {
    const banca = nomeBanca(r.descrizione);
    r.uniti.forEach(u => { if (r.ultima_registrazione && u.ultima_registrazione && giorni(u.ultima_registrazione, r.ultima_registrazione) > 20) ritardi.push({ banca, r, u }); });
    if (r.ctrl && Math.abs(r.ctrl.scarto) > SOGLIA_SCARTO) scarti.push({ banca, r });
  });
  return { ritardi, scarti };
}
const testoControlli = (ctr, conLink) => [
  ...ctr.ritardi.map(x => `<b>${esc(x.banca)}</b>: il conto «${esc(x.u.descrizione)}» è registrato in NTS solo fino al ${fmtD(x.u.ultima_registrazione)} (il c/c fino al ${fmtD(x.r.ultima_registrazione)}): il saldo del c/c, che comprende questo conto, non ha ancora i movimenti successivi.`),
  ...ctr.scarti.map(x => `<b>${esc(x.banca)}</b>: secondo il file della banca il c/c è ${eur(x.r.ctrl.saldo)} al ${fmtD(x.r.ctrl.data)}, Fiammetta ${eur(x.r.contabile + x.r.mov)} (differenza ${eur(Math.abs(x.r.ctrl.scarto))}).`)
].join('<br>') + (conLink ? ` ${link('dettaglio', 'banche', 'scoperti')}` : '');
const rateAperte = () => S.data.rate.filter(r => r.stato !== 'pagata' && r.stato !== 'saltata' && r.stato_piano === 'attivo');
// Stato di un piano. Il residuo comprende tutte le rate non pagate (anche le saltate: il debito resta).
// Per l'AdER il contatore della decadenza = rate saltate + rate scadute non ancora confermate (come nel cruscotto storico).
function statoAder(p) {
  const rs = S.data.rate.filter(r => r.piano_id === p.id);
  const saltate = rs.filter(r => r.stato === 'saltata').length, daConf = rs.filter(r => r.stato_effettivo === 'da_confermare').length;
  const nonPagate = rs.filter(r => r.stato !== 'pagata');
  const prossima = rs.find(r => r.stato !== 'pagata' && r.stato !== 'saltata' && r.scadenza >= OGGI);
  const soglia = p.soglia_decadenza || S.data.P.soglia_decadenza_ader || 8;
  const contatore = saltate + daConf;
  return { saltate, daConf, contatore, residue: nonPagate.length, residuo: sum(nonPagate, r => r.importo), pagate: rs.filter(r => r.stato === 'pagata').length, prossima, soglia, margine: soglia - contatore, tot: rs.length, totale: sum(rs, r => r.importo) };
}
function ceAnno(anno) {
  const rows = S.data.ce.filter(r => r.anno === anno);
  const voci = {}; const mesi = new Set();
  rows.forEach(r => { mesi.add(r.mese); const v = voci[r.voce] || (voci[r.voce] = { voce: r.voce, descrizione: r.descrizione, gruppo: r.gruppo, ordine: r.ordine, segno: r.segno, t: [0, 0, 0, 0] }); v.t[Math.floor((r.mese - 1) / 3)] += Number(r.saldo) * r.segno; });
  const mesiTrim = [0, 0, 0, 0]; mesi.forEach(m => mesiTrim[Math.floor((m - 1) / 3)]++);
  const lista = Object.values(voci).sort((a, b) => a.ordine - b.ordine);
  const g = gr => [0, 1, 2, 3].map(i => sum(lista.filter(v => v.gruppo === gr), v => v.t[i]));
  const ric = g('RICAVI'), varc = g('COSTI_VARIABILI'), fis = g('COSTI_FISSI'), fuori = g('FUORI_EBITDA');
  const mdc = ric.map((x, i) => x - varc[i]), ebitda = mdc.map((x, i) => x - fis[i]);
  const ammReg = sum(lista.filter(v => v.voce === 'CE.AMMORTAMENTI'), v => sum(v.t));
  const ammStima = (!ammReg && S.data.P.ammortamenti_annui) ? mesiTrim.map(m => S.data.P.ammortamenti_annui / 12 * m) : null;
  const ris = ebitda.map((x, i) => x - fuori[i] - (ammStima ? ammStima[i] : 0));
  return { anno, lista, mesiTrim, ric, varc, fis, fuori, mdc, ebitda, ris, ammStima, mesi: [...mesi].sort((a, b) => a - b) };
}

// ---------- Componenti ----------
const pillStato = s => ({ pagata: '<span class="pill good">pagata</span>', saltata: '<span class="pill bad">saltata</span>', da_confermare: '<span class="pill warn">da confermare</span>', futura: '<span class="pill plain">futura</span>' }[s] || esc(s));
const tipoPiano = { finanziamento: 'Finanziamenti', simest: 'SIMEST', fornitore: 'Piani di rientro fornitori', ader: 'Rateizzazioni AdER', soci: 'Finanziamento soci', f24: 'F24 da versare', altro: 'Altro' };
const tipoPiano1 = { finanziamento: 'finanziamento', simest: 'SIMEST', fornitore: 'piano fornitore', ader: 'AdER', soci: 'soci', f24: 'F24', altro: 'altro' };
const tipoBanca = { cc: 'conto corrente', sbf: 'incassi / SBF', accantonamento: 'accantonamento', anticipi: 'anticipi', cassa: 'cassa' };
function nomeBanca(d) { d = (d || '').toLowerCase(); if (d.includes('verona')) return 'BPER Verona'; if (d.includes('emilia') || d.startsWith('bper')) return 'BPER'; if (d.includes('padana')) return 'Cassa Padana'; if (d.includes('credem')) return 'Credem'; if (d.includes('sondrio')) return 'Pop. Sondrio'; if (d.includes('valsabbina')) return 'Valsabbina'; if (d.includes('cassa')) return 'Cassa contanti'; return 'Altro'; }
const link = (testo, view, arg) => `<a href="#" class="lnk" onclick="UI.go('${view}'${arg ? ",'" + arg + "'" : ''});return false">${testo}</a>`;

function shell(inner) {
  return `<div class="shell"><aside class="side">
    <div class="brand"><svg class="flame" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2c2 6 9 9 9 17a9 9 0 0 1-18 0c0-4 2-6 3-8 0 3 1 5 3 5 0-5 1-10 3-14z" fill="#d9480f"/><path d="M16 14c1 3 4 4 4 8a4 4 0 0 1-8 0c0-3 2-4 4-8z" fill="#f59f00"/></svg><div><b>Fiammetta</b><small>Magikal · amministrazione</small></div></div>
    <nav class="nav">${VISTE.map(([k, l]) => `<button class="${S.view === k ? 'on' : ''}" onclick="UI.go('${k}')">${l}</button>`).join('')}</nav>
    <div class="foot"><div class="info">${esc(S.me ? S.me.nome : S.email)}<br>Gestionale: ${S.data.stato.ultimo_invio ? fmtDT(S.data.stato.ultimo_invio) : 'mai'}<br>Registrazioni fino al ${fmtD(S.data.stato.ultima_registrazione)}</div><div class="act"><button onclick="UI.reload()">Aggiorna</button><button class="pw" onclick="UI.modal('password')">Password</button><button onclick="UI.logout()">Esci</button></div></div>
  </aside><main class="main">${inner}</main></div>${S.modal ? renderModal() : ''}`;
}
// Sul telefono le tabelle «resp» diventano schede: ogni cella riceve il nome della sua colonna
function etichette() {
  document.querySelectorAll('table.resp').forEach(t => {
    const rows = [...t.rows]; if (!rows.length) return;
    const h = [...rows[0].cells].map(c => c.textContent.trim());
    rows.slice(1).forEach(r => [...r.cells].forEach((c, i) => { c.dataset.label = h[i] || ''; }));
  });
}
function render() {
  if (!S.data) return;
  const page = { oggi: pageOggi, partite: pagePartite, scadenziario: pageScadenziario, ce: pageCE, banche: pageBanche, stato: pageStato, impostazioni: pageImpostazioni }[S.view] || pageOggi;
  const sc = window.scrollY; $('#app').innerHTML = shell(page()); etichette(); window.scrollTo(0, S._keepScroll ? sc : 0); S._keepScroll = false;
  const first = document.querySelector('.modal input:not([type=hidden]):not([type=checkbox]),.modal select');
  if (first && S.modal && !S.modal._f) { first.focus(); S.modal._f = true; }
}

// ---------- Oggi ----------
const segnato = v => Math.abs(v) < 0.5 ? '–' : (v > 0 ? '+ ' : '− ') + eur(Math.abs(v));
const kpiBox = (label, val, sub, cls) => `<div><div class="small muted">${label}</div><div class="kpi sm ${cls || ''}">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
function pianiFornitori() {
  const g = {};
  S.data.piani.filter(p => p.tipo === 'fornitore' && p.stato === 'attivo').forEach(p => { const k = p.controparte || p.nome; const x = g[k] || (g[k] = { nome: k, piani: [], residuo: 0, partite: [] }); x.piani.push(p); x.residuo += statoAder(p).residuo; });
  S.data.scad.filter(s => s.tipo_cf === 'F' && s.piano).forEach(s => { const k = s.piano.controparte || s.piano.nome; if (g[k]) g[k].partite.push(s); });
  return Object.values(g).sort((a, b) => b.residuo - a.residuo);
}
function pageOggi() {
  const D = S.data, P = D.P, pos = posizione(), s = pos.s;
  const pc = partiteC(), df = debitiF();
  const scadC = pc.filter(x => x.attesa < OGGI), scadF = df.filter(x => x.datsca < OGGI && !x.piano);
  const scadutoC = sum(scadC, x => x.importo), scadutoF = -sum(scadF, x => x.importo);
  const aperturaC = sum(scadC.filter(x => x.apertura), x => x.importo);
  const pf = pianiFornitori(), inBanca = (D.nuovi || []).filter(m => m.abb && m.abb.tipo !== 'proforma');
  const fine = addDays(OGGI, 30);
  const rate30 = rateAperte().filter(r => r.scadenza >= OGGI && r.scadenza <= fine);
  const forn30 = df.filter(x => x.datsca >= OGGI && x.datsca <= fine && !x.piano);
  const cli30 = pc.filter(x => x.attesa >= OGGI && x.attesa <= fine);
  const prof = proformeAttese().filter(p => p.atteso <= fine), profTutte = proformeAttese();
  const usciteRate = sum(rate30, r => r.importo), usciteForn = -sum(forn30, x => x.importo), incassi = sum(cli30, x => x.importo), incProf = sum(prof, p => p.totdoc);
  const daConf = D.rate.filter(r => r.stato_effettivo === 'da_confermare' && r.stato_piano === 'attivo');
  const ader = D.piani.filter(p => p.tipo === 'ader' && p.stato === 'attivo').map(p => ({ p, s: statoAder(p) }));
  const eventi = [...rate30.map(r => ({ d: r.scadenza, t: r.tipo === 'f24' ? 'F24' + (r.nota ? ' · ' + r.nota : '') : r.nome + (r.n_rate ? ` · rata ${r.n}/${r.n_rate}` : ''), v: -r.importo, k: tipoPiano1[r.tipo] || r.tipo })),
    ...forn30.map(x => ({ d: x.datsca, t: (x.controparte || x.conto) + (x.numdoc ? ` · ft ${x.numdoc}` : ''), v: x.importo, k: 'fornitore' })),
    ...cli30.map(x => ({ d: x.attesa, t: (x.controparte || x.conto) + (x.numdoc ? ` · ft ${x.numdoc}` : '') + (x.attesa !== x.datsca ? ' · regola cliente' : ''), v: x.importo, k: 'cliente' }))];
  const perData = {}; eventi.forEach(e => (perData[e.d] = perData[e.d] || []).push(e));
  const ev = e => `<span class="t">${esc(e.t)}</span><span class="k"><span class="pill plain">${esc(e.k)}</span></span><span class="v ${e.v < 0 ? 'bad' : 'good'}">${eur(e.v)}</span>`;
  const elenco = Object.keys(perData).sort().map(d => {
    const es = perData[d].sort((a, b) => a.v - b.v);
    if (es.length === 1) return `<div class="ev"><span class="d">${fmtD(d)}</span>${ev(es[0])}</div>`;
    const tipi = {}; es.forEach(e => tipi[e.k] = (tipi[e.k] || 0) + 1); const tot = sum(es, e => e.v);
    return `<details class="evg"><summary class="ev"><span class="d">${fmtD(d)}</span><span class="t"><b>${es.length} movimenti</b> <span class="small muted">${Object.entries(tipi).map(([k, n]) => n + ' ' + k).join(' · ')}</span></span><span class="k"></span><span class="v ${tot < 0 ? 'bad' : 'good'}"><b>${eur(tot)}</b></span></summary>${es.map(e => `<div class="ev sub"><span class="d"></span>${ev(e)}</div>`).join('')}</details>`;
  }).join('');
  const liqClass = s.liquidita < (P.uscite_fisse_mese || 0) ? 'warn' : 'good';
  const netto = s.liquidita - s.scoperti, nettoFine = netto + incassi - usciteRate - usciteForn;
  return `<div class="head"><h2>Oggi · ${new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2><span class="small muted">registrazioni fino al ${fmtD(D.stato.ultima_registrazione)} · movimenti banca fino al ${fmtD(pos.ultimoMov)} · ${link('stato dei dati', 'stato')}</span></div>
  ${daConf.length ? `<div class="alert"><b>${daConf.length} rate scadute senza esito</b> (${eur(sum(daConf, r => r.importo))}): vanno segnate come pagate o saltate nello ${link('Scadenziario', 'scadenziario', 'conferma')}.</div>` : ''}
  ${(() => { const t = testoControlli(controlliBanca(pos), true); return t ? `<div class="alert"><b>Controllo con le banche</b><br>${t}</div>` : ''; })()}
  ${D.stato.conti_da_mappare ? `<div class="alert"><b>${D.stato.conti_da_mappare} conti con movimenti non ancora classificati</b>: il conto economico non li include. Si classificano in ${link('Impostazioni → Mappa dei conti', 'impostazioni')}.</div>` : ''}
  <div class="stack"><div class="row4">
    <div class="card"><h3>${link('Liquidità', 'banche', 'liquidita')}</h3><div class="kpi ${liqClass}">${eur(s.liquidita)}</div>
      <div class="sub">bancaria ${eur(s.liqBanca)} (c/c in attivo ${eur(s.ccAttivi)} + accantonamenti ${eur(s.acc)}) · cassa ${eur(s.cassa)}</div>
      ${s.sbfPresentati > 0.5 ? `<div class="sub">non conteggiati: effetti SBF presentati ${eur(s.sbfPresentati)}</div>` : ''}
      ${pos.diversa ? `<div class="sub">stimata al ${fmtD(pos.dataStima)} · contabile al ${fmtD(D.stato.ultima_registrazione)}: ${eur(pos.c.liquidita)}</div>` : ''}
      ${P.uscite_fisse_mese ? `<div class="sub">Uscite fisse di un mese: ${eur(P.uscite_fisse_mese)} ${s.liquidita < P.uscite_fisse_mese ? '<span class="pill warn">sotto soglia</span>' : '<span class="pill good">coperte</span>'}</div>` : ''}</div>
    <div class="card"><h3>${link('Scoperti e anticipi', 'banche', 'scoperti')}</h3><div class="kpi">${eur(s.scoperti + s.anticipi)}</div><div class="sub">scoperti di c/c ${eur(s.scoperti)}${Math.abs(s.scoperti - pos.c.scoperti) > 0.5 ? ` (contabile ${eur(pos.c.scoperti)})` : ''} · anticipi ${link(eur(s.anticipi), 'banche', 'anticipi')}</div>${D.saldi[0] && D.saldi[0].accordato_anticipi ? `<div class="sub">Ultimo saldo dal portale ${esc(D.saldi[0].banca)} ${fmtD(D.saldi[0].data)}: anticipi ${eur(D.saldi[0].anticipi_utilizzati)} su accordato ${eur(D.saldi[0].accordato_anticipi)}</div>` : ''}</div>
    <div class="card"><h3>${link('PFN bancaria', 'banche')}</h3><div class="kpi">${eur(pos.pfnStima)}</div><div class="sub">finanziamenti ${eur(pos.fin)} + anticipi ${eur(s.anticipi)} + scoperti ${eur(s.scoperti)} − liquidità ${eur(s.liquidita)}${pos.diversa ? ` · contabile ${eur(pos.pfn)}` : ''}</div><div class="sub">con finanziamento soci (${eur(pos.soci)}): <b>${eur(pos.pfnTotStima)}</b></div></div>
    <div class="card"><h3>Scaduto</h3>
      <div class="kpi sm">${link('clienti', 'partite', 'incassi:scaduto')} <span class="${scadutoC > 0 ? 'warn' : ''}">${eur(scadutoC)}</span></div><div class="sub">${scadC.length} partite oltre la data attesa${aperturaC ? ` · di cui saldi 2025 ${eur(aperturaC)}` : ''}</div>
      <div class="kpi sm" style="margin-top:8px">${link('fornitori', 'partite', 'pagamenti:scaduto')} <span class="${scadutoF > 0 ? 'bad' : ''}">${eur(scadutoF)}</span></div><div class="sub">${scadF.length} partite scadute, fuori dai piani di rientro</div>
      ${pf.length ? `<div class="sub">${link('piani di rientro', 'partite', 'pagamenti:piani')}: ${pf.map(x => esc(x.nome) + ' ' + eur(x.residuo)).join(' · ')}</div>` : ''}
      ${inBanca.length ? `<div class="sub">${link(inBanca.length + ' pagamenti e incassi', 'partite', 'banca')} già passati in banca, da registrare in NTS: non contati</div>` : ''}</div>
  </div>
  <div class="card"><h3>Prossimi 30 giorni (fino al ${fmtD(fine)})</h3>
    <div class="row4" style="margin-bottom:12px">${kpiBox('Uscite', '− ' + eur(usciteRate + usciteForn), `rate, F24 e piani ${eur(usciteRate)} · ${link('fornitori in scadenza', 'partite', 'pagamenti:prossime')} ${eur(usciteForn)}`, 'bad')}${kpiBox('Incassi attesi', '+ ' + eur(incassi), `${link('fatture ai clienti', 'partite', 'incassi:prossime')} (${cli30.length})`, 'good')}${kpiBox('Proforme da incassare', '+ ' + eur(incProf), `${link(prof.length + ' proforme', 'partite', 'incassi:proforme')}, ordini non ancora fatturati${profTutte.length > prof.length ? ` · altre ${profTutte.length - prof.length} dopo i 30 giorni (clienti che pagano dopo la consegna)` : ''}`, 'good')}${kpiBox('Saldo netto dei conti a fine periodo', eur(nettoFine), `liquidità − scoperti di c/c (oggi ${eur(netto)}), senza proforme, stipendi, F24 e spese correnti`, nettoFine < 0 ? 'warn' : '')}</div>
    ${elenco ? `<div class="evl">${elenco}</div><div class="small muted" style="margin-top:6px">Le date con più movimenti si aprono con un clic.</div>` : '<div class="muted">Nessuna scadenza nei prossimi 30 giorni.</div>'}</div>
  <div class="card"><h3>Rateizzazioni AdER</h3>${ader.length ? `<ul class="list">${ader.map(({ p, s }) => `<li><div><b>${esc(p.nome)}</b><div class="d">${s.pagate}/${s.tot} pagate · contatore <b>${s.contatore}/${s.soglia}</b> (${s.saltate} saltate${s.daConf ? ` + <span class="warn">${s.daConf} scadute da confermare</span>` : ''}) · residuo ${eur(s.residuo)} · prossima ${s.prossima ? fmtD(s.prossima.scadenza) + ' ' + eur2(s.prossima.importo) : '–'}</div><div class="bar"><i class="${s.margine <= 1 ? 'bad' : s.margine <= 3 ? 'warn' : 'good'}" style="width:${Math.min(100, 100 * s.contatore / s.soglia)}%"></i></div></div><div class="right">${s.margine <= 1 ? '<span class="pill bad">decadenza vicina</span>' : s.margine <= 3 ? '<span class="pill warn">attenzione</span>' : '<span class="pill good">regolare</span>'}</div></li>`).join('')}</ul>` : '<div class="muted">Nessun piano AdER attivo.</div>'}<div class="small muted" style="margin-top:8px">Contatore = rate saltate + rate scadute non ancora confermate, come nel cruscotto storico: una rata scaduta conta finché non viene segnata pagata. Residuo = tutte le rate non pagate, saltate comprese.</div></div>
  </div>`;
}

// ---------- Crediti e debiti ----------
function gruppiPartite(rows, cli) {
  const D = S.data, q = S.partite.cerca;
  const gruppi = {}; rows.forEach(s => { const g = gruppi[s.conto] || (gruppi[s.conto] = { conto: s.conto, nome: s.controparte || String(s.conto), rows: [], tot: 0 }); g.rows.push(s); g.tot += s.importo; });
  const lista = Object.values(gruppi).sort((a, b) => cli ? b.tot - a.tot : a.tot - b.tot);
  const segno = v => cli ? v : -v;
  return lista.length ? lista.map(g => `<details class="piano" ${lista.length <= 6 || q ? 'open' : ''}><summary><span class="nm">${esc(g.nome)}<div class="small muted">conto ${g.conto}${D.R[g.conto] ? ' · regola: ' + (D.R[g.conto].base === 'scadenza' ? 'scadenza' : 'fattura') + ' + ' + D.R[g.conto].giorni + ' gg' : ''}</div></span><span class="small nowrap">${g.rows.length} partite</span><span class="nowrap right"><b>${eur2(segno(g.tot))}</b></span></summary><div class="body">${tabellaPartite(g.rows, cli)}</div></details>`).join('') : '<div class="card muted">Nessuna partita.</div>';
}
// Proforme: ogni riga mostra la catena ordine → bolla → fattura e a che punto è la proforma
const GRUPPI_PF = [['attesa', 'Da incassare · merce da spedire'], ['da_fatturare', 'Spedite, non ancora fatturate'], ['fatturata', 'Già fatturate · il credito è già nelle fatture da incassare'],
  ['pagata', 'Pagate · merce da spedire o da fatturare'], ['verifica', 'Da verificare · nessun collegamento sicuro'], ['doppia', 'Doppie · proforma rifatta'], ['chiusa', 'Chiuse · fattura incassata'], ['incassata', 'Segnate incassate a mano'], ['annullata', 'Non valide']];
function catenaProforma(p) {
  const r = [], o = p.ordine;
  if (o) r.push(`ordine n. ${o.numord} del ${fmtD(o.datord)}${o.flevas === 'S' ? '' : ' · consegna prevista ' + fmtD(o.datcons)}${Math.abs(o.totdoc - p.totdoc) > 0.5 ? ' · ' + eur2(o.totdoc) : ''}`);
  p.bolle.slice(0, 3).forEach(b => r.push(`bolla n. ${b.numdoc} del ${fmtD(b.datdoc)}`));
  p.fatture.forEach(f => { const ac = partiteDellaFattura(f).map(x => x.accontoDa).find(Boolean);
    r.push(`fattura n. ${f.numdoc} del ${fmtD(f.datdoc)} · ${f.aperto > 0.005 ? (ac ? `<b>già pagata</b> con l'acconto del ${fmtD(ac.datdoc || ac.datsca)} (${eur2(-ac.importo)}), da abbinare in NTS` : '<b>da incassare ' + eur2(f.aperto) + '</b>' + (f.scadenza ? ' entro ' + fmtD(f.scadenza) : '')) : 'incassata' + (f.incassata_il ? ' ' + fmtD(f.incassata_il) : '')}`); });
  if (!r.length) r.push('<span class="muted">nessun ordine né bolla collegati</span>');
  return r.map(x => `<span class="d2">${x}</span>`).join('');
}
function statoProforma(p) {
  const abit = () => { if (!p.abitudine) return ''; const a = p.abitudineDati;
    return `<span class="d2">${p.abitudine === 'dopo' ? `di solito paga dopo la consegna (storico: ${a.dopo} su ${a.n}${a.mediana ? ', circa ' + a.mediana + ' giorni dopo' : ''}): incasso atteso verso il ${fmtD(p.atteso)}` : `di solito paga prima della consegna (storico: ${a.n - a.dopo} su ${a.n})`}</span>`; };
  const s = p.stato;
  if (s === 'attesa') return `<span class="pill warn">da incassare</span><span class="d2">${p.tappa === 'da_spedire' ? 'merce da spedire' : 'nessun ordine collegato'}</span>${abit()}`;
  if (s === 'da_fatturare') return `<span class="pill warn">spedita, da fatturare</span><span class="d2">incasso atteso dopo la fattura</span>${abit()}`;
  if (s === 'pagata') return `<span class="pill good">pagata ${fmtD(p.pagata)}</span><span class="d2">${p.pagata_da === 'banca' ? 'bonifico visto in banca' : 'incasso registrato in NTS'}, ${p.bolle.length ? 'merce spedita, da fatturare' : 'merce da spedire'}</span>`;
  if (s === 'fatturata') {
    const part = p.fatture.flatMap(partiteDellaFattura), visto = part.length && part.every(x => x.copertura || x.banca_pag);
    return `<span class="pill plain">fatturata ${fmtD(p.fatturata_il)}</span><span class="d2">${p.fatture.length ? (visto ? 'incasso già visto in banca o segnato in Fiammetta' : 'già tra le fatture da incassare: non si conta due volte') : 'fattura non collegata'}</span>`;
  }
  if (s === 'chiusa') return `<span class="pill good">chiusa</span><span class="d2">${p.accontata ? 'fattura pagata con un acconto che in NTS non è ancora abbinato alla fattura: va abbinato in prima nota' : 'fattura incassata'}</span>`;
  if (s === 'doppia') return `<span class="pill plain">doppia</span><span class="d2">stesso ordine o bolla della proforma n. ${p.doppia.numdoc}</span>`;
  if (s === 'verifica') return `<span class="pill warn">da verificare</span><span class="d2">${p.tappa === 'evasa_nd' ? 'ordine evaso ma bolla e fattura non trovate' : 'nessun ordine, bolla o pagamento collegati da più di 120 giorni'}</span>`;
  if (s === 'incassata') return `<span class="pill good">incassata ${fmtD(p.copertura.data)}</span>`;
  return '<span class="pill plain">non valida</span>';
}
function tabellaProforme(rows) {
  if (!rows.length) return '<div class="card muted">Nessuna proforma.</div>';
  const presenti = GRUPPI_PF.filter(([k]) => rows.some(p => p.stato === k)), conIntest = presenti.length > 1;
  const riga = p => `<tr><td class="nowrap">n. ${p.numdoc}<span class="d2">${fmtD(p.datdoc)}</span></td><td>${esc(p.controparte || p.conto)}${p.paese && p.paese !== 'IT' ? ' <span class="pill plain">' + esc(p.paese) + '</span>' : ''}${p.pagamento ? `<span class="d2">${esc(p.pagamento)}</span>` : ''}</td><td class="small">${catenaProforma(p)}</td><td class="num">${eur2(p.totdoc)}</td><td>${statoProforma(p)}${p.copertura && p.copertura.nota ? '<span class="d2">' + esc(p.copertura.nota) + '</span>' : ''}</td><td class="right">${['attesa', 'da_fatturare', 'verifica'].includes(p.stato) ? `<button class="btn sm primary" onclick="UI.modal('incasso','pf:${p.chiave}')">Incassata</button> <button class="btn sm ghost" onclick="UI.annullaProforma('${p.chiave}')">non valida</button>` : p.copertura ? `<button class="btn sm ghost" onclick="UI.annullaMovimento(${p.copertura.id})">annulla</button>` : ''}</td></tr>`;
  const corpo = presenti.map(([k, titolo]) => { const g = rows.filter(p => p.stato === k);
    return (conIntest ? `<tr class="grp"><td colspan="6">${titolo} · ${g.length} · ${eur(sum(g, p => p.totdoc))}</td></tr>` : '') + g.map(riga).join(''); }).join('');
  return `<div class="card"><div class="scroll"><table class="resp"><tr><th>Proforma</th><th>Cliente</th><th>Ordine, bolla e fattura</th><th class="num">Importo</th><th>Stato</th><th></th></tr>${corpo}</table></div></div>`;
}
function pagePartite() {
  const D = S.data, T = S.partite, q = T.cerca.toLowerCase();
  const tabs = [['incassi', 'Da incassare'], ['pagamenti', 'Da pagare'], ['banca', 'In banca, da registrare'], ['attesa', 'Segnati in Fiammetta']];
  if (!tabs.some(t => t[0] === T.tab)) T.tab = 'incassi';
  const fine = addDays(OGGI, 30);
  const cerca = rows => q ? rows.filter(s => (s.controparte || '').toLowerCase().includes(q) || String(s.numdoc || '').includes(q) || String(s.conto).includes(q)) : rows;
  const filtriHtml = filtri => `<div class="tabs">${filtri.map(([k, l]) => `<button class="${T.filtro === k ? 'on' : ''}" onclick="UI.partite(null,'${k}')">${l}</button>`).join('')}</div>`;
  const cercaHtml = ph => `<div class="row" style="margin-bottom:10px"><input class="search" placeholder="${ph}" value="${esc(T.cerca)}" oninput="UI.cercaPartite(this.value)"></div>`;
  let body = '';
  if (T.tab === 'incassi') {
    const filtri = [['tutto', 'Tutto'], ['scaduto', 'Oltre la data attesa'], ['prossime', 'Attesi entro 30 giorni'], ['oltre', 'Attesi oltre 30 giorni'], ['proforme', 'Solo proforme']];
    if (!filtri.some(f => f[0] === T.filtro)) T.filtro = 'tutto';
    const pc = partiteC();
    const scad = pc.filter(s => s.attesa < OGGI), pros = pc.filter(s => s.attesa >= OGGI && s.attesa <= fine), oltre = pc.filter(s => s.attesa > fine);
    const prof = proformeAttese(), perStato = k => D.proforme.filter(p => p.stato === k), verifica = perStato('verifica'), pagate = perStato('pagata'), fatturate = perStato('fatturata'), doppie = perStato('doppia'), daSped = perStato('attesa'), daFatt = perStato('da_fatturare');
    const inBanca = D.scad.filter(s => s.tipo_cf === 'C' && s.banca_pag);
    const tot = sum(pc, s => s.importo) + sum(prof, p => p.totdoc), sal25 = sum(scad.filter(s => s.apertura), s => s.importo);
    let rows = T.filtro === 'scaduto' ? scad : T.filtro === 'prossime' ? pros : T.filtro === 'oltre' ? oltre : T.filtro === 'proforme' ? [] : pc;
    rows = cerca(rows);
    const PF_FILTRI = [['aperte', 'Aperte'], ['incassare', 'Da incassare'], ['pagata', 'Pagate, da spedire'], ['verifica', 'Da verificare'], ['chiuse', 'Chiuse e doppie'], ['tutte', 'Tutte']];
    const pff = PF_FILTRI.some(f => f[0] === T.pfFiltro) ? T.pfFiltro : 'aperte';
    const pfStati = { aperte: ['attesa', 'da_fatturare', 'fatturata', 'verifica'], incassare: ['attesa', 'da_fatturare'], pagata: ['pagata'], verifica: ['verifica'], chiuse: ['chiusa', 'doppia', 'incassata', 'annullata'], tutte: null }[pff];
    const pfRows = cerca(D.proforme.filter(p => !pfStati || pfStati.includes(p.stato)));
    body = `<div class="card" style="margin-bottom:12px"><div class="row5">${kpiBox('Fatture oltre la data attesa', eur(sum(scad, s => s.importo)), `${scad.length} partite${sal25 ? ` · di cui saldi 2025 ${eur(sal25)}` : ''}`, 'warn')}${kpiBox('Fatture attese entro 30 giorni', eur(sum(pros, s => s.importo)), pros.length + ' partite')}${kpiBox('Fatture attese oltre 30 giorni', eur(sum(oltre, s => s.importo)), oltre.length + ' partite')}${kpiBox('Proforme da incassare', eur(sum(prof, p => p.totdoc)), `${daSped.length} da spedire${daFatt.length ? ' · ' + daFatt.length + ' spedite, da fatturare' : ''}`)}${kpiBox('Totale da incassare', eur(tot), 'fatture + proforme', 'good')}</div>
      <div class="small muted" style="margin-top:8px">Non conteggiati: ${inBanca.length} incassi già arrivati in banca e da registrare in NTS (${eur(sum(inBanca, s => s.importo))}, ${link('vedi', 'partite', 'banca')}) · ${fatturate.length} proforme già fatturate (${eur(sum(fatturate, p => p.totdoc))}, il credito è già nelle fatture) · ${pagate.length} pagate e da spedire (${eur(sum(pagate, p => p.totdoc))}) · ${verifica.length} da verificare (${eur(sum(verifica, p => p.totdoc))}) · ${doppie.length} doppie</div></div>
      ${filtriHtml(filtri)}${cercaHtml('cerca cliente o numero')}
      ${T.filtro !== 'proforme' ? `<h3 style="margin:14px 0 8px">Fatture · ${rows.length} partite · ${eur(sum(rows, s => s.importo))}</h3><div class="small muted" style="margin-bottom:8px">La «data attesa» è la scadenza NTS, oppure quella della regola del cliente (es. NordicFire: fattura + 10 giorni). Con «Incassato» la partita esce subito dagli importi da incassare.</div>${gruppiPartite(rows, true)}` : ''}
      ${T.filtro === 'tutto' || T.filtro === 'proforme' ? `<h3 style="margin:18px 0 8px">Proforme · ${pfRows.length}</h3><div class="small muted" style="margin-bottom:8px">In Magikal la proforma non genera nulla in NTS: Fiammetta la collega all'ordine del cliente (stesso cliente, importo e data più vicini) e da lì alla bolla, alla fattura e all'incasso. Conta come «da incassare» finché la merce non è fatturata (da quel momento il credito è nelle fatture qui sopra) e finché non si vede il bonifico, in NTS o in banca.</div><div class="tabs">${PF_FILTRI.map(([k, l]) => `<button class="${pff === k ? 'on' : ''}" onclick="UI.pfFiltro('${k}')">${l}</button>`).join('')}</div>${tabellaProforme(pfRows)}` : ''}`;
  } else if (T.tab === 'pagamenti') {
    const filtri = [['tutto', 'Tutto'], ['scaduto', 'Scadute'], ['prossime', 'In scadenza entro 30 giorni'], ['oltre', 'Oltre 30 giorni'], ['piani', 'Piani di rientro']];
    if (!filtri.some(f => f[0] === T.filtro)) T.filtro = 'tutto';
    const df = debitiF().filter(s => !s.piano);
    const scad = df.filter(s => s.datsca < OGGI), pros = df.filter(s => s.datsca >= OGGI && s.datsca <= fine), oltre = df.filter(s => s.datsca > fine);
    const dare = partiteF().filter(s => s.importo > 0 && !s.piano), inBanca = D.scad.filter(s => s.tipo_cf === 'F' && s.banca_pag), pf = pianiFornitori();
    let rows = T.filtro === 'scaduto' ? scad : T.filtro === 'prossime' ? pros : T.filtro === 'oltre' ? oltre : T.filtro === 'piani' ? [] : df;
    rows = cerca(rows);
    const piani = pf.map(x => { const st = x.piani.map(p => ({ p, s: statoAder(p) })); const prossima = st.map(y => y.s.prossima).filter(Boolean).sort((a, b) => a.scadenza.localeCompare(b.scadenza))[0];
      return `<details class="piano" open><summary><span class="nm">${esc(x.nome)}<div class="small muted">${st.map(({ p, s }) => `${esc(p.nome)}: ${s.pagate}/${s.tot} rate pagate`).join(' · ')}</div></span><span class="small nowrap">prossima ${prossima ? fmtD(prossima.scadenza) + ' ' + eur(prossima.importo) : '–'}</span><span class="nowrap right">residuo piano <b>${eur(x.residuo)}</b></span></summary>
        <div class="body"><div class="small muted" style="margin-bottom:6px">Il debito si paga con le rate dello ${link('Scadenziario', 'scadenziario', 'piani')}. In NTS restano aperte ${x.partite.length} partite (saldo ${eur2(-sum(x.partite, s => s.importo))}): non contano nello scaduto.</div>${x.partite.length ? tabellaPartite(x.partite, false) : ''}</div></details>`; }).join('');
    body = `<div class="card" style="margin-bottom:12px"><div class="row5">${kpiBox('Scadute', eur(-sum(scad, s => s.importo)), scad.length + ' partite fuori dai piani', 'bad')}${kpiBox('In scadenza entro 30 giorni', eur(-sum(pros, s => s.importo)), pros.length + ' partite')}${kpiBox('Oltre 30 giorni', eur(-sum(oltre, s => s.importo)), oltre.length + ' partite')}${kpiBox('Totale fornitori da pagare', eur(-sum(df, s => s.importo)), 'importi lordi, fuori dai piani')}${kpiBox('Piani di rientro', eur(sum(pf, x => x.residuo)), pf.map(x => esc(x.nome)).join(' · ') || 'nessuno')}</div>
      <div class="small muted" style="margin-top:8px">Non conteggiati: ${inBanca.length} pagamenti già usciti dalla banca e da registrare in NTS (${eur(-sum(inBanca, s => s.importo))}, ${link('vedi', 'partite', 'banca')}) · ${dare.length} partite in dare (acconti, note di credito o scritture da sistemare, ${eur(sum(dare, s => s.importo))}).</div></div>
      ${filtriHtml(filtri)}${T.filtro !== 'piani' ? cercaHtml('cerca fornitore o numero fattura') : ''}
      ${T.filtro !== 'piani' ? `<h3 style="margin:14px 0 8px">Fatture da pagare · ${rows.length} partite · ${eur(-sum(rows, s => s.importo))}</h3>${gruppiPartite(rows, false)}` : ''}
      ${T.filtro === 'tutto' || T.filtro === 'piani' ? `<h3 style="margin:18px 0 8px">Piani di rientro</h3>${piani || '<div class="card muted">Nessun piano di rientro attivo.</div>'}` : ''}
      ${T.filtro === 'tutto' && dare.length ? `<details class="piano" style="margin-top:14px"><summary><span class="nm">Partite in dare (non conteggiate)<div class="small muted">acconti, note di credito, pagamenti da abbinare o scritture da sistemare in NTS</div></span><span class="small nowrap">${dare.length} partite</span><span class="nowrap right"><b>${eur2(sum(dare, s => s.importo))}</b></span></summary><div class="body">${tabellaPartite(cerca(dare), false)}</div></details>` : ''}`;
  } else if (T.tab === 'banca') {
    let rows = D.nuovi || [];
    if (q) rows = rows.filter(m => ((m.descr1 || '') + ' ' + (m.descr2 || '') + ' ' + (m.abb ? m.abb.nome : '')).toLowerCase().includes(q));
    const tutti = D.nuovi || [], abb = tutti.filter(m => m.abb);
    body = `<div class="card" style="margin-bottom:12px"><div class="row4">${kpiBox('Movimenti da registrare', String(tutti.length), 'importati in NTS dopo l\'ultima registrazione di ogni banca')}${kpiBox('Accrediti', '+ ' + eur(sum(tutti, m => m.accredito)), tutti.filter(m => m.accredito > 0).length + ' movimenti', 'good')}${kpiBox('Addebiti', '− ' + eur(sum(tutti, m => m.addebito)), tutti.filter(m => m.addebito > 0).length + ' movimenti', 'bad')}${kpiBox('Riconosciuti', String(abb.length), 'abbinati a fatture o proforme per importo')}</div>
      <div class="small muted" style="margin-top:8px">Questi movimenti sono già nella liquidità stimata. Quelli riconosciuti chiudono la partita in Fiammetta finché Miriam non li registra in NTS; gli altri (stipendi, F24, commissioni, giroconti…) restano solo nella liquidità.</div></div>
      ${cercaHtml('cerca nella descrizione o nel nome')}
      <div class="card"><div class="scroll"><table class="resp"><tr><th>Data</th><th>Banca</th><th class="num">Importo</th><th>Descrizione</th><th>Riconosciuto come</th></tr>${rows.map(m => `<tr><td class="nowrap">${fmtD(m.dataoperaz)}</td><td class="small">${esc(nomeBanca(m.banca))}</td><td class="num ${m.accredito > 0 ? 'good' : 'bad'}">${m.accredito > 0 ? '+ ' + eur2(m.accredito) : '− ' + eur2(m.addebito)}</td><td class="small full">${esc(m.descr1 || '')} <span class="muted">${esc(m.descr2 || '')}</span></td><td class="small">${m.abb ? `<span class="pill good">${esc(m.abb.tipo)}</span> ${esc(m.abb.nome || '')} <span class="muted">${esc(m.abb.rif || '')}</span>` : '<span class="muted">–</span>'}</td></tr>`).join('')}</table></div>${rows.length ? '' : '<div class="muted">Nessun movimento dopo l\'ultima registrazione.</div>'}</div>`;
  } else {
    const rows = D.movimenti.filter(m => m.stato === 'attesa');
    body = `<div class="small muted" style="margin-bottom:8px">Incassi e pagamenti segnati a mano in Fiammetta che NTS non ha ancora registrato. Spariscono da soli quando la partita viene chiusa in prima nota.</div>
    <div class="card"><div class="scroll"><table class="resp"><tr><th>Data</th><th>Tipo</th><th>Controparte</th><th>Riferimento</th><th class="num">Importo</th><th>Banca</th><th></th></tr>${rows.map(m => `<tr><td class="nowrap">${fmtD(m.data)}</td><td>${m.tipo === 'incasso' ? '<span class="pill good">incasso</span>' : '<span class="pill bad">pagamento</span>'}</td><td>${esc(m.controparte || m.conto || '')}</td><td class="small muted">${m.chiave_partita ? 'partita ' + esc(m.chiave_partita.split('|').slice(1, 4).join('/')) : m.chiave_doc ? 'proforma ' + esc(m.chiave_doc.split('|').pop()) : ''}${m.nota ? ' · ' + esc(m.nota) : ''}</td><td class="num">${eur2(m.importo)}</td><td class="small">${esc(m.banca || '')}<span class="d2">segnato da ${esc(m.creato_da || '')} il ${fmtD(m.creato_il)}</span></td><td class="right"><button class="btn sm ghost" onclick="UI.annullaMovimento(${m.id})">annulla</button></td></tr>`).join('')}</table></div>${rows.length ? '' : '<div class="muted">Niente in attesa.</div>'}</div>`;
  }
  return `<div class="head"><h2>Crediti e debiti</h2><span class="small muted">partite aperte in NTS al ${fmtD(D.stato.ultima_registrazione)} · movimenti banca fino al ${fmtD(posizione().ultimoMov)}</span></div>
  <div class="tabs" style="margin-bottom:10px">${tabs.map(([k, l]) => `<button class="${T.tab === k ? 'on' : ''}" style="${T.tab === k ? '' : 'border-color:#cfc5b8'}" onclick="UI.partite('${k}')">${l}</button>`).join('')}</div>${body}`;
}
function tabellaPartite(rows, cli) {
  rows = rows.slice().sort((a, b) => (cli ? a.attesa : a.datsca).localeCompare(cli ? b.attesa : b.datsca));
  return `<div class="scroll"><table class="resp"><tr><th>Documento</th><th>Scadenza NTS</th>${cli ? '<th>Attesa</th>' : ''}<th>Ritardo</th><th class="num">Importo</th><th>Pagamento e banca</th><th></th></tr>
  ${rows.map(s => { const rit = cli ? s.ritardo : giorni(s.datsca, OGGI); const d = cli ? s.attesa : s.datsca; return `<tr><td>${s.daAbbinare ? `<span class="pill warn" title="In NTS il ${cli ? 'pagamento del cliente' : 'pagamento al fornitore'} è registrato ma non abbinato alla fattura: va abbinato in prima nota">${cli ? 'incasso' : 'pagamento'} da abbinare</span>` : s.apertura ? '<span class="pill plain">saldo 2025</span>' : (s.numdoc ? '<span class="nowrap">ft ' + esc(String(s.numdoc)) + (s.alfdoc && s.alfdoc !== '00' ? '/' + esc(s.alfdoc) : '') + '</span> <span class="nowrap">del ' + fmtD(s.datdoc) + '</span>' : '–')}${s.insolu === 'S' ? ' <span class="pill bad">insoluto</span>' : ''}${s.flant === 'S' ? ' <span class="pill plain">anticipata</span>' : ''}${s.piano ? ' <span class="pill plain">piano ' + esc(s.piano.nome) + '</span>' : ''}${s.accontoDa ? ` <span class="pill good" title="In NTS c'è un acconto o un incasso dello stesso importo non abbinato alla fattura: la fattura è già pagata, va solo abbinata in prima nota">pagata con acconto del ${fmtD(s.accontoDa.datdoc || s.accontoDa.datsca)}</span>` : ''}${s.accontoPer ? ` <span class="small muted nowrap">per ft ${esc(String(s.accontoPer.numdoc))}</span>` : ''}</td><td class="nowrap">${fmtD(s.datsca)}</td>${cli ? `<td class="nowrap ${s.attesa !== s.datsca ? 'muted' : ''}">${fmtD(s.attesa)}</td>` : ''}<td class="nowrap ${rit > 0 && d < OGGI ? (rit > 60 ? 'bad' : 'warn') : 'muted'}">${d < OGGI ? rit + ' gg' : 'tra ' + (-rit) + ' gg'}</td><td class="num ${s.importo < 0 ? 'muted' : ''}">${eur2(cli ? s.importo : -s.importo)}</td><td class="small">${esc(s.pagamento || '')}${s.banca ? `<span class="d2">${esc(nomeBanca(s.banca) === 'Altro' ? s.banca : nomeBanca(s.banca))}</span>` : ''}</td><td class="right">${s.accontoDa || s.accontoPer ? '<span class="small muted">compensate</span>' : `<button class="btn sm ${cli ? 'primary' : ''}" onclick="UI.modal('incasso','pt:${s.chiave}')">${cli ? 'Incassato' : 'Pagato'}</button>`}</td></tr>`; }).join('')}</table></div>`;
}

// ---------- Scadenziario ----------
const ORDINE_PIANI = ['f24', 'ader', 'finanziamento', 'simest', 'soci', 'fornitore', 'altro'];
function pageScadenziario() {
  const D = S.data, f = S.filtroRate;
  const tabs = [['piani', 'Per piano'], ['prossime', 'Prossimi 60 giorni'], ['conferma', 'Da confermare'], ['tutte', 'Tutte le rate']];
  const attivi = D.piani.filter(p => (p.stato || 'attivo') === 'attivo').map(p => ({ p, s: statoAder(p) }));
  const resTipo = t => sum(attivi.filter(x => x.p.tipo === t), x => x.s.residuo);
  const tipi = ORDINE_PIANI.filter(t => attivi.some(x => x.p.tipo === t));
  const riepilogo = `<div class="card" style="margin-bottom:12px"><h3>Residuo da pagare dei piani attivi</h3><div class="row6">${tipi.map(t => kpiBox(tipoPiano[t], eur(resTipo(t)), attivi.filter(x => x.p.tipo === t).length + ' piani')).join('')}${kpiBox('Totale', '<b>' + eur(sum(attivi, x => x.s.residuo)) + '</b>', attivi.length + ' piani attivi')}</div>
    <div class="small muted" style="margin-top:8px">Residuo = tutte le rate non ancora pagate (capitale e interessi), comprese le rate saltate e quelle scadute da confermare: è quanto resta da versare.</div></div>`;
  let body = '';
  if (f === 'piani') {
    body = ORDINE_PIANI.map(t => { const ps = D.piani.filter(p => p.tipo === t); if (!ps.length) return ''; return `<h3 style="margin:18px 0 8px">${tipoPiano[t]} · residuo ${eur(resTipo(t))}</h3>` + ps.map(p => cardPiano(p)).join(''); }).join('');
  } else {
    let rs = D.rate.filter(r => r.stato_piano === 'attivo');
    if (f === 'prossime') rs = rs.filter(r => r.stato !== 'pagata' && r.stato !== 'saltata' && r.scadenza <= addDays(OGGI, 60));
    if (f === 'conferma') rs = rs.filter(r => r.stato_effettivo === 'da_confermare');
    if (f === 'tutte') rs = D.rate;
    body = `<div class="card">${tabellaRate(rs, true)}<div class="small muted" style="margin-top:8px">${rs.length} rate · totale ${eur(sum(rs, r => r.importo))}</div></div>`;
  }
  return `<div class="head"><h2>Scadenziario</h2><span><button class="btn primary" onclick="UI.modal('f24')">Aggiungi F24</button> <button class="btn" onclick="UI.modal('piano')">Nuovo piano</button></span></div>
  ${riepilogo}<div class="tabs">${tabs.map(([k, l]) => `<button class="${f === k ? 'on' : ''}" onclick="UI.filtro('${k}')">${l}</button>`).join('')}</div>${body}`;
}
function cardPiano(p) {
  const s = statoAder(p), rs = S.data.rate.filter(r => r.piano_id === p.id);
  const pagato = sum(rs.filter(r => r.stato === 'pagata'), r => r.importo);
  const stPill = (p.stato || 'attivo') === 'attivo' ? '' : `<span class="pill plain">${esc(String(p.stato).replace('_', ' '))}</span>`;
  const stato = p.tipo === 'ader'
    ? `${s.pagate}/${s.tot} pagate · contatore <b class="${s.margine <= 1 ? 'bad' : s.margine <= 3 ? 'warn' : ''}">${s.contatore}/${s.soglia}</b> (${s.saltate} saltate${s.daConf ? ` + <span class="warn">${s.daConf} da confermare</span>` : ''})`
    : `${s.pagate}/${s.tot} pagate${s.saltate ? ` · <span class="bad">${s.saltate} non pagate</span>` : ''}${s.daConf ? ` · <span class="warn">${s.daConf} da confermare</span>` : ''}`;
  return `<details class="piano" ${S._open === p.id ? 'open' : ''} ontoggle="UI.toggle('${p.id}',this.open)"><summary><span class="nm">${esc(p.nome)} ${stPill}<div class="small muted">${esc(p.controparte || '')}${p.descrizione ? ' · ' + esc(p.descrizione) : ''}</div></span>
    <span class="small nowrap">${stato}</span>
    <span class="small nowrap right">residuo <b>${eur(s.residuo)}</b> su ${eur(s.totale)}<div class="bar" style="width:140px"><i class="good" style="width:${s.totale ? 100 * pagato / s.totale : 0}%"></i></div></span></summary>
    <div class="body">${p.tipo === 'ader' ? `<div class="small muted" style="margin-bottom:6px">Prossima rata: ${s.prossima ? fmtD(s.prossima.scadenza) + ' · ' + eur2(s.prossima.importo) : '–'} · decadenza alla ${s.soglia}ª rata non pagata: contatore ${s.contatore}, margine ${s.margine}</div>` : ''}
    ${tabellaRate(rs, false)}
    <div class="row" style="margin-top:10px"><span class="small muted">${p.tipo === 'f24' ? 'Un versamento per ogni modello F24 ricevuto dal commercialista: scadenza, importo e che cosa si paga.' : `Capitale ${eur(p.capitale_iniziale)} · ${p.n_rate || rs.length} rate ${p.cadenza_mesi === 1 ? 'mensili' : p.cadenza_mesi === 6 ? 'semestrali' : 'ogni ' + p.cadenza_mesi + ' mesi'} da ${eur2(p.rata)}${p.rata1 ? ' (prima ' + eur2(p.rata1) + ')' : ''} · dal ${fmtD(p.prima_rata)}`}</span>
    <span style="margin-left:auto">${p.tipo === 'f24' ? '' : `<select class="btn sm" onchange="UI.statoPiano('${p.id}',this.value)">${['attivo', 'in_istruttoria', 'in_istanza', 'chiuso', 'decaduto'].map(x => `<option value="${x}" ${p.stato === x ? 'selected' : ''}>${x.replace('_', ' ')}</option>`).join('')}</select> `}${p.tipo === 'f24' ? `<button class="btn sm" onclick="UI.modal('f24')">Aggiungi F24</button>` : `<button class="btn sm" onclick="UI.modal('rata','${p.id}')">Aggiungi rata</button>`}</span></div></div></details>`;
}
function tabellaRate(rs, conPiano) {
  if (!rs.length) return '<div class="muted">Nessuna rata.</div>';
  return `<div class="scroll"><table class="resp"><tr>${conPiano ? '<th>Piano</th>' : ''}<th>N.</th><th>Scadenza</th><th class="num">Importo</th><th>Stato</th><th>Pagata il</th><th>Segnata da</th><th></th></tr>
  ${rs.map(r => `<tr>${conPiano ? `<td>${esc(r.nome)}<div class="small muted">${esc(r.controparte || '')}</div></td>` : ''}<td>${r.n}${r.n_rate ? '/' + r.n_rate : ''}</td><td class="nowrap ${r.stato_effettivo === 'da_confermare' ? 'warn' : ''}">${fmtD(r.scadenza)}</td><td class="num">${eur2(r.importo)}</td><td>${pillStato(r.stato_effettivo)}</td><td>${r.data_pagamento ? fmtD(r.data_pagamento) : ''}${r.banca ? '<span class="d2">' + esc(r.banca) + '</span>' : ''}</td><td class="small muted">${r.marcata_da ? esc(r.marcata_da) + ' · ' + fmtD(r.marcata_il) : ''}${r.nota ? '<div>' + esc(r.nota) + '</div>' : ''}</td>
  <td class="right">${r.stato === 'pagata' ? `<button class="btn sm ghost" onclick="UI.setRata('${r.id}','futura')" title="Torna a non pagata">annulla</button>` : r.stato === 'saltata' ? `<button class="btn sm" onclick="UI.modal('pagata','${r.id}')">pagata</button> <button class="btn sm ghost" onclick="UI.setRata('${r.id}','futura')">annulla</button>` : `<button class="btn sm primary" onclick="UI.modal('pagata','${r.id}')">pagata</button> <button class="btn sm" onclick="UI.setRata('${r.id}','saltata')">saltata</button>`}</td></tr>`).join('')}</table></div>`;
}

// ---------- Conto economico ----------
function pageCE() {
  const anni = [...new Set(S.data.ce.map(r => r.anno))].sort((a, b) => b - a);
  if (!anni.length) return '<div class="head"><h2>Conto economico</h2></div><div class="card">Nessuna registrazione contabile caricata.</div>';
  if (!S.annoCE || !anni.includes(S.annoCE)) S.annoCE = anni[0];
  const X = ceAnno(S.annoCE), T = ['T1', 'T2', 'T3', 'T4'];
  const riga = (label, arr, cls, extra) => `<tr class="${cls || ''}"><td>${label}</td>${arr.map(v => `<td class="num">${eur(v)}</td>`).join('')}<td class="num">${eur(sum(arr))}</td><td class="num small">${extra || ''}</td></tr>`;
  const vociDi = gr => X.lista.filter(v => v.gruppo === gr).map(v => riga(esc(v.descrizione), v.t, 'sub')).join('');
  const sez = l => `<tr class="sec"><td colspan="7">${l}</td></tr>`;
  const ricTot = sum(X.ric);
  const tab = `<div class="scroll"><table class="ce">
    <tr><th>Voce</th>${T.map((t, i) => `<th class="num">${t}<div class="small" style="font-weight:400">${X.mesiTrim[i] ? X.mesiTrim[i] + (X.mesiTrim[i] === 1 ? ' mese' : ' mesi') : '–'}</div></th>`).join('')}<th class="num">Anno</th><th class="num">% ricavi</th></tr>
    ${sez('Ricavi')}${vociDi('RICAVI')}${riga('<b>Ricavi</b>', X.ric, 'tot', '100%')}
    ${sez('Costi variabili')}${vociDi('COSTI_VARIABILI')}${riga('Costi variabili', X.varc, 'tot', pct(sum(X.varc), ricTot))}
    ${riga('<b>Margine di contribuzione</b>', X.mdc, 'tot', pct(sum(X.mdc), ricTot))}
    ${sez('Costi fissi')}${vociDi('COSTI_FISSI')}${riga('Costi fissi', X.fis, 'tot', pct(sum(X.fis), ricTot))}
    ${riga('<b>EBITDA</b>', X.ebitda, 'tot', pct(sum(X.ebitda), ricTot))}
    ${sez('Sotto l\'EBITDA')}${vociDi('FUORI_EBITDA')}${X.ammStima ? riga('Ammortamenti · stima (quota annua ' + eur(S.data.P.ammortamenti_annui) + ' ÷ 12 × mesi registrati)', X.ammStima, 'stima') : ''}
    ${riga('<b>Risultato' + (X.ammStima ? ' (con ammortamenti stimati)' : '') + '</b>', X.ris, 'tot', pct(sum(X.ris), ricTot))}
  </table></div>`;
  const conf = anni.length > 1 ? `<div class="card" style="margin-top:14px"><h3>Confronto per anno</h3><div class="scroll"><table class="ce"><tr><th>Anno</th><th class="num">Mesi</th><th class="num">Ricavi</th><th class="num">Costi variabili</th><th class="num">Margine</th><th class="num">Costi fissi</th><th class="num">EBITDA</th><th class="num">EBITDA %</th><th class="num">Risultato</th></tr>${anni.slice(0, 3).map(a => { const Y = ceAnno(a); return `<tr><td><b>${a}</b></td><td class="num">${Y.mesi.length}</td><td class="num">${eur(sum(Y.ric))}</td><td class="num">${eur(sum(Y.varc))}</td><td class="num">${eur(sum(Y.mdc))}</td><td class="num">${eur(sum(Y.fis))}</td><td class="num">${eur(sum(Y.ebitda))}</td><td class="num">${pct(sum(Y.ebitda), sum(Y.ric))}</td><td class="num">${eur(sum(Y.ris))}</td></tr>`; }).join('')}</table></div></div>` : `<div class="small muted" style="margin-top:10px">Il confronto con gli anni precedenti compare quando saranno caricati: la contabilità 2024 e 2025 è nel vecchio gestionale (Team System) e non in NTS.</div>`;
  return `<div class="head"><h2>Conto economico trimestrale</h2><span><select class="btn" onchange="UI.anno(this.value)">${anni.map(a => `<option value="${a}" ${a === S.annoCE ? 'selected' : ''}>${a}</option>`).join('')}</select></span></div>
  <div class="alert">Valori <b>come registrati in prima nota</b> (ricavi e costi di competenza, IVA esclusa), registrazioni fino al ${fmtD(S.data.stato.ultima_registrazione)}. Non includono ancora: stipendi e contributi del mese in corso (≈ ${eur(S.data.P.costo_personale_mese)} al mese), accantonamento TFR, variazione delle rimanenze (inventario di fine luglio e fine dicembre), ratei di fine anno. I consumi reali si leggono solo dopo l'inventario: storicamente valgono circa ${S.data.P.consumi_pct_storica || 43}% dei ricavi.</div>
  <div class="card">${tab}</div>${conf}`;
}

// ---------- Banche e PFN ----------
const fidoDi = (banca, linea) => (S.data.fidi || []).find(f => f.banca === banca && f.linea === linea) || {};
const inFido = (banca, linea, campo, val, w) => `<input class="search" style="width:${w || 88}px;text-align:right;padding-left:6px;padding-right:6px" inputmode="decimal" value="${val == null || val === '' ? '' : campo === 'tasso' ? String(Number(val)).replace('.', ',') : n0.format(Number(val))}" placeholder="–" title="${campo === 'tasso' ? 'Tasso annuo in %, es. 6,5' : 'Importo accordato in euro'}" onchange="UI.fido('${banca}','${linea}','${campo}',this.value)">`;
const barra = pct => pct == null ? '' : `<div class="bar" style="width:80px"><i class="${pct > 100 ? 'bad' : pct > 85 ? 'warn' : 'good'}" style="width:${Math.min(100, pct)}%"></i></div>`;
const pc1 = (a, b) => b ? Math.round(100 * a / b) : null;
// riga di controllo: saldo dichiarato dalla banca nel file CBI, in arancione se Fiammetta se ne discosta
const ctrlBanca = r => r.ctrl ? `<span class="d2 ${Math.abs(r.ctrl.scarto) > SOGLIA_SCARTO ? 'warn' : ''}">in banca ${eur(r.ctrl.saldo)} al ${fmtD(r.ctrl.data)}${Math.abs(r.ctrl.scarto) > SOGLIA_SCARTO ? ' · differenza ' + eur(Math.abs(r.ctrl.scarto)) : ' · torna'}</span>` : '';
function bancheCC(pos) {
  // conti correnti raggruppati per banca, con fido, tasso e statistiche dell'anno
  const D = S.data, g = {};
  pos.righe.filter(r => r.categoria === 'cc').forEach(r => {
    const b = nomeBanca(r.descrizione); const x = g[b] || (g[b] = { banca: b, conti: [], saldo: 0, contabile: 0, giorni: 0, giorniRosso: 0, medio: 0, picco: 0, numeri: 0, al: null, oneri: 0, oneriVoci: {}, ctrl: null });
    x.conti.push(r); x.saldo += r.stimato; x.contabile += r.contabile; if (r.ctrl) x.ctrl = r.ctrl;
    const u = (D.ccUtil || []).find(y => y.conto === r.conto);
    if (u) { x.giorni = Math.max(x.giorni, Number(u.giorni)); x.giorniRosso = Math.max(x.giorniRosso, Number(u.giorni_scoperto)); x.medio += Number(u.scoperto_medio); x.picco = Math.max(x.picco, Number(u.picco)); x.numeri += Number(u.numeri_debitori); x.al = u.al; }
  });
  (D.oneri || []).forEach(o => { const x = g[nomeBanca(o.banca_conto)]; if (!x || o.categoria !== 'cc' || /mutu/i.test(o.voce_conto)) return; x.oneri += Number(o.importo); x.oneriVoci[o.voce_conto] = (x.oneriVoci[o.voce_conto] || 0) + Number(o.importo); });
  return Object.values(g).map(x => { const f = fidoDi(x.banca, 'cassa'); x.fido = f.accordato != null ? Number(f.accordato) : null; x.tasso = f.tasso != null ? Number(f.tasso) : null; x.note = f.note; x.scoperto = Math.max(0, -x.saldo); return x; })
    .filter(x => Math.abs(x.saldo) > 0.5 || x.fido || x.giorniRosso || x.oneri);
}
function dettLiquidita(pos) {
  const regData = S.data.stato.ultima_registrazione, cc = pos.righe.filter(r => r.categoria !== 'anticipi').sort((a, b) => (a.categoria + nomeBanca(a.descrizione)).localeCompare(b.categoria + nomeBanca(b.descrizione)));
  const tipo = { cc: 'conto corrente', accantonamento: 'accantonamento', cassa: 'cassa contanti', sbf: 'effetti SBF (non è liquidità)' };
  return `<p class="small muted" style="margin-top:0">Stima conto per conto: saldo contabile (registrazioni fino alla data indicata) + movimenti bancari importati in NTS dopo quella data + incassi e pagamenti segnati in Fiammetta. Un c/c in rosso va negli scoperti, non toglie liquidità. I conti c/incassi (SBF) contengono effetti presentati e non ancora accreditati: diventano liquidità solo all'accredito o se anticipati. Fa eccezione Cassa Padana, dove il c/incassi è sommato al c/c (conto unico).</p>
  <div class="scroll"><table class="resp"><tr><th>Conto</th><th class="num">Contabile</th><th class="num">Movimenti banca dopo</th><th class="num">Segnati in Fiammetta</th><th class="num">Stimato</th></tr>
  ${cc.filter(r => Math.abs(r.contabile) > 0.5 || r.mov || r.app || r.info).map(r => { const i = r.info, vecchio = i && i.ultimo_movimento && giorni(i.ultimo_movimento, OGGI) > 3;
    return `<tr><td>${esc(r.descrizione)}<span class="d2">${tipo[r.categoria] || r.categoria} · registrazioni al ${fmtD(r.ultima_registrazione || regData)}${i ? ` · <span class="${vecchio ? 'warn' : ''}">movimenti al ${fmtD(i.ultimo_movimento)}</span>` : ''}</span>${r.uniti.map(u => `<span class="d2">comprende ${esc(u.descrizione)} ${eur(u.contabile)} · <span class="${r.ultima_registrazione && u.ultima_registrazione && giorni(u.ultima_registrazione, r.ultima_registrazione) > 20 ? 'warn' : ''}">registrato al ${fmtD(u.ultima_registrazione)}</span></span>`).join('')}</td><td class="num">${eur(r.contabile)}</td><td class="num">${segnato(r.mov)}</td><td class="num">${segnato(r.app)}</td><td class="num"><b class="${r.stimato < -0.5 ? 'bad' : ''}">${eur(r.stimato)}</b>${r.categoria === 'cc' && r.stimato < -0.5 ? '<span class="d2">scoperto</span>' : ''}${ctrlBanca(r)}</td></tr>`; }).join('')}</table></div>`;
}
function dettScoperti(pos) {
  const bb = bancheCC(pos), al = bb.map(x => x.al).filter(Boolean).sort().pop();
  const ordine = bb.filter(x => x.tasso != null && x.fido && x.fido - x.scoperto > 0.5).sort((a, b) => a.tasso - b.tasso);
  const sconf = bb.filter(x => x.scoperto > (x.fido || 0) + 0.5);
  const totFido = sum(bb, x => x.fido || 0), totSco = sum(bb, x => x.scoperto);
  return `<div class="row4" style="margin-bottom:12px">${kpiBox('Scoperti di c/c oggi', eur(totSco), 'stima al ' + fmtD(pos.dataStima), totSco > totFido ? 'bad' : '')}${kpiBox('Fidi di cassa accordati', eur(totFido), bb.filter(x => x.fido == null).length ? bb.filter(x => x.fido == null).map(x => x.banca).join(', ') + ': fido da inserire' : 'da Fiammetta (modificabili qui sotto)')}${kpiBox('Utilizzo complessivo', totFido ? pc1(totSco, totFido) + '%' : '–', totSco > totFido ? 'oltre i fidi: sconfinamento' : 'margine ' + eur(totFido - totSco), totSco > totFido ? 'bad' : '')}${kpiBox('Oneri sui c/c nel ' + OGGI.slice(0, 4), eur(sum(bb, x => x.oneri)), 'interessi e commissioni registrati in NTS')}</div>
  ${(() => { const t = testoControlli(controlliBanca(pos)); return t ? `<div class="alert"><b>Controllo con la banca</b><br>${t}<br><span class="small">La differenza è dovuta a registrazioni NTS mancanti o non ancora importate: finché non sono registrate, il saldo reale è quello della banca.</span></div>` : ''; })()}
  ${sconf.length ? `<div class="alert bad"><b>Sconfinamento</b>: ${sconf.map(x => `${esc(x.banca)} ${eur(x.scoperto - (x.fido || 0))} oltre il fido`).join(' · ')}. Lo sconfinamento costa più del fido: va rientrato per primo.</div>` : ''}
  <div class="alert ${ordine.length ? 'good' : ''}">${ordine.length ? `<b>Ordine consigliato per usare il fido di cassa</b> (dal tasso più basso): ${ordine.map((x, i) => `${i + 1}. ${esc(x.banca)} ${String(x.tasso).replace('.', ',')}% · disponibili ${eur(x.fido - x.scoperto)}`).join(' — ')}` : 'Inserisci fidi e tassi nella tabella qui sotto: Fiammetta indicherà da quale banca conviene usare il fido di cassa.'}</div>
  <h3 style="margin:14px 0 6px">Situazione oggi</h3>
  <div class="scroll"><table class="resp"><tr><th>Banca</th><th class="num">Saldo c/c</th><th class="num">Fido di cassa</th><th class="num">Disponibile</th><th>Utilizzo</th><th class="num">Tasso fido %</th></tr>
  ${bb.map(x => { const disp = x.fido != null ? x.fido - x.scoperto : null, u = x.fido ? pc1(x.scoperto, x.fido) : (x.scoperto > 0.5 ? null : 0);
    return `<tr><td>${esc(x.banca)}<span class="d2">${x.conti.filter(r => Math.abs(r.stimato) > 0.5 || r.info).map(r => esc(r.descrizione) + r.uniti.map(u => ' + ' + esc(u.descrizione)).join('')).join(' · ')}${x.note ? ' · ' + esc(x.note) : ''}</span></td><td class="num ${x.saldo < -0.5 ? 'bad' : ''}">${eur(x.saldo)}${x.conti.map(ctrlBanca).join('')}</td><td class="num">${inFido(x.banca, 'cassa', 'accordato', x.fido)}</td><td class="num ${disp != null && disp < -0.5 ? 'bad' : ''}">${disp == null ? '–' : eur(disp)}</td><td>${u == null ? (x.scoperto > 0.5 ? '<span class="pill bad">senza fido</span>' : '') : u + '%' + barra(u)}</td><td class="num">${inFido(x.banca, 'cassa', 'tasso', x.tasso, 62)}</td></tr>`; }).join('')}</table></div>
  <h3 style="margin:18px 0 6px">Utilizzo dall'inizio dell'anno ${al ? '(fino al ' + fmtD(al) + ')' : ''}</h3>
  <div class="scroll"><table class="resp"><tr><th>Banca</th><th class="num">Giorni in rosso</th><th class="num">Scoperto medio</th><th class="num">Utilizzo medio</th><th class="num">Costo stimato</th><th class="num">Oneri registrati</th></tr>
  ${bb.map(x => `<tr><td>${esc(x.banca)}</td><td class="num">${x.giorniRosso} su ${x.giorni}</td><td class="num">${eur(x.medio)}<span class="d2">picco ${eur(x.picco)}</span></td><td class="num">${x.fido ? pc1(x.medio, x.fido) + '%' : '–'}</td><td class="num">${x.tasso != null ? eur(x.numeri * x.tasso / 36500) : '<span class="muted">manca il tasso</span>'}</td><td class="num">${eur(x.oneri)}${Object.keys(x.oneriVoci).length ? `<span class="d2">${Object.entries(x.oneriVoci).map(([k, v]) => esc(k.toLowerCase()) + ' ' + eur(v)).join(' · ')}</span>` : ''}</td></tr>`).join('')}</table></div>
  <div class="small muted" style="margin-top:6px">Saldi giornalieri ricostruiti dalla prima nota per data di registrazione (non per valuta): sono indicativi. Scoperto medio = media su tutti i giorni dell'anno; costo stimato = numeri debitori × tasso ÷ 36.500. Oneri registrati = interessi passivi e oneri bancari addebitati sul c/c (esclusi gli interessi dei mutui).</div>`;
}
function dettAnticipi(pos) {
  const D = S.data, g = {};
  pos.righe.filter(r => r.categoria === 'anticipi' || r.categoria === 'sbf').forEach(r => {
    const b = nomeBanca(r.descrizione), linea = r.categoria === 'sbf' ? 'sbf' : (/ester/i.test(r.descrizione) ? 'anticipi_estero' : 'anticipi_italia');
    const k = b + '|' + linea; const x = g[k] || (g[k] = { banca: b, linea, conti: [], usato: 0, presentati: 0 }); x.conti.push(r);
    if (linea === 'sbf') { if (r.contabile < 0) x.usato += -r.contabile; else x.presentati += r.contabile; } else x.usato += -r.contabile;
  });
  const righe = Object.values(g).filter(x => x.usato > 0.5 || x.presentati > 0.5 || fidoDi(x.banca, x.linea).accordato).sort((a, b) => (a.banca + a.linea).localeCompare(b.banca + b.linea));
  const nomeLinea = { anticipi_italia: 'anticipi Italia (fatture)', anticipi_estero: 'anticipi estero (ordini)', sbf: 'SBF Italia (effetti)' };
  const ant = partiteC().filter(s => s.flant === 'S'), perB = {}; ant.forEach(s => { const b = nomeBanca(s.banca); (perB[b] = perB[b] || []).push(s); });
  const totUsato = sum(righe, x => x.usato), totAcc = sum(righe, x => Number(fidoDi(x.banca, x.linea).accordato) || 0);
  return `<div class="row4" style="margin-bottom:12px">${kpiBox('Anticipi utilizzati', eur(totUsato), 'saldi contabili al ' + fmtD(D.stato.ultima_registrazione))}${kpiBox('Castelletti accordati', totAcc ? eur(totAcc) : '–', totAcc ? 'inseriti in Fiammetta' : 'da inserire nella tabella')}${kpiBox('Disponibile', totAcc ? eur(totAcc - totUsato) : '–', totAcc ? pc1(totUsato, totAcc) + '% utilizzato' : '')}${kpiBox('Effetti SBF presentati', eur(sum(righe, x => x.presentati)), 'in attesa di accredito, non conteggiati')}</div>
  <div class="scroll"><table class="resp"><tr><th>Banca e linea</th><th class="num">Utilizzato</th><th class="num">Accordato</th><th class="num">Disponibile</th><th>Pieno al</th><th class="num">Tasso %</th></tr>
  ${righe.map(x => { const f = fidoDi(x.banca, x.linea), acc = f.accordato != null ? Number(f.accordato) : null, u = acc ? pc1(x.usato, acc) : null;
    return `<tr><td>${esc(x.banca)} · ${nomeLinea[x.linea]}<span class="d2">${x.conti.map(r => esc(r.descrizione)).join(' · ')}${x.presentati > 0.5 ? ' · effetti presentati ' + eur(x.presentati) : ''}</span></td><td class="num">${eur(x.usato)}</td><td class="num">${inFido(x.banca, x.linea, 'accordato', acc)}</td><td class="num">${acc != null ? eur(acc - x.usato) : '–'}</td><td>${u == null ? '' : u + '%' + barra(u)}</td><td class="num">${inFido(x.banca, x.linea, 'tasso', f.tasso, 62)}</td></tr>`; }).join('')}</table></div>
  <h3 style="margin:18px 0 6px">Fatture anticipate (scadenzario NTS) · ${ant.length} · ${eur(sum(ant, s => s.importo))}</h3>
  ${Object.keys(perB).length ? Object.entries(perB).sort((a, b) => sum(b[1], s => s.importo) - sum(a[1], s => s.importo)).map(([b, rows]) => `<details class="piano"><summary><span class="nm">${esc(b)}</span><span class="small nowrap">${rows.length} fatture</span><span class="nowrap right"><b>${eur2(sum(rows, s => s.importo))}</b></span></summary><div class="body">${tabellaPartite(rows, true)}</div></details>`).join('') : '<div class="muted small">Nessuna fattura aperta segnata come anticipata in NTS.</div>'}
  <div class="small muted" style="margin-top:6px">Gli anticipi estero sono su ordine e non su fattura: per quelli conta il saldo del conto anticipi. Il castelletto accordato non è in NTS: si inserisce qui (o dal portale della banca).</div>`;
}
function dettFinanziamenti() {
  const D = S.data;
  const chiave = t => { t = (t || '').toLowerCase(); return ['simest', 'padana', 'credem', 'sondrio', 'valsabbina', 'verona', 'emilia', 'bper', 'intesa', 'unicredit', 'bpm'].find(k => t.includes(k)) || null; };
  const gruppi = [], perChiave = {};
  const metti = (k, campo, v) => { const g = (k && perChiave[k]) || { conti: [], piani: [] }; if (k) perChiave[k] = g; if (!gruppi.includes(g)) gruppi.push(g); g[campo].push(v); };
  D.sp.filter(x => x.voce === 'SP.DEB_FINANZIAMENTI' && Math.abs(x.saldo) > 0.5).forEach(x => metti(chiave(x.descrizione), 'conti', x));
  D.piani.filter(p => (p.tipo === 'finanziamento' || p.tipo === 'simest') && p.stato === 'attivo').forEach(p => metti(chiave((p.controparte || '') + ' ' + p.nome), 'piani', { p, s: statoAder(p) }));
  const totDeb = sum(gruppi, g => -sum(g.conti, x => x.saldo)), totRes = sum(gruppi, g => sum(g.piani, x => x.s.residuo));
  return `<div class="scroll"><table class="resp"><tr><th>Finanziamento e piano</th><th class="num">Debito contabile</th><th class="num">Residuo da piano</th><th class="num">Differenza</th></tr>
    ${gruppi.map(g => { const deb = -sum(g.conti, x => x.saldo), res = sum(g.piani, x => x.s.residuo);
      return `<tr><td>${g.conti.length ? g.conti.map(x => esc(x.descrizione)).join('<br>') : '<span class="muted">nessun conto contabile collegato</span>'}${g.piani.length ? `<span class="d2">${g.piani.map(({ p, s }) => `${esc(p.nome)} · ${s.pagate}/${s.tot} rate pagate · prossima ${s.prossima ? fmtD(s.prossima.scadenza) : '–'}`).join('<br>')}</span>` : '<span class="d2 warn">nessun piano di rimborso nello Scadenziario</span>'}</td>
      <td class="num">${g.conti.length ? eur(deb) : '–'}</td><td class="num">${g.piani.length ? eur(res) : '–'}</td><td class="num muted">${g.conti.length && g.piani.length ? segnato(res - deb) : ''}</td></tr>`; }).join('')}
    <tr class="tot"><td>Totale</td><td class="num">${eur(totDeb)}</td><td class="num">${eur(totRes)}</td><td class="num">${segnato(totRes - totDeb)}</td></tr></table></div>
    <div class="small muted" style="margin-top:6px">Debito contabile = solo capitale (NTS); residuo da piano = rate non pagate, capitale e interessi. Una differenza positiva di qualche punto è normale; differenze grandi o negative vanno chieste a Michela. Le rate si segnano nello ${link('Scadenziario', 'scadenziario', 'piani')}.</div>`;
}
function dettSoci(pos) {
  const ps = S.data.piani.filter(p => p.tipo === 'soci');
  return `<div class="row4" style="margin-bottom:12px">${kpiBox('Finanziamento soci (contabile)', eur(pos.soci), 'conto soci c/finanziamento')}${ps.length ? kpiBox('Residuo da piano', eur(sum(ps, p => statoAder(p).residuo)), ps.length + ' piani') : ''}</div>
  ${ps.length ? ps.map(p => cardPiano(p)).join('') : `<div class="card"><p style="margin-top:0">Il piano di rientro del finanziamento soci non è ancora inserito (rimborso previsto da gennaio 2027). Quando è pronto si crea qui: le rate compariranno anche nello Scadenziario e nei prossimi 30 giorni.</p><button class="btn primary" onclick="UI.modal('piano','soci')">Crea il piano di rientro soci</button></div>`}`;
}
function pageBanche() {
  const D = S.data, pos = posizione(), c = pos.c, s = pos.s, P = D.P;
  const regData = D.stato.ultima_registrazione;
  const conti = [...D.banche].sort((a, b) => nomeBanca(a.descrizione).localeCompare(nomeBanca(b.descrizione)) || a.categoria.localeCompare(b.categoria));
  const banche = [...new Set(conti.map(x => nomeBanca(x.descrizione)))].filter(b => b !== 'Cassa contanti' && b !== 'Altro');
  const d = S.dett;
  const riga = (l, a, b, k, cls) => `<tr class="${cls || ''}${k ? ' clic' + (d === k ? ' on' : '') : ''}" ${k ? `onclick="UI.dett('${k}')" title="mostra il dettaglio"` : ''}><td>${l}${k ? ` <span class="frec">${d === k ? '▾' : '▸'}</span>` : ''}</td><td class="num">${eur(a)}</td>${pos.diversa ? `<td class="num">${eur(b)}</td>` : ''}</tr>`;
  const titoli = { fin: 'Finanziamenti e mutui', anticipi: 'Anticipi su fatture, ordini ed effetti', scoperti: 'Scoperti di conto corrente e fidi di cassa', liquidita: 'Liquidità conto per conto', soci: 'Finanziamento soci' };
  const corpo = d === 'fin' ? dettFinanziamenti() : d === 'anticipi' ? dettAnticipi(pos) : d === 'scoperti' ? dettScoperti(pos) : d === 'liquidita' ? dettLiquidita(pos) : d === 'soci' ? dettSoci(pos) : '';
  return `<div class="head"><h2>Banche e posizione finanziaria</h2><span class="small muted">saldi contabili al ${fmtD(regData)} · stima al ${fmtD(pos.dataStima)}</span></div>
  <div class="stack">
    <div class="row2">
      <div class="card"><h3>Liquidità</h3><div class="kpi ${s.liquidita < (P.uscite_fisse_mese || 0) ? 'warn' : 'good'}">${eur(s.liquidita)}</div><div class="sub" style="margin-bottom:8px">${pos.diversa ? `stimata al ${fmtD(pos.dataStima)} · contabile al ${fmtD(regData)}: ${eur(c.liquidita)}` : 'saldi contabili al ' + fmtD(regData)}</div>
        <table>
          <tr class="clic${d === 'liquidita' ? ' on' : ''}" onclick="UI.dett('liquidita')" title="mostra il dettaglio conto per conto"><td>Saldo dei c/c in attivo <span class="frec">${d === 'liquidita' ? '▾' : '▸'}</span></td><td class="num">${eur(s.ccAttivi)}</td></tr>
          <tr><td>Accantonamenti</td><td class="num">${eur(s.acc)}</td></tr>
          <tr class="tot"><td>Liquidità bancaria</td><td class="num">${eur(s.liqBanca)}</td></tr>
          <tr><td>Cassa contanti</td><td class="num">${eur(s.cassa)}</td></tr>
          ${Math.abs(pos.senzaConto) > 0.5 ? `<tr><td>Incassi segnati in Fiammetta senza banca</td><td class="num">${segnato(pos.senzaConto)}</td></tr>` : ''}
          <tr class="tot"><td>Liquidità totale</td><td class="num">${eur(s.liquidita)}</td></tr>
          <tr class="memo"><td>Non conteggiati: effetti SBF presentati, in attesa di accredito</td><td class="num">${eur(s.sbfPresentati)}</td></tr>
        </table>
        <div class="small muted" style="margin-top:6px">Gli effetti SBF diventano liquidità solo quando la banca li accredita o se vengono anticipati. La carta di credito aziendale è un conto di passaggio e non è liquidità. Per Cassa Padana il conto c/incassi è sommato al c/c (conto unico).</div></div>
      <div class="card"><h3>PFN bancaria</h3><div class="kpi">${eur(pos.pfnStima)}</div><div class="sub" style="margin-bottom:8px">clicca una voce per vederne il dettaglio</div>
        <table><tr><th></th><th class="num">${pos.diversa ? 'Contabile' : ''}</th>${pos.diversa ? '<th class="num">Stimata</th>' : ''}</tr>
          ${riga('Finanziamenti e mutui', pos.fin, pos.fin, 'fin')}${riga('Anticipi (castelletto e SBF anticipati)', c.anticipi, s.anticipi, 'anticipi')}${riga('Scoperti di conto corrente', c.scoperti, s.scoperti, 'scoperti')}${riga('− Liquidità totale', -c.liquidita, -s.liquidita, 'liquidita')}
          ${riga('PFN bancaria', pos.pfn, pos.pfnStima, null, 'tot')}${riga('Finanziamento soci', pos.soci, pos.soci, 'soci')}${riga('PFN totale', pos.pfnTot, pos.pfnTotStima, null, 'tot')}</table></div>
    </div>
    ${d ? `<div class="card dett" id="dett"><div class="head" style="margin-bottom:8px"><h3 style="margin:0">${titoli[d]}</h3><button class="btn sm" onclick="UI.dett(null)">chiudi ✕</button></div>${corpo}</div>` : ''}
    <div class="card"><h3>Conti bancari e cassa · saldi contabili</h3><div class="scroll"><table class="resp"><tr><th>Conto</th><th>Banca</th><th>Tipo</th><th>Registrato fino al</th><th class="num">Saldo</th></tr>${conti.map(x => { const un = (D.uniti || []).find(u => Number(u.conto_unito) === Number(x.conto)), cc = un && D.banche.find(b => Number(b.conto) === Number(un.conto_cc)); return `<tr><td>${esc(x.descrizione)}${cc ? `<span class="d2">sommato al c/c «${esc(cc.descrizione)}»</span>` : ''}</td><td>${esc(nomeBanca(x.descrizione))}</td><td><span class="pill plain">${tipoBanca[x.categoria] || x.categoria}</span></td><td class="nowrap ${x.ultima_registrazione && giorni(x.ultima_registrazione, regData) > 20 ? 'warn' : ''}">${fmtD(x.ultima_registrazione)}</td><td class="num ${x.saldo < -0.5 ? 'bad' : x.saldo > 0.5 ? 'good' : 'muted'}">${eur2(x.saldo)}</td></tr>`; }).join('')}</table></div><div class="small muted" style="margin-top:6px">Ogni saldo è aggiornato fino all'ultima registrazione in prima nota di quel conto (colonna «Registrato fino al»; in arancione se resta indietro di oltre 20 giorni rispetto alla contabilità). Segno contabile: positivo = disponibilità, negativo = debito verso la banca.</div></div>
    <div class="card"><h3>Saldi dal portale banca (inserimento manuale)</h3>
      <form class="row" onsubmit="event.preventDefault();UI.salvaSaldo(this)">
        <div class="field"><label>Data</label><input name="data" type="date" value="${OGGI}" required></div>
        <div class="field"><label>Banca</label><select name="banca">${banche.map(b => `<option>${esc(b)}</option>`).join('')}<option>Altra</option></select></div>
        <div class="field"><label>Saldo c/c</label><input name="saldo_cc" inputmode="decimal" placeholder="es. -12.500,00"></div>
        <div class="field"><label>Anticipi utilizzati</label><input name="anticipi_utilizzati" inputmode="decimal"></div>
        <div class="field"><label>Accordato anticipi</label><input name="accordato_anticipi" inputmode="decimal"></div>
        <div class="field"><label>Fido c/c</label><input name="fido_cc" inputmode="decimal"></div>
        <div class="field" style="flex:2 1 200px"><label>Note</label><input name="note"></div>
        <div class="field" style="flex:0 0 auto"><button class="btn primary">Salva</button></div></form>
      ${D.saldi.length ? `<div class="scroll"><table class="resp"><tr><th>Data</th><th>Banca</th><th class="num">Saldo c/c</th><th class="num">Anticipi</th><th class="num">Accordato</th><th class="num">Fido c/c</th><th>Note</th><th></th></tr>${D.saldi.map(x => `<tr><td class="nowrap">${fmtD(x.data)}</td><td>${esc(x.banca)}</td><td class="num">${eur2(x.saldo_cc)}</td><td class="num">${eur(x.anticipi_utilizzati)}</td><td class="num">${eur(x.accordato_anticipi)}</td><td class="num">${eur(x.fido_cc)}</td><td class="small">${esc(x.note || '')}<span class="d2">${esc(x.inserito_da || '')}</span></td><td class="right"><button class="btn sm ghost" onclick="UI.eliminaSaldo(${x.id})">elimina</button></td></tr>`).join('')}</table></div>` : '<div class="muted small">Nessun saldo inserito. I saldi del portale servono per confrontare la contabilità con la banca.</div>'}</div>
  </div>`;
}

// ---------- Stato dei dati ----------
function pageStato() {
  const D = S.data, pos = posizione(), nuovi = D.nuovi || [];
  const daConf = D.rate.filter(r => r.stato_effettivo === 'da_confermare' && r.stato_piano === 'attivo');
  const vecchie = D.proforme.filter(p => p.stato === 'verifica'), daAbb = D.scad.filter(s => s.daAbbinare);
  const bb = bancheCC(pos), senzaFido = bb.filter(x => x.fido == null), senzaTasso = bb.filter(x => x.tasso == null && (x.fido || x.scoperto > 0.5));
  const ctr = controlliBanca(pos);
  const voce = (ok, testo, n, dove) => `<li><span>${ok ? '<span class="pill good">ok</span>' : '<span class="pill warn">da fare</span>'} ${testo}</span><b>${n}${dove ? ' · ' + dove : ''}</b></li>`;
  return `<div class="head"><h2>Stato dei dati</h2><button class="btn" onclick="UI.reload()">Aggiorna adesso</button></div>
  <div class="stack"><div class="row2">
    <div class="card"><h3>Dal gestionale NTS</h3><ul class="list">
      <li><span>Ultimo invio notturno</span><b>${fmtDT(D.stato.ultimo_invio)}</b></li>
      <li><span>Ultima registrazione in prima nota</span><b>${fmtD(D.stato.ultima_registrazione)}</b></li>
      <li><span>Righe di prima nota copiate</span><b>${n0.format(D.stato.righe_prinot || 0)}</b></li>
      <li><span>Ultimo movimento bancario importato</span><b>${fmtD(pos.ultimoMov)}</b></li>
      <li><span>Dati letti in Fiammetta</span><b>${fmtDT(new Date(S.loadedAt).toISOString())}</b></li></ul>
      <div class="small muted" style="margin-top:8px">Il gestionale invia i dati ogni notte alle 3. «Aggiorna» rilegge i dati già arrivati, non interroga NTS.</div></div>
    <div class="card"><h3>Da sistemare</h3><ul class="list">
      ${voce(!daConf.length, 'Rate scadute senza esito', daConf.length, link('Scadenziario', 'scadenziario', 'conferma'))}
      ${voce(!nuovi.length, 'Movimenti in banca da registrare in NTS', nuovi.length + (nuovi.length ? ` (${nuovi.filter(m => m.abb).length} riconosciuti)` : ''), link('vedi', 'partite', 'banca'))}
      ${voce(!daAbb.length, 'Pagamenti e incassi da abbinare alle fatture in NTS', daAbb.length + (daAbb.some(x => x.accontoPer) ? ` (${daAbb.filter(x => x.accontoPer).length} hanno già la fattura dello stesso importo: ${daAbb.filter(x => x.accontoPer).map(x => (x.controparte || x.conto) + ' ft ' + x.accontoPer.numdoc).join(', ')})` : ''), link('vedi', 'partite', 'pagamenti:tutto'))}
      ${voce(!vecchie.length, 'Proforme senza collegamento sicuro, da verificare', vecchie.length, link('vedi', 'partite', 'incassi:proforme'))}
      ${voce(!D.movimenti.length, 'Segnati in Fiammetta in attesa di NTS', D.movimenti.length, link('vedi', 'partite', 'attesa'))}
      ${voce(!senzaFido.length && !senzaTasso.length, 'Fidi e tassi da inserire', [senzaFido.length ? senzaFido.map(x => x.banca).join(', ') + ' (fido)' : '', senzaTasso.length ? senzaTasso.map(x => x.banca).join(', ') + ' (tasso)' : ''].filter(Boolean).join(' · ') || '0', link('Banche', 'banche', 'scoperti'))}
      ${voce(!ctr.ritardi.length, 'Conti uniti al c/c registrati in ritardo', ctr.ritardi.map(x => `${esc(x.u.descrizione)} fermo al ${fmtD(x.u.ultima_registrazione)}`).join(' · ') || '0', link('Banche', 'banche', 'liquidita'))}
      ${voce(!ctr.scarti.length, 'Saldo c/c diverso da quello della banca', ctr.scarti.map(x => `${esc(x.banca)} ${eur(Math.abs(x.r.ctrl.scarto))}`).join(' · ') || '0', link('Banche', 'banche', 'scoperti'))}
      ${voce(!D.stato.conti_da_mappare, 'Conti da classificare nella mappa', D.stato.conti_da_mappare || 0, link('Impostazioni', 'impostazioni'))}</ul></div>
  </div>
  <div class="card"><h3>Banche: fin dove arrivano i dati</h3><div class="scroll"><table class="resp"><tr><th>Banca</th><th>Registrazioni fino al</th><th>Movimenti fino al</th><th class="num">Movimenti da registrare</th><th class="num">Riconosciuti</th></tr>
    ${(D.stimaBanca || []).map(b => { const m = nuovi.filter(x => x.codice_banca === b.codice), vecchio = b.ultimo_movimento && giorni(b.ultimo_movimento, OGGI) > 3;
      const sb = b.saldo_banca != null ? `<span class="d2">c/c in banca ${eur(b.saldo_banca)} al ${fmtD(b.data_saldo_banca)}</span>` : '';
      return `<tr><td>${esc(nomeBanca(b.banca))}<span class="d2">${esc(b.sottoconto_descr || '')}</span>${sb}</td><td class="nowrap">${fmtD(b.ultima_registrazione)}</td><td class="nowrap ${vecchio ? 'warn' : 'good'}">${fmtD(b.ultimo_movimento)}${vecchio ? ' · ' + giorni(b.ultimo_movimento, OGGI) + ' giorni fa' : ''}</td><td class="num">${m.length}</td><td class="num">${m.filter(x => x.abb).length}</td></tr>`; }).join('')}</table></div>
    <div class="small muted" style="margin-top:6px">Per avere Fiammetta aggiornata ogni giorno basta importare in NTS i movimenti bancari (file CBI) di tutte le banche: non serve registrarli in prima nota. In arancione le banche con l'ultimo movimento più vecchio di 3 giorni.</div></div>
  </div>`;
}

// ---------- Impostazioni ----------
function pageImpostazioni() {
  const D = S.data;
  const par = D.par.map(p => `<tr><td style="overflow-wrap:anywhere"><b>${esc(p.chiave)}</b><div class="small muted">${esc(p.descrizione || '')}</div></td><td class="num" style="width:104px"><input class="search" style="width:96px;text-align:right" value="${esc(String(p.valore))}" onchange="UI.parametro('${esc(p.chiave)}',this.value)"></td></tr>`).join('');
  const nomeCliente = conto => { const s = D.scad.find(x => x.conto === conto); return s ? s.controparte : (S.clienti && (S.clienti.find(c => c.conto === conto) || {}).descrizione) || ('conto ' + conto); };
  const regole = D.regole.map(r => `<tr><td>${esc(nomeCliente(r.conto))}<span class="d2">conto ${r.conto}${r.note ? ' · ' + esc(r.note) : ''}</span></td><td><span style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap"><select class="btn sm" onchange="UI.regola(${r.conto},'base',this.value)"><option value="documento" ${r.base === 'documento' ? 'selected' : ''}>data fattura</option><option value="scadenza" ${r.base === 'scadenza' ? 'selected' : ''}>scadenza NTS</option></select> + <input class="search" style="width:70px;text-align:right" value="${r.giorni}" onchange="UI.regola(${r.conto},'giorni',this.value)"> gg</span></td><td class="right"><button class="btn sm ghost" onclick="UI.eliminaRegola(${r.conto})">elimina</button></td></tr>`).join('');
  let mappa = '<div class="muted small">Carico la mappa…</div>';
  if (S.mappa) {
    const q = S.cercaConto.toLowerCase();
    let rows = S.mappa.conti.filter(c => (!S.soloMov || S.mappa.mov.has(c.conto)) && (!q || String(c.conto).includes(q) || (c.descrizione || '').toLowerCase().includes(q) || (S.mappa.m[c.conto] || '').toLowerCase().includes(q)));
    const nonMappati = rows.filter(c => !S.mappa.m[c.conto]); rows = [...nonMappati, ...rows.filter(c => S.mappa.m[c.conto])].slice(0, 400);
    const opts = v => `<option value="">— non classificato —</option>` + S.mappa.voci.map(x => `<option value="${x.codice}" ${v === x.codice ? 'selected' : ''}>${x.codice} · ${esc(x.descrizione)}</option>`).join('');
    mappa = `<div class="row" style="margin-bottom:8px"><input class="search" placeholder="cerca conto o descrizione" value="${esc(S.cercaConto)}" oninput="UI.cerca(this.value)"><label class="small"><input type="checkbox" ${S.soloMov ? 'checked' : ''} onchange="UI.soloMov(this.checked)"> solo conti con movimenti</label><span class="small muted">${nonMappati.length ? `<b class="warn">${nonMappati.length} da classificare</b> · ` : ''}${rows.length} conti mostrati</span></div>
    <div class="scroll" style="max-height:60vh"><table class="resp"><tr><th>Conto</th><th>Descrizione</th><th class="num">Saldo</th><th>Voce di riclassificazione</th><th>Aggiornato</th></tr>${rows.map(c => `<tr><td class="nowrap">${c.conto}</td><td>${esc(c.descrizione)}<div class="small muted">mastro ${c.mastro || ''}</div></td><td class="num">${S.mappa.saldo[c.conto] != null ? eur(S.mappa.saldo[c.conto]) : ''}</td><td><select class="search" onchange="UI.mappaConto(${c.conto},this.value)">${opts(S.mappa.m[c.conto])}</select></td><td class="small muted">${esc(S.mappa.da[c.conto] || '')}</td></tr>`).join('')}</table></div>`;
  } else if (!S._mappaLoading) { S._mappaLoading = true; loadMappa().then(() => { S._mappaLoading = false; S._keepScroll = true; render(); }).catch(e => { S._mappaLoading = false; toast('Mappa non caricata: ' + e.message, 5000); }); }
  const clientiOpts = (S.clienti || []).map(c => `<option value="${c.conto}">${esc(c.descrizione)}</option>`).join('');
  return `<div class="head"><h2>Impostazioni</h2></div><div class="stack"><div class="row3">
    <div class="card"><h3>Parametri</h3><table>${par}</table><div class="small muted" style="margin-top:6px">Numeri senza separatore delle migliaia (es. 25000). Il cambio è immediato.</div></div>
    <div class="card"><h3>Team</h3><table>${D.team.map(t => `<tr><td>${esc(t.nome)}<div class="small muted">${esc(t.email)}</div></td><td><span class="pill plain">${esc(t.ruolo)}</span> ${t.attivo ? '' : '<span class="pill bad">disattivo</span>'}</td></tr>`).join('')}</table><div class="small muted" style="margin-top:6px">Gli utenti si aggiungono in Supabase (tabella team + invito via Authentication). Versione app ${esc(C.versione || '')}.</div><button class="btn" style="margin-top:8px" onclick="UI.modal('password')">Cambia la mia password</button></div>
    <div class="card full-md"><h3>Regole di incasso per cliente</h3><div class="small muted" style="margin-bottom:6px">Quando un cliente paga con un ritmo suo (es. NordicFire: circa 7 giorni dal ricevimento della merce), la data attesa dell'incasso si calcola da qui invece che dalla scadenza NTS.</div>${regole ? `<table class="resp"><tr><th>Cliente</th><th>Data attesa</th><th></th></tr>${regole}</table>` : '<div class="muted small">Nessuna regola.</div>'}
      <form class="row" style="margin-top:10px" onsubmit="event.preventDefault();UI.nuovaRegola(this)"><div class="field" style="flex:2 1 220px"><label>Cliente</label><input list="lista-clienti" name="cliente" placeholder="scrivi il nome e scegli" onfocus="UI.caricaClienti()"><datalist id="lista-clienti">${clientiOpts}</datalist></div><div class="field"><label>Base</label><select name="base"><option value="documento">data fattura</option><option value="scadenza">scadenza NTS</option></select></div><div class="field"><label>Giorni</label><input name="giorni" type="number" value="10" required></div><div class="field" style="flex:0 0 auto"><button class="btn">Aggiungi</button></div></form></div>
    </div>
    <div class="card"><h3>Mappa dei conti → voci del conto economico e dello stato patrimoniale</h3><div class="small muted" style="margin-bottom:8px">Bozza preparata il 06/11/2026 sul piano dei conti NTS, da validare (Miriam). Cambiando la voce il conto economico si aggiorna subito; i clienti e i fornitori sono classificati automaticamente.</div>${mappa}</div>
  </div>`;
}
async function loadMappa() {
  const [voci, mappa, conti, saldi] = await Promise.all([all('voci', q => q.order('sezione').order('ordine')), all('mappa_conti'), all('erp_conti', q => q.eq('tipo', 'S').order('conto')), all('v_saldi_conti')]);
  const m = {}, da = {}; mappa.forEach(x => { m[x.conto] = x.voce; da[x.conto] = (x.aggiornato_da || '') + ' ' + fmtD(x.aggiornato_il); });
  const mov = new Set(), saldo = {}; saldi.forEach(s => { mov.add(s.conto); saldo[s.conto] = (saldo[s.conto] || 0) + Number(s.saldo); });
  S.mappa = { voci, m, da, conti, mov, saldo };
}

// ---------- Modali ----------
function renderModal() {
  const M = S.modal; let h = '';
  const bancheOpts = sel => `<option value="">—</option>` + [...new Set((S.data.anagBanche || []).map(b => nomeBanca(b.descrizione)).filter(b => b !== 'Altro' && b !== 'Cassa contanti'))].map(b => `<option ${b === sel ? 'selected' : ''}>${esc(b)}</option>`).join('') + `<option>Cassa</option>`;
  if (M.type === 'incasso') {
    const [kind, ...rest] = M.id.split(':'); const chiave = rest.join(':');
    const pt = kind === 'pt' ? S.data.scad.find(s => s.chiave === chiave) : null, pf = kind === 'pf' ? S.data.proforme.find(p => p.chiave === chiave) : null;
    const cli = pf || (pt && pt.tipo_cf === 'C'); const imp = pf ? pf.totdoc : Math.abs(pt.importo);
    const ref = pf ? `proforma ${pf.numdoc} del ${fmtD(pf.datdoc)} · ${esc(pf.controparte || '')}` : `${pt.apertura ? 'saldo 2025' : 'ft ' + (pt.numdoc || '') + ' del ' + fmtD(pt.datdoc)} · ${esc(pt.controparte || '')} · scadenza ${fmtD(pt.datsca)}`;
    h = `<h2>${cli ? 'Incasso ricevuto' : 'Pagamento fatto'}</h2><p class="small muted">${ref}</p>
    <form onsubmit="event.preventDefault();UI.confermaIncasso(this,'${M.id}')"><div class="row"><div class="field"><label>Data</label><input name="data" type="date" value="${OGGI}" required></div><div class="field"><label>Importo</label><input name="importo" inputmode="decimal" value="${String(imp).replace('.', ',')}" required></div></div><div class="field"><label>Banca</label><select name="banca">${bancheOpts(pt && pt.banca ? nomeBanca(pt.banca) : '')}</select></div><div class="field"><label>Nota (facoltativo)</label><input name="nota" placeholder="es. bonifico visto sul portale"></div>
    <div class="small muted" style="margin-bottom:10px">Resta segnato in Fiammetta finché NTS non registra ${cli ? "l'incasso" : 'il pagamento'}; poi si chiude da solo.</div>
    <div class="row"><button class="btn primary">Conferma</button><button type="button" class="btn" onclick="UI.closeModal()">Annulla</button></div></form>`;
  } else if (M.type === 'pagata') {
    const r = S.data.rate.find(x => x.id === M.id);
    h = `<h2>Rata pagata</h2><p class="small muted">${esc(r.nome)} · rata ${r.n}${r.n_rate ? '/' + r.n_rate : ''} · scadenza ${fmtD(r.scadenza)} · ${eur2(r.importo)}</p>
    <form onsubmit="event.preventDefault();UI.confermaPagata(this,'${r.id}')"><div class="field"><label>Pagata il</label><input name="data" type="date" value="${r.scadenza <= OGGI ? r.scadenza : OGGI}" required></div><div class="field"><label>Banca (facoltativo)</label><input name="banca" value="${esc(r.banca || '')}" placeholder="es. Cassa Padana"></div><div class="field"><label>Nota (facoltativo)</label><input name="nota" value="${esc(r.nota || '')}"></div><div class="row"><button class="btn primary">Conferma</button><button type="button" class="btn" onclick="UI.closeModal()">Annulla</button></div></form>`;
  } else if (M.type === 'rata') {
    const p = S.data.piani.find(x => x.id === M.id), rs = S.data.rate.filter(r => r.piano_id === p.id);
    const last = rs[rs.length - 1];
    h = `<h2>Aggiungi rata · ${esc(p.nome)}</h2><form onsubmit="event.preventDefault();UI.aggiungiRata(this,'${p.id}')"><div class="row"><div class="field"><label>Numero</label><input name="n" type="number" value="${(last ? last.n : 0) + 1}" required></div><div class="field"><label>Scadenza</label><input name="scadenza" type="date" value="${last ? addMonths(last.scadenza, p.cadenza_mesi || 1) : OGGI}" required></div><div class="field"><label>Importo</label><input name="importo" inputmode="decimal" value="${p.rata || ''}" required></div></div><div class="row"><button class="btn primary">Aggiungi</button><button type="button" class="btn" onclick="UI.closeModal()">Annulla</button></div></form>`;
  } else if (M.type === 'f24') {
    h = `<h2>Aggiungi un F24 da versare</h2><p class="small muted" style="margin-top:0">Un versamento per ogni modello F24 ricevuto dal commercialista. Entra nello scadenziario e nei «prossimi 30 giorni» di Oggi; si segna pagato come le altre rate. In alternativa si può mandare il PDF a Claude, che lo legge e lo inserisce.</p>
    <form onsubmit="event.preventDefault();UI.aggiungiF24(this)"><div class="row"><div class="field"><label>Scadenza del versamento</label><input name="scadenza" type="date" required></div><div class="field"><label>Importo da versare (€)</label><input name="importo" inputmode="decimal" required></div></div>
    <div class="field"><label>Che cosa si paga</label><input name="nota" placeholder="es. IVA ottobre 2026 + ritenute + INPS" required></div>
    <div class="row"><button class="btn primary">Aggiungi</button><button type="button" class="btn" onclick="UI.closeModal()">Annulla</button></div></form>`;
  } else if (M.type === 'piano') {
    h = `<h2>Nuovo piano di pagamento</h2><form onsubmit="event.preventDefault();UI.nuovoPiano(this)">
    <div class="row"><div class="field"><label>Tipo</label><select name="tipo">${Object.entries(tipoPiano).map(([k, l]) => `<option value="${k}" ${M.id === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="field" style="flex:2"><label>Nome</label><input name="nome" required placeholder="es. Mutuo Credem auto / AR123456789"></div></div>
    <div class="field"><label>Controparte</label><input name="controparte" placeholder="banca, fornitore, Agenzia delle Entrate-Riscossione"></div>
    <div class="field"><label>Descrizione</label><input name="descrizione"></div>
    <div class="row"><div class="field"><label>Capitale / totale</label><input name="capitale_iniziale" inputmode="decimal"></div><div class="field"><label>Numero rate</label><input name="n_rate" type="number" min="1" required></div><div class="field"><label>Ogni (mesi)</label><input name="cadenza_mesi" type="number" min="1" value="1" required></div></div>
    <div class="row"><div class="field"><label>Prima rata il</label><input name="prima_rata" type="date" required></div><div class="field"><label>Importo rata</label><input name="rata" inputmode="decimal" required></div><div class="field"><label>Prima rata diversa</label><input name="rata1" inputmode="decimal" placeholder="se diversa"></div></div>
    <div class="row"><div class="field"><label>Soglia di decadenza (AdER)</label><input name="soglia_decadenza" type="number" placeholder="8"></div><div class="field"><label>Note</label><input name="note"></div></div>
    <div class="small muted" style="margin-bottom:10px">Le rate vengono generate automaticamente; l'id del piano si ricava dal nome. Le rate già pagate si segnano dopo, dalla tabella.</div>
    <div class="row"><button class="btn primary">Crea il piano</button><button type="button" class="btn" onclick="UI.closeModal()">Annulla</button></div></form>`;
  } else if (M.type === 'password') {
    h = `<h2>Cambia password</h2><form onsubmit="event.preventDefault();UI.password(this)"><div class="field"><label>Nuova password (almeno 10 caratteri)</label><input name="p1" type="password" autocomplete="new-password" minlength="10" required></div><div class="field"><label>Ripeti</label><input name="p2" type="password" autocomplete="new-password" required></div><div class="row"><button class="btn primary">Salva</button><button type="button" class="btn" onclick="UI.closeModal()">Annulla</button></div></form>`;
  }
  return `<div class="modal-bg" onclick="if(event.target===this)UI.closeModal()"><div class="modal">${h}</div></div>`;
}

// ---------- Azioni ----------
async function guard(fn, okMsg) {
  if (S.busy) return; S.busy = true;
  try { await fn(); if (okMsg) toast(okMsg); } catch (e) { console.error(e); toast('Errore: ' + (e.message || e), 6000); } finally { S.busy = false; }
}
const chi = () => (S.me && S.me.nome) || S.email;
const UI = {
  go(v, arg) {
    S.view = v; S.dett = null;
    if (v === 'scadenziario' && arg) S.filtroRate = arg;
    if (v === 'banche' && arg) S.dett = arg;
    if (v === 'partite' && arg) { const [tab, filtro] = arg.split(':'); S.partite.tab = tab; S.partite.filtro = filtro || 'tutto'; S.partite.cerca = ''; }
    try { localStorage.setItem('fiammetta-view', v); } catch (e) {} render();
  },
  partite(tab, filtro) { if (tab) { S.partite.tab = tab; S.partite.filtro = 'tutto'; S.partite.cerca = ''; } if (filtro) S.partite.filtro = filtro; render(); },
  pfFiltro(k) { S.partite.pfFiltro = k; S._keepScroll = true; render(); },
  dett(k) { S.dett = (k && S.dett !== k) ? k : null; S._keepScroll = true; render(); const el = document.getElementById('dett'); if (el && S.dett) { const r = el.getBoundingClientRect(); if (r.top > window.innerHeight * 0.75) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
  async fido(banca, linea, campo, valore) {
    await guard(async () => {
      const t = String(valore).trim().replace('%', '').replace(/\s/g, '');
      let v = t === '' ? null : campo === 'tasso' ? parseFloat(t.replace(',', '.')) : num(t.replace(/€/g, ''));
      if (t !== '' && (v == null || isNaN(v))) throw new Error('valore non numerico');
      if (v != null && campo === 'tasso' && (v < 0 || v > 30)) throw new Error('il tasso va indicato in % annuo (es. 6,5)');
      if (v != null && campo === 'accordato' && v < 0) throw new Error("l'importo accordato non può essere negativo");
      const row = { banca, linea, [campo]: v, aggiornato_da: chi(), aggiornato_il: new Date().toISOString() };
      const { error } = await S.sb.from('fidi_banca').upsert(row, { onConflict: 'banca,linea' }); if (error) throw error;
      S.data.fidi = await all('fidi_banca'); S._keepScroll = true; render();
    }, campo === 'tasso' ? 'Tasso salvato' : 'Importo accordato salvato');
  },
  cercaPartite(v) { S.partite.cerca = v; S._keepScroll = true; render(); const i = document.querySelector('.search[placeholder]'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } },
  filtro(f) { S.filtroRate = f; render(); },
  anno(a) { S.annoCE = Number(a); render(); },
  toggle(id, open) { if (open) S._open = id; else if (S._open === id) S._open = null; },
  cerca(v) { S.cercaConto = v; S._keepScroll = true; render(); const i = document.querySelector('.search[placeholder]'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } },
  soloMov(v) { S.soloMov = v; S._keepScroll = true; render(); },
  modal(type, id) { S.modal = { type, id }; render(); },
  closeModal() { S.modal = null; render(); },
  async reload() { await guard(async () => { await loadAll(); S.mappa = null; render(); }, 'Dati aggiornati'); },
  async logout() { await S.sb.auth.signOut(); location.reload(); },
  async confermaIncasso(form, id) {
    await guard(async () => {
      const [kind, ...rest] = id.split(':'); const chiave = rest.join(':');
      const pt = kind === 'pt' ? S.data.scad.find(s => s.chiave === chiave) : null, pf = kind === 'pf' ? S.data.proforme.find(p => p.chiave === chiave) : null;
      const importo = num(form.importo.value); if (!importo) throw new Error('importo non valido');
      const row = { tipo: (pf || pt.tipo_cf === 'C') ? 'incasso' : 'pagamento', chiave_partita: pt ? pt.chiave : null, chiave_doc: pf ? pf.chiave : null, conto: pf ? pf.conto : pt.conto, controparte: pf ? pf.controparte : pt.controparte, data: form.data.value, importo, banca: form.banca.value || null, nota: form.nota.value.trim() || null, creato_da: chi() };
      const { error } = await S.sb.from('movimenti_app').insert(row); if (error) throw error;
      S.modal = null; await reloadMovimenti(); S._keepScroll = true; render();
    }, 'Segnato: resta in attesa della registrazione in NTS');
  },
  async annullaMovimento(id) {
    await guard(async () => { const { error } = await S.sb.from('movimenti_app').update({ stato: 'annullato' }).eq('id', id); if (error) throw error; await reloadMovimenti(); S._keepScroll = true; render(); }, 'Annullato');
  },
  async annullaProforma(chiave) {
    if (!confirm('Segnare la proforma come non più valida (annullata o sostituita)?')) return;
    await guard(async () => { const pf = S.data.proforme.find(p => p.chiave === chiave); const { error } = await S.sb.from('movimenti_app').insert({ tipo: 'incasso', chiave_doc: chiave, conto: pf.conto, controparte: pf.controparte, data: OGGI, importo: 0, stato: 'annullato', nota: 'proforma non valida', creato_da: chi() }); if (error) throw error; await reloadMovimenti(); S.data.proforme = S.data.proforme.filter(p => p.chiave !== chiave); S._keepScroll = true; render(); }, 'Proforma esclusa');
  },
  async setRata(id, stato) {
    await guard(async () => {
      const patch = { stato, marcata_da: chi(), marcata_il: new Date().toISOString() }; if (stato === 'futura') { patch.data_pagamento = null; patch.marcata_da = null; patch.marcata_il = null; }
      const { error } = await S.sb.from('rate').update(patch).eq('id', id); if (error) throw error;
      await reloadRate(); S._keepScroll = true; render();
    }, stato === 'saltata' ? 'Rata segnata come saltata' : 'Rata riportata a non pagata');
  },
  async confermaPagata(form, id) {
    await guard(async () => {
      const patch = { stato: 'pagata', data_pagamento: form.data.value, banca: form.banca.value.trim() || null, nota: form.nota.value.trim() || null, marcata_da: chi(), marcata_il: new Date().toISOString() };
      const { error } = await S.sb.from('rate').update(patch).eq('id', id); if (error) throw error;
      S.modal = null; await reloadRate(); S._keepScroll = true; render();
    }, 'Rata segnata come pagata');
  },
  async aggiungiRata(form, pid) {
    await guard(async () => {
      const n = Number(form.n.value), importo = num(form.importo.value); if (!importo) throw new Error('importo non valido');
      const { error } = await S.sb.from('rate').insert({ id: pid + '-' + n, piano_id: pid, n, scadenza: form.scadenza.value, importo, stato: 'futura' }); if (error) throw error;
      S.modal = null; await reloadRate(); S._keepScroll = true; render();
    }, 'Rata aggiunta');
  },
  async aggiungiF24(form) {
    await guard(async () => {
      const importo = num(form.importo.value), nota = form.nota.value.trim(); if (!importo || importo <= 0) throw new Error('importo non valido'); if (!form.scadenza.value) throw new Error('manca la scadenza');
      if (!S.data.piani.some(p => p.id === 'f24')) { const r = await S.sb.from('piani').insert({ id: 'f24', tipo: 'f24', nome: 'F24 da versare', controparte: 'Agenzia delle Entrate (F24 del commercialista)', descrizione: 'Un versamento per ogni modello F24 ricevuto dal commercialista', stato: 'attivo', creato_da: chi() }); if (r.error) throw r.error; }
      const n = Math.max(0, ...S.data.rate.filter(r => r.piano_id === 'f24').map(r => r.n)) + 1;
      const { error } = await S.sb.from('rate').insert({ id: 'f24-' + n, piano_id: 'f24', n, scadenza: form.scadenza.value, importo, stato: 'futura', nota }); if (error) throw error;
      S.modal = null; await reloadRate(); S.filtroRate = 'piani'; S._open = 'f24'; render();
    }, 'F24 aggiunto allo scadenziario');
  },
  async statoPiano(id, stato) {
    await guard(async () => { const { error } = await S.sb.from('piani').update({ stato, aggiornato_il: new Date().toISOString() }).eq('id', id); if (error) throw error; await reloadRate(); S._keepScroll = true; render(); }, 'Stato del piano aggiornato');
  },
  async nuovoPiano(form) {
    await guard(async () => {
      const f = new FormData(form); const g = k => (f.get(k) || '').toString().trim();
      const nome = g('nome'); let id = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      if (!id) throw new Error('nome non valido'); if (S.data.piani.some(p => p.id === id)) id += '-' + Date.now().toString(36);
      const n = Number(g('n_rate')), cad = Number(g('cadenza_mesi')) || 1, rata = num(g('rata')), rata1 = num(g('rata1')), prima = g('prima_rata');
      if (!n || !rata || !prima) throw new Error('compila numero rate, importo e prima rata');
      const piano = { id, tipo: g('tipo'), nome, controparte: g('controparte') || null, descrizione: g('descrizione') || null, capitale_iniziale: num(g('capitale_iniziale')), n_rate: n, cadenza_mesi: cad, prima_rata: prima, rata, rata1, soglia_decadenza: g('soglia_decadenza') ? Number(g('soglia_decadenza')) : (g('tipo') === 'ader' ? (S.data.P.soglia_decadenza_ader || 8) : null), note: g('note') || null, stato: 'attivo', creato_da: chi() };
      let r = await S.sb.from('piani').insert(piano); if (r.error) throw r.error;
      const rate = []; for (let i = 0; i < n; i++) rate.push({ id: id + '-' + (i + 1), piano_id: id, n: i + 1, scadenza: addMonths(prima, i * cad), importo: (i === 0 && rata1) ? rata1 : rata, stato: 'futura' });
      r = await S.sb.from('rate').insert(rate); if (r.error) throw r.error;
      S.modal = null; await reloadRate(); S.filtroRate = 'piani'; S._open = id; render();
    }, 'Piano creato');
  },
  async salvaSaldo(form) {
    await guard(async () => {
      const f = new FormData(form); const g = k => (f.get(k) || '').toString().trim();
      const row = { data: g('data'), banca: g('banca'), saldo_cc: num(g('saldo_cc')), anticipi_utilizzati: num(g('anticipi_utilizzati')), accordato_anticipi: num(g('accordato_anticipi')), fido_cc: num(g('fido_cc')), note: g('note') || null, inserito_da: chi() };
      const { error } = await S.sb.from('saldi_banca').upsert(row, { onConflict: 'data,banca' }); if (error) throw error;
      const r = await S.sb.from('saldi_banca').select('*').order('data', { ascending: false }).order('banca').limit(80); if (r.error) throw r.error; S.data.saldi = r.data; S._keepScroll = true; render();
    }, 'Saldo salvato');
  },
  async eliminaSaldo(id) {
    if (!confirm('Eliminare questo saldo?')) return;
    await guard(async () => { const { error } = await S.sb.from('saldi_banca').delete().eq('id', id); if (error) throw error; S.data.saldi = S.data.saldi.filter(s => s.id !== id); S._keepScroll = true; render(); }, 'Saldo eliminato');
  },
  async parametro(chiave, valore) {
    await guard(async () => { const v = num(valore); if (v == null) throw new Error('valore non numerico'); const { error } = await S.sb.from('parametri').update({ valore: v }).eq('chiave', chiave); if (error) throw error; S.data.P[chiave] = v; S.data.par.find(p => p.chiave === chiave).valore = v; }, 'Parametro salvato');
  },
  async caricaClienti() { if (S.clienti || S._clientiLoading) return; S._clientiLoading = true; try { S.clienti = await all('erp_conti', q => q.eq('tipo', 'C').order('descrizione')); S._keepScroll = true; render(); const i = document.querySelector('input[name=cliente]'); if (i) i.focus(); } catch (e) { toast('Clienti non caricati: ' + e.message); } S._clientiLoading = false; },
  async nuovaRegola(form) {
    await guard(async () => {
      const nome = form.cliente.value.trim(); const c = (S.clienti || []).find(x => x.descrizione === nome) || (S.clienti || []).find(x => x.descrizione.toLowerCase().startsWith(nome.toLowerCase()));
      if (!c) throw new Error('scegli un cliente dalla lista');
      const row = { conto: c.conto, giorni: Number(form.giorni.value) || 0, base: form.base.value, aggiornato_da: chi(), aggiornato_il: new Date().toISOString() };
      const { error } = await S.sb.from('regole_incasso').upsert(row); if (error) throw error;
      S.data.regole = await all('regole_incasso'); S.data.R = {}; S.data.regole.forEach(r => S.data.R[r.conto] = r); arricchisci(); S._keepScroll = true; render();
    }, 'Regola salvata');
  },
  async regola(conto, campo, valore) {
    await guard(async () => { const patch = { aggiornato_da: chi(), aggiornato_il: new Date().toISOString() }; patch[campo] = campo === 'giorni' ? (Number(valore) || 0) : valore; const { error } = await S.sb.from('regole_incasso').update(patch).eq('conto', conto); if (error) throw error; Object.assign(S.data.R[conto], patch); arricchisci(); }, 'Regola aggiornata');
  },
  async eliminaRegola(conto) {
    await guard(async () => { const { error } = await S.sb.from('regole_incasso').delete().eq('conto', conto); if (error) throw error; S.data.regole = S.data.regole.filter(r => r.conto !== conto); delete S.data.R[conto]; arricchisci(); S._keepScroll = true; render(); }, 'Regola eliminata');
  },
  async mappaConto(conto, voce) {
    await guard(async () => {
      if (!voce) { const { error } = await S.sb.from('mappa_conti').delete().eq('conto', conto); if (error) throw error; delete S.mappa.m[conto]; delete S.mappa.da[conto]; }
      else { const c = S.mappa.conti.find(x => x.conto === conto); const { error } = await S.sb.from('mappa_conti').upsert({ conto, voce, note: c ? c.descrizione : null, aggiornato_da: chi(), aggiornato_il: new Date().toISOString() }); if (error) throw error; S.mappa.m[conto] = voce; S.mappa.da[conto] = chi() + ' ' + fmtD(OGGI); }
      S.data.ce = await all('v_ce_mese'); S.data.sp = await all('v_sp_saldi'); S.data.stato = (await S.sb.rpc('stato_dati')).data || S.data.stato; S._keepScroll = true; render();
    }, 'Conto classificato');
  },
  async password(form) {
    const p1 = form.p1.value, p2 = form.p2.value;
    if (p1.length < 10) return toast('La password deve avere almeno 10 caratteri');
    if (p1 !== p2) return toast('Le due password non coincidono');
    await guard(async () => { const { error } = await S.sb.auth.updateUser({ password: p1 }); if (error) throw error; S.modal = null; S.setPwd = false; if (!S.data) start(); else render(); }, 'Password salvata');
  }
};

// ---------- Accesso e avvio ----------
function renderLogin(msg) {
  $('#app').innerHTML = `<div class="login"><form class="login-card" onsubmit="event.preventDefault();doLogin(this)"><h1>Fiam<em>metta</em></h1><p class="small muted" style="margin:0 0 14px">Amministrazione e finanza · accesso riservato</p><div class="field"><label for="le">Email</label><input id="le" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="lp">Password</label><input id="lp" name="password" type="password" autocomplete="current-password" required></div><div class="err" id="lerr">${esc(msg || '')}</div><button class="btn primary" style="justify-content:center;width:100%;padding:10px">Entra</button><div class="small muted" style="margin-top:12px;text-align:center"><a href="#" onclick="recupera();return false">Password dimenticata?</a></div></form></div>`;
}
function renderSetPassword(msg) {
  $('#app').innerHTML = `<div class="login"><form class="login-card" onsubmit="event.preventDefault();UI.password(this)"><h1>Fiam<em>metta</em></h1><p class="small muted">Benvenuto${S.email ? ', ' + esc(S.email) : ''}. Scegli la password con cui entrerai in Fiammetta.</p><div class="field"><label>Nuova password (almeno 10 caratteri)</label><input name="p1" type="password" autocomplete="new-password" minlength="10" required></div><div class="field"><label>Ripeti la password</label><input name="p2" type="password" autocomplete="new-password" required></div><div class="err">${esc(msg || '')}</div><button class="btn primary" style="justify-content:center;width:100%;padding:10px">Salva ed entra</button></form></div>`;
}
async function recupera() {
  const email = ($('#le').value || '').trim(); if (!email) { $('#lerr').textContent = 'Scrivi la tua email, poi premi «Password dimenticata?».'; return; }
  const { error } = await S.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  $('#lerr').textContent = error ? 'Non riesco a inviare il messaggio: ' + error.message : 'Se l\'indirizzo è abilitato riceverai un messaggio con il collegamento per scegliere una nuova password.';
}
async function doLogin(form) {
  const btn = form.querySelector('button'); btn.disabled = true; $('#lerr').textContent = '';
  const { error } = await S.sb.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
  btn.disabled = false;
  if (error) { $('#lerr').textContent = /invalid/i.test(error.message) ? 'Email o password non corretti.' : 'Accesso non riuscito: ' + error.message; return; }
  start();
}
async function start() {
  $('#app').innerHTML = '<div class="loading">Carico i dati…</div>';
  const { data: { session } } = await S.sb.auth.getSession();
  if (!session) return renderLogin();
  S.email = (session.user.email || '').toLowerCase();
  if (S.setPwd) return renderSetPassword();
  try { await loadAll(); } catch (e) { console.error(e); $('#app').innerHTML = `<div class="loading">Non riesco a leggere i dati (${esc(e.message)}).<br><br><button class="btn" onclick="location.reload()">Riprova</button> <button class="btn" onclick="UI.logout()">Esci</button></div>`; return; }
  S.me = S.data.team.find(t => t.email.toLowerCase() === S.email && t.attivo);
  if (!S.me) { await S.sb.auth.signOut(); S.data = null; return renderLogin('Questo utente non è abilitato a Fiammetta. Chiedi ad Andrea di aggiungerlo al team.'); }
  try { const v = localStorage.getItem('fiammetta-view'); if (v && VISTE.some(x => x[0] === v)) S.view = v; } catch (e) {}
  render();
}
setInterval(async () => { if (S.loadedAt && !S.modal && !S.busy && !document.hidden && Date.now() - S.loadedAt > 10 * 60000) { try { await loadAll(); S._keepScroll = true; render(); } catch (e) {} } }, 60000);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.modal) UI.closeModal(); });
(function init() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (/^(invite|recovery|magiclink|signup)$/.test(h.get('type') || '')) S.setPwd = true;
  const errDesc = h.get('error_description');
  S.sb = supabase.createClient(C.supabaseUrl, C.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  S.sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') { S.setPwd = true; if (!S.data) start(); } });
  if (errDesc) { history.replaceState(null, '', location.pathname); renderLogin('Il collegamento non è valido o è scaduto (' + errDesc.replace(/\+/g, ' ') + '). Chiedi un nuovo invito oppure usa «Password dimenticata?».'); return; }
  // supabase-js legge la sessione dall'URL e poi lo ripulisce: aspettiamo un attimo prima di partire
  setTimeout(start, S.setPwd || location.hash.includes('access_token') ? 600 : 0);
})();
