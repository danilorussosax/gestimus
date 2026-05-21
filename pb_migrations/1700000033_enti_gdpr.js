/// <reference path="../pb_data/types.d.ts" />

// GDPR — campi informativi sul Titolare del trattamento aggiunti alla collection `enti`.
// Modello: ogni ente è Titolare autonomo per i dati dei propri candidati/commissari.
// La piattaforma (super admin) è Responsabile del trattamento esterno.
//
// I campi popolano dinamicamente l'informativa privacy mostrata sul form di iscrizione
// pubblico e nella pagina /#/privacy. Vedi anche docs/DPA-template.md.

migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('enti');
  const addIfMissing = (name, type, options) => {
    if (!c.schema.getFieldByName(name)) {
      c.schema.addField(new SchemaField({ name, type, options: options || {} }));
    }
  };
  // Titolare
  addIfMissing('privacy_titolare',         'text',  { max: 250 });   // es. "Associazione Culturale Sfera APS"
  addIfMissing('privacy_sede_legale',      'text',  { max: 250 });
  addIfMissing('privacy_partita_iva',      'text',  { max: 32 });
  addIfMissing('privacy_pec',              'email', {});
  addIfMissing('privacy_email_contatto',   'email', {});
  // DPO (opzionale)
  addIfMissing('privacy_dpo_nome',         'text',  { max: 200 });
  addIfMissing('privacy_dpo_email',        'email', {});
  // Retention dati iscrizioni (in mesi). 0 = nessuna scadenza automatica.
  addIfMissing('privacy_retention_mesi',   'number',{ min: 0, max: 240, noDecimal: true });
  // URL informativa custom; se vuoto l'app genera template da questi campi.
  addIfMissing('privacy_informativa_url',  'url',   { max: 500 });
  // Data ultimo aggiornamento dell'informativa
  addIfMissing('privacy_aggiornata_il',    'date',  {});

  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('enti');
  ['privacy_titolare','privacy_sede_legale','privacy_partita_iva','privacy_pec',
   'privacy_email_contatto','privacy_dpo_nome','privacy_dpo_email',
   'privacy_retention_mesi','privacy_informativa_url','privacy_aggiornata_il'
  ].forEach(name => {
    const f = c.schema.getFieldByName(name);
    if (f) c.schema.removeField(f.id);
  });
  dao.saveCollection(c);
});
