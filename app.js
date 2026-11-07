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
  partite: { tab: 'clienti', filtro: 'scaduto', cerca: '' }, clienti: null };
const VISTE = [['oggi', 'Oggi'], ['partite', 'Crediti e debiti'], ['scadenziario', 'Scadenziario'], ['ce', 'Conto economico'], ['banche', 'Banche e PFN'], ['impostazioni', 'Impostazioni']];
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// de-DE: stesso formato italiano (punto per le migliaia, virgola per i decimali) ma raggruppa anche i numeri a 4 cifre
const n0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const n2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = v => (v == null || isNaN(v)) ? '–' : n0.format(Math.round(v)) + ' €';
const eur2 = v => (v == null || isNaN(v)) ? '–' : n2.format(v) + ' €';
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
  const [stato, ce, sp, banche, rate, piani, scad, par, saldi, team, movimenti, regole, proforme, stimaBanca, accrediti, anagBanche] = await Promise.all([
    S.sb.rpc('stato_dati').then(r => { if (r.error) throw r.error; return r.data; }),
    all('v_ce_mese'), all('v_sp_saldi'), all('v_banche_saldi'),
    all('v_rate', q => q.order('scadenza').order('n')), all('piani', q => q.order('tipo').order('nome')),
    all('v_scadenze_aperte', q => q.order('datsca')), all('parametri'),
    S.sb.from('saldi_banca').select('*').order('data', { ascending: false }).order('banca').limit(80).then(r => { if (r.error) throw r.error; return r.data; }),
    all('team'),
    all('movimenti_app', q => q.eq('stato', 'attesa').order('data', { ascending: false })),
    all('regole_incasso'), all('v_proforme', q => q.order('datdoc', { ascending: false })),
    all('v_banca_stima'), all('v_banca_accrediti', q => q.order('dataoperaz', { ascending: false })),
    all('erp_banche', q => q.order('codice'))
  ]);
  const P = {}; par.forEach(p => P[p.chiave] = typeof p.valore === 'number' ? p.valore : num(p.valore));
  const R = {}; regole.forEach(r => R[r.conto] = r);
  S.data = { stato, ce, sp, banche, rate, piani, scad, par, P, saldi, team, movimenti, regole, R, proforme, stimaBanca, accrediti, anagBanche };
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
      // la fattura vera e' uscita: cerco la partita aperta dello stesso cliente con lo stesso importo
      const cand = D.scad.filter(s => s.conto === pf.conto && s.tipo_cf === 'C' && Math.abs(Number(s.importo) - Number(pf.totdoc)) < 0.01 && s.datdoc >= pf.datdoc)
        .filter(s => !D.movimenti.some(x => x.chiave_partita === s.chiave))[0];
      if (cand) { m.chiave_partita = cand.chiave; collega.push(m); }
      else if (pf.fatturata_il && giorni(pf.fatturata_il, OGGI) > 45) chiudi.push(m.id); // fatturata da tempo e nessuna partita aperta: NTS ha gia' registrato l'incasso
    }
  }
  try {
    for (const m of collega) await S.sb.from('movimenti_app').update({ chiave_partita: m.chiave_partita }).eq('id', m.id);
    if (chiudi.length) { await S.sb.from('movimenti_app').update({ stato: 'riconciliato', riconciliato_il: new Date().toISOString() }).in('id', chiudi); D.movimenti = D.movimenti.filter(m => !chiudi.includes(m.id)); }
  } catch (e) { console.error('riconciliazione', e); }
}
// Calcoli derivati su partite e proforme (coperture, date attese, piani di rientro)
function arricchisci() {
  const D = S.data;
  const copertaPartita = {}, copertaDoc = {};
  D.movimenti.forEach(m => { if (m.chiave_partita) copertaPartita[m.chiave_partita] = m; if (m.chiave_doc) copertaDoc[m.chiave_doc] = m; });
  const pianiForn = D.piani.filter(p => p.tipo === 'fornitore' && p.stato === 'attivo');
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const inPiano = nome => { const n = norm(nome); return pianiForn.find(p => { const c = norm(p.controparte || p.nome); const k = c.split(' ')[0]; return c && (n.includes(c) || c.includes(n) || (k.length > 3 && n.startsWith(k))); }); };
  D.scad.forEach(s => {
    s.importo = Number(s.importo); s.copertura = copertaPartita[s.chiave] || null;
    s.apertura = /\|2025\|\|9999\|/.test(s.chiave) || (s.numdoc === 0 && s.datsca <= '2026-01-01');
    const r = D.R[s.conto];
    s.attesa = (s.tipo_cf === 'C' && r) ? addDays(r.base === 'scadenza' ? s.datsca : (s.datdoc || s.datsca), r.giorni) : s.datsca;
    s.ritardo = giorni(s.attesa, OGGI);
    s.piano = s.tipo_cf === 'F' ? inPiano(s.controparte) : null;
  });
  D.proforme.forEach(p => {
    p.totdoc = Number(p.totdoc); p.copertura = copertaDoc[p.chiave] || null;
    p.stato = p.copertura ? (p.copertura.stato === 'annullato' || Number(p.copertura.importo) === 0 ? 'annullata' : 'incassata') : (p.fatturata_il ? 'fatturata' : 'attesa');
  });
}
const partiteC = () => S.data.scad.filter(s => s.tipo_cf === 'C' && !s.copertura);
const partiteF = () => S.data.scad.filter(s => s.tipo_cf === 'F' && !s.copertura);
const proformeAttese = () => S.data.proforme.filter(p => p.stato === 'attesa');

