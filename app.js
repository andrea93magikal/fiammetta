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
// Importi: un solo separatore (punto o virgola) è il separatore decimale; se ci sono entrambi vale l'ultimo («1.234,56» e «1,234.56»); più punti = migliaia
const num = v => { let t = String(v == null ? '' : v).replace(/[\s€]/g, ''); if (!t) return null;
  const c = t.lastIndexOf(','), d = t.lastIndexOf('.');
  if (c >= 0 && d >= 0) t = c > d ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (c >= 0) t = t.replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  const x = parseFloat(t); return isNaN(x) ? null : x; };
const sum = (arr, f) => arr.reduce((a, r) => a + (Number(f ? f(r) : r) || 0), 0);
let OGGI = isoLocal(); // si riaggiorna a ogni lettura dei dati: dopo la mezzanotte «oggi» cambia anche con la pagina rimasta aperta
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
  OGGI = isoLocal();
  const [stato, ce, sp, banche, rate, piani, scad, par, saldi, team, movimenti, regole, proforme, stimaBanca, nuovi, anagBanche, fidi, ccUtil, oneri, uniti, castBanca, castMov, castRiba, castNts, cOrdini, cBolle, cFatture, cIncassi, docF24, antic, dilaz] = await Promise.all([
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
    all('v_castelletti_banca').catch(() => []), all('v_castelletti_mov', q => q.order('dataoperaz', { ascending: false }).order('progr', { ascending: false })).catch(() => []),
    all('v_castelletti_riba').catch(() => []), all('v_castelletti_nts', q => q.order('datreg').order('numreg').order('riga')).catch(() => []),
    all('v_catena_ordini').catch(() => []), all('v_catena_bolle').catch(() => []), all('v_catena_fatture').catch(() => []), all('v_incassi_banca').catch(() => []),
    all('documenti_f24', q => q.order('caricato_il', { ascending: false })).catch(() => []),
    all('anticipi_presentati', q => q.order('data_presentazione', { ascending: false }).order('creato_il', { ascending: false })).catch(() => []),
    all('dilazioni', q => q.order('creato_il', { ascending: false })).catch(() => [])
  ]);
  const P = {}; par.forEach(p => P[p.chiave] = typeof p.valore === 'number' ? p.valore : num(p.valore));
  const R = {}; regole.forEach(r => R[r.conto] = r);
  S.data = { stato, ce, sp, banche, rate, piani, scad, par, P, saldi, team, movimenti, regole, R, proforme, stimaBanca, nuovi, anagBanche, fidi, ccUtil, oneri, uniti,
    cast: { banca: castBanca, mov: castMov, riba: castRiba, nts: castNts },
    catena: { ordini: cOrdini, bolle: cBolle, fatture: cFatture, incassi: cIncassi }, docF24, antic, dilazioni: dilaz };
  collegaCatena();
  await riconcilia();
  arricchisci();
  S.loadedAt = Date.now();
}
async function reloadRate() { S.data.rate = await all('v_rate', q => q.order('scadenza').order('n')); S.data.piani = await all('piani', q => q.order('tipo').order('nome')); arricchisci(); }
async function reloadDocF24() { S.data.docF24 = await all('documenti_f24', q => q.order('caricato_il', { ascending: false })); }
async function reloadAntic() { S.data.antic = await all('anticipi_presentati', q => q.order('data_presentazione', { ascending: false }).order('creato_il', { ascending: false })); }
async function reloadDilazioni() { S.data.dilazioni = await all('dilazioni', q => q.order('creato_il', { ascending: false })); await reloadMovimenti(); }
async function reloadMovimenti() { S.data.movimenti = await all('movimenti_app', q => q.eq('stato', 'attesa').order('data', { ascending: false })); await riconcilia(); arricchisci(); }

// Collega gli incassi segnati in Fiammetta alle partite e chiude quelli che NTS ha ormai registrato
async function riconcilia() {
  const D = S.data, aperte = new Map(D.scad.map(s => [s.chiave, s]));
  const chiudi = [], collega = [];
  for (const m of D.movimenti) {
    if (m.chiave_partita) {
      const s = aperte.get(m.chiave_partita);
      // pagamento di una rata di dilazione: NTS lo ha registrato quando il residuo della partita è sceso almeno dell'importo pagato
      if (!s || (m.rata_n != null && m.residuo_nts != null && Math.abs(Number(s.importo)) <= Number(m.residuo_nts) - Number(m.importo) + 0.5)) chiudi.push(m.id);
      continue;
    }
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
const docRif = s => (s.daAbbinare ? (s.accontoPer ? 'da abbinare a ft ' + s.accontoPer.numdoc : 'da abbinare') : s.apertura ? 'saldo 2025' : (s.numdoc ? 'ft ' + s.numdoc : '')) + (s.tr && s.tr.n ? ` · rata ${s.tr.n}/${s.tr.tot}` : '');
// Dilazioni concordate (tabella dilazioni): la partita si divide nelle rate accordate con la controparte. Il residuo aperto in NTS, meno i pagamenti
// segnati a mano che NTS non ha ancora registrato, si assegna alle rate dall'ultima alla prima: le rate già pagate escono da sole, quelle
// scoperte restano. Quello che nessuna rata copre (rate inserite per meno del residuo) resta con la scadenza originale: nulla sparisce in silenzio.
const r2 = v => Math.round(v * 100) / 100;
const assorbito = (m, R) => m.residuo_nts != null && R <= Number(m.residuo_nts) - Number(m.importo) + 0.5;
function espandiDilazioni(dilMap) {
  const D = S.data; D.scadX = [];
  D.scad.forEach(s => {
    s.dil = null; const d = dilMap[s.chiave];
    if (!d || s.piano || s.daAbbinare || s.accontoDa || s.accontoPer || !Array.isArray(d.rate) || !d.rate.length) { D.scadX.push(s); return; }
    const segno = s.importo < 0 ? -1 : 1, R = Math.abs(s.importo);
    const pend = D.movimenti.filter(m => m.stato === 'attesa' && m.chiave_partita === s.chiave && !assorbito(m, R)), pendTot = r2(sum(pend, m => m.importo)), rest = Math.max(0, r2(R - pendTot));
    const tr = d.rate.slice().sort((a, b) => String(a.data).localeCompare(String(b.data))).map((t, i) => ({ n: i + 1, data: String(t.data).slice(0, 10), importo: Number(t.importo) || 0, aperto: 0 }));
    let r = rest, extra = 0;
    for (let i = tr.length - 1; i >= 0 && r > 0.004; i--) { const q = Math.min(tr[i].importo, r); tr[i].aperto = q; r = r2(r - q); }
    if (r > 0.004) { if (r <= 1) tr[tr.length - 1].aperto = r2(tr[tr.length - 1].aperto + r); else extra = r; }
    for (let i = 0; i < tr.length - 1; i++) if (tr[i].aperto > 0.004 && tr[i].aperto <= 1 && tr[i].aperto < tr[i].importo) { tr[i + 1].aperto = r2(tr[i + 1].aperto + tr[i].aperto); tr[i].aperto = 0; } // briciole di arrotondamento
    const righe = tr.filter(t => t.aperto > 0.004).map(t => ({ ...s, kx: s.chiave + '#' + t.n, importo: segno * t.aperto, datsca: t.data, attesa: t.data, ritardo: giorni(t.data, OGGI), datscaNTS: s.datsca, tr: { n: t.n, tot: tr.length, importoRata: t.importo, data: t.data }, dilazione: d, copertura: null, banca_pag: null }));
    if (extra > 0.004) righe.push({ ...s, kx: s.chiave + '#x', importo: segno * extra, datscaNTS: s.datsca, tr: { n: 0, tot: tr.length, importoRata: extra }, dilazione: d, copertura: null, banca_pag: null });
    s.dil = { d, tr, pend, pendTot, rest, extra, righe, residuoNTS: R };
    righe.forEach(x => D.scadX.push(x));
  });
}
function arricchisci() {
  const D = S.data;
  const dilMap = {}; (D.dilazioni || []).forEach(d => { if (d.stato === 'attiva') dilMap[d.chiave_partita] = d; });
  const copertaPartita = {}, copertaDoc = {};
  // un pagamento segnato su una partita con dilazione è il pagamento di una rata: non copre l'intera partita (la partita si divide in rate, vedi espandiDilazioni)
  D.movimenti.forEach(m => { if (m.chiave_partita && !dilMap[m.chiave_partita]) copertaPartita[m.chiave_partita] = m; if (m.chiave_doc) copertaDoc[m.chiave_doc] = m; });
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
  espandiDilazioni(dilMap);
  D.proforme.forEach(p => { p.totdoc = Number(p.totdoc); p.copertura = copertaDoc[p.chiave] || null; p.banca_pag = null; p.pagata = null; p.pagata_da = null; });
  // Movimenti bancari importati in NTS dopo l'ultima registrazione: li riconosco per importo (e nome, se c'è nella descrizione).
  // Una partita riconosciuta esce da scaduti e scadenze: il movimento è già nella liquidità stimata.
  const usate = new Set(), nuovi = D.nuovi || [];
  nuovi.forEach(m => { m.abb = null; m.manuale = null; m.addebito = Number(m.addebito) || 0; m.accredito = Number(m.accredito) || 0; });
  // Incassi e pagamenti segnati a mano che la banca ha poi importato: stesso verso, stessa banca, importo uguale al centesimo e date vicine
  // (± FINESTRA_MANUALE giorni) sono lo stesso movimento. Si abbinano uno a uno e il segnato a mano NON si somma alla banca (vedi posizione()).
  D.movimenti.forEach(x => { x.inBanca = null; });
  D.movimenti.filter(x => x.stato === 'attesa' && x.banca !== 'Cassa').slice().sort((a, b) => String(a.data).localeCompare(String(b.data))).forEach(x => {
    const k = x.tipo === 'incasso' ? 'accredito' : 'addebito', imp = Number(x.importo) || 0, dd = m => Math.abs(giorni(String(x.data).slice(0, 10), String(m.dataoperaz).slice(0, 10)));
    const c = nuovi.filter(m => !m.manuale && m[k] > 0 && Math.abs(m[k] - imp) < 0.01 && (!x.banca || nomeBanca(m.banca) === x.banca) && dd(m) <= FINESTRA_MANUALE).sort((a, b) => dd(a) - dd(b))[0];
    if (c) { c.manuale = x; x.inBanca = c; c.abb = { tipo: 'segnato a mano', nome: x.controparte || '', rif: 'segnato in Fiammetta il ' + fmtD(x.data) }; }
  });
  const forn = D.scadX.filter(s => s.tipo_cf === 'F' && s.importo < 0 && !s.piano && !s.copertura);
  const cli = D.scadX.filter(s => s.tipo_cf === 'C' && s.importo > 0 && !s.copertura && !s.accontoDa);
  nuovi.filter(m => m.addebito > 0 && !m.manuale).forEach(m => {
    const c = forn.filter(s => !usate.has(s.kx || s.chiave) && Math.abs(-s.importo - m.addebito) < 0.01 && giorni(s.datsca, m.dataoperaz) <= 45 && giorni(s.datsca, m.dataoperaz) >= -10)
      .sort((a, b) => Math.abs(giorni(a.datsca, m.dataoperaz)) - Math.abs(giorni(b.datsca, m.dataoperaz)))[0];
    if (c) { usate.add(c.kx || c.chiave); c.banca_pag = m; m.abb = { tipo: 'fornitore', nome: c.controparte, rif: docRif(c) }; }
  });
  nuovi.filter(m => m.accredito > 0 && !m.manuale).forEach(m => {
    const testo = ' ' + norm((m.descr1 || '') + ' ' + (m.descr2 || '')) + ' ';
    const cand = cli.filter(s => !usate.has(s.kx || s.chiave) && Math.abs(s.importo - m.accredito) < 0.01 && giorni(s.datsca, m.dataoperaz) <= 240 && giorni(s.datsca, m.dataoperaz) >= -90);
    const c = cand.find(s => nomeIn(s.controparte, testo)) || cand[0];
    if (c) { usate.add(c.kx || c.chiave); c.banca_pag = m; m.abb = { tipo: 'cliente', nome: c.controparte, rif: docRif(c) }; }
  });
  pagamentiProforme();
  statoProforme();
}
const scadX = () => S.data.scadX || S.data.scad;
const partiteC = () => scadX().filter(s => s.tipo_cf === 'C' && !s.copertura && !s.banca_pag);
const partiteF = () => scadX().filter(s => s.tipo_cf === 'F' && !s.copertura && !s.banca_pag);
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
// Anticipi (tabella rapporti_banca): per i rapporti del file CBI di Cassa Padana l'utilizzo reale è il saldo dichiarato dalla banca, se il file è recente
// (FRESCO_BANCA giorni): sostituisce il saldo contabile NTS, che si aggiorna solo quando Miriam registra gli anticipi (e spesso sul conto sbagliato).
const FRESCO_BANCA = 10, FERMO_NTS = 30, GIORNI_ANTICIPO = 120, FINESTRA_MANUALE = 10;
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
  ((D.cast && D.cast.banca) || []).forEach(x => {
    const r = righe.find(y => Number(y.conto) === Number(x.conto));
    if (!r || x.saldo_banca == null || !x.data_saldo_banca || giorni(x.data_saldo_banca, OGGI) > FRESCO_BANCA) return;
    r.bancaAnt = { saldo: Number(x.saldo_banca), data: x.data_saldo_banca, codice: x.codice_banca, rapporto: x.rapporto };
    r.mov = r.bancaAnt.saldo - r.contabile;
  });
  const ultimoMov = stima.reduce((m, x) => (x.ultimo_movimento || '') > m ? x.ultimo_movimento : m, '');
  let senzaConto = 0, nIn = 0, nOut = 0; const dateApp = [];
  D.movimenti.filter(m => m.stato === 'attesa').forEach(m => {
    const v = (m.tipo === 'incasso' ? 1 : -1) * Number(m.importo || 0);
    const cc = righe.filter(x => x.categoria === 'cc' && m.banca && nomeBanca(x.descrizione) === m.banca);
    const r = m.banca === 'Cassa' ? righe.find(x => x.categoria === 'cassa') : (cc.find(x => x.info) || cc[0]);
    const ultimo = r && r.info ? r.info.ultimo_movimento : (r ? '' : ultimoMov);
    if (m.inBanca) return; // la banca lo ha gia' importato (abbinato per importo e data in arricchisci()): e' nei movimenti, non si somma due volte
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
    diversa: Math.abs(s.liquidita - c.liquidita) > 0.5 || Math.abs(s.scoperti - c.scoperti) > 0.5 || Math.abs(s.anticipi - c.anticipi) > 0.5 };
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
// Piani AdER dal più urgente: prima quelli con più rate scadute (contatore), poi con più scaduto in euro; i piani non attivi in fondo
const cmpAder = (a, b) => ((b.p.stato || 'attivo') === 'attivo') - ((a.p.stato || 'attivo') === 'attivo') || b.s.contatore - a.s.contatore || b.s.scadutoImporto - a.s.scadutoImporto || b.s.residuo - a.s.residuo;
const erogazione = p => p.data_erogazione || (p.prima_rata ? addMonths(String(p.prima_rata).slice(0, 10), -(p.cadenza_mesi || 1)) : null);
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
  const scadute = nonPagate.filter(r => r.scadenza < OGGI), zonaRossa = Math.max(1, soglia - 2); // zona rossa = a 2 rate dalla decadenza (6 su 8)
  return { scadute: scadute.length, scadutoImporto: sum(scadute, r => r.importo), maxGiorni: scadute.length ? giorni(scadute[0].scadenza, OGGI) : 0, zonaRossa, rosso: p.tipo === 'ader' && contatore >= zonaRossa, saltate, daConf, contatore, residue: nonPagate.length, residuo: sum(nonPagate, r => r.importo), pagate: rs.filter(r => r.stato === 'pagata').length, prossima, soglia, margine: soglia - contatore, tot: rs.length, totale: sum(rs, r => r.importo) };
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
const link = (testo, view, arg) => `<a href="#" class="lnk" onclick="event.stopPropagation();UI.go('${view}'${arg ? ",'" + arg + "'" : ''});return false">${testo}</a>`;

// ---------- Spiegazioni al passaggio del mouse (come in Scintilla) ----------
// Ogni titolo, riquadro, intestazione di colonna, pulsante e valore importante ha una spiegazione di che cosa è e come si calcola.
// Si cerca per testo (minuscolo, spazi singoli): stringa = testo uguale, espressione regolare = testo che corrisponde. I «title» già presenti diventano spiegazioni uguali.
// Le definizioni sono quelle del documento «Indicatori e definizioni»: se cambia una regola di calcolo va cambiata anche qui.
const GL = [
  // Oggi
  ['liquidità', "I soldi disponibili oggi in banca e in cassa, stimati conto per conto: saldo contabile NTS + movimenti bancari importati dopo l'ultima registrazione + incassi e pagamenti segnati in Fiammetta (mai contati due volte). Conta i c/c in attivo, i conti di accantonamento e la cassa contanti. I c/c in rosso vanno negli scoperti; gli effetti SBF presentati non sono liquidità."],
  ['scoperti e anticipi', "Debito verso le banche già utilizzato: scoperti dei c/c in rosso + anticipi (fatture Italia ed estero, SBF anticipati). Per Cassa Padana l'utilizzo degli anticipi è il saldo dichiarato dalla banca nel file CBI, se recente (al massimo 10 giorni)."],
  ['pfn bancaria', "Posizione finanziaria netta = finanziamenti e mutui (debito contabile, senza interessi) + anticipi + scoperti − liquidità. Più è bassa meglio è. Il finanziamento dei soci si somma a parte."],
  ['scaduto', "Fatture aperte oltre la data attesa di incasso (clienti) o oltre la scadenza (fornitori, esclusi i piani di rientro). Una partita con dilazione concordata vale con le date delle rate. Non sono contati i pagamenti già visti in banca o segnati in Fiammetta."],
  [/^clienti \d/, "Scaduto dei clienti: fatture aperte la cui data attesa di incasso è passata. La data attesa è la scadenza NTS, o quella della regola del cliente (es. NordicFire: fattura + 10 giorni), o la rata di una dilazione concordata. Clic per vedere l'elenco."],
  [/^fornitori \d/, "Scaduto dei fornitori: fatture in avere con scadenza passata (importi lordi), fuori dai piani di rientro. Una partita dilazionata vale con le date delle rate. Clic per vedere l'elenco."],
  [/^prossimi 30 giorni/, "Quello che entra e quello che esce da oggi ai prossimi 30 giorni, dalle scadenze note. Non comprende stipendi, spese correnti e F24 non ancora ricevuti."],
  ['uscite', "Quanto si deve pagare nei prossimi 30 giorni: rate di finanziamenti, F24, piani (AdER, fornitori) e fatture fornitori in scadenza. Clic per l'elenco dei fornitori."],
  ['incassi attesi', "Fatture ai clienti che si prevede di incassare nei prossimi 30 giorni, secondo la data attesa (scadenza NTS, regola del cliente o rata di dilazione). Clic per l'elenco."],
  ['proforme da incassare', "Proforme di ordini non ancora fatturati: il cliente deve ancora pagarle (o ha pagato e la merce non è partita). Quando la merce viene fatturata il credito passa nelle fatture e la proforma smette di contare, così non si somma due volte."],
  ['saldo netto dei conti a fine periodo', "Liquidità − scoperti di c/c, più gli incassi attesi e meno le uscite dei prossimi 30 giorni. Senza proforme, stipendi, F24 non ancora noti e spese correnti: è un minimo, non una previsione completa."],
  ['rateizzazioni ader', "Piani di rateizzazione con l'Agenzia delle Entrate-Riscossione. Il contatore = rate saltate + rate scadute non ancora confermate: all'ottava rata non pagata il piano decade. Da 6 in su è zona rossa: pagare per prime."],
  // Crediti e debiti
  ['fatture oltre la data attesa', "Fatture ai clienti ancora aperte la cui data attesa di incasso è passata. Non comprende gli incassi già visti in banca o segnati in Fiammetta. Clic: elenco filtrato."],
  ['fatture attese entro 30 giorni', "Fatture ai clienti con data attesa di incasso da oggi ai prossimi 30 giorni. Clic: elenco filtrato."],
  ['fatture attese oltre 30 giorni', "Fatture ai clienti con data attesa di incasso oltre i 30 giorni. Clic: elenco filtrato."],
  ['totale da incassare', "Fatture aperte da incassare + proforme ancora da incassare. Le proforme già fatturate non si sommano: il credito è già nelle fatture. Clic: elenco completo."],
  ['scadute', "Fatture fornitori con scadenza passata, fuori dai piani di rientro. Importi lordi, solo partite in avere (i saldi in dare sono a parte). Una partita dilazionata vale con le date delle rate."],
  ['in scadenza entro 30 giorni', "Fatture fornitori con scadenza (o rata di dilazione) da oggi ai prossimi 30 giorni. Clic: elenco filtrato."],
  ['oltre 30 giorni', "Fatture fornitori con scadenza oltre i 30 giorni. Clic: elenco filtrato."],
  ['totale fornitori da pagare', "Tutte le fatture fornitori in avere ancora da pagare, importi lordi, fuori dai piani di rientro."],
  ['piani di rientro', "Debiti verso fornitori con un piano di rate concordato a parte (es. Tecno 3FP, Torneria Alpone): conta il residuo del piano, non le singole fatture, che restano aperte in NTS."],
  ['movimenti da registrare', "Movimenti del c/c che la banca ha mandato nel file CBI, importati in NTS ma non ancora registrati in prima nota. Sono già nella liquidità stimata."],
  ['accrediti', "Somma dei movimenti in entrata importati dalla banca e non ancora registrati in NTS."],
  ['addebiti', "Somma dei movimenti in uscita importati dalla banca e non ancora registrati in NTS."],
  ['riconosciuti', "Movimenti abbinati per importo (e nome) a una fattura, a una proforma o a un incasso/pagamento segnato in Fiammetta: la partita esce da scaduto e scadenze, e il segnato a mano non si somma alla banca."],
  [/^fatture · /, "Fatture clienti ancora da incassare, raggruppate per cliente. «Incassato» le toglie subito dagli importi attesi; «dilaziona» registra rate concordate con il cliente."],
  [/^fatture da pagare/, "Fatture fornitori ancora da pagare, raggruppate per fornitore, importi lordi. «Pagato» le toglie subito; «dilaziona» registra rate concordate con il fornitore."],
  ['scadenza nts', "Scadenza registrata nel gestionale NTS. Se c'è una dilazione concordata, sotto è indicata la data della rata, che è quella che vale."],
  [/^(data )?attesa$/, "Data in cui si prevede di incassare: scadenza NTS, oppure scadenza o data fattura + giorni della regola del cliente, oppure rata di dilazione."],
  ['ritardo', "Giorni trascorsi dalla data attesa (clienti) o dalla scadenza (fornitori). Giallo fino a 60 giorni, rosso oltre. «tra N gg» = non ancora scaduta."],
  ['pagamento e banca', "Modalità di pagamento e banca d'appoggio registrate in NTS sulla partita."],
  ['riconosciuto come', "A che cosa è stato abbinato il movimento di banca: fattura cliente, fattura fornitore, proforma, o incasso/pagamento segnato a mano in Fiammetta."],
  ['ordine, bolla e fattura', "Il percorso della proforma: ordine del cliente → bolla (DDT) → fattura. NTS non collega la proforma: la collega Fiammetta, uno a uno, per cliente, importo e data."],
  ['segnati in fiammetta', "Incassi e pagamenti segnati a mano che NTS non ha ancora registrato: contano subito nella liquidità stimata e spariscono da soli quando NTS li registra."],
  ['rate concordate', "Le rate della dilazione accordata con la controparte. La rata «pagata» è quella che il residuo aperto in NTS non copre più."],
  // Scadenziario
  ['residuo da pagare dei piani attivi', "Per ogni tipo di piano, tutte le rate non ancora pagate (capitale e interessi), comprese le saltate e le scadute da confermare: è quanto resta da versare. Clic su un tipo per andare al suo elenco."],
  [/^totale$/, "Residuo da pagare di tutti i piani attivi."],
  [/^f24 da versare/, "Modelli F24 ricevuti dal commercialista: ogni versamento è una rata con scadenza e importo."],
  [/^(rateizzazioni ader|aderenti)/, "Piani con l'Agenzia delle Entrate-Riscossione, in ordine di urgenza: prima quelli con più rate scadute. Da 6 rate scadute o saltate è zona rossa, all'8ª il piano decade."],
  [/^finanziamenti/, "Finanziamenti e mutui con le banche: rate per data di erogazione, raggruppate per banca."],
  // Banche
  [/^debito contabile/, "Capitale ancora da rimborsare secondo la contabilità NTS. NON comprende gli interessi (futuri né maturati): per quello c'è il «residuo da piano»."],
  [/^residuo da piano/, "Quanto resta da pagare secondo il piano di ammortamento: capitale e interessi delle rate non ancora pagate. È più alto del debito contabile perché comprende gli interessi."],
  ['differenza', "Debito contabile − residuo da piano. Normalmente il residuo del piano è più alto perché comprende gli interessi; una differenza diversa va controllata."],
  ['contabile', "Saldo registrato in prima nota NTS, fino all'ultima registrazione."],
  [/^stimat[oa]$/, "Contabile + movimenti bancari importati dopo l'ultima registrazione + incassi e pagamenti segnati in Fiammetta."],
  ['accordato', "Importo massimo concesso dalla banca su quella linea (fido di cassa o castelletto)."],
  ['utilizzato', "Importo della linea già usato."],
  ['disponibile', "Accordato − utilizzato: quanto si può ancora usare."],
  [/^utilizzo/, "Quota dell'accordato già utilizzata."],
  [/^tasso/, "Tasso annuo applicato dalla banca, in %. Serve per scegliere dove scoprirsi (prima la linea più economica) e stimare il costo."],
  ['scoperti di c/c oggi', "Somma dei c/c in rosso alla stima di oggi."],
  ['anticipi nella pfn', "Anticipi su fatture e SBF anticipati: sono debito verso la banca e entrano nella PFN."],
  ['finanziamento soci (contabile)', "Finanziamento dei soci alla società (conto soci c/finanziamento). Non è nella PFN bancaria ma in quella totale."],
  [/^castelletti accordati/, "Somma degli accordati delle linee di anticipo (SBF, fatture Italia, estero, export). Mostra solo le linee con accordato inserito."],
  ['fidi di cassa accordati', "Somma dei fidi di cassa dei c/c inseriti."],
  [/^documento$/, "Fattura o documento della partita (numero e data). «saldo 2025» = saldo di apertura dell'anno; «da abbinare» = pagamento registrato in NTS ma non abbinato alla fattura."],
  [/^importo$/, "Importo in euro (IVA compresa per le fatture; capitale + interessi per le rate)."],
  [/^scadenza$/, "Data di scadenza della rata. Se è passata e la rata non è pagata, è in ritardo."],
  [/^stato$/, "Per le rate: «da confermare» = scadenza passata senza che nessuno abbia segnato pagata o saltata. Per le proforme: a che punto è il percorso ordine → bolla → fattura → incasso."],
  [/^n\.$/, "Numero della rata sul totale del piano."],
  [/^pagata il$/, "Data in cui la rata è stata pagata e banca usata."],
  [/^segnata da$/, "Chi ha segnato lo stato della rata e quando; l'eventuale PDF collegato."],
  [/^conto$/, "Conto del piano dei conti di NTS."],
  [/^banca$/, "Banca del conto."],
  [/^tipo$/, "Tipo di conto: conto corrente, c/incassi SBF, accantonamento, anticipi o cassa."],
  [/^registrato fino al$/, "Data dell'ultima registrazione in prima nota su quel conto: dopo quella data valgono i movimenti importati dalla banca."],
  [/^saldo$/, "Saldo contabile in prima nota NTS."],
  [/^saldo c\/c$/, "Saldo del c/c letto sul portale della banca e inserito a mano: serve come controllo, non cambia la stima."],
  [/^anticipi$/, "Anticipi utilizzati letti sul portale della banca e inseriti a mano."],
  [/^fido c\/c$/, "Fido di cassa del c/c letto sul portale della banca."],
  [/^conti bancari e cassa/, "Saldi contabili NTS dei conti bancari e della cassa, con l'ultima registrazione di ciascuno."],
  [/^saldi dal portale banca/, "Saldi letti sul portale della banca e inseriti a mano: servono come controllo e non cambiano la stima."],
  [/^simest( ·|$)/, "Finanziamenti agevolati SIMEST (fiere internazionali, esportatrici): rate semestrali."],
  [/^finanziamento soci( ·|$)/, "Finanziamento dei soci alla società: piano di rimborso (da gennaio 2027)."],
  [/^piani di rientro fornitori( ·|$)/, "Piani di rate concordati con fornitori per debiti pregressi: contano il residuo del piano, non le singole fatture."],
  // Pulsanti e funzioni
  ['oggi', "Situazione di oggi: liquidità, scoperti e anticipi, PFN, scaduto, prossimi 30 giorni e rate AdER."],
  ['crediti e debiti', "Fatture da incassare (clienti, proforme), da pagare (fornitori), movimenti già in banca e incassi/pagamenti segnati a mano."],
  ['scadenziario', "Rate di finanziamenti, F24, AdER e piani di rientro con scadenza, stato e conferma dei pagamenti."],
  ['banche e pfn', "Conti, scoperti, fidi, anticipi e castelletti, finanziamenti, PFN."],
  ['conto economico', "Ricavi, costi e margini per trimestre, come registrati in prima nota."],
  ['stato dati', "Quando sono arrivati gli ultimi dati dal gestionale e che cosa manca o va controllato."],
  ['impostazioni', "Parametri, regole di incasso per cliente, mappa dei conti e team."],
  ['incassato', "Segna che il cliente ha pagato: l'importo entra subito nella liquidità stimata e la partita esce dai crediti. Resta «in attesa» finché NTS non lo registra, poi si chiude da solo. Se la banca importa lo stesso movimento, non si somma due volte."],
  ['pagato', "Segna che hai pagato il fornitore: l'importo esce subito dalla liquidità stimata e la partita dai debiti. Resta «in attesa» finché NTS non lo registra, poi si chiude da solo. Se la banca importa lo stesso movimento, non si somma due volte."],
  ['incassata', "Segna che il cliente ha pagato la proforma."],
  ['non valida', "Esclude la proforma dai conti (rifatta, annullata o errata)."],
  ['aggiorna', "Rilegge subito i dati dal database. Fiammetta lo fa anche da sola: controlla ogni 2 minuti se il gestionale ha mandato dati nuovi e quando riapri la scheda."],
  ['aggiorna adesso', "Rilegge subito i dati dal database."],
  ['pagata', "Segna la rata come pagata, con data e banca."],
  ['saltata', "Segna la rata come non pagata: nell'AdER conta per la decadenza e il debito resta nel residuo."],
  ['annulla', "Annulla questa registrazione (chi ne ha il permesso, dopo conferma)."],
  ['aggiungi f24', "Inserisce un modello F24 ricevuto dal commercialista: scadenza, importo e ciò che si paga; il PDF si può allegare."],
  ['nuovo piano', "Crea un piano di rate: finanziamento, AdER, piano fornitore o altro."],
  ['aggiungi rata', "Aggiunge una rata a questo piano."]
];
const GL_LAB = new Map(); // cache testo -> spiegazione
function spiega(testo) {
  const k = String(testo || '').toLowerCase().replace(/\s+/g, ' ').trim(); if (!k) return null;
  if (GL_LAB.has(k)) return GL_LAB.get(k);
  let r = null; for (const [m, t] of GL) { if (typeof m === 'string' ? m === k : m.test(k)) { r = t; break; } }
  GL_LAB.set(k, r); return r;
}
// Dopo ogni disegno della pagina: i «title» diventano spiegazioni istantanee e i testi del glossario ricevono la loro
function tooltips() {
  const root = document.getElementById('app'); if (!root) return;
  root.querySelectorAll('[title]').forEach(el => { const t = el.getAttribute('title'); if (t) { el.setAttribute('data-tip', t); el.removeAttribute('title'); } });
  root.querySelectorAll('th, h3, .lab, .nav button, .act button, .head button, .btn, .pill, summary .nm').forEach(el => {
    if (el.dataset.tip) return;
    const nodo = el.matches('summary .nm') ? el.firstChild : null;
    const t = spiega(nodo ? nodo.textContent : el.textContent); if (t) { el.setAttribute('data-tip', t); if (el.matches('th, h3, .lab')) el.classList.add('tip'); }
  });
  // il valore di un riquadro ha la spiegazione della sua etichetta (o del titolo della scheda)
  root.querySelectorAll('.kpi').forEach(el => {
    if (el.dataset.tip) return;
    const prev = el.previousElementSibling, lab = prev && prev.matches('.lab') ? prev.textContent : (el.closest('.card') && el.closest('.card').querySelector('h3') ? el.closest('.card').querySelector('h3').textContent : '');
    const t = spiega(el.textContent) || spiega(lab); if (t) el.setAttribute('data-tip', t);
  });
}
(function iniziaTooltip() {
  const box = document.createElement('div'); box.className = 'tooltip'; box.setAttribute('role', 'tooltip'); document.body.appendChild(box);
  let cur = null, timer = null;
  const mostra = (el, x, y) => {
    const t = el.getAttribute('data-tip'); if (!t) return; cur = el; box.textContent = t; box.classList.add('on');
    const w = box.offsetWidth, h = box.offsetHeight; let L = x + 14, T = y + 18;
    if (L + w > window.innerWidth - 8) L = Math.max(8, window.innerWidth - w - 8);
    if (T + h > window.innerHeight - 8) T = Math.max(8, y - h - 12);
    box.style.left = L + 'px'; box.style.top = T + 'px';
  };
  const nascondi = () => { cur = null; clearTimeout(timer); box.classList.remove('on'); };
  document.addEventListener('mouseover', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (!el) return nascondi(); if (el === cur) return; clearTimeout(timer); timer = setTimeout(() => mostra(el, e.clientX, e.clientY), 180); box._xy = [e.clientX, e.clientY]; });
  document.addEventListener('mousemove', e => { box._xy = [e.clientX, e.clientY]; if (cur) { const el = e.target.closest && e.target.closest('[data-tip]'); if (el !== cur) return nascondi(); mostra(cur, e.clientX, e.clientY); } });
  document.addEventListener('mouseout', e => { if (cur && !(e.relatedTarget && cur.contains(e.relatedTarget))) nascondi(); });
  document.addEventListener('scroll', nascondi, true); document.addEventListener('mousedown', nascondi, true); document.addEventListener('keydown', nascondi, true);
  // sul telefono non c'è il passaggio del mouse: un tocco prolungato su un testo con spiegazione la mostra per qualche secondo
  document.addEventListener('contextmenu', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && window.matchMedia('(hover: none)').matches) { e.preventDefault(); const r = el.getBoundingClientRect(); mostra(el, r.left, r.top); clearTimeout(timer); timer = setTimeout(nascondi, 6000); } });
})();

