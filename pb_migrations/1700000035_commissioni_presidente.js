/// <reference path="../pb_data/types.d.ts" />

// Refactor: il PRESIDENTE è attributo della COMMISSIONE, non del concorso.
// Prima: commissari.is_presidente = unico per concorso (concettualmente errato
// quando un concorso ha più commissioni — es. "Giuria Archi" e "Giuria Fiati"
// dovrebbero avere ciascuna il proprio presidente).
// Dopo: commissioni.presidente = relation a commissari (1 per commissione).
//
// Backward-compat: il vecchio campo `is_presidente` su `commissari` resta in
// schema (deprecato), ma il valore non viene più letto dalla logica fase/judge.
// Una nuova migration in futuro lo rimuoverà.
//
// Data migration: per ogni commissione esistente popoliamo `presidente` con il
// commissario che era marcato `is_presidente=true` ed è anche membro della
// commissione. Se nessun membro è marcato presidente, il campo resta vuoto e
// l'admin lo imposterà manualmente.

migrate((db) => {
  const dao = new Dao(db);
  const commissioni = dao.findCollectionByNameOrId('commissioni');
  const commissari = dao.findCollectionByNameOrId('commissari');

  if (!commissioni.schema.getFieldByName('presidente')) {
    commissioni.schema.addField(new SchemaField({
      name: 'presidente',
      type: 'relation',
      options: {
        collectionId: commissari.id,
        cascadeDelete: false,
        maxSelect: 1,
        minSelect: 0,
      },
    }));
    dao.saveCollection(commissioni);
  }

  // Data migration: best-effort.
  try {
    const allComm = dao.findRecordsByExpr('commissioni', null, null);
    for (let i = 0; i < (allComm ? allComm.length : 0); i++) {
      const c = allComm[i];
      if (c.get('presidente')) continue; // già popolato
      const memberIds = c.get('commissari') || [];
      // Trovo tra i membri quello con is_presidente=true (se esiste).
      for (let j = 0; j < memberIds.length; j++) {
        try {
          const m = dao.findRecordById('commissari', memberIds[j]);
          if (m.get('is_presidente')) {
            c.set('presidente', m.id);
            dao.saveRecord(c);
            break;
          }
        } catch (e) { /* membro orfano, skip */ }
      }
    }
  } catch (e) { /* nessuna commissione, skip */ }
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('commissioni');
  const f = c.schema.getFieldByName('presidente');
  if (f) {
    c.schema.removeField(f.id);
    dao.saveCollection(c);
  }
});
