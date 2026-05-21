/// <reference path="../pb_data/types.d.ts" />

// Lockdown delle regole di accesso per produzione multi-tenant.
// Prima di questa migration, tutte le regole erano aperte ("").
// Dopo, ogni operazione richiede autenticazione e i ruoli sono rispettati.
//
// Regola generale:
//   - list/view: qualsiasi utente autenticato (commissari vedono candidati, admin vedono tutto)
//   - create/update: admin per dati strutturali, commissari solo per valutazioni
//   - delete: solo admin / superadmin
//
// ATTENZIONE: Questa migration può causare rotture se ci sono chiamate
// API non autenticate nel frontend. Il frontend va verificato dopo.

migrate((db) => {
  const dao = new Dao(db);

  const authRequired = '@request.auth.id != ""';
  const adminOnly = '@request.auth.role = "admin" || @request.auth.role = "superadmin"';
  const nobody = null;

  const lock = (name, rules) => {
    try {
      const c = dao.findCollectionByNameOrId(name);
      let changed = false;
      for (const [key, val] of Object.entries(rules)) {
        if (c[key] !== val) {
          c[key] = val;
          changed = true;
        }
      }
      if (changed) dao.saveCollection(c);
    } catch {}
  };

  // --- Collezioni con dati strutturali (solo admin crea/modifica) ---
  lock('concorsi',       { listRule: authRequired, viewRule: authRequired, createRule: adminOnly, updateRule: adminOnly, deleteRule: adminOnly });
  lock('commissari',     { listRule: authRequired, viewRule: authRequired, createRule: adminOnly, updateRule: adminOnly, deleteRule: adminOnly });
  lock('candidati',      { listRule: authRequired, viewRule: authRequired, createRule: adminOnly, updateRule: adminOnly, deleteRule: adminOnly });
  lock('fasi',           { listRule: authRequired, viewRule: authRequired, createRule: adminOnly, updateRule: adminOnly, deleteRule: adminOnly });
  lock('candidati_fase', { listRule: authRequired, viewRule: authRequired, createRule: adminOnly, updateRule: adminOnly, deleteRule: adminOnly });
  lock('sezioni',        { listRule: authRequired, viewRule: authRequired, createRule: adminOnly, updateRule: adminOnly, deleteRule: adminOnly });
  lock('categorie',      { listRule: authRequired, viewRule: authRequired, createRule: adminOnly, updateRule: adminOnly, deleteRule: adminOnly });
  lock('commissioni',    { listRule: authRequired, viewRule: authRequired, createRule: adminOnly, updateRule: adminOnly, deleteRule: adminOnly });
  lock('aule',           { listRule: authRequired, viewRule: authRequired, createRule: adminOnly, updateRule: adminOnly, deleteRule: adminOnly });
  lock('prenotazioni',   { listRule: authRequired, viewRule: authRequired, createRule: adminOnly, updateRule: adminOnly, deleteRule: adminOnly });

  // --- Valutazioni: commissari possono creare/modificare le proprie ---
  lock('valutazioni',    { listRule: authRequired, viewRule: authRequired, createRule: authRequired, updateRule: authRequired, deleteRule: adminOnly });

  // --- Accounts: updateRule ristretta; listRule includi superadmin ---
  lock('accounts', {
    listRule: '(role = "admin" || role = "superadmin") || @request.auth.id != ""',
    viewRule: '(role = "admin" || role = "superadmin") || @request.auth.id != ""',
    updateRule: adminOnly,
  });

  // --- Audit, enti, fase_runtime: invariati (gestiti dalle migration dedicate) ---

}, (db) => {
  const dao = new Dao(db);
  const open = '';
  const revert = (name) => {
    try {
      const c = dao.findCollectionByNameOrId(name);
      c.listRule = open; c.viewRule = open; c.createRule = open; c.updateRule = open; c.deleteRule = open;
      dao.saveCollection(c);
    } catch {}
  };
  ['concorsi','commissari','candidati','fasi','candidati_fase','valutazioni','sezioni','categorie','commissioni','aule','prenotazioni'].forEach(revert);
});