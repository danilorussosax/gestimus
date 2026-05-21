/// <reference path="../pb_data/types.d.ts" />

// PocketBase auto-migration: creates the 6 collections used by the gestionale.
// Compatible with PocketBase v0.22+ (uses Dao + SchemaField).
//
// To apply, place this directory next to the pocketbase binary (or pass
// --migrationsDir ./pb_migrations) and run `./pocketbase serve`.

migrate((db) => {
  const dao = new Dao(db);

  // ---------- concorsi ----------
  const concorsi = new Collection({
    name: "concorsi",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "",
    updateRule: "",
    deleteRule: "",
    schema: [
      new SchemaField({ name: "nome", type: "text", required: true, options: { max: 255 } }),
      new SchemaField({ name: "anno", type: "number", required: true, options: { min: 1900, max: 2200, noDecimal: true } }),
      new SchemaField({ name: "data_inizio", type: "date", options: {} }),
      new SchemaField({ name: "stato", type: "select", required: false, options: { maxSelect: 1, values: ["ATTIVO", "CONCLUSO"] } }),
      new SchemaField({ name: "legacy_id", type: "number", options: { noDecimal: true } }),
    ],
  });
  dao.saveCollection(concorsi);

  // ---------- commissari ----------
  const commissari = new Collection({
    name: "commissari",
    type: "base",
    listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "",
    schema: [
      new SchemaField({ name: "concorso", type: "relation", required: true, options: { collectionId: concorsi.id, cascadeDelete: true, maxSelect: 1 } }),
      new SchemaField({ name: "nome", type: "text", required: true, options: { max: 255 } }),
      new SchemaField({ name: "cognome", type: "text", options: { max: 255 } }),
      new SchemaField({ name: "specialita", type: "text", options: { max: 255 } }),
      new SchemaField({ name: "email", type: "email", options: {} }),
      new SchemaField({ name: "telefono", type: "text", options: { max: 50 } }),
      new SchemaField({ name: "data_nascita", type: "date", options: {} }),
      new SchemaField({ name: "nazionalita", type: "text", options: { max: 100 } }),
      new SchemaField({ name: "foto", type: "file", options: { maxSelect: 1, maxSize: 2097152, mimeTypes: ["image/jpeg","image/png","image/webp","image/gif"] } }),
      new SchemaField({ name: "cv", type: "file", options: { maxSelect: 1, maxSize: 5242880 } }),
      new SchemaField({ name: "bio", type: "text", options: {} }),
      new SchemaField({ name: "stato", type: "select", options: { maxSelect: 1, values: ["ATTIVO", "INATTIVO"] } }),
      new SchemaField({ name: "legacy_id", type: "number", options: { noDecimal: true } }),
    ],
  });
  dao.saveCollection(commissari);

  // ---------- candidati ----------
  const candidati = new Collection({
    name: "candidati",
    type: "base",
    listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "",
    schema: [
      new SchemaField({ name: "concorso", type: "relation", required: true, options: { collectionId: concorsi.id, cascadeDelete: true, maxSelect: 1 } }),
      new SchemaField({ name: "numero_candidato", type: "number", required: true, options: { min: 1, noDecimal: true } }),
      new SchemaField({ name: "nome", type: "text", required: true, options: { max: 255 } }),
      new SchemaField({ name: "cognome", type: "text", options: { max: 255 } }),
      new SchemaField({ name: "strumento", type: "text", required: true, options: { max: 255 } }),
      new SchemaField({ name: "data_nascita", type: "date", options: {} }),
      new SchemaField({ name: "nazionalita", type: "text", options: { max: 100 } }),
      new SchemaField({ name: "foto", type: "file", options: { maxSelect: 1, maxSize: 2097152, mimeTypes: ["image/jpeg","image/png","image/webp","image/gif"] } }),
      new SchemaField({ name: "cv", type: "file", options: { maxSelect: 1, maxSize: 5242880 } }),
      new SchemaField({ name: "docenti_preparatori", type: "json", options: {} }),
      new SchemaField({ name: "data_iscrizione", type: "date", options: {} }),
      new SchemaField({ name: "legacy_id", type: "number", options: { noDecimal: true } }),
    ],
  });
  dao.saveCollection(candidati);

  // ---------- fasi ----------
  const fasi = new Collection({
    name: "fasi",
    type: "base",
    listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "",
    schema: [
      new SchemaField({ name: "concorso", type: "relation", required: true, options: { collectionId: concorsi.id, cascadeDelete: true, maxSelect: 1 } }),
      new SchemaField({ name: "ordine", type: "number", required: true, options: { min: 1, noDecimal: true } }),
      new SchemaField({ name: "nome", type: "text", required: true, options: { max: 255 } }),
      new SchemaField({ name: "ammessi", type: "number", options: { min: 1, noDecimal: true } }),
      new SchemaField({ name: "data_prevista", type: "date", options: {} }),
      new SchemaField({ name: "scala", type: "number", options: { min: 2, max: 1000, noDecimal: true } }),
      new SchemaField({ name: "modo_valutazione", type: "select", options: { maxSelect: 1, values: ["autonoma","sincrona"] } }),
      new SchemaField({ name: "pesi", type: "json", options: {} }),
      new SchemaField({ name: "commissari_ids", type: "json", options: {} }),
      new SchemaField({ name: "stato", type: "select", options: { maxSelect: 1, values: ["PIANIFICATA","IN_CORSO","CONCLUSA"] } }),
      new SchemaField({ name: "legacy_id", type: "number", options: { noDecimal: true } }),
    ],
  });
  dao.saveCollection(fasi);

  // ---------- candidati_fase ----------
  const candidatiFase = new Collection({
    name: "candidati_fase",
    type: "base",
    listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "",
    schema: [
      new SchemaField({ name: "fase", type: "relation", required: true, options: { collectionId: fasi.id, cascadeDelete: true, maxSelect: 1 } }),
      new SchemaField({ name: "candidato", type: "relation", required: true, options: { collectionId: candidati.id, cascadeDelete: true, maxSelect: 1 } }),
      new SchemaField({ name: "posizione", type: "number", options: { min: 1, noDecimal: true } }),
      new SchemaField({ name: "stato", type: "select", options: { maxSelect: 1, values: ["IN_ATTESA","IN_ESECUZIONE","COMPLETATO","ELIMINATO"] } }),
      new SchemaField({ name: "ammesso_prossima_fase", type: "bool", options: {} }),
      new SchemaField({ name: "legacy_id", type: "number", options: { noDecimal: true } }),
    ],
  });
  dao.saveCollection(candidatiFase);

  // ---------- valutazioni ----------
  const valutazioni = new Collection({
    name: "valutazioni",
    type: "base",
    listRule: "", viewRule: "", createRule: "", updateRule: "", deleteRule: "",
    schema: [
      new SchemaField({ name: "candidato_fase", type: "relation", required: true, options: { collectionId: candidatiFase.id, cascadeDelete: true, maxSelect: 1 } }),
      new SchemaField({ name: "commissario", type: "relation", required: true, options: { collectionId: commissari.id, cascadeDelete: true, maxSelect: 1 } }),
      new SchemaField({ name: "criterio", type: "select", required: true, options: { maxSelect: 1, values: ["tecnica","interpretazione","intonazione","musicalita"] } }),
      new SchemaField({ name: "voto", type: "number", required: true, options: {} }),
      new SchemaField({ name: "note", type: "text", options: {} }),
      new SchemaField({ name: "timestamp", type: "date", options: {} }),
      new SchemaField({ name: "legacy_id", type: "number", options: { noDecimal: true } }),
    ],
  });
  dao.saveCollection(valutazioni);

}, (db) => {
  const dao = new Dao(db);
  ["valutazioni","candidati_fase","fasi","candidati","commissari","concorsi"].forEach((name) => {
    try {
      const c = dao.findCollectionByNameOrId(name);
      dao.deleteCollection(c);
    } catch (e) { /* ignore */ }
  });
});
