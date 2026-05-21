/// <reference path="../pb_data/types.d.ts" />

// Collection pubblica con solo i campi di branding necessari pre-login:
//   nome, logo, colore_primario, colore_secondario.
// I dati sensibili (email/telefono/indirizzo) restano nella collection `enti` privata.
// Il frontend è responsabile di tenere il record sincronizzato con `enti` quando
// l'admin modifica il branding (vedi db.saveEnte()).

migrate((db) => {
  const dao = new Dao(db);

  const c = new Collection({
    name: 'enti_public',
    type: 'base',
    listRule: '',
    viewRule: '',
    createRule: '@request.auth.role = "admin" || @request.auth.role = "superadmin"',
    updateRule: '@request.auth.role = "admin" || @request.auth.role = "superadmin"',
    deleteRule: '@request.auth.role = "admin" || @request.auth.role = "superadmin"',
    schema: [
      new SchemaField({ name: 'nome',              type: 'text', required: true, options: { max: 255 } }),
      new SchemaField({ name: 'logo',              type: 'file', options: { maxSelect: 1, maxSize: 5242880, mimeTypes: ['image/png','image/jpeg','image/webp','image/svg+xml'] } }),
      new SchemaField({ name: 'colore_primario',   type: 'text', options: { max: 7 } }),
      new SchemaField({ name: 'colore_secondario', type: 'text', options: { max: 7 } }),
    ],
  });
  dao.saveCollection(c);

  // Best-effort: se esiste già un record `enti`, popola subito `enti_public` coi campi
  // di branding così la prima visita pre-login mostra il tenant correttamente.
  try {
    const enti = dao.findCollectionByNameOrId('enti');
    const records = dao.findRecordsByExpr('enti', null, null);
    if (records && records.length > 0) {
      const source = records[0];
      const dest = new Record(c);
      dest.set('nome', source.getString('nome'));
      dest.set('colore_primario', source.getString('colore_primario'));
      dest.set('colore_secondario', source.getString('colore_secondario'));
      // Logo: PB non permette copia diretta del file via DAO senza filesystem access dentro la migration.
      // L'admin dovrà ri-salvare il branding dalla UI per uploadare il logo in enti_public.
      dao.saveRecord(dest);
    }
  } catch (e) { /* nessun ente preesistente, skip */ }
}, (db) => {
  const dao = new Dao(db);
  try {
    dao.deleteCollection(dao.findCollectionByNameOrId('enti_public'));
  } catch (e) { /* ignore */ }
});