function shell(inner) {
  return `<div class="shell"><aside class="side">
    <div class="brand"><svg class="flame" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2c2 6 9 9 9 17a9 9 0 0 1-18 0c0-4 2-6 3-8 0 3 1 5 3 5 0-5 1-10 3-14z" fill="#d9480f"/><path d="M16 14c1 3 4 4 4 8a4 4 0 0 1-8 0c0-3 2-4 4-8z" fill="#f59f00"/></svg><div><b>Fiammetta</b><small>Magikal · amministrazione</small></div></div>
    <nav class="nav">${VISTE.map(([k, l]) => `<button class="${S.view === k ? 'on' : ''}" onclick="UI.go('${k}')">${l}</button>`).join('')}</nav>
    <div class="foot"><div class="info">${esc(S.me ? S.me.nome : S.email)}<br>Gestionale: ${S.data.stato.ultimo_invio ? fmtDT(S.data.stato.ultimo_invio) : 'mai'}<br>Pagina letta alle ${new Date(S.loadedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}<br>Registrazioni fino al ${fmtD(S.data.stato.ultima_registrazione)}</div><div class="act"><button onclick="UI.reload()">Aggiorna</button><button class="pw" onclick="UI.modal('password')">Password</button><button onclick="UI.logout()">Esci</button></div></div>
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
  const sc = window.scrollY; $('#app').innerHTML = shell(page()); etichette(); tooltips(); window.scrollTo(0, S._keepScroll ? sc : 0); S._keepScroll = false;
  if (S._anchor) { const a = document.getElementById(S._anchor); S._anchor = null; if (a) a.scrollIntoView({ block: 'start' }); }
  const first = document.querySelector('.modal input:not([type=hidden]):not([type=checkbox]),.modal select');
  if (S.modal && S.modal.type === 'dilazione') UI.dilTot();
  const sicuro = document.querySelector('.modal button[autofocus]');
  if (sicuro && S.modal && !S.modal._f) { sicuro.focus(); S.modal._f = true; }
  else if (first && S.modal && !S.modal._f) { first.focus(); S.modal._f = true; }
}

// ---------- Oggi ----------
const segnato = v => Math.abs(v) < 0.5 ? '–' : (v > 0 ? '+ ' : '− ') + eur(Math.abs(v));
// kpiBox(etichetta, valore, sottotitolo, classe, vai): se «vai» (istruzione JS, es. "UI.go('partite','pagamenti:prossime')") è presente il riquadro è cliccabile
const kpiBox = (label, val, sub, cls, vai) => `<div${vai ? ` class="kclk" role="button" tabindex="0" onclick="${vai}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${vai}}"` : ''}><div class="small muted lab">${label}</div><div class="kpi sm ${cls || ''}">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
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
  const ader = D.piani.filter(p => p.tipo === 'ader' && p.stato === 'attivo').map(p => ({ p, s: statoAder(p) })).sort(cmpAder), aderRosso = ader.filter(x => x.s.rosso);
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
  ${aderRosso.length ? `<div class="alert bad" style="font-size:15px"><b>AdER in zona rossa: ${aderRosso.map(x => esc(x.p.nome) + ' ' + x.s.contatore + '/' + x.s.soglia + ' rate scadute (' + eur(x.s.scadutoImporto) + ')').join(' · ')}.</b> Alla ${aderRosso[0].s.soglia}ª rata non pagata il piano decade automaticamente: dare priorità a questi pagamenti. ${link('Vai al piano', 'scadenziario', 'piani')}</div>` : ''}
  ${daConf.length ? `<div class="alert"><b>${daConf.length} rate scadute senza esito</b> (${eur(sum(daConf, r => r.importo))}): vanno segnate come pagate o saltate nello ${link('Scadenziario', 'scadenziario', 'conferma')}.</div>` : ''}
  ${(() => { const t = testoControlli(controlliBanca(pos), true); return t ? `<div class="alert"><b>Controllo con le banche</b><br>${t}</div>` : ''; })()}
  ${D.stato.conti_da_mappare ? `<div class="alert"><b>${D.stato.conti_da_mappare} conti con movimenti non ancora classificati</b>: il conto economico non li include. Si classificano in ${link('Impostazioni → Mappa dei conti', 'impostazioni')}.</div>` : ''}
  <div class="stack"><div class="row4">
    <div class="card kclk2" onclick="UI.go('banche','liquidita')"><h3>${link('Liquidità', 'banche', 'liquidita')}</h3><div class="kpi ${liqClass}">${eur(s.liquidita)}</div>
      <div class="sub">bancaria ${eur(s.liqBanca)} (c/c in attivo ${eur(s.ccAttivi)} + accantonamenti ${eur(s.acc)}) · cassa ${eur(s.cassa)}</div>
      ${s.sbfPresentati > 0.5 ? `<div class="sub">non conteggiati: effetti SBF presentati ${eur(s.sbfPresentati)}</div>` : ''}
      ${pos.diversa ? `<div class="sub">stimata al ${fmtD(pos.dataStima)} · contabile al ${fmtD(D.stato.ultima_registrazione)}: ${eur(pos.c.liquidita)}</div>` : ''}
      ${pos.ultimoMov && giorni(pos.ultimoMov, OGGI) >= 3 ? `<div class="sub warn">movimenti banca fermi al ${fmtD(pos.ultimoMov)} (${giorni(pos.ultimoMov, OGGI)} giorni): incassi e pagamenti più recenti si vedono solo se segnati con «Incassato» / «Pagato»</div>` : ''}
      ${P.uscite_fisse_mese ? `<div class="sub">Uscite fisse di un mese: ${eur(P.uscite_fisse_mese)} ${s.liquidita < P.uscite_fisse_mese ? '<span class="pill warn">sotto soglia</span>' : '<span class="pill good">coperte</span>'}</div>` : ''}</div>
    <div class="card kclk2" onclick="UI.go('banche','scoperti')"><h3>${link('Scoperti e anticipi', 'banche', 'scoperti')}</h3><div class="kpi">${eur(s.scoperti + s.anticipi)}</div><div class="sub">scoperti di c/c ${eur(s.scoperti)}${Math.abs(s.scoperti - pos.c.scoperti) > 0.5 ? ` (contabile ${eur(pos.c.scoperti)})` : ''} · anticipi ${link(eur(s.anticipi), 'banche', 'anticipi')}</div>${(() => { const K = castelletti(pos); return K.accordato ? `<div class="sub">castelletti: utilizzati ${eur(K.utilizzoAcc)} su ${eur(K.accordato)} accordati · disponibili ${eur(K.disponibile)}</div>` : ''; })()}${D.saldi[0] && D.saldi[0].accordato_anticipi ? `<div class="sub">Ultimo saldo dal portale ${esc(D.saldi[0].banca)} ${fmtD(D.saldi[0].data)}: anticipi ${eur(D.saldi[0].anticipi_utilizzati)} su accordato ${eur(D.saldi[0].accordato_anticipi)}</div>` : ''}</div>
    <div class="card kclk2" onclick="UI.go('banche')"><h3>${link('PFN bancaria', 'banche')}</h3><div class="kpi">${eur(pos.pfnStima)}</div><div class="sub">finanziamenti ${eur(pos.fin)} (capitale, senza interessi) + anticipi ${eur(s.anticipi)} + scoperti ${eur(s.scoperti)} − liquidità ${eur(s.liquidita)}${pos.diversa ? ` · contabile ${eur(pos.pfn)}` : ''}</div><div class="sub">con finanziamento soci (${eur(pos.soci)}): <b>${eur(pos.pfnTotStima)}</b></div></div>
    <div class="card"><h3>Scaduto</h3>
      <div class="kclk" onclick="UI.go('partite','incassi:scaduto')"><div class="kpi sm">${link('clienti', 'partite', 'incassi:scaduto')} <span class="${scadutoC > 0 ? 'warn' : ''}">${eur(scadutoC)}</span></div><div class="sub">${scadC.length} partite oltre la data attesa${aperturaC ? ` · di cui saldi 2025 ${eur(aperturaC)}` : ''}</div></div>
      <div class="kclk" style="margin-top:8px" onclick="UI.go('partite','pagamenti:scaduto')"><div class="kpi sm">${link('fornitori', 'partite', 'pagamenti:scaduto')} <span class="${scadutoF > 0 ? 'bad' : ''}">${eur(scadutoF)}</span></div><div class="sub">${scadF.length} partite scadute, fuori dai piani di rientro</div></div>
      ${pf.length ? `<div class="sub">${link('piani di rientro', 'partite', 'pagamenti:piani')}: ${pf.map(x => esc(x.nome) + ' ' + eur(x.residuo)).join(' · ')}</div>` : ''}
      ${inBanca.length ? `<div class="sub">${link(inBanca.length + ' pagamenti e incassi', 'partite', 'banca')} già passati in banca, da registrare in NTS: non contati</div>` : ''}</div>
  </div>
  <div class="card"><h3>Prossimi 30 giorni (fino al ${fmtD(fine)})</h3>
    <div class="row4" style="margin-bottom:12px">${kpiBox('Uscite', '− ' + eur(usciteRate + usciteForn), `${link('rate, F24 e piani', 'scadenziario', 'prossime')} ${eur(usciteRate)} · ${link('fornitori in scadenza', 'partite', 'pagamenti:prossime')} ${eur(usciteForn)}`, 'bad', "UI.go('partite','pagamenti:prossime')")}${kpiBox('Incassi attesi', '+ ' + eur(incassi), `${link('fatture ai clienti', 'partite', 'incassi:prossime')} (${cli30.length})`, 'good', "UI.go('partite','incassi:prossime')")}${kpiBox('Proforme da incassare', '+ ' + eur(incProf), `${link(prof.length + ' proforme', 'partite', 'incassi:proforme')}, ordini non ancora fatturati${profTutte.length > prof.length ? ` · altre ${profTutte.length - prof.length} dopo i 30 giorni (clienti che pagano dopo la consegna)` : ''}`, 'good', "UI.go('partite','incassi:proforme')")}${kpiBox('Saldo netto dei conti a fine periodo', eur(nettoFine), `liquidità − scoperti di c/c (oggi ${eur(netto)}), senza proforme, stipendi, F24 e spese correnti`, nettoFine < 0 ? 'warn' : '')}</div>
    ${elenco ? `<div class="evl">${elenco}</div><div class="small muted" style="margin-top:6px">Le date con più movimenti si aprono con un clic.</div>` : '<div class="muted">Nessuna scadenza nei prossimi 30 giorni.</div>'}</div>
  <div class="card"><h3>Rateizzazioni AdER</h3>${ader.length ? `<ul class="list">${ader.map(({ p, s }) => `<li class="${s.rosso ? 'zr' : ''}" style="${s.rosso ? 'padding:10px 12px;border-radius:8px;margin-bottom:6px' : ''}"><div><b style="${s.rosso ? 'font-size:1.15em;color:var(--bad)' : ''}">${esc(p.nome)}</b><div class="d" style="${s.rosso ? 'font-size:14px' : ''}">${s.pagate}/${s.tot} pagate · contatore <b class="${s.rosso ? 'zr-n' : ''}">${s.contatore}/${s.soglia}</b> (${s.saltate} saltate${s.daConf ? ` + <span class="${s.rosso ? 'bad' : 'warn'}">${s.daConf} scadute da confermare</span>` : ''}) · scaduto ${eur(s.scadutoImporto)} · residuo ${eur(s.residuo)} · prossima ${s.prossima ? fmtD(s.prossima.scadenza) + ' ' + eur2(s.prossima.importo) : '–'}</div><div class="bar"><i class="${s.rosso ? 'bad' : s.margine <= 3 ? 'warn' : 'good'}" style="width:${Math.min(100, 100 * s.contatore / s.soglia)}%"></i></div></div><div class="right">${s.rosso ? `<span class="pill bad" title="Da ${s.zonaRossa} rate scadute su ${s.soglia} il piano è in zona rossa: all'ottava il piano decade automaticamente. Pagare con priorità.">ZONA ROSSA${s.margine > 0 ? ' · ' + s.margine + (s.margine === 1 ? ' rata alla decadenza' : ' rate alla decadenza') : ''}</span>` : s.margine <= 3 ? '<span class="pill warn">attenzione</span>' : '<span class="pill good">regolare</span>'}</div></li>`).join('')}</ul>` : '<div class="muted">Nessun piano AdER attivo.</div>'}<div class="small muted" style="margin-top:8px">Contatore = rate saltate + rate scadute non ancora confermate, come nel cruscotto storico: una rata scaduta conta finché non viene segnata pagata. Residuo = tutte le rate non pagate, saltate comprese.</div></div>
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
  const riga = p => `<tr><td class="nowrap">n. ${p.numdoc}<span class="d2">${fmtD(p.datdoc)}</span></td><td>${esc(p.controparte || p.conto)}${p.paese && p.paese !== 'IT' ? ' <span class="pill plain">' + esc(p.paese) + '</span>' : ''}${p.pagamento ? `<span class="d2">${esc(p.pagamento)}</span>` : ''}</td><td class="small">${catenaProforma(p)}</td><td class="num">${eur2(p.totdoc)}</td><td>${statoProforma(p)}${p.copertura && p.copertura.nota ? '<span class="d2">' + esc(p.copertura.nota) + '</span>' : ''}</td><td class="right">${['attesa', 'da_fatturare', 'verifica'].includes(p.stato) ? `<button class="btn sm primary" onclick="UI.modal('incasso','pf:${p.chiave}')">Incassata</button> ${puoElim() ? `<button class="btn sm ghost" onclick="UI.chiediAnnullaProforma('${p.chiave}')">non valida</button>` : ''}` : p.copertura && puoElim() ? `<button class="btn sm ghost" onclick="UI.chiediAnnullaMovimento(${p.copertura.id})">annulla</button>` : ''}</td></tr>`;
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
    const inBanca = scadX().filter(s => s.tipo_cf === 'C' && s.banca_pag);
    const tot = sum(pc, s => s.importo) + sum(prof, p => p.totdoc), sal25 = sum(scad.filter(s => s.apertura), s => s.importo);
    let rows = T.filtro === 'scaduto' ? scad : T.filtro === 'prossime' ? pros : T.filtro === 'oltre' ? oltre : T.filtro === 'proforme' ? [] : pc;
    rows = cerca(rows);
    const PF_FILTRI = [['aperte', 'Aperte'], ['incassare', 'Da incassare'], ['pagata', 'Pagate, da spedire'], ['verifica', 'Da verificare'], ['chiuse', 'Chiuse e doppie'], ['tutte', 'Tutte']];
    const pff = PF_FILTRI.some(f => f[0] === T.pfFiltro) ? T.pfFiltro : 'aperte';
    const pfStati = { aperte: ['attesa', 'da_fatturare', 'fatturata', 'verifica'], incassare: ['attesa', 'da_fatturare'], pagata: ['pagata'], verifica: ['verifica'], chiuse: ['chiusa', 'doppia', 'incassata', 'annullata'], tutte: null }[pff];
    const pfRows = cerca(D.proforme.filter(p => !pfStati || pfStati.includes(p.stato)));
    body = `<div class="card" style="margin-bottom:12px"><div class="row5">${kpiBox('Fatture oltre la data attesa', eur(sum(scad, s => s.importo)), `${scad.length} partite${sal25 ? ` · di cui saldi 2025 ${eur(sal25)}` : ''}`, 'warn', "UI.partite(null,'scaduto')")}${kpiBox('Fatture attese entro 30 giorni', eur(sum(pros, s => s.importo)), pros.length + ' partite', '', "UI.partite(null,'prossime')")}${kpiBox('Fatture attese oltre 30 giorni', eur(sum(oltre, s => s.importo)), oltre.length + ' partite', '', "UI.partite(null,'oltre')")}${kpiBox('Proforme da incassare', eur(sum(prof, p => p.totdoc)), `${daSped.length} da spedire${daFatt.length ? ' · ' + daFatt.length + ' spedite, da fatturare' : ''}`, '', "UI.partite(null,'proforme')")}${kpiBox('Totale da incassare', eur(tot), 'fatture + proforme', 'good', "UI.partite(null,'tutto')")}</div>
      <div class="small muted" style="margin-top:8px">Non conteggiati: ${inBanca.length} incassi già arrivati in banca e da registrare in NTS (${eur(sum(inBanca, s => s.importo))}, ${link('vedi', 'partite', 'banca')}) · ${fatturate.length} proforme già fatturate (${eur(sum(fatturate, p => p.totdoc))}, il credito è già nelle fatture) · ${pagate.length} pagate e da spedire (${eur(sum(pagate, p => p.totdoc))}) · ${verifica.length} da verificare (${eur(sum(verifica, p => p.totdoc))}) · ${doppie.length} doppie</div></div>
      ${dilazioniCard(true)}${filtriHtml(filtri)}${cercaHtml('cerca cliente o numero')}
      ${T.filtro !== 'proforme' ? `<h3 style="margin:14px 0 8px">Fatture · ${rows.length} partite · ${eur(sum(rows, s => s.importo))}</h3><div class="small muted" style="margin-bottom:8px">La «data attesa» è la scadenza NTS, oppure quella della regola del cliente (es. NordicFire: fattura + 10 giorni). Con «Incassato» la partita esce subito dagli importi da incassare.</div>${gruppiPartite(rows, true)}` : ''}
      ${T.filtro === 'tutto' || T.filtro === 'proforme' ? `<h3 style="margin:18px 0 8px">Proforme · ${pfRows.length}</h3><div class="small muted" style="margin-bottom:8px">In Magikal la proforma non genera nulla in NTS: Fiammetta la collega all'ordine del cliente (stesso cliente, importo e data più vicini) e da lì alla bolla, alla fattura e all'incasso. Conta come «da incassare» finché la merce non è fatturata (da quel momento il credito è nelle fatture qui sopra) e finché non si vede il bonifico, in NTS o in banca.</div><div class="tabs">${PF_FILTRI.map(([k, l]) => `<button class="${pff === k ? 'on' : ''}" onclick="UI.pfFiltro('${k}')">${l}</button>`).join('')}</div>${tabellaProforme(pfRows)}` : ''}`;
  } else if (T.tab === 'pagamenti') {
    const filtri = [['tutto', 'Tutto'], ['scaduto', 'Scadute'], ['prossime', 'In scadenza entro 30 giorni'], ['oltre', 'Oltre 30 giorni'], ['piani', 'Piani di rientro']];
    if (!filtri.some(f => f[0] === T.filtro)) T.filtro = 'tutto';
    const df = debitiF().filter(s => !s.piano);
    const scad = df.filter(s => s.datsca < OGGI), pros = df.filter(s => s.datsca >= OGGI && s.datsca <= fine), oltre = df.filter(s => s.datsca > fine);
    const dare = partiteF().filter(s => s.importo > 0 && !s.piano), inBanca = scadX().filter(s => s.tipo_cf === 'F' && s.banca_pag), pf = pianiFornitori();
    let rows = T.filtro === 'scaduto' ? scad : T.filtro === 'prossime' ? pros : T.filtro === 'oltre' ? oltre : T.filtro === 'piani' ? [] : df;
    rows = cerca(rows);
    const piani = pf.map(x => { const st = x.piani.map(p => ({ p, s: statoAder(p) })); const prossima = st.map(y => y.s.prossima).filter(Boolean).sort((a, b) => a.scadenza.localeCompare(b.scadenza))[0];
      return `<details class="piano" open><summary><span class="nm">${esc(x.nome)}<div class="small muted">${st.map(({ p, s }) => `${esc(p.nome)}: ${s.pagate}/${s.tot} rate pagate`).join(' · ')}</div></span><span class="small nowrap">prossima ${prossima ? fmtD(prossima.scadenza) + ' ' + eur(prossima.importo) : '–'}</span><span class="nowrap right">residuo piano <b>${eur(x.residuo)}</b></span></summary>
        <div class="body"><div class="small muted" style="margin-bottom:6px">Il debito si paga con le rate dello ${link('Scadenziario', 'scadenziario', 'piani')}. In NTS restano aperte ${x.partite.length} partite (saldo ${eur2(-sum(x.partite, s => s.importo))}): non contano nello scaduto.</div>${x.partite.length ? tabellaPartite(x.partite, false) : ''}</div></details>`; }).join('');
    body = `<div class="card" style="margin-bottom:12px"><div class="row5">${kpiBox('Scadute', eur(-sum(scad, s => s.importo)), scad.length + ' partite fuori dai piani', 'bad', "UI.partite(null,'scaduto')")}${kpiBox('In scadenza entro 30 giorni', eur(-sum(pros, s => s.importo)), pros.length + ' partite', '', "UI.partite(null,'prossime')")}${kpiBox('Oltre 30 giorni', eur(-sum(oltre, s => s.importo)), oltre.length + ' partite', '', "UI.partite(null,'oltre')")}${kpiBox('Totale fornitori da pagare', eur(-sum(df, s => s.importo)), 'importi lordi, fuori dai piani', '', "UI.partite(null,'tutto')")}${kpiBox('Piani di rientro', eur(sum(pf, x => x.residuo)), pf.map(x => esc(x.nome)).join(' · ') || 'nessuno', '', "UI.partite(null,'piani')")}</div>
      <div class="small muted" style="margin-top:8px">Non conteggiati: ${inBanca.length} pagamenti già usciti dalla banca e da registrare in NTS (${eur(-sum(inBanca, s => s.importo))}, ${link('vedi', 'partite', 'banca')}) · ${dare.length} partite in dare (acconti, note di credito o scritture da sistemare, ${eur(sum(dare, s => s.importo))}).</div></div>
      ${dilazioniCard(false)}${filtriHtml(filtri)}${T.filtro !== 'piani' ? cercaHtml('cerca fornitore o numero fattura') : ''}
      ${T.filtro !== 'piani' ? `<h3 style="margin:14px 0 8px">Fatture da pagare · ${rows.length} partite · ${eur(-sum(rows, s => s.importo))}</h3>${gruppiPartite(rows, false)}` : ''}
      ${T.filtro === 'tutto' || T.filtro === 'piani' ? `<h3 style="margin:18px 0 8px">Piani di rientro</h3>${piani || '<div class="card muted">Nessun piano di rientro attivo.</div>'}` : ''}
      ${T.filtro === 'tutto' && dare.length ? `<details class="piano" style="margin-top:14px"><summary><span class="nm">Partite in dare (non conteggiate)<div class="small muted">acconti, note di credito, pagamenti da abbinare o scritture da sistemare in NTS</div></span><span class="small nowrap">${dare.length} partite</span><span class="nowrap right"><b>${eur2(sum(dare, s => s.importo))}</b></span></summary><div class="body">${tabellaPartite(cerca(dare), false)}</div></details>` : ''}`;
  } else if (T.tab === 'banca') {
    const filtriB = [['tutto', 'Tutti'], ['accrediti', 'Accrediti'], ['addebiti', 'Addebiti'], ['riconosciuti', 'Riconosciuti'], ['altri', 'Non riconosciuti']];
    if (!filtriB.some(f => f[0] === T.filtro)) T.filtro = 'tutto';
    let rows = (D.nuovi || []).filter(m => T.filtro === 'accrediti' ? m.accredito > 0 : T.filtro === 'addebiti' ? m.addebito > 0 : T.filtro === 'riconosciuti' ? m.abb : T.filtro === 'altri' ? !m.abb : true);
    if (q) rows = rows.filter(m => ((m.descr1 || '') + ' ' + (m.descr2 || '') + ' ' + (m.abb ? m.abb.nome : '')).toLowerCase().includes(q));
    const tutti = D.nuovi || [], abb = tutti.filter(m => m.abb);
    body = `<div class="card" style="margin-bottom:12px"><div class="row4">${kpiBox('Movimenti da registrare', String(tutti.length), 'importati in NTS dopo l\'ultima registrazione di ogni banca', '', "UI.partite(null,'tutto')")}${kpiBox('Accrediti', '+ ' + eur(sum(tutti, m => m.accredito)), tutti.filter(m => m.accredito > 0).length + ' movimenti', 'good', "UI.partite(null,'accrediti')")}${kpiBox('Addebiti', '− ' + eur(sum(tutti, m => m.addebito)), tutti.filter(m => m.addebito > 0).length + ' movimenti', 'bad', "UI.partite(null,'addebiti')")}${kpiBox('Riconosciuti', String(abb.length), 'abbinati a fatture, proforme o incassi segnati per importo', '', "UI.partite(null,'riconosciuti')")}</div>
      <div class="small muted" style="margin-top:8px">Questi movimenti sono già nella liquidità stimata. Quelli riconosciuti chiudono la partita in Fiammetta finché Miriam non li registra in NTS; gli altri (stipendi, F24, commissioni, giroconti…) restano solo nella liquidità.</div></div>
      ${filtriHtml(filtriB)}${cercaHtml('cerca nella descrizione o nel nome')}
      <div class="card"><div class="scroll"><table class="resp"><tr><th>Data</th><th>Banca</th><th class="num">Importo</th><th>Descrizione</th><th>Riconosciuto come</th></tr>${rows.map(m => `<tr><td class="nowrap">${fmtD(m.dataoperaz)}</td><td class="small">${esc(nomeBanca(m.banca))}</td><td class="num ${m.accredito > 0 ? 'good' : 'bad'}">${m.accredito > 0 ? '+ ' + eur2(m.accredito) : '− ' + eur2(m.addebito)}</td><td class="small full">${esc(m.descr1 || '')} <span class="muted">${esc(m.descr2 || '')}</span></td><td class="small">${m.abb ? `<span class="pill good">${esc(m.abb.tipo)}</span> ${esc(m.abb.nome || '')} <span class="muted">${esc(m.abb.rif || '')}</span>` : '<span class="muted">–</span>'}</td></tr>`).join('')}</table></div>${rows.length ? '' : '<div class="muted">Nessun movimento dopo l\'ultima registrazione.</div>'}</div>`;
  } else {
    const rows = D.movimenti.filter(m => m.stato === 'attesa');
    body = `<div class="small muted" style="margin-bottom:8px">Incassi e pagamenti segnati a mano in Fiammetta che NTS non ha ancora registrato. Spariscono da soli quando la partita viene chiusa in prima nota. Se la banca ha già importato lo stesso movimento (stesso importo, banca e date vicine) compare «già in banca»: nella liquidità conta una volta sola.</div>
    <div class="card"><div class="scroll"><table class="resp"><tr><th>Data</th><th>Tipo</th><th>Controparte</th><th>Riferimento</th><th class="num">Importo</th><th>Banca</th><th></th></tr>${rows.map(m => `<tr><td class="nowrap">${fmtD(m.data)}</td><td>${m.tipo === 'incasso' ? '<span class="pill good">incasso</span>' : '<span class="pill bad">pagamento</span>'}</td><td>${esc(m.controparte || m.conto || '')}</td><td class="small muted">${m.inBanca ? `<span class="pill good" title="La banca ha già importato questo movimento (stesso importo, banca e data vicina): è nella liquidità una volta sola, il segnato a mano non si somma">già in banca ${fmtD(m.inBanca.dataoperaz)}</span> ` : ''}${m.chiave_partita ? 'partita ' + esc(m.chiave_partita.split('|').slice(1, 4).join('/')) : m.chiave_doc ? 'proforma ' + esc(m.chiave_doc.split('|').pop()) : ''}${m.nota ? ' · ' + esc(m.nota) : ''}</td><td class="num">${eur2(m.importo)}</td><td class="small">${esc(m.banca || '')}<span class="d2">segnato da ${esc(m.creato_da || '')} il ${fmtD(m.creato_il)}</span></td><td class="right">${puoElim() ? `<button class="btn sm ghost" onclick="UI.chiediAnnullaMovimento(${m.id})">annulla</button>` : ''}</td></tr>`).join('')}</table></div>${rows.length ? '' : '<div class="muted">Niente in attesa.</div>'}</div>`;
  }
  return `<div class="head"><h2>Crediti e debiti</h2><span class="small muted">partite aperte in NTS al ${fmtD(D.stato.ultima_registrazione)} · movimenti banca fino al ${fmtD(posizione().ultimoMov)}</span></div>
  <div class="tabs" style="margin-bottom:10px">${tabs.map(([k, l]) => `<button class="${T.tab === k ? 'on' : ''}" style="${T.tab === k ? '' : 'border-color:#cfc5b8'}" onclick="UI.partite('${k}')">${l}</button>`).join('')}</div>${body}`;
}
// Elenco delle dilazioni concordate con lo stato di ogni rata (la rata «pagata» è quella che il residuo NTS non copre più)
function dilazioniCard(cli) {
  const lista = S.data.scad.filter(s => s.dil && s.tipo_cf === (cli ? 'C' : 'F'));
  if (!lista.length) return '';
  const tot = sum(lista, s => s.dil.righe.reduce((a, r) => a + Math.abs(r.importo), 0));
  const pillRata = (s, t) => { const r = s.dil.righe.find(x => x.tr.n === t.n);
    if (t.aperto <= 0.004) return '<span class="pill good">' + (cli ? 'incassata' : 'pagata') + '</span>';
    if (r && r.banca_pag) return '<span class="pill good" title="Il movimento è già nel file della banca, da registrare in NTS">visto in banca</span>';
    return t.data < OGGI ? `<span class="pill bad">scaduta da ${giorni(t.data, OGGI)} gg</span>` : '<span class="pill plain">' + (cli ? 'da incassare' : 'da pagare') + '</span>'; };
  return `<details class="piano" style="margin-bottom:12px" ${lista.length <= 4 ? 'open' : ''}><summary><span class="nm">Dilazioni concordate<div class="small muted">al posto della scadenza originale valgono le date delle rate</div></span><span class="small nowrap">${lista.length} ${lista.length === 1 ? 'partita' : 'partite'}</span><span class="nowrap right">ancora aperto <b>${eur2(tot)}</b></span></summary><div class="body"><div class="scroll"><table class="resp"><tr><th>${cli ? 'Cliente' : 'Fornitore'}</th><th>Documento</th><th>Rate concordate</th><th class="num">Residuo</th><th></th></tr>
  ${lista.map(s => `<tr><td>${esc(s.controparte || s.conto)}</td><td class="small">${s.apertura ? 'saldo 2025' : 'ft ' + esc(String(s.numdoc || '')) + ' del ' + fmtD(s.datdoc)}<span class="d2">scadenza originale ${fmtD(s.datsca)}</span></td><td class="small">${s.dil.tr.map(t => `<div class="nowrap">${t.n}ª · ${fmtD(t.data)} · ${eur2(t.importo)} ${pillRata(s, t)}</div>`).join('')}${s.dil.extra > 0.004 ? `<div class="warn">quota non pianificata ${eur2(s.dil.extra)}: resta con la scadenza originale</div>` : ''}${s.dil.d.nota ? `<div class="muted">${esc(s.dil.d.nota)}</div>` : ''}</td><td class="num">${eur2(s.dil.righe.reduce((a, r) => a + Math.abs(r.importo), 0))}<span class="d2">in NTS ${eur2(s.dil.residuoNTS)}${s.dil.pendTot > 0.004 ? ' · segnati a mano ' + eur2(s.dil.pendTot) : ''}</span></td><td class="right"><button class="btn sm" onclick="UI.modal('dilazione','${s.chiave}')">modifica</button></td></tr>`).join('')}</table></div></div></details>`;
}
function tabellaPartite(rows, cli) {
  rows = rows.slice().sort((a, b) => (cli ? a.attesa : a.datsca).localeCompare(cli ? b.attesa : b.datsca));
  return `<div class="scroll"><table class="resp"><tr><th>Documento</th><th>Scadenza NTS</th>${cli ? '<th>Attesa</th>' : ''}<th>Ritardo</th><th class="num">Importo</th><th>Pagamento e banca</th><th></th></tr>
  ${rows.map(s => { const rit = cli ? s.ritardo : giorni(s.datsca, OGGI); const d = cli ? s.attesa : s.datsca; return `<tr><td>${s.daAbbinare ? `<span class="pill warn" title="In NTS il ${cli ? 'pagamento del cliente' : 'pagamento al fornitore'} è registrato ma non abbinato alla fattura: va abbinato in prima nota">${cli ? 'incasso' : 'pagamento'} da abbinare</span>` : s.apertura ? '<span class="pill plain">saldo 2025</span>' : (s.numdoc ? '<span class="nowrap">ft ' + esc(String(s.numdoc)) + (s.alfdoc && s.alfdoc !== '00' ? '/' + esc(s.alfdoc) : '') + '</span> <span class="nowrap">del ' + fmtD(s.datdoc) + '</span>' : '–')}${s.insolu === 'S' ? ' <span class="pill bad">insoluto</span>' : ''}${s.flant === 'S' ? ' <span class="pill plain">anticipata</span>' : ''}${s.piano ? ' <span class="pill plain">piano ' + esc(s.piano.nome) + '</span>' : ''}${s.tr ? ` <span class="pill warn" title="Dilazione concordata: al posto della scadenza NTS valgono le date delle rate. Si modifica con il pulsante «dilazione».">${s.tr.n ? 'dilazione · rata ' + s.tr.n + '/' + s.tr.tot : 'dilazione · quota non pianificata'}</span>` : ''}${s.accontoDa ? ` <span class="pill good" title="In NTS c'è un acconto o un incasso dello stesso importo non abbinato alla fattura: la fattura è già pagata, va solo abbinata in prima nota">pagata con acconto del ${fmtD(s.accontoDa.datdoc || s.accontoDa.datsca)}</span>` : ''}${s.accontoPer ? ` <span class="small muted nowrap">per ft ${esc(String(s.accontoPer.numdoc))}</span>` : ''}</td><td class="nowrap">${fmtD(s.datscaNTS || s.datsca)}${s.tr ? `<span class="d2">rata del ${fmtD(s.datsca)}${s.tr.n && Math.abs(s.tr.importoRata - Math.abs(s.importo)) > 0.5 ? ' · di ' + eur2(s.tr.importoRata) : ''}</span>` : ''}</td>${cli ? `<td class="nowrap ${s.attesa !== s.datsca ? 'muted' : ''}">${fmtD(s.attesa)}</td>` : ''}<td class="nowrap ${rit > 0 && d < OGGI ? (rit > 60 ? 'bad' : 'warn') : 'muted'}">${d < OGGI ? rit + ' gg' : 'tra ' + (-rit) + ' gg'}</td><td class="num ${s.importo < 0 ? 'muted' : ''}">${eur2(cli ? s.importo : -s.importo)}</td><td class="small">${esc(s.pagamento || '')}${s.banca ? `<span class="d2">${esc(nomeBanca(s.banca) === 'Altro' ? s.banca : nomeBanca(s.banca))}</span>` : ''}</td><td class="right">${s.accontoDa || s.accontoPer ? '<span class="small muted">compensate</span>' : `<button class="btn sm ${cli ? 'primary' : ''}" onclick="UI.modal('incasso','${s.tr ? 'tr:' + s.tr.n + ':' : 'pt:'}${s.chiave}')">${cli ? 'Incassato' : 'Pagato'}</button>${s.piano || s.daAbbinare ? '' : ` <button class="btn sm ghost" onclick="UI.modal('dilazione','${s.chiave}')" title="${s.tr ? 'Modifica o annulla la dilazione concordata' : 'Registra una dilazione concordata con ' + (cli ? 'il cliente' : 'il fornitore') + ': rate con date e importi diversi dalla scadenza originale'}">${s.tr ? 'dilazione' : 'dilaziona'}</button>`}`}</td></tr>`; }).join('')}</table></div>`;
}

