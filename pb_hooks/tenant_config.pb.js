/// <reference path="../pb_data/types.d.ts" />

// Gating server-side dei limiti di piano sul singolo PocketBase tenant.
//
// Legge la singola riga di `tenant_config` (popolata da `apply-ente-plan.sh`)
// e applica i controlli su create di:
//   - `concorsi`  → conta i concorsi con stato != 'CONCLUSO'; blocca se >= limit_concorsi
//   - `iscrizioni`→ conta le iscrizioni dell'ANNO SOLARE corrente; blocca se >= limit_iscritti_annui
//
// Inoltre: se `piano_scadenza + grace_giorni < now`, blocca entrambe.
//
// Fail-open: se `tenant_config` è assente o vuoto, NON blocca nulla (utile in
// dev e su tenant non ancora propagati). Il piano "ppe" (limit=0 = illimitato)
// passa sempre i limiti ma resta soggetto alla scadenza (PPE non scade mai →
// piano_scadenza vuota → never blocked).

// Cache della config per ridurre il numero di query (refresh ogni 60s).
let __tc_cache = null;
let __tc_cache_at = 0;
function loadConfig() {
  const now = Date.now();
  if (__tc_cache && (now - __tc_cache_at) < 60_000) return __tc_cache;
  try {
    const items = $app.dao().findRecordsByFilter('tenant_config', '', '-created', 1, 0);
    __tc_cache = (items && items.length > 0) ? items[0] : null;
    __tc_cache_at = now;
    return __tc_cache;
  } catch (err) {
    // Collection non esiste → fail-open
    __tc_cache = null;
    __tc_cache_at = now;
    return null;
  }
}

function checkPianoActive(cfg) {
  if (!cfg) return; // fail-open
  const scad = cfg.get('piano_scadenza');
  if (!scad) return; // PPE o piano senza scadenza
  const grace = Number(cfg.get('grace_giorni')) || 0;
  const expMs = new Date(String(scad)).getTime();
  if (!isFinite(expMs)) return;
  const cutoff = expMs + grace * 24 * 60 * 60 * 1000;
  if (Date.now() > cutoff) {
    throw new BadRequestError('Piano scaduto il ' + new Date(expMs).toLocaleDateString('it-IT') + '. Contatta il super admin per il rinnovo.');
  }
}

// ---------- concorsi ----------
onRecordBeforeCreateRequest((e) => {
  const cfg = loadConfig();
  if (!cfg) return;
  checkPianoActive(cfg);
  const limit = Number(cfg.get('limit_concorsi')) || 0;
  if (limit === 0) return; // 0 = illimitato
  let count = 0;
  try {
    // Conta i concorsi non ancora conclusi (BOZZA/ATTIVO contano, CONCLUSO no).
    const items = $app.dao().findRecordsByFilter('concorsi', 'stato != "CONCLUSO"', '', 0, 0);
    count = items ? items.length : 0;
  } catch (err) { return; }
  if (count >= limit) {
    throw new BadRequestError(
      'Limite del piano raggiunto: ' + count + '/' + limit + ' concorsi attivi. ' +
      'Concludi un concorso esistente o passa a un piano superiore.'
    );
  }
}, 'concorsi');

// Calcola l'inizio del ciclo annuale corrente, partendo dall'anniversario
// del piano_inizio del tenant. Esempio: piano_inizio 2026-03-15
//   - now 2026-09-20 → ciclo dal 2026-03-15
//   - now 2027-04-01 → ciclo dal 2027-03-15
//   - now 2028-01-10 → ciclo dal 2027-03-15
// Fallback (piano_inizio mancante) → 1° gennaio dell'anno corrente.
function getCicloInizio(cfg, now) {
  const ts = cfg.get('piano_inizio');
  if (!ts) return new Date(now.getFullYear(), 0, 1);
  const inizio = new Date(String(ts));
  if (!isFinite(inizio.getTime())) return new Date(now.getFullYear(), 0, 1);
  const ciclo = new Date(now.getFullYear(), inizio.getMonth(), inizio.getDate(),
                         inizio.getHours(), inizio.getMinutes(), inizio.getSeconds());
  // Se l'anniversario di quest'anno è ancora nel futuro, il ciclo corrente è iniziato l'anno scorso.
  if (ciclo.getTime() > now.getTime()) ciclo.setFullYear(ciclo.getFullYear() - 1);
  return ciclo;
}

// ---------- iscrizioni ----------
onRecordBeforeCreateRequest((e) => {
  const cfg = loadConfig();
  if (!cfg) return;
  checkPianoActive(cfg);
  const limit = Number(cfg.get('limit_iscritti_annui')) || 0;
  if (limit === 0) return; // 0 = illimitato
  // Counter sul ciclo annuale dall'anniversario del piano_inizio del tenant.
  const now = new Date();
  const ciclo = getCicloInizio(cfg, now);
  const cicloStart = ciclo.toISOString();
  let count = 0;
  try {
    const items = $app.dao().findRecordsByFilter(
      'iscrizioni',
      'created >= {:y}',
      '', 0, 0,
      { y: cicloStart },
    );
    count = items ? items.length : 0;
  } catch (err) { return; }
  if (count >= limit) {
    const cicloFineMs = ciclo.getTime() + (365 * 24 * 60 * 60 * 1000);
    const cicloFine = new Date(cicloFineMs).toLocaleDateString('it-IT');
    throw new BadRequestError(
      'Limite del piano raggiunto: ' + count + '/' + limit + ' iscritti nel ciclo annuale corrente ' +
      '(dal ' + ciclo.toLocaleDateString('it-IT') + ' al ' + cicloFine + '). ' +
      'L\'ente ha esaurito la quota del piano corrente.'
    );
  }
}, 'iscrizioni');

// Invalida la cache quando il super admin propaga una nuova config.
onRecordAfterUpdateRequest((e) => {
  __tc_cache = null;
  __tc_cache_at = 0;
}, 'tenant_config');
onRecordAfterCreateRequest((e) => {
  __tc_cache = null;
  __tc_cache_at = 0;
}, 'tenant_config');

// ============================================================================
// Endpoint inter-server: POST /api/admin/apply-plan
//
// Riceve il piano dal PB platform via $http.send (vedi pb_hooks/tenants.pb.js
// sul platform). Autenticazione via header X-Gestimus-Key, validato contro
// GESTIMUS_SECRET_KEY presente nell'env del PB tenant (replicata dal platform
// al provisioning, vedi scripts/provision-tenant.sh).
//
// Non serve auth utente — la chiave fa da shared secret.
// Body atteso (JSON):
//   { piano, piano_inizio, piano_scadenza, limit_concorsi,
//     limit_iscritti_annui, ppe_setup_per_concorso, ppe_per_iscritto, grace_giorni }
// ============================================================================
routerAdd('POST', '/api/admin/apply-plan', (c) => {
  const expected = $os.getenv('GESTIMUS_SECRET_KEY') || '';
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
    const items = $app.dao().findRecordsByFilter('tenant_config', '', '-created', 1, 0);
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

    // Forza l'invalidazione cache anche se l'after-hook non scatta in tempo.
    __tc_cache = null;
    __tc_cache_at = 0;

    return c.json(200, { ok: true, id: rec.id, piano: rec.get('piano') });
  } catch (err) {
    console.error('apply-plan upsert failed:', err && err.message || err);
    return c.json(500, { error: 'apply_failed', message: String(err && err.message || err) });
  }
});
