/// <reference path="../pb_data/types.d.ts" />

// Collection `iscrizioni`: gestisce le richieste di iscrizione auto-service dal
// form pubblico /#/iscrizione. Workflow:
//   pending → email_verified → approved (→ crea record in `candidati`) | rejected
//
// Vincolo: 1 sola iscrizione per (email, concorso) — indice unique.
// Rule:
//   - createRule: '' (pubblico, no auth) per permettere il submit del form
//   - listRule/viewRule: solo admin/superadmin (privacy: dati di contatto sensibili)
//   - updateRule: solo admin/superadmin (per approve/reject/note)
//   - deleteRule: solo admin/superadmin

migrate((db) => {
  const dao = new Dao(db);
  const concorsi = dao.findCollectionByNameOrId('concorsi');
  const sezioni  = dao.findCollectionByNameOrId('sezioni');
  const categorie = dao.findCollectionByNameOrId('categorie');
  const candidati = dao.findCollectionByNameOrId('candidati');
  const accounts = dao.findCollectionByNameOrId('accounts');

  const adminOnly = '@request.auth.role = "admin" || @request.auth.role = "superadmin"';

  const c = new Collection({
    name: 'iscrizioni',
    type: 'base',
    listRule:   adminOnly,
    viewRule:   adminOnly,
    createRule: '',
    updateRule: adminOnly,
    deleteRule: adminOnly,
    schema: [
      // ---- Workflow ----
      new SchemaField({ name: 'stato', type: 'select', required: true, options: { maxSelect: 1, values: ['pending', 'email_verified', 'approved', 'rejected'] } }),
      new SchemaField({ name: 'concorso', type: 'relation', required: true, options: { collectionId: concorsi.id, cascadeDelete: true, maxSelect: 1 } }),
      new SchemaField({ name: 'token_verifica', type: 'text', options: { max: 64 } }),
      new SchemaField({ name: 'verified_at', type: 'date', options: {} }),
      new SchemaField({ name: 'approved_at', type: 'date', options: {} }),
      new SchemaField({ name: 'approved_by', type: 'relation', options: { collectionId: accounts.id, cascadeDelete: false, maxSelect: 1 } }),
      new SchemaField({ name: 'candidato', type: 'relation', options: { collectionId: candidati.id, cascadeDelete: false, maxSelect: 1 } }),
      new SchemaField({ name: 'rejected_reason', type: 'text', options: { max: 500 } }),
      new SchemaField({ name: 'note_admin', type: 'text', options: { max: 2000 } }),

      // ---- Anagrafica ----
      new SchemaField({ name: 'nome', type: 'text', required: true, options: { max: 100 } }),
      new SchemaField({ name: 'cognome', type: 'text', required: true, options: { max: 100 } }),
      new SchemaField({ name: 'data_nascita', type: 'date', required: true, options: {} }),
      new SchemaField({ name: 'luogo_nascita', type: 'text', options: { max: 200 } }),
      new SchemaField({ name: 'nazionalita', type: 'text', required: true, options: { max: 80 } }),
      new SchemaField({ name: 'sesso', type: 'select', options: { maxSelect: 1, values: ['M', 'F', 'altro'] } }),
      new SchemaField({ name: 'codice_fiscale', type: 'text', options: { max: 32 } }),

      // ---- Contatti ----
      new SchemaField({ name: 'email', type: 'email', required: true, options: {} }),
      new SchemaField({ name: 'telefono', type: 'text', options: { max: 40 } }),
      new SchemaField({ name: 'indirizzo', type: 'text', options: { max: 300 } }),
      new SchemaField({ name: 'citta', type: 'text', options: { max: 100 } }),
      new SchemaField({ name: 'provincia', type: 'text', options: { max: 60 } }),
      new SchemaField({ name: 'cap', type: 'text', options: { max: 20 } }),
      new SchemaField({ name: 'paese', type: 'text', options: { max: 80 } }),

      // ---- Tutore (per minorenni) ----
      new SchemaField({ name: 'tutore_nome', type: 'text', options: { max: 100 } }),
      new SchemaField({ name: 'tutore_cognome', type: 'text', options: { max: 100 } }),
      new SchemaField({ name: 'tutore_email', type: 'email', options: {} }),
      new SchemaField({ name: 'tutore_telefono', type: 'text', options: { max: 40 } }),

      // ---- Dati artistici ----
      new SchemaField({ name: 'tipo', type: 'select', required: true, options: { maxSelect: 1, values: ['individuale', 'gruppo'] } }),
      new SchemaField({ name: 'strumento', type: 'text', required: true, options: { max: 100 } }),
      new SchemaField({ name: 'sezione', type: 'relation', options: { collectionId: sezioni.id, cascadeDelete: false, maxSelect: 1 } }),
      new SchemaField({ name: 'categoria', type: 'relation', options: { collectionId: categorie.id, cascadeDelete: false, maxSelect: 1 } }),
      new SchemaField({ name: 'docenti_preparatori', type: 'json', options: { maxSize: 4096 } }),
      new SchemaField({ name: 'anni_studio', type: 'number', options: { min: 0, max: 100, noDecimal: true } }),
      new SchemaField({ name: 'scuola_provenienza', type: 'text', options: { max: 200 } }),
      new SchemaField({ name: 'note_libere', type: 'text', options: { max: 2000 } }),

      // ---- Gruppo (se tipo=gruppo) ----
      new SchemaField({ name: 'gruppo_nome', type: 'text', options: { max: 200 } }),
      new SchemaField({ name: 'gruppo_membri', type: 'json', options: { maxSize: 32768 } }),

      // ---- Programma ----
      new SchemaField({ name: 'programma', type: 'json', required: true, options: { maxSize: 16384 } }),
      new SchemaField({ name: 'durata_totale_min', type: 'number', options: { min: 0, max: 600, noDecimal: false } }),

      // ---- Consensi GDPR ----
      new SchemaField({ name: 'consenso_privacy', type: 'bool', required: true, options: {} }),
      new SchemaField({ name: 'consenso_immagini', type: 'bool', options: {} }),
      new SchemaField({ name: 'consenso_regolamento', type: 'bool', required: true, options: {} }),

      // ---- Allegati ----
      new SchemaField({ name: 'foto', type: 'file', options: { maxSelect: 1, maxSize: 2097152, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] } }),
      new SchemaField({ name: 'documento_identita', type: 'file', options: { maxSelect: 1, maxSize: 2097152, mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'] } }),
      new SchemaField({ name: 'ricevuta_pagamento', type: 'file', options: { maxSelect: 1, maxSize: 2097152, mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'] } }),
      new SchemaField({ name: 'autorizzazione_minore', type: 'file', options: { maxSelect: 1, maxSize: 2097152, mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'] } }),
    ],
    indexes: [
      'CREATE INDEX `idx_iscrizioni_stato` ON `iscrizioni` (`stato`)',
      'CREATE INDEX `idx_iscrizioni_concorso` ON `iscrizioni` (`concorso`)',
      'CREATE INDEX `idx_iscrizioni_email` ON `iscrizioni` (`email`)',
      'CREATE UNIQUE INDEX `idx_iscrizioni_email_concorso` ON `iscrizioni` (`email`, `concorso`)',
      'CREATE UNIQUE INDEX `idx_iscrizioni_token` ON `iscrizioni` (`token_verifica`) WHERE `token_verifica` != \'\'',
    ],
  });
  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  try {
    dao.deleteCollection(dao.findCollectionByNameOrId('iscrizioni'));
  } catch (e) { /* ignore */ }
});
