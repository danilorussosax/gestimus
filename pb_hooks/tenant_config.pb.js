/// <reference path="../pb_data/types.d.ts" />

// Gating server-side dei limiti di piano sul singolo PocketBase tenant.
//
// Legge la singola riga di `tenant_config` (popolata dall'endpoint
// `/api/admin/apply-plan` quando il super-admin salva il piano) e applica i
// controlli su create di:
//   - `concorsi`  → conta i concorsi con stato != 'CONCLUSO'; blocca se >= limit_concorsi
//   - `iscrizioni`→ conta le PERSONE FISICHE iscritte nel CICLO ANNUALE
//                   dall'anniversario di piano_inizio (fallback: anno solare).
//                   Un'iscrizione individuale = 1 persona; un'iscrizione di
//                   gruppo = N persone (numero di membri in gruppo_membri,
//                   con minimo 1). La stessa persona presente sia in un gruppo
//                   che come singolo viene contata più volte: ogni iscrizione
//                   genera quote/pagamento autonomi.
//
// Inoltre: se `piano_scadenza + grace_giorni < now`, blocca entrambe.
//
// IMPORTANTE: in PocketBase Goja le variabili e funzioni top-level NON sono nello
// scope delle callback hook (e neanche dei route handler). Tutta la logica DEVE
// essere inline in ogni callback. Niente cache in-memory: ogni invocazione fa un
// SELECT su `tenant_config` (singleton, costo SQLite ~1ms).

// ============================================================================
// concorsi: blocca create se piano scaduto o limit_concorsi raggiunto
// ============================================================================
onRecordBeforeCreateRequest((e) => {
  try {
    let cfg;
    try {
      const items = $app.dao().findRecordsByFilter('tenant_config', 'id != ""', '-created', 1, 0);
      cfg = (items && items.length > 0) ? items[0] : null;
    } catch (err) { return; } // collection non esiste → fail-open
    if (!cfg) return;

    // Piano scaduto?
    const scad = cfg.get('piano_scadenza');
    if (scad) {
      const grace = Number(cfg.get('grace_giorni')) || 0;
      const expMs = new Date(String(scad)).getTime();
      if (isFinite(expMs)) {
        const cutoff = expMs + grace * 24 * 60 * 60 * 1000;
        if (Date.now() > cutoff) {
          throw new BadRequestError('Piano scaduto il ' + new Date(expMs).toLocaleDateString('it-IT') + '. Contatta il super admin per il rinnovo.');
        }
      }
    }

    // Limit concorsi?
    const limit = Number(cfg.get('limit_concorsi')) || 0;
    if (limit === 0) return; // 0 = illimitato
    let count = 0;
    try {
      const items = $app.dao().findRecordsByFilter('concorsi', 'stato != "CONCLUSO"', '', 0, 0);
      count = items ? items.length : 0;
    } catch (err) { return; }
    if (count >= limit) {
      throw new BadRequestError(
        'Limite del piano raggiunto: ' + count + '/' + limit + ' concorsi attivi. ' +
        'Concludi un concorso esistente o passa a un piano superiore.'
      );
    }
  } catch (err) {
    // Rilancio solo le BadRequestError, le altre vengono loggate ma non bloccano
    if (err && err.message && err.message.indexOf('Limite') === 0) throw err;
    if (err && err.message && err.message.indexOf('Piano scaduto') === 0) throw err;
    console.warn('concorsi gating hook error:', err && err.message || err);
  }
}, 'concorsi');

