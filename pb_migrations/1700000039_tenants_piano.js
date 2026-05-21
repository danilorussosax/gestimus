/// <reference path="../pb_data/types.d.ts" />

// Aggiunge i campi di gestione "piano" alla collection `tenants` sul PB platform.
//
// Modello: il super admin assegna un piano (trial/starter/pro/ultra/ppe) durante
// la creazione/modifica dell'ente. Il piano determina i limiti (concorsi, iscritti
// annui) e la modalità di fatturazione (annuale o pay-per-event).
//
// I limiti sono SALVATI sul record tenant come campi separati (`limit_concorsi`,
// `limit_iscritti_annui`) per permettere override case-by-case (es. ente strategico
// che ha Pro ma con concorsi illimitati). Il valore di default lo imposta la UI
// (`js/piani.js`).
//
// Piani disponibili:
//   - trial   : 30 giorni, 1 concorso, 5 iscritti, gratis
//   - starter : 1 anno, 2 concorsi, 100 iscritti, €150
//   - pro     : 1 anno, 3 concorsi, 500 iscritti, €230
//   - ultra   : 1 anno, 10 concorsi, 2000 iscritti, €350
//   - ppe     : pay-per-event (€50 setup/concorso + €0,50/iscritto), nessun limite

migrate((db) => {
  const dao = new Dao(db);
  const tenants = dao.findCollectionByNameOrId('tenants');

  const addIfMissing = (name, type, options) => {
    if (!tenants.schema.getFieldByName(name)) {
      tenants.schema.addField(new SchemaField({ name, type, options: options || {} }));
    }
  };

  addIfMissing('piano',                 'select', { maxSelect: 1, values: ['trial', 'starter', 'pro', 'ultra', 'ppe'] });
  addIfMissing('piano_inizio',          'date',   {});
  addIfMissing('piano_scadenza',        'date',   {});
  addIfMissing('limit_concorsi',        'number', { min: 0, noDecimal: true });
  addIfMissing('limit_iscritti_annui',  'number', { min: 0, noDecimal: true });
  addIfMissing('ppe_setup_per_concorso','number', { min: 0, noDecimal: false });
  addIfMissing('ppe_per_iscritto',      'number', { min: 0, noDecimal: false });
  addIfMissing('piano_note',            'text',   { max: 2000 });

  dao.saveCollection(tenants);
}, (db) => {
  const dao = new Dao(db);
  try {
    const tenants = dao.findCollectionByNameOrId('tenants');
    for (const name of [
      'piano', 'piano_inizio', 'piano_scadenza',
      'limit_concorsi', 'limit_iscritti_annui',
      'ppe_setup_per_concorso', 'ppe_per_iscritto', 'piano_note',
    ]) {
      const f = tenants.schema.getFieldByName(name);
      if (f) tenants.schema.removeField(f.id);
    }
    dao.saveCollection(tenants);
  } catch (e) { /* ignore */ }
});
