/// <reference path="../pb_data/types.d.ts" />

// Refactor: i commissari diventano un'ANAGRAFICA per tenant, non più legati a un
// singolo concorso. Lo stesso commissario fisico può essere assegnato a più
// concorsi (es. edizione 2026, 2027, 2028 di un concorso ricorrente) senza
// duplicazione di record.
//
// Schema:
//   - commissari.concorsi  (relation multi → concorsi, optional, maxSelect 99,
//                          cascadeDelete: false). Vuoto = solo in archivio.
//   - commissari.concorso  (legacy, relation singola): viene LASCIATO in schema
//                          (deprecato, non più letto da js/db.js). Una migration
//                          futura potrà rimuoverlo dopo periodo di stabilizzazione.
//
// Data migration:
//   1. Raggruppa i commissari esistenti per fingerprint:
//        - email (lowercase, trimmed) se presente
//        - altrimenti nome+cognome+specialita normalizzati (NFD, lowercase,
//          stripped diacritics, no punctuation)
//   2. Per ogni gruppo con >1 record:
//        - Sceglie il "canonical" = record con più campi compilati (score basato
//          su foto/cv/bio/email/telefono/data_nascita)
//        - Popola canonical.concorsi = union(record.concorso for record in group)
//        - Per ogni record non-canonical:
//            • Riassegna accounts.commissario → canonical.id
//            • Riassegna valutazioni.commissario → canonical.id
//            • Sostituisce duplicato → canonical in commissioni.commissari (multi)
//            • Sostituisce duplicato → canonical in commissioni.presidente
//            • Sostituisce duplicato → canonical in fasi.commissari_ids (JSON)
//            • Elimina il duplicato
//   3. Per i gruppi con 1 solo record: copia concorso → concorsi[concorso] (se
//      concorso non vuoto), altrimenti lascia concorsi vuoto.
//
// Best-effort: la migration logga ogni errore singolo ma non blocca il flusso.