// ---------- Scadenziario ----------
const ORDINE_PIANI = ['f24', 'ader', 'finanziamento', 'simest', 'soci', 'fornitore', 'altro'];
function pageScadenziario() {
  const D = S.data, f = S.filtroRate;
  const tabs = [['piani', 'Per piano'], ['prossime', 'Prossimi 60 giorni'], ['conferma', 'Da confermare'], ['tutte', 'Tutte le rate']];
  const attivi = D.piani.filter(p => (p.stato || 'attivo') === 'attivo').map(p => ({ p, s: statoAder(p) }));
  const resTipo = t => sum(attivi.filter(x => x.p.tipo === t), x => x.s.residuo);
  const tipi = ORDINE_PIANI.filter(t => attivi.some(x => x.p.tipo === t));
  const riepilogo = `<div class="card" style="margin-bottom:12px"><h3>Residuo da pagare dei piani attivi</h3><div class="row6">${tipi.map(t => kpiBox(tipoPiano[t], eur(resTipo(t)), attivi.filter(x => x.p.tipo === t).length + ' piani' + (t === 'ader' && attivi.some(x => x.p.tipo === 'ader' && x.s.rosso) ? ' · <b class="bad">zona rossa</b>' : ''), t === 'ader' && attivi.some(x => x.p.tipo === 'ader' && x.s.rosso) ? 'bad' : '', `UI.goA('scadenziario','piani','sec-${t}')`)).join('')}${kpiBox('Totale', '<b>' + eur(sum(attivi, x => x.s.residuo)) + '</b>', attivi.length + ' piani attivi', '', "UI.go('scadenziario','piani')")}</div>
    <div class="small muted" style="margin-top:8px">Residuo = tutte le rate non ancora pagate (capitale e interessi), comprese le rate saltate e quelle scadute da confermare: è quanto resta da versare.</div></div>`;
  let body = '';
  if (f === 'piani') {
    body = ORDINE_PIANI.map(t => {
      let ps = D.piani.filter(p => p.tipo === t); if (!ps.length) return '';
      const titolo = `<h3 id="sec-${t}" style="margin:18px 0 8px">${tipoPiano[t]} · residuo ${eur(resTipo(t))}</h3>`;
      // AdER: dal più urgente (più rate scadute) come nel vecchio cruscotto; a 6 rate scadute su 8 è zona rossa
      if (t === 'ader') return titolo + ps.map(p => ({ p, s: statoAder(p) })).sort(cmpAder).map(x => cardPiano(x.p)).join('');
      // Finanziamenti e SIMEST: raggruppati per banca e, dentro ogni banca, per data di erogazione; le rate con la scadenza passata e non pagate sono «in ritardo»
      if (t === 'finanziamento' || t === 'simest') {
        const gr = {}; ps.slice().sort((a, b) => String(erogazione(a) || '').localeCompare(String(erogazione(b) || ''))).forEach(p => (gr[p.controparte || p.nome] = gr[p.controparte || p.nome] || []).push(p));
        return titolo + Object.keys(gr).sort((a, b) => a.localeCompare(b)).map(b => { const L = gr[b], st = L.map(p => statoAder(p)), rit = st.filter((x, i) => x.scadute > 0 && (L[i].stato || 'attivo') === 'attivo');
          return `<div class="gh"><b>${esc(b)}</b><span class="small muted">${L.length} ${L.length === 1 ? 'finanziamento' : 'finanziamenti'} · residuo ${eur(sum(st, x => x.residuo))}</span>${rit.length ? `<span class="pill bad" title="Rate con la scadenza passata e non pagate: siamo in ritardo. Vanno segnate pagate (se lo sono) o regolarizzate con la banca.">in ritardo · ${sum(rit, x => x.scadute)} ${sum(rit, x => x.scadute) === 1 ? 'rata' : 'rate'} · ${eur(sum(rit, x => x.scadutoImporto))}</span>` : ''}</div>` + L.map(p => cardPiano(p)).join(''); }).join('');
      }
      return titolo + ps.map(p => cardPiano(p)).join('');
    }).join('');
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
function pdfInAttesa() {
  const docs = (S.data.docF24 || []).filter(d => d.stato === 'da_inserire');
  if (!docs.length) return '';
  return `<div class="card" style="margin:2px 0 12px;background:#fff7e6;border-color:#f0d9a8"><b>${docs.length === 1 ? '1 PDF caricato, da inserire' : docs.length + ' PDF caricati, da inserire'}</b><div class="small muted" style="margin-bottom:6px">Apri il PDF e copia scadenza e importo con «Inserisci i dati»: il PDF resta collegato al versamento.</div>
    ${docs.map(d => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:4px 0"><span class="small" style="overflow-wrap:anywhere"><b>${esc(d.nome_file)}</b> · caricato da ${esc(d.caricato_da || '')} il ${fmtD(d.caricato_il)}${d.nota ? ' · ' + esc(d.nota) : ''}</span><span style="margin-left:auto"><button class="btn sm" onclick="UI.apriPdf('${d.id}')">Apri PDF</button> <button class="btn sm primary" onclick="UI.modal('f24','${d.id}')">Inserisci i dati</button>${puoElim() ? ` <button class="btn sm danger" onclick="UI.chiediEliminaDoc('${d.id}')">elimina</button>` : ''}</span></div>`).join('')}</div>`;
}
function cardPiano(p) {
  const s = statoAder(p), rs = S.data.rate.filter(r => r.piano_id === p.id);
  const pagato = sum(rs.filter(r => r.stato === 'pagata'), r => r.importo);
  const attivo = (p.stato || 'attivo') === 'attivo', rosso = attivo && s.rosso, inRit = attivo && p.tipo !== 'ader' && s.scadute > 0;
  const stPill = attivo ? '' : `<span class="pill plain">${esc(String(p.stato).replace('_', ' '))}</span>`;
  const stato = p.tipo === 'ader'
    ? `${s.pagate}/${s.tot} pagate · contatore <b class="${rosso ? 'zr-n' : s.margine <= 3 ? 'warn' : ''}">${s.contatore}/${s.soglia}</b> (${s.saltate} saltate${s.daConf ? ` + <span class="warn">${s.daConf} da confermare</span>` : ''})`
    : `${s.pagate}/${s.tot} pagate${s.saltate ? ` · <span class="bad">${s.saltate} non pagate</span>` : ''}${s.daConf ? ` · <span class="warn">${s.daConf} da confermare</span>` : ''}`;
  const ritPill = inRit ? ` <span class="pill bad" title="Ci sono rate con la scadenza passata e non pagate: siamo in ritardo sul piano. Vanno segnate pagate (se lo sono) o regolarizzate con la banca.">in ritardo · ${s.scadute} ${s.scadute === 1 ? 'rata' : 'rate'} · da ${s.maxGiorni} gg</span>` : '';
  const erog = (p.tipo === 'finanziamento' || p.tipo === 'simest') && erogazione(p) ? ` · erogato ${p.data_erogazione ? '' : '≈ '}${fmtD(erogazione(p))}` : '';
  const bannerRosso = rosso ? `<div class="alert bad" style="margin-top:0"><b>Zona rossa: ${s.contatore} rate scadute su ${s.soglia}.</b> ${s.margine > 0 ? `Mancano ${s.margine} ${s.margine === 1 ? 'rata' : 'rate'} alla decadenza: alla ${s.soglia}ª rata non pagata il piano decade automaticamente e l'intero debito torna esigibile in un'unica soluzione. <b>Pagare queste rate con priorità</b> (scaduto ${eur2(s.scadutoImporto)}).` : `La soglia di ${s.soglia} rate è raggiunta: il piano può essere già decaduto, da verificare subito con l'Agenzia (scaduto ${eur2(s.scadutoImporto)}).`}</div>` : '';
  return `<details class="piano ${rosso ? 'zr' : ''}" ${S._open === p.id || rosso ? 'open' : ''} ontoggle="UI.toggle('${p.id}',this.open)"><summary><span class="nm">${esc(p.nome)} ${stPill}${rosso ? ' <span class="pill bad">ZONA ROSSA</span>' : ''}${ritPill}<div class="small muted">${esc(p.controparte || '')}${p.descrizione ? ' · ' + esc(p.descrizione) : ''}${erog}</div></span>
    <span class="small nowrap">${stato}</span>
    <span class="small nowrap right">residuo <b>${eur(s.residuo)}</b> su ${eur(s.totale)}<div class="bar" style="width:140px"><i class="good" style="width:${s.totale ? 100 * pagato / s.totale : 0}%"></i></div></span></summary>
    <div class="body">${bannerRosso}${p.tipo === 'f24' ? pdfInAttesa() : ''}${p.tipo === 'ader' ? `<div class="small muted" style="margin-bottom:6px">Prossima rata: ${s.prossima ? fmtD(s.prossima.scadenza) + ' · ' + eur2(s.prossima.importo) : '–'} · decadenza alla ${s.soglia}ª rata non pagata: contatore ${s.contatore}, margine ${s.margine}</div>` : ''}
    ${tabellaRate(rs, false)}
    <div class="row" style="margin-top:10px"><span class="small muted">${p.tipo === 'f24' ? 'Un versamento per ogni modello F24 ricevuto dal commercialista: scadenza, importo e che cosa si paga.' : `Capitale ${eur(p.capitale_iniziale)} · ${p.n_rate || rs.length} rate ${p.cadenza_mesi === 1 ? 'mensili' : p.cadenza_mesi === 6 ? 'semestrali' : 'ogni ' + p.cadenza_mesi + ' mesi'} da ${eur2(p.rata)}${p.rata1 ? ' (prima ' + eur2(p.rata1) + ')' : ''} · dal ${fmtD(p.prima_rata)}`}</span>
    <span style="margin-left:auto">${p.tipo === 'f24' ? '' : `<select class="btn sm" onchange="UI.statoPiano('${p.id}',this.value)">${['attivo', 'in_istruttoria', 'in_istanza', 'chiuso', 'decaduto'].map(x => `<option value="${x}" ${p.stato === x ? 'selected' : ''}>${x.replace('_', ' ')}</option>`).join('')}</select> `}${p.tipo === 'f24' ? `<button class="btn sm" onclick="UI.modal('f24')">Aggiungi F24</button>` : `<button class="btn sm" onclick="UI.modal('rata','${p.id}')">Aggiungi rata</button>`}</span></div></div></details>`;
}
const pdfRata = r => { const d = r.documento_id && (S.data.docF24 || []).find(x => x.id === r.documento_id); return d ? `<div><button class="btn sm ghost" style="max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere" onclick="UI.apriPdf('${d.id}')" title="Apre il PDF originale">PDF ${esc(d.nome_file)}</button></div>` : ''; };
function tabellaRate(rs, conPiano) {
  if (!rs.length) return '<div class="muted">Nessuna rata.</div>';
  const rossi = new Set(S.data.piani.filter(p => (p.stato || 'attivo') === 'attivo' && statoAder(p).rosso).map(p => p.id));
  return `<div class="scroll"><table class="resp"><tr>${conPiano ? '<th>Piano</th>' : ''}<th>N.</th><th>Scadenza</th><th class="num">Importo</th><th>Stato</th><th>Pagata il</th><th>Segnata da</th><th></th></tr>
  ${rs.map(r => { const inRit = r.stato !== 'pagata' && r.scadenza < OGGI && r.stato_piano === 'attivo', rosso = inRit && rossi.has(r.piano_id), gg = inRit ? giorni(r.scadenza, OGGI) : 0;
    return `<tr class="${rosso ? 'zrr' : ''}">${conPiano ? `<td>${esc(r.nome)}<div class="small muted">${esc(r.controparte || '')}</div></td>` : ''}<td>${r.n}${r.n_rate ? '/' + r.n_rate : ''}</td><td class="nowrap ${rosso ? 'rit-big' : inRit ? 'bad' : r.stato_effettivo === 'da_confermare' ? 'warn' : ''}">${fmtD(r.scadenza)}${inRit ? `<span class="d2 ${rosso ? 'rit' : ''}">${rosso ? 'SCADUTA da ' + gg + ' gg' : 'in ritardo di ' + gg + ' gg'}</span>` : ''}</td><td class="num">${eur2(r.importo)}</td><td>${pillStato(r.stato_effettivo)}</td><td>${r.data_pagamento ? fmtD(r.data_pagamento) : ''}${r.banca ? '<span class="d2">' + esc(r.banca) + '</span>' : ''}</td><td class="small muted">${r.marcata_da ? esc(r.marcata_da) + ' · ' + fmtD(r.marcata_il) : ''}${r.nota ? '<div>' + esc(r.nota) + '</div>' : ''}${pdfRata(r)}</td>
  <td class="right">${r.stato === 'pagata' ? `<button class="btn sm ghost" onclick="UI.setRata('${r.id}','futura')" title="Torna a non pagata">annulla</button>` : r.stato === 'saltata' ? `<button class="btn sm" onclick="UI.modal('pagata','${r.id}')">pagata</button> <button class="btn sm ghost" onclick="UI.setRata('${r.id}','futura')">annulla</button>` : `<button class="btn sm primary" onclick="UI.modal('pagata','${r.id}')">pagata</button> <button class="btn sm" onclick="UI.setRata('${r.id}','saltata')">saltata</button>`}${r.tipo === 'f24' && puoElim() ? ` <button class="btn sm danger" onclick="UI.chiediEliminaRata('${r.id}')">elimina</button>` : ''}</td></tr>`; }).join('')}</table></div>`;
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
const inFido = (banca, linea, campo, val, w) => `<input class="search" style="width:${w || 88}px;text-align:right;padding-left:6px;padding-right:6px" inputmode="decimal" data-dec="${campo === 'tasso' ? 3 : 2}" value="${val == null || val === '' ? '' : String(Number(val)).replace('.', ',')}" placeholder="–" title="${campo === 'tasso' ? 'Tasso annuo in %, es. 6,5' : 'Importo accordato in euro'}" onchange="UI.fido('${banca}','${linea}','${campo}',this.value)">`;
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
// ---------- Castelletti ----------
// Una riga per ogni linea di credito su anticipi: Cassa Padana (SBF, fatture Italia, fatture estero), Credem (anticipo export), BPER (in chiusura).
// Utilizzato: saldo dichiarato dalla banca nel file CBI se il rapporto è mappato (tabella rapporti_banca) e il file è recente; per Credem, che non è
// nel file, il capitale delle tranche aperte ricostruite dalla prima nota (anticipo + 120 giorni); altrimenti il saldo contabile NTS.
const nomeLineaAnt = { anticipi_italia: 'Anticipo fatture Italia', anticipi_estero: 'Anticipo fatture estero', sbf: 'SBF · RiBa' };
// Tranche aperte di un conto anticipi dalla prima nota: gli anticipi sono le registrazioni in avere (più il saldo di apertura), i rimborsi quelle in dare.
// Il rimborso comprende gli interessi (fino al 3% in più): chiude l'anticipo di pari importo che ha più o meno 120 giorni (mai prima di 90).
// I rimborsi senza anticipo corrispondente (anticipi dell'anno scorso, saldo di apertura) scalano dai più vecchi; l'eccedenza sono interessi.
function trancheAnticipi(righe, giorniScad) {
  const dt = m => String(m.datreg).slice(0, 10), ord = (a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : 0;
  const A = righe.filter(m => Number(m.importo) < -0.005).map(m => ({ data: dt(m), originale: -Number(m.importo), residuo: -Number(m.importo), apertura: Number(m.causale) === 4999 })).sort(ord);
  const R = righe.filter(m => Number(m.importo) > 0.005).map(m => ({ data: dt(m), importo: Number(m.importo) })).sort(ord);
  R.forEach(d => {
    const c = A.filter(a => a.residuo > 0.5 && !a.apertura && giorni(a.data, d.data) >= 90 && d.importo >= a.residuo - 0.01 && d.importo <= a.residuo * 1.03);
    if (!c.length) return;
    c.sort((x, y) => Math.abs(giorni(x.data, d.data) - giorniScad) - Math.abs(giorni(y.data, d.data) - giorniScad));
    c[0].residuo = 0; d.abbinato = true;
  });
  R.filter(d => !d.abbinato).forEach(d => {
    let resto = d.importo, usato = 0;
    for (const a of A) {
      if (resto <= 0.5) break;
      if (a.residuo <= 0.5 || a.data > d.data) continue;
      const x = Math.min(a.residuo, resto); a.residuo -= x; resto -= x; usato += x;
      if (resto <= 0.03 * usato) break;
    }
  });
  const aperte = A.filter(a => a.residuo > 0.5).map(a => ({ data: a.data, importo: a.residuo, originale: a.originale, apertura: a.apertura, scadenza: a.apertura ? null : addDays(a.data, giorniScad) }));
  return { aperte, capitale: sum(aperte, a => a.importo) };
}
// Movimento di un rapporto anticipi del file CBI: anticipo (causale 30) o scarico alla scadenza (causale 53), con distinta, fattura e debitore.
function leggiMovAnticipo(m) {
  const d = String(m.descr2 || '').replace(/\s+/g, ' ').trim(), c = String(m.causale);
  if (c === '53') {
    const f = d.match(/FATT\. N\. (\S+) (\d\d)\.(\d\d)\.(\d{4})(?: DEB\. (.+?))?(?: N\.? ?FATT\..*)?$/i);
    return { tipo: 'scarico', testo: f ? `incasso fattura ${f[1]} del ${f[2]}/${f[3]}/${f[4]}${f[5] ? ' · ' + f[5] : ''}` : d };
  }
  if (c === '30') { const f = d.match(/DIST(?:INTA|\.)\s*N\.?(?:RO)?\s*(?:\d{4}\s+)?(\d+)/i); return { tipo: 'anticipo', testo: f ? 'anticipo, distinta ' + f[1] : d }; }
  return { tipo: 'altro', testo: d };
}
const etichettaLinea = (banca, linea) => banca === 'Credem' && linea === 'anticipi_estero' ? 'Anticipo export' : nomeLineaAnt[linea];
// Documenti presentati alla banca (tabella anticipi_presentati): la banca non dice quali fatture o RiBa compongono un anticipo, quindi si inseriscono a mano,
// una riga per documento, con il valore del documento e l'importo davvero anticipato (può essere inferiore: spazio libero nel castelletto, concentrazione sul debitore).
const LINEE_BASE = [['Cassa Padana', 'sbf'], ['Cassa Padana', 'anticipi_italia'], ['Cassa Padana', 'anticipi_estero'], ['Credem', 'anticipi_estero']];
const normNum = v => { const t = String(v == null ? '' : v).trim(); return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t.toLowerCase(); };
// Scarichi alla scadenza (causale 53) dal file della banca: «SCARICO … FATT. N. 123 15.10.2026 DEB. cliente». Servono a riconoscere i documenti presentati già incassati.
function scarichiBanca() {
  return ((S.data.cast || {}).mov || []).filter(m => String(m.causale) === '53').map(m => {
    const d = String(m.descr2 || '').replace(/\s+/g, ' '), f = d.match(/FATT\. N\. (\S+) (\d\d)\.(\d\d)\.(\d{4})/i);
    return f ? { num: normNum(f[1]), data: `${f[4]}-${f[3]}-${f[2]}`, dataop: m.dataoperaz, importo: Math.abs(Number(m.importo)) } : null;
  }).filter(Boolean);
}
// Elenco delle linee tra cui scegliere nel modulo «Registra anticipo»: quelle base più le altre che risultano dai conti o dai documenti già inseriti
function lineeAnticipi() {
  const mappa = new Map(LINEE_BASE.map(([b, l]) => [b + '|' + l, `${b} · ${etichettaLinea(b, l)}`]));
  try { castelletti(posizione()).lista.forEach(x => { if (!mappa.has(x.banca + '|' + x.linea)) mappa.set(x.banca + '|' + x.linea, `${x.banca} · ${x.etichetta}`); }); } catch (e) { console.warn(e); }
  (S.data.antic || []).forEach(a => { if (!mappa.has(a.banca + '|' + a.linea)) mappa.set(a.banca + '|' + a.linea, `${a.banca} · ${etichettaLinea(a.banca, a.linea)}`); });
  return [...mappa.entries()].map(([k, t]) => ({ k, t }));
}
// Documenti tra cui scegliere (facoltativo): fatture di clienti ancora aperte in NTS e proforme in attesa. Scegliendone una il modulo si compila da solo.
function opzioniAnticipo() {
  const usate = new Set((S.data.antic || []).filter(a => a.stato === 'aperto').flatMap(a => [a.chiave_partita, a.chiave_doc]).filter(Boolean)), out = [];
  S.data.scad.filter(s => s.tipo_cf === 'C' && !s.copertura && !s.banca_pag && s.importo > 0 && !s.apertura && !s.daAbbinare).forEach(s => out.push({ k: 'pt', chiave: s.chiave, ord: String(s.datdoc || ''), cliente: s.controparte || '', documento: `ft ${s.numdoc} del ${fmtD(s.datdoc)}`, numero: String(s.numdoc || ''), datdoc: s.datdoc ? String(s.datdoc).slice(0, 10) : '', scadenza: s.datsca ? String(s.datsca).slice(0, 10) : '', importo: s.importo }));
  proformeAttese().forEach(p => out.push({ k: 'pf', chiave: p.chiave, ord: String(p.datdoc || ''), cliente: p.controparte || '', documento: `proforma ${p.numdoc} del ${fmtD(p.datdoc)}`, numero: '', datdoc: '', scadenza: '', importo: p.totdoc }));
  out.sort((a, b) => a.ord < b.ord ? 1 : a.ord > b.ord ? -1 : 0);
  out.forEach(o => { o.label = `${o.cliente} · ${o.documento} · ${eur2(o.importo)}${usate.has(o.chiave) ? ' · già presentato' : ''}`; });
  return out.slice(0, 500);
}
function castelletti(pos) {
  const D = S.data, C = D.cast || { banca: [], mov: [], riba: [], nts: [] }, g = {};
  const giorniScad = Number((D.P || {}).giorni_anticipo_export) || GIORNI_ANTICIPO;
  const ordLinea = { sbf: 0, anticipi_italia: 1, anticipi_estero: 2 }, ordBanca = { 'Cassa Padana': 0, 'Credem': 1 };
  const gruppo = (banca, linea) => g[banca + '|' + linea] || (g[banca + '|' + linea] = { banca, linea, etichetta: etichettaLinea(banca, linea),
    conti: [], codici: [], contiNum: [], usato: 0, presentati: 0, nts: 0, bancaRighe: 0, righe: 0, dataBanca: null, ultimaReg: null, tranche: null, mov: [], avvisi: [], unico: false, riba: [] });
  pos.righe.filter(r => r.categoria === 'anticipi' || r.categoria === 'sbf').forEach(r => {
    const banca = nomeBanca(r.descrizione), linea = r.categoria === 'sbf' ? 'sbf' : (/ester|export/i.test(r.descrizione) ? 'anticipi_estero' : 'anticipi_italia');
    const x = gruppo(banca, linea); x.conti.push(r.descrizione); x.contiNum.push(Number(r.conto)); x.righe++;
    if (linea === 'sbf') { if (r.stimato < 0) x.usato += -r.stimato; else x.presentati += r.stimato; } else { x.usato += -r.stimato; x.nts += -r.contabile; }
    if (r.bancaAnt) { x.bancaRighe++; x.dataBanca = r.bancaAnt.data; }
    if (r.ultima_registrazione && Math.abs(r.contabile) > 0.5 && (!x.ultimaReg || r.ultima_registrazione > x.ultimaReg)) x.ultimaReg = r.ultima_registrazione;
  });
  // c/incassi uniti al c/c (Cassa Padana, conto unico): effetti RiBa presentati; gli anticipi RiBa accreditati dalla banca dopo l'ultima registrazione sono da registrare
  pos.righe.filter(r => r.categoria === 'cc').forEach(r => r.uniti.filter(u => /incassi|sbf/i.test(u.descrizione)).forEach(u => {
    const x = gruppo(nomeBanca(r.descrizione), 'sbf'); x.unico = true; x.conti.push(u.descrizione + ' (sommato al c/c)');
    if (u.contabile > 0) x.presentati += u.contabile; else x.usato += -u.contabile;
    if (u.ultima_registrazione && (!x.ultimaReg || u.ultima_registrazione > x.ultimaReg)) x.ultimaReg = u.ultima_registrazione;
    const sm = (D.stimaBanca || []).find(s => Number(s.sottoconto) === Number(r.conto));
    if (sm) x.riba = C.riba.filter(m => Number(m.codice_banca) === Number(sm.codice) && (!u.ultima_registrazione || m.dataoperaz > u.ultima_registrazione) && Number(m.importo) > 0);
  }));
  // documenti presentati inseriti a mano: importi numerici, scarico già visto nel file della banca (Cassa Padana), giorni di ritardo sulla scadenza
  const scar = scarichiBanca();
  const antic = (D.antic || []).map(a => ({ ...a, imp: Number(a.importo_documento), ant: Number(a.importo_anticipato),
    scar: a.stato === 'aperto' && a.banca === 'Cassa Padana' && a.numero_doc && a.data_doc ? scar.find(s => s.num === normNum(a.numero_doc) && s.data === String(a.data_doc).slice(0, 10)) || null : null,
    ritardo: a.stato === 'aperto' && a.scadenza ? giorni(String(a.scadenza).slice(0, 10), OGGI) : null }));
  antic.filter(a => a.stato === 'aperto').forEach(a => gruppo(a.banca, a.linea));
  const lista = Object.values(g).map(x => {
    const f = fidoDi(x.banca, x.linea);
    x.accordato = f.accordato != null ? Number(f.accordato) : null; x.tasso = f.tasso != null ? Number(f.tasso) : null;
    x.util = x.linea === 'sbf' ? x.usato + x.presentati : x.usato; x.fonte = x.bancaRighe && x.bancaRighe === x.righe ? 'banca' : 'nts';
    // tranche (anticipi che non sono nel file della banca): ricostruite dalla prima nota
    if (x.linea !== 'sbf' && x.fonte === 'nts' && x.banca === 'Credem') {
      const righe = C.nts.filter(m => x.contiNum.includes(Number(m.conto)));
      if (righe.length) { x.tranche = trancheAnticipi(righe, giorniScad); x.nts = -sum(righe, m => m.importo); x.util = x.tranche.capitale; x.fonte = 'tranche'; }
    }
    // movimenti recenti dei rapporti mappati (anticipi e scarichi)
    const rap = (C.banca || []).filter(b => x.contiNum.includes(Number(b.conto)));
    x.mov = C.mov.filter(m => rap.some(b => Number(b.codice_banca) === Number(m.codice_banca) && Number(b.rapporto) === Number(m.rapporto)) && (String(m.causale) === '30' || String(m.causale) === '53')).slice(0, 14);
    x.disp = x.accordato != null ? x.accordato - x.util : null; x.perc = x.accordato ? pc1(x.util, x.accordato) : null; x.diff = x.fonte === 'banca' || x.fonte === 'tranche' ? x.util - x.nts : null;
    x.det = antic.filter(a => a.banca === x.banca && a.linea === x.linea); x.detAperti = x.det.filter(a => a.stato === 'aperto');
    x.detDoc = sum(x.detAperti, a => a.imp); x.detAnt = sum(x.detAperti, a => a.ant);
    x.detDiff = x.detAperti.length && (x.righe || x.unico) ? x.util - x.detAnt : null; // confronto col dettaglio inserito, solo se la linea ha un utilizzo di riferimento
    // avvisi: ciò che Miriam o Andrea devono guardare
    const av = x.avvisi, scad = x.tranche ? x.tranche.aperte.filter(a => a.scadenza && a.scadenza < OGGI) : [];
    rap.filter(b => b.saldo_banca != null && b.data_saldo_banca && giorni(b.data_saldo_banca, OGGI) > FRESCO_BANCA).forEach(b => av.push(`il file della banca arriva solo al ${fmtD(b.data_saldo_banca)}: finché non si importa quello nuovo il saldo mostrato è quello di NTS.`));
    if (x.fonte === 'banca' && Math.abs(x.diff) > SOGLIA_SCARTO) av.push(`in NTS il conto risulta ${eur2(x.nts)}${x.ultimaReg ? ' (registrato fino al ' + fmtD(x.ultimaReg) + ')' : ''}, ${eur2(Math.abs(x.diff))} ${x.diff > 0 ? 'in meno' : 'in più'} della banca. Fa fede la banca: la differenza viene da anticipi o incassi non ancora registrati in NTS, oppure registrati sull'altro conto anticipi.`);
    if (scad.length) av.push(`${scad.length === 1 ? 'una tranche di ' + eur2(scad[0].importo) + ' ha' : scad.length + ' tranche per ' + eur2(sum(scad, a => a.importo)) + ' hanno'} superato i ${giorniScad} giorni (${scad.map(a => fmtD(a.scadenza)).join(', ')}) e il rimborso non risulta registrato in NTS (conto registrato fino al ${fmtD(x.ultimaReg)}). Controlla sul portale: se è già stata rimborsata l'utilizzo è più basso, e il debito nella PFN più alto del vero.`);
    if (x.tranche && x.diff > SOGLIA_SCARTO && x.diff < 0.05 * x.util) av.push(`il capitale delle tranche è ${eur2(x.util)}, il saldo NTS ${eur2(x.nts)}: la differenza di ${eur2(x.diff)} sembrano gli interessi già pagati, registrati in riduzione del debito anziché a costo (oneri finanziari).`);
    if (x.fonte === 'nts' && x.linea !== 'sbf' && x.ultimaReg && x.usato > 0.5 && giorni(x.ultimaReg, OGGI) > FERMO_NTS) av.push(`saldo fermo alla registrazione del ${fmtD(x.ultimaReg)} (${giorni(x.ultimaReg, OGGI)} giorni fa)${x.banca === 'BPER' ? ': il conto BPER è in chiusura' : ''}. Se l'anticipo è già stato rimborsato va chiuso in NTS, altrimenti il debito della PFN è sovrastimato di ${eur2(x.usato)}.`);
    if (x.unico && x.riba.length) av.push(`dopo l'ultima registrazione del c/incassi (${fmtD(x.ultimaReg)}) la banca ha accreditato ${eur2(sum(x.riba, m => m.importo))} di anticipi RiBa (${x.riba.length === 1 ? '1 accredito' : x.riba.length + ' accrediti'}, l'ultimo il ${fmtD(x.riba.map(m => m.dataoperaz).sort().pop())}) non ancora registrati in NTS: l'utilizzo SBF mostrato è quello contabile e può essere in ritardo.`);
    // documenti presentati inseriti a mano: già scaricati dalla banca o scaduti ma ancora aperti; dettaglio che non torna con l'utilizzo
    const sc = x.detAperti.filter(a => a.scar), ri = x.detAperti.filter(a => !a.scar && a.ritardo != null && a.ritardo > 0);
    const elenco = L => L.slice(0, 3).map(a => esc(a.cliente)).join(', ') + (L.length > 3 ? '…' : ''), uno = L => L.length === 1;
    if (sc.length) av.push(`${sc.length} ${uno(sc) ? 'documento presentato risulta scaricato' : 'documenti presentati risultano scaricati'} dalla banca (${elenco(sc)}) ma ${uno(sc) ? 'è ancora aperto' : 'sono ancora aperti'} nel dettaglio: ${uno(sc) ? 'chiudilo' : 'chiudili'} in «Documenti anticipati».`);
    if (ri.length) av.push(`${ri.length} ${uno(ri) ? 'documento presentato ha' : 'documenti presentati hanno'} la scadenza passata (${elenco(ri)}; ${eur2(sum(ri, a => a.ant))} anticipati) e ${uno(ri) ? 'risulta ancora aperto' : 'risultano ancora aperti'}: se ${uno(ri) ? 'è stato incassato' : 'sono stati incassati'} ${uno(ri) ? 'chiudilo' : 'chiudili'} in «Documenti anticipati».`);
    if (x.detDiff != null && Math.abs(x.detDiff) > SOGLIA_SCARTO) av.push(`il dettaglio dei documenti anticipati somma ${eur2(x.detAnt)}, l'utilizzo è ${eur2(x.util)}: ${x.detDiff > 0 ? `mancano documenti per ${eur2(x.detDiff)} (anticipi non ancora inseriti)` : `il dettaglio supera l'utilizzo di ${eur2(-x.detDiff)} (documenti già incassati ancora aperti, oppure anticipi non ancora registrati in NTS)`}.`);
    return x;
  }).filter(x => x.util > 0.5 || x.presentati > 0.5 || x.accordato || x.bancaRighe || x.detAperti.length)
    .sort((a, b) => (ordBanca[a.banca] ?? 5) - (ordBanca[b.banca] ?? 5) || a.banca.localeCompare(b.banca) || ordLinea[a.linea] - ordLinea[b.linea]);
  // totali sui soli anticipi (l'SBF presentato non è un debito): utilizzo di tutte le linee, accordato e disponibile delle linee con accordato inserito
  const ant = lista.filter(x => x.linea !== 'sbf'), conAcc = ant.filter(x => x.accordato != null);
  return { lista, utilizzo: sum(ant, x => x.util), utilizzoAcc: sum(conAcc, x => x.util), accordato: sum(conAcc, x => x.accordato), disponibile: sum(conAcc, x => x.disp), nAvvisi: sum(lista, x => x.avvisi.length), nDet: sum(lista, x => x.detAperti.length), giorniScad };
}
function dettAnticipi(pos) {
  const D = S.data, K = castelletti(pos), L = K.lista, tr = L.filter(x => x.tranche);
  const segn2 = v => Math.abs(v) < 0.005 ? '–' : (v > 0 ? '+ ' : '− ') + eur2(Math.abs(v));
  const fonte = x => x.fonte === 'banca' ? `<span class="d2">dalla banca al ${fmtD(x.dataBanca)}${x.diff != null && Math.abs(x.diff) > SOGLIA_SCARTO ? ` · <span class="warn">in NTS ${eur(x.nts)}</span>` : ' · torna con NTS'}</span>`
    : x.fonte === 'tranche' ? `<span class="d2">${x.tranche.aperte.length} tranche aperte (da NTS fino al ${fmtD(x.ultimaReg)})${x.diff != null && Math.abs(x.diff) > SOGLIA_SCARTO ? ` · saldo NTS ${eur(x.nts)}` : ''}</span>`
    : `<span class="d2 ${x.ultimaReg && giorni(x.ultimaReg, OGGI) > FERMO_NTS ? 'warn' : ''}">da NTS${x.ultimaReg ? ', registrato fino al ' + fmtD(x.ultimaReg) : ''}</span>`;
  const detSint = x => x.detAperti.length
    ? `<span class="d2">${x.detAperti.length} ${x.detAperti.length === 1 ? 'documento presentato' : 'documenti presentati'}: valore ${eur(x.detDoc)} · anticipato <b>${eur(x.detAnt)}</b>${x.detDiff == null ? '' : Math.abs(x.detDiff) > SOGLIA_SCARTO ? ` · <span class="warn">${x.detDiff > 0 ? 'da inserire ' + eur(x.detDiff) : 'in più ' + eur(-x.detDiff)}</span>` : ' · torna con l\'utilizzo'}</span>`
    : (x.util > 0.5 ? '<span class="d2 muted">dettaglio dei documenti non inserito</span>' : '');
  const detHtml = x => {
    const ap = x.detAperti, ch = x.det.filter(a => a.stato === 'chiuso'), chiudi = x.banca === 'Credem' ? 'Rimborsato' : 'Incassato';
    const riga = a => { const ri = a.stato === 'aperto' && a.ritardo != null && a.ritardo > 0, pa = a.imp > 0 ? Math.round(100 * a.ant / a.imp) : 0;
      return `<tr><td>${esc(a.cliente)}<span class="d2">${esc(a.documento || '')}${a.nota ? (a.documento ? ' · ' : '') + esc(a.nota) : ''}</span>${a.scar ? `<span class="d2 good">scaricato dalla banca il ${fmtD(a.scar.dataop)}</span>` : ''}</td>
        <td class="nowrap">${fmtD(a.data_presentazione)}</td><td class="nowrap ${ri ? 'bad' : ''}">${a.scadenza ? fmtD(a.scadenza) : '–'}${ri ? `<span class="d2 bad">scaduto da ${a.ritardo} giorni</span>` : ''}</td>
        <td class="num">${eur2(a.imp)}</td><td class="num"><b>${eur2(a.ant)}</b>${pa < 100 ? `<span class="d2">${pa}% del documento</span>` : ''}</td>
        <td class="right nowrap">${a.stato === 'aperto' ? `<button class="btn sm" onclick="UI.chiudiAnticipo('${a.id}')">${chiudi}</button>` : `<span class="small muted">chiuso il ${fmtD(a.chiuso_il)}</span> <button class="btn sm ghost" onclick="UI.riapriAnticipo('${a.id}')">riapri</button>`} <button class="btn sm ghost" onclick="UI.modal('anticipo','${a.id}')">modifica</button>${puoElim() ? ` <button class="btn sm ghost" onclick="UI.chiediEliminaAnticipo('${a.id}')">elimina</button>` : ''}</td></tr>`; };
    const th = '<tr><th>Cliente e documento</th><th>Presentato il</th><th>Scadenza</th><th class="num">Valore documento</th><th class="num">Anticipato</th><th></th></tr>';
    const perCli = {}; ap.forEach(a => { const k = norm(a.cliente) || a.cliente; (perCli[k] = perCli[k] || { n: a.cliente, v: 0 }).v += a.ant; });
    const top = Object.values(perCli).sort((p, q) => q.v - p.v).slice(0, 4);
    const base = x.righe || x.unico;
    const ric = !ap.length ? (x.util > 0.5 ? `L'utilizzo è ${eur2(x.util)} ma non ci sono documenti inseriti: usa «Registra anticipo».` : 'Nessun documento aperto.')
      : !base ? 'Questa linea non ha un conto collegato in contabilità: il confronto con l\'utilizzo non è possibile.'
      : Math.abs(x.detDiff) <= SOGLIA_SCARTO ? `<span class="good">Il dettaglio torna con l'utilizzo (${eur2(x.util)}).</span>`
      : `<span class="warn">Utilizzo ${eur2(x.util)}, dettaglio ${eur2(x.detAnt)}: ${x.detDiff > 0 ? 'mancano documenti per ' + eur2(x.detDiff) : 'il dettaglio supera l\'utilizzo di ' + eur2(-x.detDiff)}.</span>`;
    return `<details class="piano" ${ap.length || S._open === 'ant-' + x.banca + x.linea ? 'open' : ''} ontoggle="UI.toggle('ant-${x.banca}${x.linea}',this.open)"><summary><span class="nm">${esc(x.banca)} · ${esc(x.etichetta)}: documenti presentati</span>${ap.length ? `<span class="small nowrap">${ap.length} ${ap.length === 1 ? 'aperto' : 'aperti'}</span><span class="nowrap right"><b>${eur2(x.detAnt)}</b> anticipati</span>` : `<span class="small muted nowrap">${ch.length ? 'nessun documento aperto' : 'nessun documento inserito'}</span>`}</summary><div class="body">
      ${ap.length ? `<div class="scroll"><table class="resp">${th}${ap.map(riga).join('')}<tr class="tot"><td>Totale aperti<span class="d2">${ap.length} ${ap.length === 1 ? 'documento' : 'documenti'}</span></td><td></td><td></td><td class="num">${eur2(x.detDoc)}</td><td class="num">${eur2(x.detAnt)}<span class="d2">${pct(x.detAnt, x.detDoc)} del valore</span></td><td></td></tr></table></div>` : ''}
      <div class="small" style="margin:8px 0">${ric}${x.detAperti.length && x.accordato != null ? ` · accordato ${eur(x.accordato)}, ${x.accordato - x.detAnt >= 0 ? 'resta ' + eur(x.accordato - x.detAnt) : 'sforato di ' + eur(x.detAnt - x.accordato)} sul dettaglio` : ''}</div>
      ${ap.length > 1 && x.detAnt > 0.5 ? `<div class="small muted" style="margin-bottom:8px">Concentrazione sui debitori: ${top.map(t => `${esc(t.n)} ${pct(t.v, x.detAnt)} (${eur(t.v)})`).join(' · ')}</div>` : ''}
      <button class="btn sm" onclick="UI.nuovoAnticipo('${x.banca}','${x.linea}')">+ Registra anticipo su questa linea</button>
      ${ch.length ? `<details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Chiusi (${ch.length})</summary><div class="scroll"><table class="resp">${th}${ch.slice(0, 50).map(riga).join('')}</table></div>${ch.length > 50 ? '<div class="small muted">Mostrati gli ultimi 50.</div>' : ''}</details>` : ''}</div></details>`;
  };
  const tab = `<div class="scroll"><table class="resp"><tr><th>Linea</th><th class="num">Utilizzato</th><th class="num">Accordato</th><th class="num">Disponibile</th><th>Utilizzo</th><th class="num">Tasso %</th></tr>
  ${L.map(x => `<tr><td>${esc(x.banca)} · <b>${esc(x.etichetta)}</b>${fonte(x)}<span class="d2">${x.conti.map(esc).join(' · ')}${x.linea === 'sbf' && x.presentati > 0.5 ? ' · effetti presentati ' + eur(x.presentati) : ''}</span>${detSint(x)}</td>
    <td class="num"><b>${eur(x.util)}</b></td><td class="num">${inFido(x.banca, x.linea, 'accordato', x.accordato)}</td><td class="num ${x.disp != null && x.disp < -0.5 ? 'bad' : ''}">${x.disp != null ? eur(x.disp) : '–'}</td><td>${x.perc == null ? '' : x.perc + '%' + barra(x.perc)}</td><td class="num">${inFido(x.banca, x.linea, 'tasso', x.tasso, 62)}</td></tr>`).join('')}
  <tr class="tot"><td>Totale anticipi <span class="d2">SBF escluso: gli effetti presentati non sono un debito</span></td><td class="num">${eur(K.utilizzo)}</td><td class="num">${K.accordato ? eur(K.accordato) : '–'}</td><td class="num">${K.accordato ? eur(K.disponibile) : '–'}</td><td></td><td></td></tr></table></div>`;
  const cpBanca = L.filter(x => x.fonte === 'banca' && x.banca === 'Cassa Padana'), cpU = sum(cpBanca, x => x.util), cpN = sum(cpBanca, x => x.nts);
  const avvisi = L.flatMap(x => x.avvisi.map(a => `<li><b>${esc(x.banca)} · ${esc(x.etichetta)}</b>: ${a}</li>`)).join('')
    + (cpBanca.length > 1 && Math.abs(cpU - cpN) > SOGLIA_SCARTO ? `<li><b>Cassa Padana · Italia ed estero insieme</b>: banca ${eur2(cpU)}, NTS ${eur2(cpN)}, differenza ${eur2(Math.abs(cpU - cpN))}: ${cpU > cpN ? 'il debito vero verso la banca è più alto di quello in contabilità' : 'in contabilità il debito è più alto di quello vero'}.</li>` : '');
  const movHtml = x => !x.mov.length ? '' : `<details class="piano"><summary><span class="nm">${esc(x.banca)} · ${esc(x.etichetta)}: ultimi movimenti dalla banca</span><span class="small nowrap">${x.mov.length}</span></summary><div class="body"><div class="scroll"><table class="resp"><tr><th>Data</th><th>Che cosa</th><th class="num">Utilizzo</th></tr>
    ${x.mov.map(m => { const l = leggiMovAnticipo(m); return `<tr><td class="nowrap">${fmtD(m.dataoperaz)}</td><td>${esc(l.testo)}</td><td class="num ${l.tipo === 'scarico' ? 'good' : ''}">${segn2(-Number(m.importo))}</td></tr>`; }).join('')}</table></div></div></details>`;
  const trHtml = x => `<details class="piano" ${x.tranche.aperte.some(a => a.scadenza && a.scadenza < OGGI) ? 'open' : ''}><summary><span class="nm">${esc(x.banca)} · ${esc(x.etichetta)}: tranche aperte, rimborso a ${K.giorniScad} giorni</span><span class="small nowrap">${x.tranche.aperte.length} tranche</span><span class="nowrap right"><b>${eur2(x.tranche.capitale)}</b></span></summary><div class="body"><div class="scroll"><table class="resp"><tr><th>Anticipo del</th><th class="num">Importo</th><th>Da rimborsare il</th><th>Stato</th></tr>
    ${x.tranche.aperte.map(a => { const gg = a.scadenza ? giorni(OGGI, a.scadenza) : null; return `<tr><td class="nowrap">${a.apertura ? 'saldo di apertura 2026' : fmtD(a.data)}</td><td class="num">${eur2(a.importo)}</td><td class="nowrap">${a.scadenza ? fmtD(a.scadenza) : '–'}</td><td>${gg == null ? '<span class="pill plain">da verificare</span>' : gg < 0 ? `<span class="pill bad">scaduta da ${-gg} giorni</span>` : gg <= 30 ? `<span class="pill warn">tra ${gg} giorni</span>` : `<span class="pill plain">tra ${gg} giorni</span>`}</td></tr>`; }).join('')}</table></div>
    <div class="small muted" style="margin-top:6px">Ricostruite dalla prima nota: ogni anticipo è chiuso dal rimborso di pari importo (più gli interessi) registrato dopo circa ${K.giorniScad} giorni. La data di rimborso è anticipo + ${K.giorniScad} giorni: conferma sul portale Credem.</div></div></details>`;
  return `<div class="row4" style="margin-bottom:12px">${kpiBox('Anticipi nella PFN', eur(pos.s.anticipi), pos.diversa && Math.abs(pos.s.anticipi - pos.c.anticipi) > 0.5 ? 'contabile NTS ' + eur(pos.c.anticipi) : 'saldi contabili al ' + fmtD(D.stato.ultima_registrazione))}${kpiBox('Castelletti accordati', K.accordato ? eur(K.accordato) : '–', K.accordato ? 'inseriti in Fiammetta' : 'da inserire nella tabella')}${kpiBox('Disponibile', K.accordato ? eur(K.disponibile) : '–', K.accordato ? pc1(K.utilizzoAcc, K.accordato) + '% utilizzato' : 'serve l\'accordato di ogni linea')}${kpiBox('Da verificare', K.nAvvisi ? K.nAvvisi + (K.nAvvisi === 1 ? ' punto' : ' punti') : 'nulla', K.nAvvisi ? 'vedi sotto la tabella' : 'saldi e tranche coerenti', K.nAvvisi ? 'warn' : 'good')}</div>
  ${tab}
  ${avvisi ? `<div class="alert"><b>Da controllare</b><ul style="margin:6px 0 0 18px;padding:0">${avvisi}</ul></div>` : ''}
  <div class="head" style="margin:18px 0 6px"><h3 style="margin:0">Documenti anticipati</h3><button class="btn sm primary" onclick="UI.nuovoAnticipo()">+ Registra anticipo</button></div>
  <div class="small muted" style="margin-bottom:8px">La banca non dice quali fatture o RiBa compongono l'utilizzo: si inseriscono qui, una riga per documento, con il valore del documento e l'importo davvero anticipato (può essere inferiore al documento, secondo lo spazio libero nel castelletto o la concentrazione sul debitore). Il totale si confronta con l'utilizzo.</div>
  ${L.map(detHtml).join('')}
  <h3 style="margin:18px 0 6px">Dettaglio</h3>
  ${tr.map(trHtml).join('')}${L.map(movHtml).join('')}${!tr.length && !L.some(x => x.mov.length) ? '<div class="muted small">Nessun dettaglio disponibile.</div>' : ''}
  <div class="small muted" style="margin-top:8px">Cassa Padana: il saldo degli anticipi Italia ed estero è quello dichiarato dalla banca nel file CBI (si aggiorna da solo a ogni importazione) e sostituisce il saldo NTS nella PFN «stimata»; i movimenti si registrano in NTS e quando arrivano il saldo NTS si allinea. Credem non è nel file della banca: l'utilizzato è il capitale delle tranche, ricostruito dalla prima nota (la PFN usa il saldo NTS). SBF: il saldo è quello contabile del c/incassi; gli anticipi RiBa accreditati dalla banca e non ancora registrati sono segnalati qui sopra. L'accordato di ogni linea non è in NTS: si inserisce qui (o dal portale della banca). Documenti anticipati: inseriti a mano (la banca non li comunica); il totale degli aperti si confronta con l'utilizzo e le righe scadute, o già scaricate dalla banca (Cassa Padana, dalla fattura), sono segnalate qui sopra.</div>`;
}
function dettFinanziamenti() {
  const D = S.data;
  const chiave = t => { t = (t || '').toLowerCase(); return ['simest', 'padana', 'credem', 'sondrio', 'valsabbina', 'verona', 'emilia', 'bper', 'intesa', 'unicredit', 'bpm'].find(k => t.includes(k)) || null; };
  const gruppi = [], perChiave = {};
  const metti = (k, campo, v) => { const g = (k && perChiave[k]) || { conti: [], piani: [] }; if (k) perChiave[k] = g; if (!gruppi.includes(g)) gruppi.push(g); g[campo].push(v); };
  D.sp.filter(x => x.voce === 'SP.DEB_FINANZIAMENTI' && Math.abs(x.saldo) > 0.5).forEach(x => metti(chiave(x.descrizione), 'conti', x));
  D.piani.filter(p => (p.tipo === 'finanziamento' || p.tipo === 'simest') && p.stato === 'attivo').forEach(p => metti(chiave((p.controparte || '') + ' ' + p.nome), 'piani', { p, s: statoAder(p) }));
  const totDeb = sum(gruppi, g => -sum(g.conti, x => x.saldo)), totRes = sum(gruppi, g => sum(g.piani, x => x.s.residuo));
  return `<div class="scroll"><table class="resp"><tr><th>Finanziamento e piano</th><th class="num">Debito contabile<div class="small" style="font-weight:400;text-transform:none;letter-spacing:0">senza interessi</div></th><th class="num">Residuo da piano<div class="small" style="font-weight:400;text-transform:none;letter-spacing:0">con interessi</div></th><th class="num">Differenza</th></tr>
    ${gruppi.map(g => { const deb = -sum(g.conti, x => x.saldo), res = sum(g.piani, x => x.s.residuo);
      return `<tr><td>${g.conti.length ? g.conti.map(x => esc(x.descrizione)).join('<br>') : '<span class="muted">nessun conto contabile collegato</span>'}${g.piani.length ? `<span class="d2">${g.piani.map(({ p, s }) => `${esc(p.nome)} · ${s.pagate}/${s.tot} rate pagate · prossima ${s.prossima ? fmtD(s.prossima.scadenza) : '–'}`).join('<br>')}</span>` : '<span class="d2 warn">nessun piano di rimborso nello Scadenziario</span>'}</td>
      <td class="num">${g.conti.length ? eur(deb) : '–'}</td><td class="num">${g.piani.length ? eur(res) : '–'}</td><td class="num muted">${g.conti.length && g.piani.length ? segnato(res - deb) : ''}</td></tr>`; }).join('')}
    <tr class="tot"><td>Totale</td><td class="num">${eur(totDeb)}</td><td class="num">${eur(totRes)}</td><td class="num">${segnato(totRes - totDeb)}</td></tr></table></div>
    <div class="alert" style="margin-top:10px"><b>Il debito contabile non comprende gli interessi</b>: è il solo capitale ancora da rimborsare secondo NTS (gli interessi si registrano in contabilità quando vengono addebitati). Perciò anche la PFN, che usa il debito contabile, è al netto degli interessi futuri e maturati. Il residuo da piano comprende invece capitale e interessi di tutte le rate non pagate.</div>
    <div class="small muted" style="margin-top:6px">Una differenza (residuo da piano − debito contabile) positiva di qualche punto è normale, perché sono gli interessi; differenze grandi o negative vanno chieste a Michela. Le rate si segnano nello ${link('Scadenziario', 'scadenziario', 'piani')}.</div>`;
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
  const titoli = { fin: 'Finanziamenti e mutui', anticipi: 'Castelletti e anticipi (fatture, ordini, SBF)', scoperti: 'Scoperti di conto corrente e fidi di cassa', liquidita: 'Liquidità conto per conto', soci: 'Finanziamento soci' };
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
          ${riga('Finanziamenti e mutui <span class="small muted">(debito contabile, senza interessi)</span>', pos.fin, pos.fin, 'fin')}${riga('Anticipi (castelletto e SBF anticipati)', c.anticipi, s.anticipi, 'anticipi')}${riga('Scoperti di conto corrente', c.scoperti, s.scoperti, 'scoperti')}${riga('− Liquidità totale', -c.liquidita, -s.liquidita, 'liquidita')}
          ${riga('PFN bancaria', pos.pfn, pos.pfnStima, null, 'tot')}${riga('Finanziamento soci', pos.soci, pos.soci, 'soci')}${riga('PFN totale', pos.pfnTot, pos.pfnTotStima, null, 'tot')}</table></div>
    </div>
    ${d ? `<div class="card dett" id="dett"><div class="head" style="margin-bottom:8px"><h3 style="margin:0">${titoli[d]}</h3><button class="btn sm" onclick="UI.dett(null)">chiudi ✕</button></div>${corpo}</div>` : ''}
    <div class="card"><h3>Conti bancari e cassa · saldi contabili</h3><div class="scroll"><table class="resp"><tr><th>Conto</th><th>Banca</th><th>Tipo</th><th>Registrato fino al</th><th class="num">Saldo</th></tr>${conti.map(x => { const un = (D.uniti || []).find(u => Number(u.conto_unito) === Number(x.conto)), cc = un && D.banche.find(b => Number(b.conto) === Number(un.conto_cc)); return `<tr><td>${esc(x.descrizione)}${cc ? `<span class="d2">sommato al c/c «${esc(cc.descrizione)}»</span>` : ''}</td><td>${esc(nomeBanca(x.descrizione))}</td><td><span class="pill plain">${tipoBanca[x.categoria] || x.categoria}</span></td><td class="nowrap ${x.ultima_registrazione && giorni(x.ultima_registrazione, regData) > 20 ? 'warn' : ''}">${fmtD(x.ultima_registrazione)}</td><td class="num ${x.saldo < -0.5 ? 'bad' : x.saldo > 0.5 ? 'good' : 'muted'}">${eur2(x.saldo)}</td></tr>`; }).join('')}</table></div><div class="small muted" style="margin-top:6px">Ogni saldo è aggiornato fino all'ultima registrazione in prima nota di quel conto (colonna «Registrato fino al»; in arancione se resta indietro di oltre 20 giorni rispetto alla contabilità). Segno contabile: positivo = disponibilità, negativo = debito verso la banca.</div></div>
    <div class="card"><h3>Saldi dal portale banca (inserimento manuale)</h3>
      <form class="row" onsubmit="event.preventDefault();UI.salvaSaldo(this)">
        <div class="field"><label>Data</label><input name="data" type="date" value="${OGGI}" required></div>
        <div class="field"><label>Banca</label><select name="banca">${banche.map(b => `<option>${esc(b)}</option>`).join('')}<option>Altra</option></select></div>
        <div class="field"><label>Saldo c/c</label><input name="saldo_cc" inputmode="decimal" placeholder="es. -12500,00"></div>
        <div class="field"><label>Anticipi utilizzati</label><input name="anticipi_utilizzati" inputmode="decimal"></div>
        <div class="field"><label>Accordato anticipi</label><input name="accordato_anticipi" inputmode="decimal"></div>
        <div class="field"><label>Fido c/c</label><input name="fido_cc" inputmode="decimal"></div>
        <div class="field" style="flex:2 1 200px"><label>Note</label><input name="note"></div>
        <div class="field" style="flex:0 0 auto"><button class="btn primary">Salva</button></div></form>
      ${D.saldi.length ? `<div class="scroll"><table class="resp"><tr><th>Data</th><th>Banca</th><th class="num">Saldo c/c</th><th class="num">Anticipi</th><th class="num">Accordato</th><th class="num">Fido c/c</th><th>Note</th><th></th></tr>${D.saldi.map(x => `<tr><td class="nowrap">${fmtD(x.data)}</td><td>${esc(x.banca)}</td><td class="num">${eur2(x.saldo_cc)}</td><td class="num">${eur(x.anticipi_utilizzati)}</td><td class="num">${eur(x.accordato_anticipi)}</td><td class="num">${eur(x.fido_cc)}</td><td class="small">${esc(x.note || '')}<span class="d2">${esc(x.inserito_da || '')}</span></td><td class="right">${puoElim() ? `<button class="btn sm ghost" onclick="UI.chiediEliminaSaldo(${x.id})">elimina</button>` : ''}</td></tr>`).join('')}</table></div>` : '<div class="muted small">Nessun saldo inserito. I saldi del portale servono per confrontare la contabilità con la banca.</div>'}</div>
  </div>`;
}

// ---------- Stato dei dati ----------
function pageStato() {
  const D = S.data, pos = posizione(), nuovi = D.nuovi || [];
  const daConf = D.rate.filter(r => r.stato_effettivo === 'da_confermare' && r.stato_piano === 'attivo');
  const vecchie = D.proforme.filter(p => p.stato === 'verifica'), daAbb = D.scad.filter(s => s.daAbbinare);
  const bb = bancheCC(pos), senzaFido = bb.filter(x => x.fido == null), senzaTasso = bb.filter(x => x.tasso == null && (x.fido || x.scoperto > 0.5));
  const ctr = controlliBanca(pos), cast = castelletti(pos);
  const voce = (ok, testo, n, dove) => `<li><span>${ok ? '<span class="pill good">ok</span>' : '<span class="pill warn">da fare</span>'} ${testo}</span><b>${n}${dove ? ' · ' + dove : ''}</b></li>`;
  return `<div class="head"><h2>Stato dei dati</h2><button class="btn" onclick="UI.reload()">Aggiorna adesso</button></div>
  <div class="stack"><div class="row2">
    <div class="card"><h3>Dal gestionale NTS</h3><ul class="list">
      <li><span>Ultimo invio notturno</span><b>${fmtDT(D.stato.ultimo_invio)}</b></li>
      <li><span>Questa pagina ha letto i dati</span><b>${fmtDT(new Date(S.loadedAt).toISOString())} · si aggiorna da sola (ogni 2 minuti e al ritorno sulla scheda)</b></li>
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
      ${voce(!(D.docF24 || []).some(d => d.stato === 'da_inserire'), 'F24 caricati in PDF, di cui inserire scadenza e importo', (D.docF24 || []).filter(d => d.stato === 'da_inserire').length, link('Scadenziario', 'scadenziario', 'piani'))}
      ${voce(!cast.nAvvisi, 'Castelletti: saldi, tranche e documenti anticipati da verificare', cast.nAvvisi, link('vedi', 'banche', 'anticipi'))}
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

// Dilazioni: rate uguali (l'ultima assorbe gli arrotondamenti) e riga del modulo
function generaRate(tot, n, primaData) {
  n = Math.max(1, Math.min(36, Math.round(n) || 1)); const base = Math.floor(tot / n * 100) / 100, out = [];
  for (let i = 0; i < n; i++) out.push({ data: addMonths(primaData, i), importo: i === n - 1 ? Math.round((tot - base * (n - 1)) * 100) / 100 : base });
  return out;
}
const rigaDil = (data, importo) => `<div class="dil-r" style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) auto;gap:6px;align-items:center;margin-bottom:6px"><input type="date" name="d" value="${esc(data || '')}" required style="min-width:0;border:1px solid #cfc5b8;border-radius:8px;padding:7px 8px;background:#fff"><input name="i" inputmode="decimal" data-dec="2" data-nohint="1" value="${importo == null || importo === '' ? '' : String(importo).replace('.', ',')}" placeholder="importo" required style="min-width:0;text-align:right;border:1px solid #cfc5b8;border-radius:8px;padding:7px 8px;background:#fff"><button type="button" class="btn sm ghost" title="Togli questa rata" onclick="this.parentNode.remove();UI.dilTot()">×</button></div>`;
// ---------- Modali ----------
// id di una partita: «pt:chiave» (intera), «tr:N:chiave» (rata N di una dilazione), «pf:chiave» (proforma)
function parseId(id) { const p = String(id).split(':'), kind = p.shift(); let n = null; if (kind === 'tr') n = Number(p.shift()); return { kind, n, chiave: p.join(':') }; }
function renderModal() {
  const M = S.modal; let h = '';
  const bancheOpts = sel => `<option value="">—</option>` + [...new Set((S.data.anagBanche || []).map(b => nomeBanca(b.descrizione)).filter(b => b !== 'Altro' && b !== 'Cassa contanti'))].map(b => `<option ${b === sel ? 'selected' : ''}>${esc(b)}</option>`).join('') + `<option>Cassa</option>`;
  if (M.type === 'incasso') {
    const { kind, n, chiave } = parseId(M.id);
    const pt = (kind === 'pt' || kind === 'tr') ? S.data.scad.find(s => s.chiave === chiave) : null, pf = kind === 'pf' ? S.data.proforme.find(p => p.chiave === chiave) : null;
    const rata = kind === 'tr' && pt ? scadX().find(x => x.chiave === chiave && x.tr && x.tr.n === n) : null;
    const cli = pf || (pt && pt.tipo_cf === 'C'); const imp = r2(pf ? pf.totdoc : rata ? Math.abs(rata.importo) : Math.abs(pt.importo));
    const ref = pf ? `proforma ${pf.numdoc} del ${fmtD(pf.datdoc)} · ${esc(pf.controparte || '')}` : `${pt.apertura ? 'saldo 2025' : 'ft ' + (pt.numdoc || '') + ' del ' + fmtD(pt.datdoc)} · ${esc(pt.controparte || '')} · ${rata ? (rata.tr.n ? `<b>rata ${rata.tr.n}/${rata.tr.tot} della dilazione</b> del ${fmtD(rata.datsca)} (scadenza originale ${fmtD(pt.datsca)})` : '<b>quota non pianificata</b> della dilazione') : 'scadenza ' + fmtD(pt.datsca)}`;
    h = `<h2>${cli ? 'Incasso ricevuto' : 'Pagamento fatto'}</h2><p class="small muted">${ref}</p>
    <form onsubmit="event.preventDefault();UI.confermaIncasso(this,'${M.id}')"><div class="row"><div class="field"><label>Data</label><input name="data" type="date" value="${OGGI}" required></div><div class="field"><label>Importo</label><input name="importo" inputmode="decimal" value="${String(imp).replace('.', ',')}" required></div></div><div class="field"><label>Banca</label><select name="banca">${bancheOpts(pt && pt.banca ? nomeBanca(pt.banca) : '')}</select></div><div class="field"><label>Nota (facoltativo)</label><input name="nota" placeholder="es. bonifico visto sul portale"></div>
    <div class="small muted" style="margin-bottom:10px">Resta segnato in Fiammetta finché NTS non registra ${cli ? "l'incasso" : 'il pagamento'}; poi si chiude da solo.</div>
    <div class="row"><button class="btn primary">Conferma</button><button type="button" class="btn" onclick="UI.closeModal()">Annulla</button></div></form>`;
  } else if (M.type === 'dilazione') {
    const sp = S.data.scad.find(x => x.chiave === M.id);
    if (!sp) h = '<h2>Dilazione</h2><p class="small muted">La partita non è più aperta in NTS.</p><div class="row"><button class="btn" onclick="UI.closeModal()">Chiudi</button></div>';
    else {
      const cli = sp.tipo_cf === 'C', d = sp.dil ? sp.dil.d : null, R = Math.abs(sp.importo), rest = sp.dil ? sp.dil.rest : R;
      let rate = d ? d.rate.slice().sort((a, b) => String(a.data).localeCompare(String(b.data))).map(t => ({ data: String(t.data).slice(0, 10), importo: Number(t.importo) })) : generaRate(rest, 3, addMonths(OGGI, 1));
      h = `<h2>Dilazione concordata</h2><p class="small muted"><b>${esc(sp.controparte || sp.conto)}</b> · ${sp.apertura ? 'saldo 2025' : 'ft ' + esc(String(sp.numdoc || '')) + ' del ' + fmtD(sp.datdoc)} · scadenza originale ${fmtD(sp.datsca)}<br>Aperto in NTS <b>${eur2(R)}</b>${sp.dil && sp.dil.pendTot > 0.004 ? ` · già segnato a mano ${eur2(sp.dil.pendTot)} (ancora da registrare in NTS) · da ${cli ? 'incassare' : 'pagare'} <b>${eur2(rest)}</b>` : ''}</p>
      <form id="fdil" data-res="${rest.toFixed(2)}" data-scad="${esc(sp.datsca)}" oninput="UI.dilTot()" onsubmit="event.preventDefault();UI.salvaDilazione(this,'${esc(sp.chiave)}')">
        <div class="small muted" style="margin-bottom:6px">Scrivi le rate come le avete concordate. Se alcune sono già ${cli ? 'incassate' : 'pagate'} puoi inserirle comunque: Fiammetta assegna il residuo aperto in NTS partendo dall'ultima rata, quindi quelle già saldate escono da sole.</div>
        <div class="row" style="align-items:flex-end;margin-bottom:8px"><div class="field" style="flex:0 0 90px"><label>Genera</label><input name="g_n" type="number" min="1" max="36" value="3" title="Numero di rate"></div><div class="field" style="flex:0 0 150px"><label>rate mensili dal</label><input name="g_data" type="date" value="${addMonths(OGGI, 1)}"></div><div class="field" style="flex:0 0 auto"><button type="button" class="btn sm" onclick="UI.dilGenera(this.form)" title="Divide il residuo in rate uguali: poi correggi gli importi come serve">Dividi il residuo</button></div></div>
        <div id="dil-righe">${rate.map(t => rigaDil(t.data, t.importo)).join('')}</div>
        <div style="margin:4px 0 8px"><button type="button" class="btn sm ghost" onclick="UI.dilRiga()">+ aggiungi rata</button></div>
        <div id="dil-tot" class="small" style="margin-bottom:8px"></div>
        <div class="field"><label>Nota (facoltativo)</label><input name="nota" value="${esc(d ? d.nota || '' : '')}" placeholder="es. accordo del ${fmtD(OGGI)} con il fornitore, via mail"></div>
        <div class="row"><button class="btn primary">${d ? 'Salva le modifiche' : 'Salva la dilazione'}</button>${d ? `<button type="button" class="btn danger" onclick="UI.annullaDilazione(${d.id})" title="Torna alla scadenza originale">Annulla la dilazione</button>` : ''}<button type="button" class="btn" onclick="UI.closeModal()">Chiudi</button></div>
      </form>`;
    }
  } else if (M.type === 'pagata') {
    const r = S.data.rate.find(x => x.id === M.id);
    h = `<h2>Rata pagata</h2><p class="small muted">${esc(r.nome)} · rata ${r.n}${r.n_rate ? '/' + r.n_rate : ''} · scadenza ${fmtD(r.scadenza)} · ${eur2(r.importo)}</p>
    <form onsubmit="event.preventDefault();UI.confermaPagata(this,'${r.id}')"><div class="field"><label>Pagata il</label><input name="data" type="date" value="${r.scadenza <= OGGI ? r.scadenza : OGGI}" required></div><div class="field"><label>Banca (facoltativo)</label><input name="banca" value="${esc(r.banca || '')}" placeholder="es. Cassa Padana"></div><div class="field"><label>Nota (facoltativo)</label><input name="nota" value="${esc(r.nota || '')}"></div><div class="row"><button class="btn primary">Conferma</button><button type="button" class="btn" onclick="UI.closeModal()">Annulla</button></div></form>`;
  } else if (M.type === 'rata') {
    const p = S.data.piani.find(x => x.id === M.id), rs = S.data.rate.filter(r => r.piano_id === p.id);
    const last = rs[rs.length - 1];
    h = `<h2>Aggiungi rata · ${esc(p.nome)}</h2><form onsubmit="event.preventDefault();UI.aggiungiRata(this,'${p.id}')"><div class="row"><div class="field"><label>Numero</label><input name="n" type="number" value="${(last ? last.n : 0) + 1}" required></div><div class="field"><label>Scadenza</label><input name="scadenza" type="date" value="${last ? addMonths(last.scadenza, p.cadenza_mesi || 1) : OGGI}" required></div><div class="field"><label>Importo</label><input name="importo" inputmode="decimal" value="${p.rata ? String(p.rata).replace('.', ',') : ''}" required></div></div><div class="row"><button class="btn primary">Aggiungi</button><button type="button" class="btn" onclick="UI.closeModal()">Annulla</button></div></form>`;
  } else if (M.type === 'f24') {
    const doc = M.id && (S.data.docF24 || []).find(d => d.id === M.id);
    h = `<h2>${doc ? "Inserisci i dati dell'F24" : 'Aggiungi un F24 da versare'}</h2><p class="small muted" style="margin-top:0">${doc ? `PDF caricato: <b>${esc(doc.nome_file)}</b> <button type="button" class="btn sm ghost" onclick="UI.apriPdf('${doc.id}')">Apri PDF</button><br>Copia dal modello la scadenza e l'importo da versare.` : "Scrivi la scadenza e l'importo da versare, come sono sul modello F24 ricevuto dal commercialista. Se vuoi, allega il PDF: resta collegato al versamento e si riapre quando serve."}</p>
    <form onsubmit="event.preventDefault();UI.aggiungiF24(this,'${doc ? doc.id : ''}')"><div class="row"><div class="field"><label>Scadenza del versamento</label><input name="scadenza" type="date" required></div><div class="field"><label>Importo da versare (€)</label><input name="importo" inputmode="decimal" placeholder="es. 1234,56" required></div></div>
    <div class="field"><label>Che cosa si paga</label><input name="nota" required placeholder="es. IVA ottobre 2026 + ritenute + INPS"></div>
    ${doc ? '' : `<div class="field"><label>PDF dell'F24 (facoltativo)</label><input name="pdf" type="file" accept="application/pdf,.pdf"></div>`}
    <div class="row"><button class="btn primary">Aggiungi allo scadenziario</button><button type="button" class="btn" onclick="UI.closeModal()">Annulla</button></div></form>
    ${doc ? '' : `<details style="margin-top:14px"><summary class="small muted" style="cursor:pointer">Hai solo il PDF e inserisci i dati più tardi?</summary>
    <form onsubmit="event.preventDefault();UI.caricaF24(this)" style="margin-top:10px"><div class="field"><label>PDF dell'F24</label><input name="pdf" type="file" accept="application/pdf,.pdf" required></div>
    <div class="field"><label>Nota (facoltativo)</label><input name="nota" placeholder="es. F24 di novembre: IVA e ritenute"></div>
    <div class="row"><button class="btn">Carica solo il PDF</button></div></form></details>`}`;
  } else if (M.type === 'anticipo') {
    const a = M.id && (S.data.antic || []).find(x => String(x.id) === String(M.id));
    const linee = lineeAnticipi(), lsel = a ? a.banca + '|' + a.linea : (M.linea || ''), opz = a ? [] : opzioniAnticipo();
    S._anticPick = Object.fromEntries(opz.map(o => [o.label, o]));
    const dec = v => v == null ? '' : String(v).replace('.', ',');
    h = `<h2>${a ? 'Modifica documento anticipato' : 'Registra un anticipo'}</h2><p class="small muted" style="margin-top:0">Un documento per volta: il valore del documento e l'importo che la banca ha davvero anticipato (può essere inferiore al valore).</p>
    <form onsubmit="event.preventDefault();UI.salvaAnticipo(this,'${a ? a.id : ''}')">
    <div class="field"><label>Linea</label><select name="linea" required>${lsel ? '' : '<option value="">— scegli la linea —</option>'}${linee.map(l => `<option value="${esc(l.k)}" ${l.k === lsel ? 'selected' : ''}>${esc(l.t)}</option>`).join('')}</select></div>
    ${a ? '' : `<div class="field"><label>Cerca il documento (facoltativo)</label><input name="pick" list="dl-antic" autocomplete="off" placeholder="scrivi il cliente o il numero fattura" oninput="UI.pescaAnticipo(this)"><datalist id="dl-antic">${opz.map(o => `<option value="${esc(o.label)}"></option>`).join('')}</datalist></div>`}
    <div class="field"><label>Cliente (debitore)</label><input name="cliente" required value="${esc(a ? a.cliente : '')}"></div>
    <div class="field"><label>Documento</label><input name="documento" placeholder="es. ft 123 del 15/10/2026, proforma 45" value="${esc(a ? a.documento || '' : '')}"></div>
    <div class="row"><div class="field"><label>Fattura n. (facoltativo)</label><input name="numero_doc" value="${esc(a ? a.numero_doc || '' : '')}"></div><div class="field"><label>Data fattura (facoltativo)</label><input name="data_doc" type="date" value="${a && a.data_doc ? String(a.data_doc).slice(0, 10) : ''}"></div></div>
    <div class="row"><div class="field"><label>Presentato il</label><input name="data_presentazione" type="date" value="${a ? String(a.data_presentazione).slice(0, 10) : OGGI}" required></div><div class="field"><label>Scadenza</label><input name="scadenza" type="date" value="${a && a.scadenza ? String(a.scadenza).slice(0, 10) : ''}"></div></div>
    <div class="row"><div class="field"><label>Valore del documento (€)</label><input name="importo_documento" inputmode="decimal" required placeholder="es. 12500,00" value="${dec(a && a.importo_documento)}" oninput="UI.percAntic(this.form)"></div><div class="field"><label>Importo anticipato (€)</label><input name="importo_anticipato" inputmode="decimal" required placeholder="es. 10000,00" value="${dec(a && a.importo_anticipato)}" oninput="UI.percAntic(this.form)"></div></div>
    <div class="perc small muted" style="margin:-2px 0 10px"></div>
    <div class="field"><label>Nota (facoltativo)</label><input name="nota" value="${esc(a ? a.nota || '' : '')}" placeholder="es. distinta n. 123"></div>
    <input type="hidden" name="chiave" value="${a ? (a.chiave_partita ? 'pt:' + esc(a.chiave_partita) : a.chiave_doc ? 'pf:' + esc(a.chiave_doc) : '') : ''}">
    <div class="small muted" style="margin-bottom:10px">Scadenza vuota: per Credem (anticipo export) si calcola presentazione + ${Number((S.data.P || {}).giorni_anticipo_export) || GIORNI_ANTICIPO} giorni; per Cassa Padana resta senza scadenza. Il documento esce dai «aperti» quando lo segni come incassato.</div>
    <div class="row"><button class="btn primary">${a ? 'Salva le modifiche' : 'Registra'}</button><button type="button" class="btn" onclick="UI.closeModal()">Annulla</button></div></form>`;
  } else if (M.type === 'conferma') {
    h = `<h2>${esc(M.titolo)}</h2><div class="card" style="margin:10px 0;background:#fbf9f6">${M.dettaglio}</div><p class="small muted" style="margin:0 0 12px">${esc(M.avviso || "L'operazione non si può annullare.")}</p>
    <div class="row"><button type="button" class="btn" autofocus onclick="UI.closeModal()">Annulla</button><button type="button" class="btn danger" onclick="UI.esegui()">${esc(M.bottone || 'Elimina')}</button></div>`;
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
const puoElim = () => !!(S.me && S.me.puo_eliminare);
const UI = {
  go(v, arg) {
    S.view = v; S.dett = null;
    if (v === 'scadenziario' && arg) S.filtroRate = arg;
    if (v === 'banche' && arg) S.dett = arg;
    if (v === 'partite' && arg) { const [tab, filtro] = arg.split(':'); S.partite.tab = tab; S.partite.filtro = filtro || 'tutto'; S.partite.cerca = ''; }
    try { localStorage.setItem('fiammetta-view', v); } catch (e) {} render();
  },
  goA(v, arg, anchor) { S._anchor = anchor; UI.go(v, arg); },
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
  dilRiga() { const c = document.getElementById('dil-righe'); if (!c) return; const ult = [...c.querySelectorAll('.dil-r')].pop(); const dv = ult && ult.querySelector('[name=d]').value; c.insertAdjacentHTML('beforeend', rigaDil(dv ? addMonths(dv, 1) : OGGI, '')); UI.dilTot(); },
  dilGenera(f) { const n = Number(f.g_n.value) || 1, d0 = f.g_data.value || OGGI, res = Number(f.dataset.res) || 0; document.getElementById('dil-righe').innerHTML = generaRate(res, n, d0).map(t => rigaDil(t.data, t.importo)).join(''); UI.dilTot(); },
  dilRate() { return [...document.querySelectorAll('#dil-righe .dil-r')].map(r => ({ data: r.querySelector('[name=d]').value, importo: num(r.querySelector('[name=i]').value) })); },
  dilTot() {
    const f = document.getElementById('fdil'), el = document.getElementById('dil-tot'); if (!f || !el) return;
    const rate = UI.dilRate().filter(t => t.importo), tot = sum(rate, t => t.importo), res = Number(f.dataset.res) || 0, diff = Math.round((tot - res) * 100) / 100;
    el.className = 'small ' + (Math.abs(diff) <= 0.5 ? 'good' : diff > 0 ? 'warn' : 'bad');
    el.innerHTML = `Rate: <b>${rate.length}</b> · totale <b>${eur2(tot)}</b> · residuo ${eur2(res)}<br>` + (Math.abs(diff) <= 0.5 ? 'Le rate coprono esattamente il residuo.' : diff > 0 ? `Le rate superano il residuo di ${eur2(diff)}: va bene se le prime sono già saldate (il residuo viene assegnato partendo dall'ultima rata).` : `Mancano ${eur2(-diff)} rispetto al residuo: restano con la scadenza originale (${fmtD(f.dataset.scad)}) come «quota non pianificata».`);
  },
  async salvaDilazione(form, chiave) {
    await guard(async () => {
      const sp = S.data.scad.find(x => x.chiave === chiave); if (!sp) throw new Error('la partita non è più aperta in NTS');
      const rate = UI.dilRate(); if (!rate.length) throw new Error('inserisci almeno una rata');
      rate.forEach(t => { if (!/^\d{4}-\d{2}-\d{2}$/.test(t.data || '')) throw new Error('ogni rata vuole una data'); if (!t.importo || t.importo <= 0) throw new Error('ogni rata vuole un importo maggiore di zero'); });
      rate.sort((a, b) => a.data.localeCompare(b.data)); const json = rate.map((t, i) => ({ n: i + 1, data: t.data, importo: Math.round(t.importo * 100) / 100 }));
      const nota = form.nota.value.trim() || null, d = sp.dil ? sp.dil.d : null, ora = new Date().toISOString();
      if (d) { const { error } = await S.sb.from('dilazioni').update({ rate: json, nota, aggiornato_da: chi(), aggiornato_il: ora }).eq('id', d.id); if (error) throw error; }
      else { const row = { tipo_cf: sp.tipo_cf, chiave_partita: sp.chiave, conto: sp.conto, controparte: sp.controparte, documento: sp.apertura ? 'saldo 2025' : 'ft ' + (sp.numdoc || '') + ' del ' + fmtD(sp.datdoc), importo_nts: Math.abs(sp.importo), rate: json, stato: 'attiva', nota, creato_da: chi() }; const { error } = await S.sb.from('dilazioni').insert(row); if (error) throw error; }
      S.modal = null; await reloadDilazioni(); S._keepScroll = true; render();
    }, 'Dilazione salvata: al posto della scadenza originale valgono le date delle rate');
  },
  async annullaDilazione(id) {
    await guard(async () => { const { error } = await S.sb.from('dilazioni').update({ stato: 'annullata', aggiornato_da: chi(), aggiornato_il: new Date().toISOString() }).eq('id', id); if (error) throw error; S.modal = null; await reloadDilazioni(); S._keepScroll = true; render(); }, 'Dilazione annullata: torna la scadenza originale');
  },
  async confermaIncasso(form, id) {
    await guard(async () => {
      const { kind, n, chiave } = parseId(id);
      const pt = (kind === 'pt' || kind === 'tr') ? S.data.scad.find(s => s.chiave === chiave) : null, pf = kind === 'pf' ? S.data.proforme.find(p => p.chiave === chiave) : null;
      const importo = num(form.importo.value); if (!importo) throw new Error('importo non valido');
      const row = { tipo: (pf || pt.tipo_cf === 'C') ? 'incasso' : 'pagamento', chiave_partita: pt ? pt.chiave : null, chiave_doc: pf ? pf.chiave : null, conto: pf ? pf.conto : pt.conto, controparte: pf ? pf.controparte : pt.controparte, data: form.data.value, importo, banca: form.banca.value || null, nota: form.nota.value.trim() || null, creato_da: chi() };
      if (kind === 'tr') {
        // pagamento di una rata: ricordo il residuo NTS di adesso, così quando NTS lo registra (il residuo cala) il segnato a mano si chiude da solo
        const rest = pt.dil ? pt.dil.rest : Math.abs(pt.importo);
        if (importo > rest + 0.5) throw new Error('importo superiore al residuo della partita (' + eur2(rest) + ')');
        row.rata_n = n; row.residuo_nts = Math.round(rest * 100) / 100; row.nota = ['rata ' + (n || 'extra') + '/' + (pt.dil ? pt.dil.tr.length : '?'), row.nota].filter(Boolean).join(' · ');
      }
      const { error } = await S.sb.from('movimenti_app').insert(row); if (error) throw error;
      S.modal = null; await reloadMovimenti(); S._keepScroll = true; render();
    }, 'Segnato: resta in attesa della registrazione in NTS');
  },
  chiediAnnullaMovimento(id) {
    if (!puoElim()) return UI.nonAutorizzato();
    const m = (S.data.movimenti || []).find(x => x.id === id) || (S.data.proforme.map(p => p.copertura).find(c => c && c.id === id));
    UI.chiedi({ titolo: 'Annullare questa registrazione?', bottone: 'Sì, annulla', azione: 'annullaMovimento', arg: id,
      dettaglio: m ? `<b>${m.tipo === 'incasso' ? 'Incasso' : 'Pagamento'}</b> del ${fmtD(m.data)} · <b>${eur2(m.importo)}</b><div class="small muted">${esc(m.controparte || m.conto || '')}${m.nota ? ' · ' + esc(m.nota) : ''}</div>` : 'Registrazione segnata in Fiammetta' });
  },
  async annullaMovimento(id) {
    if (!puoElim()) return UI.nonAutorizzato();
    await guard(async () => { const { error } = await S.sb.from('movimenti_app').update({ stato: 'annullato' }).eq('id', id); if (error) throw error; await reloadMovimenti(); S._keepScroll = true; render(); }, 'Annullato');
  },
  chiediAnnullaProforma(chiave) {
    if (!puoElim()) return UI.nonAutorizzato();
    const p = S.data.proforme.find(x => x.chiave === chiave); if (!p) return;
    UI.chiedi({ titolo: 'Segnare la proforma come non valida?', bottone: 'Sì, non valida', azione: 'annullaProforma', arg: chiave, avviso: 'La proforma esce da tutti gli elenchi e dai totali (annullata o sostituita).',
      dettaglio: `<b>Proforma n. ${p.numdoc}</b> del ${fmtD(p.datdoc)} · <b>${eur2(p.totdoc)}</b><div class="small muted">${esc(p.controparte || p.conto)}</div>` });
  },
  async annullaProforma(chiave) {
    if (!puoElim()) return UI.nonAutorizzato();
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
  async aggiungiF24(form, docId) {
    await guard(async () => {
      const importo = num(form.importo.value), nota = form.nota.value.trim(); if (!importo || importo <= 0) throw new Error('importo non valido'); if (!form.scadenza.value) throw new Error('manca la scadenza'); if (!nota) throw new Error('scrivi che cosa si paga');
      const f = form.pdf && form.pdf.files[0];
      if (f) { if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') throw new Error('il file deve essere un PDF'); if (f.size > 10 * 1024 * 1024) throw new Error('il PDF supera i 10 MB'); }
      if (!S.data.piani.some(p => p.id === 'f24')) { const r = await S.sb.from('piani').insert({ id: 'f24', tipo: 'f24', nome: 'F24 da versare', controparte: 'Agenzia delle Entrate (F24 del commercialista)', descrizione: 'Un versamento per ogni modello F24 ricevuto dal commercialista', stato: 'attivo', creato_da: chi() }); if (r.error) throw r.error; }
      const n = Math.max(0, ...S.data.rate.filter(r => r.piano_id === 'f24').map(r => r.n)) + 1;
      let doc = docId || null, percorso = null;
      if (f) {
        const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
        percorso = 'f24/' + stamp + '-' + f.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
        const up = await S.sb.storage.from('documenti').upload(percorso, f, { contentType: 'application/pdf', upsert: false }); if (up.error) throw up.error;
        const ins = await S.sb.from('documenti_f24').insert({ nome_file: f.name, percorso, nota, caricato_da: chi(), stato: 'inserito' }).select('id').single();
        if (ins.error) { await S.sb.storage.from('documenti').remove([percorso]); throw ins.error; }
        doc = ins.data.id;
      }
      const rec = { id: 'f24-' + n, piano_id: 'f24', n, scadenza: form.scadenza.value, importo, stato: 'futura', nota }; if (doc) rec.documento_id = doc;
      const { error } = await S.sb.from('rate').insert(rec);
      if (error) { if (f && doc) { try { await S.sb.from('documenti_f24').delete().eq('id', doc); await S.sb.storage.from('documenti').remove([percorso]); } catch (e) { console.warn(e); } } throw error; }
      if (docId) { const u = await S.sb.from('documenti_f24').update({ stato: 'inserito' }).eq('id', docId); if (u.error) console.warn(u.error); }
      S.modal = null; await reloadRate(); if (doc) await reloadDocF24(); S.filtroRate = 'piani'; S._open = 'f24'; render();
    }, 'F24 aggiunto allo scadenziario');
  },
  async caricaF24(form) {
    await guard(async () => {
      const f = form.pdf.files[0]; if (!f) throw new Error('scegli il PDF');
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') throw new Error('il file deve essere un PDF');
      if (f.size > 10 * 1024 * 1024) throw new Error('il PDF supera i 10 MB');
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      const percorso = 'f24/' + stamp + '-' + f.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
      const up = await S.sb.storage.from('documenti').upload(percorso, f, { contentType: 'application/pdf', upsert: false }); if (up.error) throw up.error;
      const ins = await S.sb.from('documenti_f24').insert({ nome_file: f.name, percorso, nota: form.nota.value.trim() || null, caricato_da: chi() });
      if (ins.error) { await S.sb.storage.from('documenti').remove([percorso]); throw ins.error; }
      S.modal = null; await reloadDocF24(); S.filtroRate = 'piani'; S._open = 'f24'; render();
    }, 'PDF caricato: resta da inserire scadenza e importo');
  },
  async apriPdf(id) {
    const d = (S.data.docF24 || []).find(x => x.id === id); if (!d) return toast('PDF non trovato');
    const w = window.open('', '_blank');
    try { const r = await S.sb.storage.from('documenti').createSignedUrl(d.percorso, 300); if (r.error) throw r.error; if (w) w.location = r.data.signedUrl; else location.href = r.data.signedUrl; }
    catch (e) { if (w) w.close(); console.error(e); toast('Non riesco ad aprire il PDF: ' + (e.message || e), 6000); }
  },
  nuovoAnticipo(banca, linea) { S.modal = { type: 'anticipo', id: null, linea: banca && linea ? banca + '|' + linea : '' }; render(); },
  pescaAnticipo(el) {
    const o = (S._anticPick || {})[el.value]; if (!o) return;
    const f = el.form, set = (n, v) => { f[n].value = v == null ? '' : v; f[n].dispatchEvent(new Event('input', { bubbles: true })); }, imp = String(Math.round(o.importo * 100) / 100).replace('.', ',');
    set('cliente', o.cliente); set('documento', o.documento); set('numero_doc', o.numero); set('data_doc', o.datdoc); set('importo_documento', imp); set('importo_anticipato', imp);
    if (o.scadenza) set('scadenza', o.scadenza);
    f.chiave.value = o.k + ':' + o.chiave; UI.percAntic(f);
  },
  percAntic(f) {
    const d = num(f.importo_documento.value), a = num(f.importo_anticipato.value), el = f.querySelector('.perc'); if (!el) return;
    if (!d || a == null) { el.className = 'perc small muted'; el.textContent = ''; return; }
    if (a > d + 0.005) { el.className = 'perc small bad'; el.textContent = "L'importo anticipato non può superare il valore del documento."; return; }
    el.className = 'perc small muted'; el.textContent = `Anticipato il ${(100 * a / d).toFixed(1).replace('.', ',')}% del documento` + (d - a > 0.005 ? ` · restano ${eur2(d - a)} non anticipati` : '') + '.';
  },
  async salvaAnticipo(form, id) {
    await guard(async () => {
      const [banca, linea] = String(form.linea.value).split('|'); if (!banca || !linea) throw new Error('scegli la linea');
      const cliente = form.cliente.value.trim(); if (!cliente) throw new Error('scrivi il cliente');
      const imp = num(form.importo_documento.value), ant = num(form.importo_anticipato.value);
      if (!imp || imp <= 0) throw new Error('il valore del documento non è valido');
      if (ant == null || ant < 0) throw new Error("l'importo anticipato non è valido");
      if (ant > imp + 0.005) throw new Error("l'importo anticipato non può superare il valore del documento");
      const pres = form.data_presentazione.value; if (!pres) throw new Error('manca la data di presentazione');
      let scad = form.scadenza.value || null;
      if (!scad && banca === 'Credem' && linea === 'anticipi_estero') scad = addDays(pres, Number((S.data.P || {}).giorni_anticipo_export) || GIORNI_ANTICIPO);
      if (scad && scad < pres) throw new Error('la scadenza non può essere prima della presentazione');
      const [k, ...r] = String(form.chiave.value || '').split(':'), ch = r.join(':'), r2 = v => Math.round(v * 100) / 100;
      const row = { banca, linea, cliente, documento: form.documento.value.trim() || null, chiave_partita: k === 'pt' && ch ? ch : null, chiave_doc: k === 'pf' && ch ? ch : null,
        numero_doc: form.numero_doc.value.trim() || null, data_doc: form.data_doc.value || null, data_presentazione: pres, scadenza: scad, importo_documento: r2(imp), importo_anticipato: r2(ant), nota: form.nota.value.trim() || null };
      if (id) { const { error } = await S.sb.from('anticipi_presentati').update({ ...row, aggiornato_da: chi(), aggiornato_il: new Date().toISOString() }).eq('id', id); if (error) throw error; }
      else { const { error } = await S.sb.from('anticipi_presentati').insert({ ...row, stato: 'aperto', creato_da: chi() }); if (error) throw error; }
      S.modal = null; await reloadAntic(); S.view = 'banche'; S.dett = 'anticipi'; S._keepScroll = true; render();
    }, id ? 'Documento aggiornato' : 'Anticipo registrato');
  },
  async chiudiAnticipo(id) {
    await guard(async () => { const { error } = await S.sb.from('anticipi_presentati').update({ stato: 'chiuso', chiuso_il: OGGI, aggiornato_da: chi(), aggiornato_il: new Date().toISOString() }).eq('id', id); if (error) throw error; await reloadAntic(); S._keepScroll = true; render(); }, 'Documento chiuso: non conta più tra gli aperti');
  },
  async riapriAnticipo(id) {
    await guard(async () => { const { error } = await S.sb.from('anticipi_presentati').update({ stato: 'aperto', chiuso_il: null, aggiornato_da: chi(), aggiornato_il: new Date().toISOString() }).eq('id', id); if (error) throw error; await reloadAntic(); S._keepScroll = true; render(); }, 'Documento riaperto');
  },
  chiediEliminaAnticipo(id) {
    if (!puoElim()) return UI.nonAutorizzato();
    const a = (S.data.antic || []).find(x => String(x.id) === String(id)); if (!a) return;
    UI.chiedi({ titolo: 'Eliminare questo documento anticipato?', bottone: 'Sì, elimina', azione: 'eliminaAnticipo', arg: id,
      dettaglio: `<b>${esc(a.cliente)}</b>${a.documento ? ' · ' + esc(a.documento) : ''}<div class="small muted">${esc(a.banca)} · ${esc(etichettaLinea(a.banca, a.linea))} · presentato il ${fmtD(a.data_presentazione)} · valore ${eur2(a.importo_documento)} · anticipato <b>${eur2(a.importo_anticipato)}</b></div>`,
      avviso: "Se il documento è stato solo incassato basta chiuderlo (resta nello storico): eliminalo solo se l'hai inserito per errore." });
  },
  async eliminaAnticipo(id) {
    if (!puoElim()) return UI.nonAutorizzato();
    await guard(async () => { const { error } = await S.sb.from('anticipi_presentati').delete().eq('id', id); if (error) throw error; await reloadAntic(); S._keepScroll = true; render(); }, 'Documento eliminato');
  },
  chiedi(o) { S.modal = { type: 'conferma', ...o }; render(); },
  esegui() { const m = S.modal; S.modal = null; render(); if (m && m.azione && UI[m.azione]) UI[m.azione](m.arg); },
  nonAutorizzato() { toast('Solo chi ha il permesso di eliminare (oggi Andrea e Miriam) può farlo', 5000); },
  chiediEliminaRata(id) {
    if (!puoElim()) return UI.nonAutorizzato();
    const r = S.data.rate.find(x => x.id === id); if (!r) return;
    UI.chiedi({ titolo: 'Eliminare questa registrazione?', bottone: 'Sì, elimina', azione: 'eliminaRata', arg: id,
      dettaglio: `<b>${esc(r.nome)}</b> · scadenza <b>${fmtD(r.scadenza)}</b> · <b>${eur2(r.importo)}</b>${r.nota ? '<div class="small muted">' + esc(r.nota) + '</div>' : ''}${r.stato === 'pagata' ? '<div class="small warn">Attenzione: è segnata come già pagata.</div>' : ''}` });
  },
  async eliminaRata(id) {
    if (!puoElim()) return UI.nonAutorizzato();
    await guard(async () => {
      const { data, error } = await S.sb.from('rate').delete().eq('id', id).select(); if (error) throw error;
      if (!data || !data.length) throw new Error('non eliminata: non hai il permesso, oppure non esiste più');
      await reloadRate(); S._keepScroll = true; render();
    }, 'Registrazione eliminata');
  },
  chiediEliminaDoc(id) {
    if (!puoElim()) return UI.nonAutorizzato();
    const d = (S.data.docF24 || []).find(x => x.id === id); if (!d) return;
    const legate = S.data.rate.filter(r => r.documento_id === id).length;
    UI.chiedi({ titolo: 'Eliminare questo PDF?', bottone: 'Sì, elimina', azione: 'eliminaDoc', arg: id, avviso: legate ? `Le ${legate} rate già inserite restano, ma perdono il collegamento al PDF. L'operazione non si può annullare.` : undefined,
      dettaglio: `<b>${esc(d.nome_file)}</b><div class="small muted">caricato da ${esc(d.caricato_da || '')} il ${fmtD(d.caricato_il)}</div>` });
  },
  async eliminaDoc(id) {
    if (!puoElim()) return UI.nonAutorizzato();
    await guard(async () => {
      const d = (S.data.docF24 || []).find(x => x.id === id); if (!d) return;
      const { data, error } = await S.sb.from('documenti_f24').delete().eq('id', id).select(); if (error) throw error;
      if (!data || !data.length) throw new Error('non eliminato: non hai il permesso, oppure non esiste più');
      await S.sb.storage.from('documenti').remove([d.percorso]);
      await reloadDocF24(); await reloadRate(); S._keepScroll = true; render();
    }, 'PDF eliminato');
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
  chiediEliminaSaldo(id) {
    if (!puoElim()) return UI.nonAutorizzato();
    const x = S.data.saldi.find(y => y.id === id); if (!x) return;
    UI.chiedi({ titolo: 'Eliminare questo saldo?', bottone: 'Sì, elimina', azione: 'eliminaSaldo', arg: id, dettaglio: `<b>${esc(x.banca)}</b> del ${fmtD(x.data)} · saldo c/c <b>${eur2(x.saldo_cc)}</b>` });
  },
  async eliminaSaldo(id) {
    if (!puoElim()) return UI.nonAutorizzato();
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
// Aggiornamento automatico: ogni 2 minuti, e appena la scheda torna in primo piano, Fiammetta chiede al database «quando è arrivato l'ultimo invio del gestionale?»
// (stato_dati). Se è cambiato (invio delle 3 di notte), se è passata la mezzanotte o se i dati hanno più di 10 minuti, rilegge tutto da sola, senza F5.
// Non tocca nulla mentre c'è una finestra aperta o si sta scrivendo in un campo.
async function controllaDati() {
  if (!S.data || !S.loadedAt || S.busy || S.modal || document.hidden || S._ctrl) return;
  const ae = document.activeElement; if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
  S._ctrl = true;
  try {
    const { data, error } = await S.sb.rpc('stato_dati'); if (error) throw error;
    const nuovoInvio = data && data.ultimo_invio && data.ultimo_invio !== S.data.stato.ultimo_invio, giornoNuovo = isoLocal() !== OGGI, vecchi = Date.now() - S.loadedAt > 10 * 60000;
    if (nuovoInvio || giornoNuovo || vecchi) {
      await loadAll(); S._keepScroll = true; render();
      toast(nuovoInvio ? 'Dati nuovi dal gestionale (invio del ' + fmtDT(data.ultimo_invio) + '): pagina aggiornata' : giornoNuovo ? 'Nuovo giorno: dati aggiornati' : 'Dati aggiornati');
    }
  } catch (e) { console.error('controllo aggiornamenti', e); } finally { S._ctrl = false; }
}
setInterval(controllaDati, 120000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) controllaDati(); });
window.addEventListener('focus', controllaDati);

// ---------- Importi: sia il punto sia la virgola sono la virgola decimale ----------
// Durante la digitazione il campo accetta solo cifre e un separatore decimale (il punto diventa virgola), con massimo 2 decimali (3 per i tassi):
// nessun separatore delle migliaia. Sotto il campo si legge quanto verrà salvato.
function pulisciImporto(el) {
  const dec = Number(el.dataset.dec || 2), raw = el.value, pos = el.selectionStart == null ? raw.length : el.selectionStart;
  let out = '', sep = false, extra = false, troppi = false, nuova = null;
  for (let i = 0; i < raw.length; i++) {
    if (i === pos) nuova = out.length;
    const ch = raw[i];
    if (/\d/.test(ch)) { if (sep && out.split(',')[1].length >= dec) { troppi = true; continue; } out += ch; }
    else if (ch === ',' || ch === '.') { if (sep) { extra = true; continue; } sep = true; out += out === '' || out === '-' ? '0,' : ','; }
    else if (ch === '-' && out === '') out = '-';
  }
  if (nuova == null) nuova = out.length;
  if (out !== raw) { el.value = out; try { el.setSelectionRange(nuova, nuova); } catch (e) {} }
  if (el.closest('td') || el.dataset.nohint) return;
  let h = el.nextElementSibling; if (!h || !h.classList.contains('hint')) { h = document.createElement('div'); h.className = 'hint'; el.insertAdjacentElement('afterend', h); }
  const v = num(out);
  if (extra || troppi) { h.className = 'hint bad'; h.textContent = (extra ? 'Un solo separatore decimale (. oppure ,). ' : '') + (troppi ? `Massimo ${dec} decimali. ` : '') + 'Scrivi 1234,56, senza punto delle migliaia.' + (v == null ? '' : ' Ora vale ' + (dec > 2 ? String(v).replace('.', ',') + ' %' : eur2(v)) + '.'); }
  else { h.className = 'hint'; h.textContent = v == null || out === '-' ? '' : '= ' + (dec > 2 ? String(v).replace('.', ',') + ' %' : eur2(v)); }
}
document.addEventListener('input', e => { const el = e.target; if (el && el.matches && el.matches('input[inputmode=decimal]')) pulisciImporto(el); });
// «1.234,56» incollato (formato italiano con il punto delle migliaia) viene letto come 1234,56
document.addEventListener('paste', e => {
  const el = e.target; if (!el || !el.matches || !el.matches('input[inputmode=decimal]')) return;
  const t = ((e.clipboardData || window.clipboardData).getData('text') || '').trim();
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) { e.preventDefault(); el.value = t.replace(/\./g, ''); pulisciImporto(el); }
});
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
