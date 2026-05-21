/// <reference path="../pb_data/types.d.ts" />

// Aggiunge al `concorsi` due campi per gestire l'apertura/chiusura delle iscrizioni
// auto-service da frontend pubblico:
//   - iscrizioni_aperte (bool): se true, il form pubblico /#/iscrizione accetta nuove iscrizioni
//   - iscrizioni_chiusura (date): data/ora limite oltre cui le iscrizioni si chiudono automaticamente
//     (verificata server-side via filtro nel form pubblico)
//
// Regola operativa nel frontend pubblico:
//   un concorso è "aperto alle iscrizioni" se:
//     stato = 'ATTIVO' AND iscrizioni_aperte = true AND
//     (iscrizioni_chiusura IS NULL OR iscrizioni_chiusura > NOW())

migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('concorsi');
  if (!c.schema.getFieldByName('iscrizioni_aperte')) {
    c.schema.addField(new SchemaField({
      name: 'iscrizioni_aperte',
      type: 'bool',
      options: {},
    }));
  }
  if (!c.schema.getFieldByName('iscrizioni_chiusura')) {
    c.schema.addField(new SchemaField({
      name: 'iscrizioni_chiusura',
      type: 'date',
      options: {},
    }));
  }
  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('concorsi');
  for (const name of ['iscrizioni_aperte', 'iscrizioni_chiusura']) {
    const f = c.schema.getFieldByName(name);
    if (f) c.schema.removeField(f.id);
  }
  dao.saveCollection(c);
});