migrate((db) => {
  const dao = new Dao(db);
  const commissari = dao.findCollectionByNameOrId('commissari');
  const concorsi   = dao.findCollectionByNameOrId('concorsi');

  // ---- 1. Schema: aggiungi field `concorsi` se non esiste ----
  if (!commissari.schema.getFieldByName('concorsi')) {
    commissari.schema.addField(new SchemaField({
      name: 'concorsi',
      type: 'relation',
      options: {
        collectionId: concorsi.id,
        cascadeDelete: false,
        maxSelect: 99,
        minSelect: 0,
      },
    }));
    dao.saveCollection(commissari);
  }

  // ---- 2. Data migration ----
  const allCom = dao.findRecordsByExpr('commissari', null, null) || [];

  // Normalizzatore inline (Goja non condivide funzioni tra hook ma qui siamo in
  // migration, scope unico → funzione locale OK)
  function normKey(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
  function fingerprint(rec) {
    const email = String(rec.get('email') || '').toLowerCase().trim();
    if (email) return 'e:' + email;
    return 'n:' + normKey(rec.get('nome')) + '|' + normKey(rec.get('cognome')) + '|' + normKey(rec.get('specialita'));
  }
  function score(rec) {
    return (rec.get('foto') ? 1 : 0)
         + (rec.get('cv') ? 1 : 0)
         + (rec.get('bio') ? 1 : 0)
         + (rec.get('email') ? 1 : 0)
         + (rec.get('telefono') ? 1 : 0)
         + (rec.get('data_nascita') ? 1 : 0);
  }

  // Raggruppa per fingerprint
  const groups = {};
  for (let i = 0; i < allCom.length; i++) {
    const r = allCom[i];
    const key = fingerprint(r);
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }

  // Per ogni gruppo: scegli canonical, accorpa concorsi, riassegna referenze
  const keys = Object.keys(groups);
  for (let i = 0; i < keys.length; i++) {
    const recs = groups[keys[i]];
    // Sort discendente per score: il primo è il canonical
    recs.sort(function (a, b) { return score(b) - score(a); });
    const canonical = recs[0];
    const duplicates = recs.slice(1);

    // Accorpa concorsi
    const concorsiSet = {};
    for (let j = 0; j < recs.length; j++) {
      const cId = recs[j].get('concorso');
      if (cId) concorsiSet[cId] = true;
    }
    const concorsiArr = Object.keys(concorsiSet);
    try {
      canonical.set('concorsi', concorsiArr);
      dao.saveRecord(canonical);
    } catch (e) {
      console.log('migration 042: failed to set concorsi on ' + canonical.id + ': ' + e);
    }

    if (duplicates.length === 0) continue;

    // Riassegna riferimenti per ogni duplicato
    for (let d = 0; d < duplicates.length; d++) {
      const dup = duplicates[d];
      const dupId = dup.id;

      // accounts.commissario → canonical
      try {
        const accs = dao.findRecordsByExpr(
          'accounts',
          $dbx.exp('commissario = {:id}', { id: dupId }),
          null
        ) || [];
        for (let a = 0; a < accs.length; a++) {
          accs[a].set('commissario', canonical.id);
          dao.saveRecord(accs[a]);
        }
      } catch (e) { console.log('migration 042 (accounts): ' + e); }

      // valutazioni.commissario → canonical
      try {
        const vals = dao.findRecordsByExpr(
          'valutazioni',
          $dbx.exp('commissario = {:id}', { id: dupId }),
          null
        ) || [];
        for (let v = 0; v < vals.length; v++) {
          vals[v].set('commissario', canonical.id);
          dao.saveRecord(vals[v]);
        }
      } catch (e) { console.log('migration 042 (valutazioni): ' + e); }

      // commissioni.commissari (multi) e commissioni.presidente (single)
      try {
        const comms = dao.findRecordsByExpr('commissioni', null, null) || [];
        for (let c = 0; c < comms.length; c++) {
          const com = comms[c];
          let changed = false;
          const members = com.get('commissari') || [];
          if (Array.isArray(members) && members.indexOf(dupId) >= 0) {
            const out = [];
            const seen = {};
            for (let m = 0; m < members.length; m++) {
              const id = members[m] === dupId ? canonical.id : members[m];
              if (!seen[id]) { seen[id] = true; out.push(id); }
            }
            com.set('commissari', out);
            changed = true;
          }
          if (com.get('presidente') === dupId) {
            com.set('presidente', canonical.id);
            changed = true;
          }
          if (changed) dao.saveRecord(com);
        }
      } catch (e) { console.log('migration 042 (commissioni): ' + e); }

      // fasi.commissari_ids (JSON array)
      try {
        const fasi = dao.findRecordsByExpr('fasi', null, null) || [];
        for (let f = 0; f < fasi.length; f++) {
          const fase = fasi[f];
          const ids = fase.get('commissari_ids');
          if (Array.isArray(ids) && ids.indexOf(dupId) >= 0) {
            const out = [];
            const seen = {};
            for (let k = 0; k < ids.length; k++) {
              const id = ids[k] === dupId ? canonical.id : ids[k];
              if (!seen[id]) { seen[id] = true; out.push(id); }
            }
            fase.set('commissari_ids', out);
            dao.saveRecord(fase);
          }
        }
      } catch (e) { console.log('migration 042 (fasi): ' + e); }

      // Elimina il duplicato
      try { dao.deleteRecord(dup); }
      catch (e) { console.log('migration 042 (delete dup ' + dupId + '): ' + e); }
    }
  }
}, (db) => {
  // Down: rimuove solo il field `concorsi` dallo schema.
  // I duplicati eliminati NON possono essere ripristinati (data loss accettato).
  const dao = new Dao(db);
  try {
    const commissari = dao.findCollectionByNameOrId('commissari');
    const f = commissari.schema.getFieldByName('concorsi');
    if (f) {
      commissari.schema.removeField(f.id);
      dao.saveCollection(commissari);
    }
  } catch (e) { /* skip */ }
});