// ---------- Calcoli ----------
function posizione() {
  const D = S.data, b = D.banche, sp = D.sp;
  const cc = b.filter(x => x.categoria === 'cc');
  const ccAttivi = sum(cc.filter(x => x.saldo > 0), x => x.saldo), scoperti = -sum(cc.filter(x => x.saldo < 0), x => x.saldo);
  const sbf = sum(b.filter(x => x.categoria === 'sbf'), x => x.saldo), acc = sum(b.filter(x => x.categoria === 'accantonamento'), x => x.saldo);
  const cassa = sum(b.filter(x => x.categoria === 'cassa'), x => x.saldo);
  const carte = sum(sp.filter(x => x.voce === 'SP.LIQUIDITA' && x.mastro !== 2415), x => x.saldo);
  const anticipi = -sum(b.filter(x => x.categoria === 'anticipi'), x => x.saldo);
  const fin = -sum(sp.filter(x => x.voce === 'SP.DEB_FINANZIAMENTI'), x => x.saldo);
  const soci = -sum(sp.filter(x => x.voce === 'SP.DEB_SOCI'), x => x.saldo);
  const liquidita = ccAttivi + sbf + acc + cassa + carte;
  const pfn = fin + anticipi + scoperti - liquidita;
  // stima aggiornata: movimenti bancari importati in NTS dopo l'ultima registrazione + incassi/pagamenti segnati in Fiammetta piu' recenti dei movimenti importati
  const banca = D.stimaBanca || [];
  const deltaBanca = sum(banca, x => Number(x.accrediti_dopo || 0) - Number(x.addebiti_dopo || 0));
  const ultimoMov = banca.reduce((m, x) => x.ultimo_movimento > m ? x.ultimo_movimento : m, '');
  const appIn = D.movimenti.filter(m => m.tipo === 'incasso' && m.data > ultimoMov), appOut = D.movimenti.filter(m => m.tipo === 'pagamento' && m.data > ultimoMov);
  const deltaApp = sum(appIn, m => m.importo) - sum(appOut, m => m.importo);
  const dataStima = [ultimoMov, ...D.movimenti.map(m => m.data), D.stato.ultima_registrazione].filter(Boolean).sort().pop();
  return { ccAttivi, scoperti, sbf, acc, cassa, carte, anticipi, fin, soci, liquidita, pfn, pfnTot: pfn + soci,
    stima: liquidita + deltaBanca + deltaApp, deltaBanca, deltaApp, ultimoMov, dataStima, nIn: appIn.length, nOut: appOut.length };
}
const rateAperte = () => S.data.rate.filter(r => r.stato !== 'pagata' && r.stato !== 'saltata' && r.stato_piano === 'attivo');
function statoAder(p) {
  const rs = S.data.rate.filter(r => r.piano_id === p.id);
  const saltate = rs.filter(r => r.stato === 'saltata').length, daConf = rs.filter(r => r.stato_effettivo === 'da_confermare').length;
  const residue = rs.filter(r => r.stato !== 'pagata' && r.stato !== 'saltata');
  const prossima = residue.find(r => r.scadenza >= OGGI);
  const soglia = p.soglia_decadenza || S.data.P.soglia_decadenza_ader || 8;
  const margine = soglia - saltate;
  return { saltate, daConf, residue: residue.length, residuo: sum(residue, r => r.importo), pagate: rs.filter(r => r.stato === 'pagata').length, prossima, soglia, margine, tot: rs.length };
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
const tipoPiano = { finanziamento: 'Finanziamenti', simest: 'SIMEST', fornitore: 'Piani di rientro fornitori', ader: 'Rateizzazioni AdER', altro: 'Altro' };
const tipoBanca = { cc: 'conto corrente', sbf: 'incassi / SBF', accantonamento: 'accantonamento', anticipi: 'anticipi', cassa: 'cassa' };
function nomeBanca(d) { d = (d || '').toLowerCase(); if (d.includes('verona')) return 'BPER Verona'; if (d.includes('emilia') || d.startsWith('bper')) return 'BPER'; if (d.includes('padana')) return 'Cassa Padana'; if (d.includes('credem')) return 'Credem'; if (d.includes('sondrio')) return 'Pop. Sondrio'; if (d.includes('valsabbina')) return 'Valsabbina'; if (d.includes('cassa')) return 'Cassa contanti'; return 'Altro'; }
const link = (testo, view, arg) => `<a href="#" class="lnk" onclick="UI.go('${view}'${arg ? ",'" + arg + "'" : ''});return false">${testo}</a>`;

function shell(inner) {
  return `<div class="shell"><aside class="side">
    <div class="brand"><svg class="flame" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2c2 6 9 9 9 17a9 9 0 0 1-18 0c0-4 2-6 3-8 0 3 1 5 3 5 0-5 1-10 3-14z" fill="#d9480f"/><path d="M16 14c1 3 4 4 4 8a4 4 0 0 1-8 0c0-3 2-4 4-8z" fill="#f59f00"/></svg><div><b>Fiammetta</b><small>Magikal · amministrazione</small></div></div>
    <nav class="nav">${VISTE.map(([k, l]) => `<button class="${S.view === k ? 'on' : ''}" onclick="UI.go('${k}')">${l}</button>`).join('')}</nav>
    <div class="foot">${esc(S.me ? S.me.nome : S.email)}<br>Gestionale: ${S.data.stato.ultimo_invio ? fmtDT(S.data.stato.ultimo_invio) : 'mai'}<br>Registrazioni fino al ${fmtD(S.data.stato.ultima_registrazione)}<br><button onclick="UI.reload()">Aggiorna</button> <button onclick="UI.modal('password')">Password</button> <button onclick="UI.logout()">Esci</button></div>
  </aside><main class="main">${inner}</main></div>${S.modal ? renderModal() : ''}`;
}
function render() {
  if (!S.data) return;
  const page = { oggi: pageOggi, partite: pagePartite, scadenziario: pageScadenziario, ce: pageCE, banche: pageBanche, impostazioni: pageImpostazioni }[S.view] || pageOggi;
  const sc = window.scrollY; $('#app').innerHTML = shell(page()); window.scrollTo(0, S._keepScroll ? sc : 0); S._keepScroll = false;
  const first = document.querySelector('.modal input:not([type=hidden]):not([type=checkbox]),.modal select');
  if (first && S.modal && !S.modal._f) { first.focus(); S.modal._f = true; }
}

// ---------- Oggi ----------
function pageOggi() {
  const D = S.data, P = D.P, pos = posizione();
  const pc = partiteC(), pf = partiteF();
  const scadC = pc.filter(s => s.attesa < OGGI), scadF = pf.filter(s => s.datsca < OGGI && !s.piano);
  const scadutoC = sum(scadC, s => s.importo), scadutoF = -sum(scadF, s => s.importo);
  const aperturaC = sum(scadC.filter(s => s.apertura), s => s.importo), inPianoF = -sum(pf.filter(s => s.datsca < OGGI && s.piano), s => s.importo);
  const fine = addDays(OGGI, 30);
  const rate30 = rateAperte().filter(r => r.scadenza >= OGGI && r.scadenza <= fine);
  const forn30 = pf.filter(s => s.datsca >= OGGI && s.datsca <= fine && !s.piano);
  const cli30 = pc.filter(s => s.attesa >= OGGI && s.attesa <= fine);
  const prof = proformeAttese();
  const usciteRate = sum(rate30, r => r.importo), usciteForn = -sum(forn30, s => s.importo), incassi = sum(cli30, s => s.importo), incProf = sum(prof, p => p.totdoc);
  const daConf = D.rate.filter(r => r.stato_effettivo === 'da_confermare' && r.stato_piano === 'attivo');
  const ader = D.piani.filter(p => p.tipo === 'ader' && p.stato === 'attivo').map(p => ({ p, s: statoAder(p) }));
  const eventi = [...rate30.map(r => ({ d: r.scadenza, t: r.nome + (r.n_rate ? ` · rata ${r.n}/${r.n_rate}` : ''), v: -r.importo, k: r.tipo })),
    ...forn30.map(s => ({ d: s.datsca, t: (s.controparte || s.conto) + (s.numdoc ? ` · ft ${s.numdoc}` : ''), v: s.importo, k: 'fornitore' })),
    ...cli30.map(s => ({ d: s.attesa, t: (s.controparte || s.conto) + (s.numdoc ? ` · ft ${s.numdoc}` : '') + (s.attesa !== s.datsca ? ' · regola cliente' : ''), v: s.importo, k: 'cliente' }))].sort((a, b) => a.d.localeCompare(b.d));
  const liqClass = pos.stima < (P.uscite_fisse_mese || 0) ? 'warn' : 'good';
  const stimaDiversa = Math.abs(pos.stima - pos.liquidita) > 0.5;
  return `<div class="head"><h2>Oggi · ${new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2><span class="small muted">Saldi contabili dal gestionale, registrazioni fino al ${fmtD(D.stato.ultima_registrazione)}</span></div>
  ${daConf.length ? `<div class="alert"><b>${daConf.length} rate scadute senza esito</b> (${eur(sum(daConf, r => r.importo))}): vanno segnate come pagate o saltate nello ${link('Scadenziario', 'scadenziario', 'conferma')}.</div>` : ''}
  ${D.stato.conti_da_mappare ? `<div class="alert"><b>${D.stato.conti_da_mappare} conti con movimenti non ancora classificati</b>: il conto economico non li include. Si classificano in ${link('Impostazioni → Mappa dei conti', 'impostazioni')}.</div>` : ''}
  <div class="grid">
    <div class="card"><h3>${link('Liquidità', 'banche')}</h3><div class="kpi ${liqClass}">${eur(pos.stima)}</div>
      ${stimaDiversa ? `<div class="sub">stima al ${fmtD(pos.dataStima)}: contabile ${eur(pos.liquidita)} ${pos.deltaBanca ? `${pos.deltaBanca > 0 ? '+' : '−'} ${eur(Math.abs(pos.deltaBanca))} movimenti banca importati in NTS non ancora registrati` : ''} ${pos.deltaApp ? `${pos.deltaApp > 0 ? '+' : '−'} ${eur(Math.abs(pos.deltaApp))} segnati in Fiammetta (${pos.nIn} incassi, ${pos.nOut} pagamenti)` : ''}</div>` : `<div class="sub">saldo contabile al ${fmtD(D.stato.ultima_registrazione)}: c/c attivi ${eur(pos.ccAttivi)} · SBF ${eur(pos.sbf)} · accantonamenti ${eur(pos.acc)} · cassa e carte ${eur(pos.cassa + pos.carte)}</div>`}
      ${P.uscite_fisse_mese ? `<div class="sub">Uscite fisse di un mese: ${eur(P.uscite_fisse_mese)} ${pos.stima < P.uscite_fisse_mese ? '<span class="pill warn">sotto soglia</span>' : '<span class="pill good">coperte</span>'}</div>` : ''}</div>
    <div class="card"><h3>${link('Scoperti e anticipi', 'banche')}</h3><div class="kpi">${eur(pos.scoperti + pos.anticipi)}</div><div class="sub">scoperti di c/c ${eur(pos.scoperti)} · anticipi (castelletto) ${eur(pos.anticipi)}</div>${D.saldi[0] && D.saldi[0].accordato_anticipi ? `<div class="sub">Ultimo saldo dal portale ${esc(D.saldi[0].banca)} ${fmtD(D.saldi[0].data)}: anticipi ${eur(D.saldi[0].anticipi_utilizzati)} su accordato ${eur(D.saldi[0].accordato_anticipi)}</div>` : '<div class="sub">Gli accordati si inseriscono in Banche e PFN → Saldi dal portale</div>'}</div>
    <div class="card"><h3>${link('PFN bancaria', 'banche')}</h3><div class="kpi">${eur(pos.pfn)}</div><div class="sub">finanziamenti ${eur(pos.fin)} + anticipi ${eur(pos.anticipi)} + scoperti ${eur(pos.scoperti)} − liquidità contabile ${eur(pos.liquidita)}</div><div class="sub">con finanziamento soci (${eur(pos.soci)}): <b>${eur(pos.pfnTot)}</b></div></div>
    <div class="card"><h3>Scaduto</h3><div class="kpi sm">${link('clienti', 'partite', 'clienti:scaduto')} <span class="${scadutoC > 0 ? 'warn' : ''}">${eur(scadutoC)}</span></div><div class="sub">${scadC.length} partite oltre la data attesa${aperturaC ? ` · di cui saldi 2025: ${eur(aperturaC)}` : ''}</div><div class="kpi sm" style="margin-top:8px">${link('fornitori', 'partite', 'fornitori:scaduto')} <span class="${scadutoF > 0 ? 'bad' : ''}">${eur(scadutoF)}</span></div><div class="sub">${scadF.length} partite scadute da pagare${inPianoF ? ` · altri ${eur(inPianoF)} coperti da piani di rientro` : ''}</div></div>
    <div class="card wide"><h3>Prossimi 30 giorni (fino al ${fmtD(fine)})</h3>
      <div class="grid" style="margin-bottom:10px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))"><div><div class="kpi sm bad">− ${eur(usciteRate + usciteForn)}</div><div class="sub">uscite: rate e piani ${eur(usciteRate)} · ${link('fornitori in scadenza', 'partite', 'fornitori:prossime')} ${eur(usciteForn)}</div></div><div><div class="kpi sm good">+ ${eur(incassi)}</div><div class="sub">${link('incassi attesi da clienti', 'partite', 'clienti:prossime')} (${cli30.length} scadenze)</div></div><div><div class="kpi sm good">+ ${eur(incProf)}</div><div class="sub">${link('proforme da incassare', 'partite', 'proforme')} prima della spedizione (${prof.length})</div></div><div><div class="kpi sm">${eur(pos.stima + incassi - usciteRate - usciteForn)}</div><div class="sub">liquidità a fine periodo se tutto va come previsto (senza proforme, stipendi, F24 e spese correnti)</div></div></div>
      ${eventi.length ? `<div class="scroll"><table><tr><th>Data</th><th>Che cosa</th><th>Tipo</th><th class="num">Importo</th></tr>${eventi.slice(0, 40).map(e => `<tr><td class="nowrap">${fmtD(e.d)}</td><td>${esc(e.t)}</td><td><span class="pill plain">${esc(e.k)}</span></td><td class="num ${e.v < 0 ? 'bad' : 'good'}">${eur(e.v)}</td></tr>`).join('')}</table>${eventi.length > 40 ? `<div class="small muted">… e altre ${eventi.length - 40} scadenze</div>` : ''}</div>` : '<div class="muted">Nessuna scadenza nei prossimi 30 giorni.</div>'}</div>
    <div class="card"><h3>Rateizzazioni AdER</h3>${ader.length ? `<ul class="list">${ader.map(({ p, s }) => `<li><div><b>${esc(p.nome)}</b><div class="d">${s.saltate} saltate su ${s.soglia} di soglia · residuo ${eur(s.residuo)} · prossima ${s.prossima ? fmtD(s.prossima.scadenza) + ' ' + eur2(s.prossima.importo) : '–'}${s.daConf ? ` · <span class="warn">${s.daConf} da confermare</span>` : ''}</div><div class="bar"><i class="${s.margine <= 1 ? 'bad' : s.margine <= 3 ? 'warn' : 'good'}" style="width:${Math.min(100, 100 * s.saltate / s.soglia)}%"></i></div></div><div class="right">${s.margine <= 1 ? '<span class="pill bad">decadenza vicina</span>' : s.margine <= 3 ? '<span class="pill warn">attenzione</span>' : '<span class="pill good">regolare</span>'}</div></li>`).join('')}</ul>` : '<div class="muted">Nessun piano AdER attivo.</div>'}<div class="small muted" style="margin-top:8px">Il contatore conta solo le rate marcate «saltata»; le rate scadute senza esito non contano finché non vengono confermate.</div></div>
    <div class="card"><h3>Stato dei dati</h3><ul class="list"><li><span>Ultimo invio del gestionale</span><b>${fmtDT(D.stato.ultimo_invio)}</b></li><li><span>Ultima registrazione in prima nota</span><b>${fmtD(D.stato.ultima_registrazione)}</b></li><li><span>Ultimo movimento bancario importato in NTS</span><b>${fmtD(pos.ultimoMov)}</b></li><li><span>Incassi e pagamenti segnati in attesa di NTS</span><b>${D.movimenti.length}</b></li><li><span>Conti con movimenti da classificare</span><b class="${D.stato.conti_da_mappare ? 'warn' : ''}">${D.stato.conti_da_mappare || 0}</b></li><li><span>Rate aperte nello scadenziario</span><b>${rateAperte().length}</b></li></ul></div>
  </div>`;
}

// ---------- Crediti e debiti (partite, proforme, banca) ----------
function pagePartite() {
  const D = S.data, T = S.partite, q = T.cerca.toLowerCase();
  const tabs = [['clienti', 'Clienti'], ['fornitori', 'Fornitori'], ['proforme', 'Proforme'], ['attesa', 'Segnati in attesa di NTS'], ['banca', 'Accrediti in banca']];
  let body = '';
  if (T.tab === 'clienti' || T.tab === 'fornitori') {
    const cli = T.tab === 'clienti';
    let rows = cli ? partiteC() : partiteF();
    const fine = addDays(OGGI, 30);
    const filtri = cli ? [['scaduto', 'Oltre la data attesa'], ['prossime', 'Attesi entro 30 giorni'], ['tutte', 'Tutte le partite']] : [['scaduto', 'Scadute'], ['prossime', 'In scadenza entro 30 giorni'], ['piano', 'In piano di rientro'], ['tutte', 'Tutte le partite']];
    if (!filtri.some(f => f[0] === T.filtro)) T.filtro = 'scaduto';
    const dataDi = s => cli ? s.attesa : s.datsca;
    if (T.filtro === 'scaduto') rows = rows.filter(s => dataDi(s) < OGGI && !s.piano);
    if (T.filtro === 'prossime') rows = rows.filter(s => dataDi(s) >= OGGI && dataDi(s) <= fine && !s.piano);
    if (T.filtro === 'piano') rows = rows.filter(s => s.piano);
    if (q) rows = rows.filter(s => (s.controparte || '').toLowerCase().includes(q) || String(s.numdoc || '').includes(q) || String(s.conto).includes(q));
    const gruppi = {}; rows.forEach(s => { const g = gruppi[s.conto] || (gruppi[s.conto] = { conto: s.conto, nome: s.controparte || String(s.conto), rows: [], tot: 0 }); g.rows.push(s); g.tot += s.importo; });
    const lista = Object.values(gruppi).sort((a, b) => cli ? b.tot - a.tot : a.tot - b.tot);
    const totale = sum(rows, s => s.importo);
    const segno = v => cli ? v : -v;
    body = `<div class="tabs">${filtri.map(([k, l]) => `<button class="${T.filtro === k ? 'on' : ''}" onclick="UI.partite(null,'${k}')">${l}</button>`).join('')}</div>
    <div class="row" style="margin-bottom:10px"><input class="search" placeholder="cerca ${cli ? 'cliente' : 'fornitore'} o numero fattura" value="${esc(T.cerca)}" oninput="UI.cercaPartite(this.value)"><span class="small muted">${lista.length} ${cli ? 'clienti' : 'fornitori'} · ${rows.length} partite · <b>${eur(segno(totale))}</b>${cli ? ` · di cui saldi 2025: ${eur(sum(rows.filter(s => s.apertura), s => s.importo))}` : ''}</span></div>
    ${cli ? '<div class="small muted" style="margin-bottom:8px">La «data attesa» è la scadenza NTS, oppure la data calcolata dalla regola del cliente (es. NordicFire: fattura + 10 giorni). Con «Incassato» la partita esce dallo scaduto e conta nella liquidità stimata finché NTS non registra l\'incasso.</div>' : '<div class="small muted" style="margin-bottom:8px">Importi negativi = note di credito o acconti già pagati non ancora abbinati in NTS. Le partite dei fornitori con un piano di rientro attivo sono nel filtro apposito e non contano nello scaduto.</div>'}
    ${lista.length ? lista.map(g => `<details class="piano" ${lista.length <= 6 || q ? 'open' : ''}><summary><span class="nm">${esc(g.nome)}<div class="small muted">conto ${g.conto}${D.R[g.conto] ? ' · regola: ' + (D.R[g.conto].base === 'scadenza' ? 'scadenza' : 'fattura') + ' + ' + D.R[g.conto].giorni + ' gg' : ''}</div></span><span class="small nowrap">${g.rows.length} partite</span><span class="nowrap right"><b>${eur2(segno(g.tot))}</b></span></summary><div class="body">${tabellaPartite(g.rows, cli)}</div></details>`).join('') : '<div class="card muted">Nessuna partita con questo filtro.</div>'}`;
  } else if (T.tab === 'proforme') {
    let rows = D.proforme.slice(); const filtri = [['attesa', 'Da incassare'], ['tutte', 'Tutte (8 mesi)']];
    if (!filtri.some(f => f[0] === T.filtro)) T.filtro = 'attesa';
    if (T.filtro === 'attesa') rows = rows.filter(p => p.stato === 'attesa');
    if (q) rows = rows.filter(p => (p.controparte || '').toLowerCase().includes(q) || String(p.numdoc).includes(q));
    const pillP = p => p.stato === 'attesa' ? '<span class="pill warn">da incassare</span>' : p.stato === 'incassata' ? `<span class="pill good">incassata ${fmtD(p.copertura.data)}</span>` : p.stato === 'fatturata' ? `<span class="pill plain">fatturata ${fmtD(p.fatturata_il)}</span>` : '<span class="pill plain">annullata</span>';
    body = `<div class="tabs">${filtri.map(([k, l]) => `<button class="${T.filtro === k ? 'on' : ''}" onclick="UI.partite(null,'${k}')">${l}</button>`).join('')}</div>
    <div class="row" style="margin-bottom:10px"><input class="search" placeholder="cerca cliente o numero" value="${esc(T.cerca)}" oninput="UI.cercaPartite(this.value)"><span class="small muted">${rows.length} proforme · <b>${eur(sum(rows, p => p.totdoc))}</b></span></div>
    <div class="small muted" style="margin-bottom:8px">Le proforme (serie PR) vengono pagate prima della spedizione. Quando arriva il bonifico si segna «Incassata»: la fattura che NTS emetterà dopo (stesso cliente, stesso importo) viene riconosciuta da sola e non comparirà tra i crediti scaduti. «Fatturata» = NTS ha già emesso la fattura definitiva.</div>
    <div class="card"><div class="scroll"><table><tr><th>Data</th><th>N.</th><th>Cliente</th><th>Pagamento</th><th class="num">Importo</th><th>Stato</th><th>Spedita</th><th></th></tr>${rows.map(p => `<tr><td class="nowrap">${fmtD(p.datdoc)}</td><td>${p.numdoc}</td><td>${esc(p.controparte || p.conto)}${p.paese && p.paese !== 'IT' ? ' <span class="pill plain">' + esc(p.paese) + '</span>' : ''}</td><td class="small">${esc(p.pagamento || '')}</td><td class="num">${eur2(p.totdoc)}</td><td>${pillP(p)}${p.copertura && p.copertura.nota ? '<div class="small muted">' + esc(p.copertura.nota) + '</div>' : ''}</td><td class="nowrap small">${p.spedita_il ? fmtD(p.spedita_il) : ''}</td><td class="nowrap right">${p.stato === 'attesa' ? `<button class="btn sm primary" onclick="UI.modal('incasso','pf:${p.chiave}')">Incassata</button> <button class="btn sm ghost" onclick="UI.annullaProforma('${p.chiave}')">non valida</button>` : p.copertura ? `<button class="btn sm ghost" onclick="UI.annullaMovimento(${p.copertura.id})">annulla</button>` : ''}</td></tr>`).join('')}</table></div>${rows.length ? '' : '<div class="muted">Nessuna proforma.</div>'}</div>`;
  } else if (T.tab === 'attesa') {
    const rows = D.movimenti.filter(m => m.stato === 'attesa');
    body = `<div class="small muted" style="margin-bottom:8px">Incassi e pagamenti segnati in Fiammetta che NTS non ha ancora registrato. Spariscono da soli quando la partita viene chiusa in prima nota.</div>
    <div class="card"><div class="scroll"><table><tr><th>Data</th><th>Tipo</th><th>Controparte</th><th>Riferimento</th><th class="num">Importo</th><th>Banca</th><th>Segnato da</th><th></th></tr>${rows.map(m => `<tr><td class="nowrap">${fmtD(m.data)}</td><td>${m.tipo === 'incasso' ? '<span class="pill good">incasso</span>' : '<span class="pill bad">pagamento</span>'}</td><td>${esc(m.controparte || m.conto || '')}</td><td class="small muted">${m.chiave_partita ? 'partita ' + esc(m.chiave_partita.split('|').slice(1, 4).join('/')) : m.chiave_doc ? 'proforma ' + esc(m.chiave_doc.split('|').pop()) : ''}${m.nota ? ' · ' + esc(m.nota) : ''}</td><td class="num">${eur2(m.importo)}</td><td class="small">${esc(m.banca || '')}</td><td class="small muted">${esc(m.creato_da || '')} · ${fmtD(m.creato_il)}</td><td class="right"><button class="btn sm ghost" onclick="UI.annullaMovimento(${m.id})">annulla</button></td></tr>`).join('')}</table></div>${rows.length ? '' : '<div class="muted">Niente in attesa.</div>'}</div>`;
  } else if (T.tab === 'banca') {
    let rows = D.accrediti.filter(a => !a.pn_numreg);
    if (q) rows = rows.filter(a => ((a.descr1 || '') + ' ' + (a.descr2 || '')).toLowerCase().includes(q));
    body = `<div class="row" style="margin-bottom:10px"><input class="search" placeholder="cerca nella descrizione" value="${esc(T.cerca)}" oninput="UI.cercaPartite(this.value)"><span class="small muted">${rows.length} accrediti degli ultimi 60 giorni importati in NTS e non ancora in prima nota · <b>${eur(sum(rows, a => a.importo))}</b></span></div>
    <div class="small muted" style="margin-bottom:8px">Sono i bonifici in entrata letti dai movimenti bancari importati in NTS (fino al ${fmtD(posizione().ultimoMov)}). Servono per riconoscere chi ha pagato: la partita si segna «Incassato» dalla scheda Clienti.</div>
    <div class="card"><div class="scroll"><table><tr><th>Data</th><th>Banca</th><th class="num">Importo</th><th>Descrizione</th></tr>${rows.map(a => `<tr><td class="nowrap">${fmtD(a.dataoperaz)}</td><td class="small">${esc(nomeBanca(a.banca))}</td><td class="num good">${eur2(a.importo)}</td><td class="small">${esc(a.descr1 || '')} <span class="muted">${esc(a.descr2 || '')}</span></td></tr>`).join('')}</table></div>${rows.length ? '' : '<div class="muted">Nessun accredito non registrato (o movimenti non ancora importati in NTS).</div>'}</div>`;
  }
  return `<div class="head"><h2>Crediti e debiti</h2><span class="small muted">partite aperte dal gestionale al ${fmtD(D.stato.ultima_registrazione)}</span></div>
  <div class="tabs" style="margin-bottom:6px">${tabs.map(([k, l]) => `<button class="${T.tab === k ? 'on' : ''}" style="${T.tab === k ? '' : 'border-color:#cfc5b8'}" onclick="UI.partite('${k}')">${l}</button>`).join('')}</div>${body}`;
}
function tabellaPartite(rows, cli) {
  rows = rows.slice().sort((a, b) => (cli ? a.attesa : a.datsca).localeCompare(cli ? b.attesa : b.datsca));
  return `<div class="scroll"><table><tr><th>Documento</th><th>Scadenza NTS</th>${cli ? '<th>Attesa</th>' : ''}<th>Ritardo</th><th class="num">Importo</th><th>Pagamento</th><th>Banca</th><th></th></tr>
  ${rows.map(s => { const rit = cli ? s.ritardo : giorni(s.datsca, OGGI); const d = cli ? s.attesa : s.datsca; return `<tr><td class="nowrap">${s.apertura ? '<span class="pill plain">saldo 2025</span>' : (s.numdoc ? 'ft ' + esc(String(s.numdoc)) + (s.alfdoc && s.alfdoc !== '00' ? '/' + esc(s.alfdoc) : '') + ' del ' + fmtD(s.datdoc) : '–')}${s.insolu === 'S' ? ' <span class="pill bad">insoluto</span>' : ''}${s.flant === 'S' ? ' <span class="pill plain">anticipata</span>' : ''}${s.piano ? ' <span class="pill plain">piano ' + esc(s.piano.nome) + '</span>' : ''}</td><td class="nowrap">${fmtD(s.datsca)}</td>${cli ? `<td class="nowrap ${s.attesa !== s.datsca ? 'muted' : ''}">${fmtD(s.attesa)}</td>` : ''}<td class="nowrap ${rit > 0 && d < OGGI ? (rit > 60 ? 'bad' : 'warn') : 'muted'}">${d < OGGI ? rit + ' gg' : 'tra ' + (-rit) + ' gg'}</td><td class="num ${s.importo < 0 ? 'muted' : ''}">${eur2(cli ? s.importo : -s.importo)}</td><td class="small">${esc(s.pagamento || '')}</td><td class="small">${esc(nomeBanca(s.banca) === 'Altro' ? (s.banca || '') : nomeBanca(s.banca))}</td><td class="nowrap right"><button class="btn sm ${cli ? 'primary' : ''}" onclick="UI.modal('incasso','pt:${s.chiave}')">${cli ? 'Incassato' : 'Pagato'}</button></td></tr>`; }).join('')}</table></div>`;
}

// ---------- Scadenziario ----------
function pageScadenziario() {
  const D = S.data, f = S.filtroRate;
  const tabs = [['piani', 'Per piano'], ['prossime', 'Prossimi 60 giorni'], ['conferma', 'Da confermare'], ['tutte', 'Tutte le rate']];
  let body = '';
  if (f === 'piani') {
    const ordine = ['ader', 'finanziamento', 'simest', 'fornitore', 'altro'];
    body = ordine.map(t => { const ps = D.piani.filter(p => p.tipo === t); if (!ps.length) return ''; return `<h3 style="margin:18px 0 8px">${tipoPiano[t]}</h3>` + ps.map(p => cardPiano(p)).join(''); }).join('');
  } else {
    let rs = D.rate.filter(r => r.stato_piano === 'attivo');
    if (f === 'prossime') rs = rs.filter(r => r.stato !== 'pagata' && r.stato !== 'saltata' && r.scadenza <= addDays(OGGI, 60));
    if (f === 'conferma') rs = rs.filter(r => r.stato_effettivo === 'da_confermare');
    if (f === 'tutte') rs = D.rate;
    body = `<div class="card">${tabellaRate(rs, true)}<div class="small muted" style="margin-top:8px">${rs.length} rate · totale ${eur(sum(rs, r => r.importo))}</div></div>`;
  }
  return `<div class="head"><h2>Scadenziario</h2><button class="btn primary" onclick="UI.modal('piano')">Nuovo piano</button></div>
  <div class="tabs">${tabs.map(([k, l]) => `<button class="${f === k ? 'on' : ''}" onclick="UI.filtro('${k}')">${l}</button>`).join('')}</div>${body}`;
}
function cardPiano(p) {
  const s = statoAder(p), rs = S.data.rate.filter(r => r.piano_id === p.id);
  const pagato = sum(rs.filter(r => r.stato === 'pagata'), r => r.importo), totale = sum(rs, r => r.importo);
  const stPill = (p.stato || 'attivo') === 'attivo' ? '' : `<span class="pill plain">${esc(String(p.stato).replace('_', ' '))}</span>`;
  return `<details class="piano" ${S._open === p.id ? 'open' : ''} ontoggle="UI.toggle('${p.id}',this.open)"><summary><span class="nm">${esc(p.nome)} ${stPill}<div class="small muted">${esc(p.controparte || '')}${p.descrizione ? ' · ' + esc(p.descrizione) : ''}</div></span>
    <span class="small nowrap">${s.pagate}/${s.tot} rate pagate${p.tipo === 'ader' ? ` · <b class="${s.margine <= 1 ? 'bad' : s.margine <= 3 ? 'warn' : ''}">${s.saltate} saltate</b> (soglia ${s.soglia})` : ''}${s.daConf ? ` · <span class="warn">${s.daConf} da confermare</span>` : ''}</span>
    <span class="small nowrap right">residuo <b>${eur(s.residuo)}</b> su ${eur(totale)}<div class="bar" style="width:140px"><i class="good" style="width:${totale ? 100 * pagato / totale : 0}%"></i></div></span></summary>
    <div class="body">${p.tipo === 'ader' ? `<div class="small muted" style="margin-bottom:6px">Prossima rata: ${s.prossima ? fmtD(s.prossima.scadenza) + ' · ' + eur2(s.prossima.importo) : '–'} · la decadenza scatta alla ${s.soglia}ª rata non pagata (${s.margine} di margine)</div>` : ''}
    ${tabellaRate(rs, false)}
    <div class="row" style="margin-top:10px"><span class="small muted">Capitale ${eur(p.capitale_iniziale)} · ${p.n_rate || rs.length} rate ${p.cadenza_mesi === 1 ? 'mensili' : p.cadenza_mesi === 6 ? 'semestrali' : 'ogni ' + p.cadenza_mesi + ' mesi'} da ${eur2(p.rata)}${p.rata1 ? ' (prima ' + eur2(p.rata1) + ')' : ''} · dal ${fmtD(p.prima_rata)}</span>
    <span style="margin-left:auto"><select class="btn sm" onchange="UI.statoPiano('${p.id}',this.value)">${['attivo', 'in_istruttoria', 'in_istanza', 'chiuso', 'decaduto'].map(x => `<option value="${x}" ${p.stato === x ? 'selected' : ''}>${x.replace('_', ' ')}</option>`).join('')}</select> <button class="btn sm" onclick="UI.modal('rata','${p.id}')">Aggiungi rata</button></span></div></div></details>`;
}
function tabellaRate(rs, conPiano) {
  if (!rs.length) return '<div class="muted">Nessuna rata.</div>';
  return `<div class="scroll"><table><tr>${conPiano ? '<th>Piano</th>' : ''}<th>N.</th><th>Scadenza</th><th class="num">Importo</th><th>Stato</th><th>Pagata il</th><th>Segnata da</th><th></th></tr>
  ${rs.map(r => `<tr>${conPiano ? `<td>${esc(r.nome)}<div class="small muted">${esc(r.controparte || '')}</div></td>` : ''}<td>${r.n}${r.n_rate ? '/' + r.n_rate : ''}</td><td class="nowrap ${r.stato_effettivo === 'da_confermare' ? 'warn' : ''}">${fmtD(r.scadenza)}</td><td class="num">${eur2(r.importo)}</td><td>${pillStato(r.stato_effettivo)}</td><td class="nowrap">${r.data_pagamento ? fmtD(r.data_pagamento) : ''}${r.banca ? ' <span class="small muted">' + esc(r.banca) + '</span>' : ''}</td><td class="small muted nowrap">${r.marcata_da ? esc(r.marcata_da) + ' · ' + fmtD(r.marcata_il) : ''}${r.nota ? '<div>' + esc(r.nota) + '</div>' : ''}</td>
  <td class="nowrap right">${r.stato === 'pagata' ? `<button class="btn sm ghost" onclick="UI.setRata('${r.id}','futura')" title="Torna a non pagata">annulla</button>` : r.stato === 'saltata' ? `<button class="btn sm" onclick="UI.modal('pagata','${r.id}')">pagata</button> <button class="btn sm ghost" onclick="UI.setRata('${r.id}','futura')">annulla</button>` : `<button class="btn sm primary" onclick="UI.modal('pagata','${r.id}')">pagata</button> <button class="btn sm" onclick="UI.setRata('${r.id}','saltata')">saltata</button>`}</td></tr>`).join('')}</table></div>`;
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
  const tab = `<div class="scroll"><table>
    <tr><th>Voce</th>${T.map((t, i) => `<th class="num">${t}<div class="small" style="font-weight:400">${X.mesiTrim[i] ? X.mesiTrim[i] + (X.mesiTrim[i] === 1 ? ' mese' : ' mesi') : '–'}</div></th>`).join('')}<th class="num">Anno</th><th class="num">% ricavi</th></tr>
    ${sez('Ricavi')}${vociDi('RICAVI')}${riga('<b>Ricavi</b>', X.ric, 'tot', '100%')}
    ${sez('Costi variabili')}${vociDi('COSTI_VARIABILI')}${riga('Costi variabili', X.varc, 'tot', pct(sum(X.varc), ricTot))}
    ${riga('<b>Margine di contribuzione</b>', X.mdc, 'tot', pct(sum(X.mdc), ricTot))}
    ${sez('Costi fissi')}${vociDi('COSTI_FISSI')}${riga('Costi fissi', X.fis, 'tot', pct(sum(X.fis), ricTot))}
    ${riga('<b>EBITDA</b>', X.ebitda, 'tot', pct(sum(X.ebitda), ricTot))}
    ${sez('Sotto l\'EBITDA')}${vociDi('FUORI_EBITDA')}${X.ammStima ? riga('Ammortamenti · stima (quota annua ' + eur(S.data.P.ammortamenti_annui) + ' ÷ 12 × mesi registrati)', X.ammStima, 'stima') : ''}
    ${riga('<b>Risultato' + (X.ammStima ? ' (con ammortamenti stimati)' : '') + '</b>', X.ris, 'tot', pct(sum(X.ris), ricTot))}
  </table></div>`;
  const conf = anni.length > 1 ? `<div class="card" style="margin-top:14px"><h3>Confronto per anno</h3><div class="scroll"><table><tr><th>Anno</th><th class="num">Mesi</th><th class="num">Ricavi</th><th class="num">Costi variabili</th><th class="num">Margine</th><th class="num">Costi fissi</th><th class="num">EBITDA</th><th class="num">EBITDA %</th><th class="num">Risultato</th></tr>${anni.slice(0, 3).map(a => { const Y = ceAnno(a); return `<tr><td><b>${a}</b></td><td class="num">${Y.mesi.length}</td><td class="num">${eur(sum(Y.ric))}</td><td class="num">${eur(sum(Y.varc))}</td><td class="num">${eur(sum(Y.mdc))}</td><td class="num">${eur(sum(Y.fis))}</td><td class="num">${eur(sum(Y.ebitda))}</td><td class="num">${pct(sum(Y.ebitda), sum(Y.ric))}</td><td class="num">${eur(sum(Y.ris))}</td></tr>`; }).join('')}</table></div></div>` : `<div class="small muted" style="margin-top:10px">Il confronto con gli anni precedenti compare quando saranno caricati: la contabilità 2024 e 2025 è nel vecchio gestionale (Team System) e non in NTS.</div>`;
  return `<div class="head"><h2>Conto economico trimestrale</h2><span><select class="btn" onchange="UI.anno(this.value)">${anni.map(a => `<option value="${a}" ${a === S.annoCE ? 'selected' : ''}>${a}</option>`).join('')}</select></span></div>
  <div class="alert">Valori <b>come registrati in prima nota</b> (ricavi e costi di competenza, IVA esclusa), registrazioni fino al ${fmtD(S.data.stato.ultima_registrazione)}. Non includono ancora: stipendi e contributi del mese in corso (≈ ${eur(S.data.P.costo_personale_mese)} al mese), accantonamento TFR, variazione delle rimanenze (inventario di fine luglio e fine dicembre), ratei di fine anno. I consumi reali si leggono solo dopo l'inventario: storicamente valgono circa ${S.data.P.consumi_pct_storica || 43}% dei ricavi.</div>
  <div class="card">${tab}</div>${conf}`;
}

// ---------- Banche e PFN ----------
function pageBanche() {
  const D = S.data, pos = posizione();
  const conti = [...D.banche].sort((a, b) => nomeBanca(a.descrizione).localeCompare(nomeBanca(b.descrizione)) || a.categoria.localeCompare(b.categoria));
  const fin = D.sp.filter(x => x.voce === 'SP.DEB_FINANZIAMENTI' && Math.abs(x.saldo) > 0.5);
  const soci = D.sp.filter(x => x.voce === 'SP.DEB_SOCI' && Math.abs(x.saldo) > 0.5);
  const pianiFin = D.piani.filter(p => (p.tipo === 'finanziamento' || p.tipo === 'simest') && p.stato === 'attivo').map(p => ({ p, s: statoAder(p) }));
  const banche = [...new Set(conti.map(c => nomeBanca(c.descrizione)))].filter(b => b !== 'Cassa contanti' && b !== 'Altro');
  const stima = (D.stimaBanca || []).slice().sort((a, b) => (a.banca || '').localeCompare(b.banca || ''));
  return `<div class="head"><h2>Banche e posizione finanziaria</h2><span class="small muted">saldi contabili al ${fmtD(D.stato.ultima_registrazione)}</span></div>
  <div class="grid">
    <div class="card"><h3>Liquidità: contabile e stimata</h3><div class="kpi">${eur(pos.stima)}</div><table><tr><td>Liquidità contabile (c/c attivi, SBF, accantonamenti, cassa, carte)</td><td class="num">${eur(pos.liquidita)}</td></tr><tr><td>Movimenti bancari importati in NTS dopo l'ultima registrazione (fino al ${fmtD(pos.ultimoMov)})</td><td class="num">${pos.deltaBanca >= 0 ? '+' : '−'} ${eur(Math.abs(pos.deltaBanca))}</td></tr><tr><td>Incassi e pagamenti segnati in Fiammetta dopo l'ultimo movimento importato (${pos.nIn} + ${pos.nOut})</td><td class="num">${pos.deltaApp >= 0 ? '+' : '−'} ${eur(Math.abs(pos.deltaApp))}</td></tr><tr class="tot"><td>Liquidità stimata al ${fmtD(pos.dataStima)}</td><td class="num">${eur(pos.stima)}</td></tr></table>
      ${stima.length ? `<div class="scroll" style="margin-top:8px"><table><tr><th>Banca</th><th>Registrazioni fino al</th><th>Movimenti fino al</th><th class="num">Accrediti dopo</th><th class="num">Addebiti dopo</th><th class="num">Non registrati</th></tr>${stima.map(b => `<tr><td>${esc(nomeBanca(b.banca))} <span class="small muted">${esc(b.sottoconto_descr || '')}</span></td><td class="nowrap">${fmtD(b.ultima_registrazione)}</td><td class="nowrap ${b.ultimo_movimento && giorni(b.ultimo_movimento, OGGI) > 3 ? 'warn' : ''}">${fmtD(b.ultimo_movimento)}</td><td class="num good">${eur(b.accrediti_dopo)}</td><td class="num bad">${eur(b.addebiti_dopo)}</td><td class="num muted">${b.movimenti_non_registrati}</td></tr>`).join('')}</table></div>` : ''}
      <div class="small muted" style="margin-top:6px">La stima vale quanto l'ultimo import dei movimenti bancari in NTS: se la data «movimenti fino al» è vecchia, la liquidità reale va presa dal portale.</div></div>
    <div class="card"><h3>PFN bancaria</h3><div class="kpi">${eur(pos.pfn)}</div><table><tr><td>Finanziamenti e mutui</td><td class="num">${eur(pos.fin)}</td></tr><tr><td>Anticipi su fatture (castelletto)</td><td class="num">${eur(pos.anticipi)}</td></tr><tr><td>Scoperti di conto corrente</td><td class="num">${eur(pos.scoperti)}</td></tr><tr><td>− Liquidità contabile</td><td class="num">− ${eur(pos.liquidita)}</td></tr><tr class="tot"><td>PFN bancaria</td><td class="num">${eur(pos.pfn)}</td></tr><tr><td>Finanziamento soci</td><td class="num">${eur(pos.soci)}</td></tr><tr class="tot"><td>PFN totale</td><td class="num">${eur(pos.pfnTot)}</td></tr></table></div>
    <div class="card"><h3>Finanziamenti: contabilità e piani</h3><table><tr><th>Conto / piano</th><th class="num">Debito contabile</th><th class="num">Residuo da piano</th></tr>${fin.map(x => `<tr><td>${esc(x.descrizione)}</td><td class="num">${eur(-x.saldo)}</td><td class="num muted"></td></tr>`).join('')}${pianiFin.map(({ p, s }) => `<tr class="sub"><td>↳ ${esc(p.nome)}</td><td class="num"></td><td class="num">${eur(s.residuo)}</td></tr>`).join('')}<tr class="tot"><td>Totale</td><td class="num">${eur(pos.fin)}</td><td class="num">${eur(sum(pianiFin, x => x.s.residuo))}</td></tr>${soci.map(x => `<tr><td>${esc(x.descrizione)}</td><td class="num">${eur(-x.saldo)}</td><td></td></tr>`).join('')}</table><div class="small muted" style="margin-top:6px">Il residuo da piano somma le rate non ancora pagate (capitale + interessi); il debito contabile è il solo capitale. Le differenze grandi vanno chieste a Michela.</div></div>
    <div class="card wide"><h3>Conti bancari e cassa (saldi contabili)</h3><div class="scroll"><table><tr><th>Banca</th><th>Conto</th><th>Tipo</th><th class="num">Saldo</th></tr>${conti.map(c => `<tr><td>${esc(nomeBanca(c.descrizione))}</td><td>${esc(c.descrizione)}</td><td><span class="pill plain">${tipoBanca[c.categoria] || c.categoria}</span></td><td class="num ${c.saldo < -0.5 ? 'bad' : c.saldo > 0.5 ? 'good' : 'muted'}">${eur2(c.saldo)}</td></tr>`).join('')}</table></div><div class="small muted" style="margin-top:6px">Segno contabile: positivo = disponibilità, negativo = debito verso la banca. I movimenti bancari importati in NTS non coprono tutte le banche: i saldi reali si confrontano con il portale.</div></div>
    <div class="card wide"><h3>Saldi dal portale banca (inserimento manuale)</h3>
      <form class="row" onsubmit="event.preventDefault();UI.salvaSaldo(this)">
        <div class="field"><label>Data</label><input name="data" type="date" value="${OGGI}" required></div>
        <div class="field"><label>Banca</label><select name="banca">${banche.map(b => `<option>${esc(b)}</option>`).join('')}<option>Altra</option></select></div>
        <div class="field"><label>Saldo c/c</label><input name="saldo_cc" inputmode="decimal" placeholder="es. -12.500,00"></div>
        <div class="field"><label>Anticipi utilizzati</label><input name="anticipi_utilizzati" inputmode="decimal"></div>
        <div class="field"><label>Accordato anticipi</label><input name="accordato_anticipi" inputmode="decimal"></div>
        <div class="field"><label>Fido c/c</label><input name="fido_cc" inputmode="decimal"></div>
        <div class="field" style="flex:2 1 200px"><label>Note</label><input name="note"></div>
        <div class="field" style="flex:0 0 auto"><button class="btn primary">Salva</button></div></form>
      ${D.saldi.length ? `<div class="scroll"><table><tr><th>Data</th><th>Banca</th><th class="num">Saldo c/c</th><th class="num">Anticipi</th><th class="num">Accordato</th><th class="num">Fido c/c</th><th>Note</th><th>Inserito da</th><th></th></tr>${D.saldi.map(s => `<tr><td class="nowrap">${fmtD(s.data)}</td><td>${esc(s.banca)}</td><td class="num">${eur2(s.saldo_cc)}</td><td class="num">${eur2(s.anticipi_utilizzati)}</td><td class="num">${eur2(s.accordato_anticipi)}</td><td class="num">${eur2(s.fido_cc)}</td><td class="small">${esc(s.note || '')}</td><td class="small muted">${esc(s.inserito_da || '')}</td><td><button class="btn sm ghost" onclick="UI.eliminaSaldo(${s.id})">elimina</button></td></tr>`).join('')}</table></div>` : '<div class="muted small">Nessun saldo inserito. I saldi del portale servono per confrontare la contabilità con la banca e per conoscere l\'accordato degli anticipi.</div>'}</div>
  </div>`;
}

// ---------- Impostazioni ----------
function pageImpostazioni() {
  const D = S.data;
  const par = D.par.map(p => `<tr><td><b>${esc(p.chiave)}</b><div class="small muted">${esc(p.descrizione || '')}</div></td><td class="num"><input class="search" style="max-width:140px;text-align:right" value="${esc(String(p.valore))}" onchange="UI.parametro('${esc(p.chiave)}',this.value)"></td></tr>`).join('');
  const nomeCliente = conto => { const s = D.scad.find(x => x.conto === conto); return s ? s.controparte : (S.clienti && (S.clienti.find(c => c.conto === conto) || {}).descrizione) || ('conto ' + conto); };
  const regole = D.regole.map(r => `<tr><td>${esc(nomeCliente(r.conto))}<div class="small muted">conto ${r.conto}${r.note ? ' · ' + esc(r.note) : ''}</div></td><td class="nowrap"><select class="btn sm" onchange="UI.regola(${r.conto},'base',this.value)"><option value="documento" ${r.base === 'documento' ? 'selected' : ''}>data fattura</option><option value="scadenza" ${r.base === 'scadenza' ? 'selected' : ''}>scadenza NTS</option></select> + <input class="search" style="width:70px;text-align:right" value="${r.giorni}" onchange="UI.regola(${r.conto},'giorni',this.value)"> gg</td><td class="right"><button class="btn sm ghost" onclick="UI.eliminaRegola(${r.conto})">elimina</button></td></tr>`).join('');
  let mappa = '<div class="muted small">Carico la mappa…</div>';
  if (S.mappa) {
    const q = S.cercaConto.toLowerCase();
    let rows = S.mappa.conti.filter(c => (!S.soloMov || S.mappa.mov.has(c.conto)) && (!q || String(c.conto).includes(q) || (c.descrizione || '').toLowerCase().includes(q) || (S.mappa.m[c.conto] || '').toLowerCase().includes(q)));
    const nonMappati = rows.filter(c => !S.mappa.m[c.conto]); rows = [...nonMappati, ...rows.filter(c => S.mappa.m[c.conto])].slice(0, 400);
    const opts = v => `<option value="">— non classificato —</option>` + S.mappa.voci.map(x => `<option value="${x.codice}" ${v === x.codice ? 'selected' : ''}>${x.codice} · ${esc(x.descrizione)}</option>`).join('');
    mappa = `<div class="row" style="margin-bottom:8px"><input class="search" placeholder="cerca conto o descrizione" value="${esc(S.cercaConto)}" oninput="UI.cerca(this.value)"><label class="small"><input type="checkbox" ${S.soloMov ? 'checked' : ''} onchange="UI.soloMov(this.checked)"> solo conti con movimenti</label><span class="small muted">${nonMappati.length ? `<b class="warn">${nonMappati.length} da classificare</b> · ` : ''}${rows.length} conti mostrati</span></div>
    <div class="scroll" style="max-height:60vh"><table><tr><th>Conto</th><th>Descrizione</th><th class="num">Saldo</th><th>Voce di riclassificazione</th><th>Aggiornato</th></tr>${rows.map(c => `<tr><td class="nowrap">${c.conto}</td><td>${esc(c.descrizione)}<div class="small muted">mastro ${c.mastro || ''}</div></td><td class="num">${S.mappa.saldo[c.conto] != null ? eur(S.mappa.saldo[c.conto]) : ''}</td><td><select class="search" onchange="UI.mappaConto(${c.conto},this.value)">${opts(S.mappa.m[c.conto])}</select></td><td class="small muted">${esc(S.mappa.da[c.conto] || '')}</td></tr>`).join('')}</table></div>`;
  } else if (!S._mappaLoading) { S._mappaLoading = true; loadMappa().then(() => { S._mappaLoading = false; S._keepScroll = true; render(); }).catch(e => { S._mappaLoading = false; toast('Mappa non caricata: ' + e.message, 5000); }); }
  const clientiOpts = (S.clienti || []).map(c => `<option value="${c.conto}">${esc(c.descrizione)}</option>`).join('');
  return `<div class="head"><h2>Impostazioni</h2></div><div class="grid">
    <div class="card"><h3>Parametri</h3><table>${par}</table><div class="small muted" style="margin-top:6px">Numeri senza separatore delle migliaia (es. 25000). Il cambio è immediato.</div></div>
    <div class="card"><h3>Regole di incasso per cliente</h3><div class="small muted" style="margin-bottom:6px">Quando un cliente paga con un ritmo suo (es. NordicFire: circa 7 giorni dal ricevimento della merce), la data attesa dell'incasso si calcola da qui invece che dalla scadenza NTS.</div><table>${regole || '<tr><td class="muted">Nessuna regola.</td></tr>'}</table>
      <form class="row" style="margin-top:10px" onsubmit="event.preventDefault();UI.nuovaRegola(this)"><div class="field" style="flex:2 1 220px"><label>Cliente</label><input list="lista-clienti" name="cliente" placeholder="scrivi il nome e scegli" onfocus="UI.caricaClienti()"><datalist id="lista-clienti">${clientiOpts}</datalist></div><div class="field"><label>Base</label><select name="base"><option value="documento">data fattura</option><option value="scadenza">scadenza NTS</option></select></div><div class="field"><label>Giorni</label><input name="giorni" type="number" value="10" required></div><div class="field" style="flex:0 0 auto"><button class="btn">Aggiungi</button></div></form></div>
    <div class="card"><h3>Team</h3><table>${D.team.map(t => `<tr><td>${esc(t.nome)}<div class="small muted">${esc(t.email)}</div></td><td><span class="pill plain">${esc(t.ruolo)}</span> ${t.attivo ? '' : '<span class="pill bad">disattivo</span>'}</td></tr>`).join('')}</table><div class="small muted" style="margin-top:6px">Gli utenti si aggiungono in Supabase (tabella team + invito via Authentication). Versione app ${esc(C.versione || '')}.</div><button class="btn" style="margin-top:8px" onclick="UI.modal('password')">Cambia la mia password</button></div>
    <div class="card wide"><h3>Mappa dei conti → voci del conto economico e dello stato patrimoniale</h3><div class="small muted" style="margin-bottom:8px">Bozza preparata il 06/11/2026 sul piano dei conti NTS, da validare (Miriam). Cambiando la voce il conto economico si aggiorna subito; i clienti e i fornitori sono classificati automaticamente.</div>${mappa}</div>
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
  } else if (M.type === 'piano') {
    h = `<h2>Nuovo piano di pagamento</h2><form onsubmit="event.preventDefault();UI.nuovoPiano(this)">
    <div class="row"><div class="field"><label>Tipo</label><select name="tipo">${Object.entries(tipoPiano).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div><div class="field" style="flex:2"><label>Nome</label><input name="nome" required placeholder="es. Mutuo Credem auto / AR123456789"></div></div>
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
    S.view = v;
    if (v === 'scadenziario' && arg) S.filtroRate = arg;
    if (v === 'partite' && arg) { const [tab, filtro] = arg.split(':'); S.partite.tab = tab; if (filtro) S.partite.filtro = filtro; S.partite.cerca = ''; }
    try { localStorage.setItem('fiammetta-view', v); } catch (e) {} render();
  },
  partite(tab, filtro) { if (tab) { S.partite.tab = tab; S.partite.cerca = ''; } if (filtro) S.partite.filtro = filtro; render(); },
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