// ============================================================================
// iscrizioni: blocca create se piano scaduto o limit_iscritti_annui raggiunto
// nel ciclo annuale dall'anniversario di piano_inizio.
// ============================================================================
onRecordBeforeCreateRequest((e) => {
  try {
    let cfg;
    try {
      const items = $app.dao().findRecordsByFilter('tenant_config', 'id != ""', '-created', 1, 0);
      cfg = (items && items.length > 0) ? items[0] : null;
    } catch (err) { return; }
    if (!cfg) return;

    // Piano scaduto?
    const scad = cfg.get('piano_scadenza');
    if (scad) {
      const grace = Number(cfg.get('grace_giorni')) || 0;
      const expMs = new Date(String(scad)).getTime();
      if (isFinite(expMs)) {
        const cutoff = expMs + grace * 24 * 60 * 60 * 1000;
        if (Date.now() > cutoff) {
          throw new BadRequestError('Piano scaduto il ' + new Date(expMs).toLocaleDateString('it-IT') + '. Contatta il super admin per il rinnovo.');
        }
      }
    }

    // Limit iscritti annui?
    const limit = Number(cfg.get('limit_iscritti_annui')) || 0;
    if (limit === 0) return;

    // Calcola inizio ciclo annuale dall'anniversario di piano_inizio.
    const now = new Date();
    const inizioRaw = cfg.get('piano_inizio');
    let ciclo;
    if (inizioRaw) {
      const inizio = new Date(String(inizioRaw));
      if (isFinite(inizio.getTime())) {
        ciclo = new Date(now.getFullYear(), inizio.getMonth(), inizio.getDate(),
                         inizio.getHours(), inizio.getMinutes(), inizio.getSeconds());
        if (ciclo.getTime() > now.getTime()) ciclo.setFullYear(ciclo.getFullYear() - 1);
      } else {
        ciclo = new Date(now.getFullYear(), 0, 1);
      }
    } else {
      ciclo = new Date(now.getFullYear(), 0, 1);
    }
    const cicloStart = ciclo.toISOString();

    // Conta "per testa": per ogni iscrizione, individuale = 1; gruppo = numero
    // di membri valorizzati in gruppo_membri (minimo 1, anche se l'array è
    // vuoto o mal-formato, per non perdere il pagamento già ricevuto).
    const countTeste = (rec) => {
      const tipo = String(rec.get('tipo') || '').toLowerCase();
      if (tipo !== 'gruppo') return 1;
      let membri = rec.get('gruppo_membri');
      if (!membri) return 1;
      if (typeof membri === 'string') {
        try { membri = JSON.parse(membri); } catch (_) { return 1; }
      }
      if (!Array.isArray(membri)) return 1;
      const validi = membri.filter((m) => m && (m.nome || m.cognome));
      return Math.max(1, validi.length);
    };

    let counted = 0;
    try {
      const items = $app.dao().findRecordsByFilter(
        'iscrizioni',
        'created >= {:y}',
        '', 0, 0,
        { y: cicloStart },
      );
      if (items) for (let i = 0; i < items.length; i++) counted += countTeste(items[i]);
    } catch (err) { return; }

    const incoming = countTeste(e.record);
    if (counted + incoming > limit) {
      const cicloFineMs = ciclo.getTime() + (365 * 24 * 60 * 60 * 1000);
      const cicloFine = new Date(cicloFineMs).toLocaleDateString('it-IT');
      const dettaglio = incoming > 1
        ? ' L\'iscrizione di un gruppo da ' + incoming + ' persone supererebbe il limite.'
        : '';
      throw new BadRequestError(
        'Limite del piano raggiunto: ' + counted + '/' + limit + ' iscritti (persone fisiche) ' +
        'nel ciclo annuale corrente (dal ' + ciclo.toLocaleDateString('it-IT') + ' al ' + cicloFine + ').' +
        dettaglio + ' L\'ente ha esaurito la quota del piano corrente.'
      );
    }
  } catch (err) {
    if (err && err.message && err.message.indexOf('Limite') === 0) throw err;
    if (err && err.message && err.message.indexOf('Piano scaduto') === 0) throw err;
    console.warn('iscrizioni gating hook error:', err && err.message || err);
  }
}, 'iscrizioni');

// ============================================================================
// Endpoint inter-server: POST /api/admin/apply-plan
//
// Riceve il piano dal PB platform via $http.send. Autenticazione via header
// X-Gestimus-Key, validato contro GESTIMUS_SECRET_KEY dell'env del PB tenant.
// Fa upsert sulla riga singleton di `tenant_config`.
// ============================================================================
routerAdd('POST', '/api/admin/apply-plan', (c) => {
  const expected = ($os.getenv('GESTIMUS_SECRET_KEY') || '').toString();
  if (!expected) return c.json(500, { error: 'tenant_key_missing', message: 'GESTIMUS_SECRET_KEY non impostata sul tenant' });
  const provided = c.request().header.get('X-Gestimus-Key') || '';
  if (!provided || provided !== expected) {
    return c.json(403, { error: 'forbidden' });
  }

  let body = {};
  try { body = $apis.requestInfo(c).data || {}; } catch (err) {
    return c.json(400, { error: 'invalid_body' });
  }

  try {
    const items = $app.dao().findRecordsByFilter('tenant_config', 'id != ""', '-created', 1, 0);
    const col = $app.dao().findCollectionByNameOrId('tenant_config');
    let rec;
    if (items && items.length > 0) {
      rec = items[0];
    } else {
      rec = new Record(col);
    }
    rec.set('piano',                  body.piano || 'trial');
    rec.set('piano_inizio',           body.piano_inizio || '');
    rec.set('piano_scadenza',         body.piano_scadenza || '');
    rec.set('limit_concorsi',         Number(body.limit_concorsi) || 0);
    rec.set('limit_iscritti_annui',   Number(body.limit_iscritti_annui) || 0);
    rec.set('ppe_setup_per_concorso', Number(body.ppe_setup_per_concorso) || 0);
    rec.set('ppe_per_iscritto',       Number(body.ppe_per_iscritto) || 0);
    rec.set('grace_giorni',           Number(body.grace_giorni) || 0);
    rec.set('applied_at',             new Date().toISOString());
    $app.dao().saveRecord(rec);
    return c.json(200, { ok: true, id: rec.id, piano: rec.get('piano') });
  } catch (err) {
    console.error('apply-plan upsert failed:', err && err.message || err);
    return c.json(500, { error: 'apply_failed', message: String(err && err.message || err) });
  }
});
