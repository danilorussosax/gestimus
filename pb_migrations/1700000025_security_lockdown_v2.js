/// <reference path="../pb_data/types.d.ts" />

// Hardening v2:
//   1. accounts: list/view ristrette (self + admin) — niente più visibilità globale degli account
//   2. accounts.update: self-update consentito (cambio password) + admin
//   3. enti: list/view richiedono auth — il branding pubblico va esposto via campi pubblici
//      dedicati o un endpoint separato (vedi `enti_public` se introdotto in futuro)
//
// Per l'esistenza-admin pre-login: il frontend deve usare il pattern login-try
// e dedurre il primo-avvio dall'errore (account_not_found) anziché enumerare accounts.

migrate((db) => {
  const dao = new Dao(db);

  const apply = (name, rules) => {
    try {
      const c = dao.findCollectionByNameOrId(name);
      let changed = false;
      for (const [k, v] of Object.entries(rules)) {
        if (c[k] !== v) { c[k] = v; changed = true; }
      }
      if (changed) dao.saveCollection(c);
    } catch (e) { /* collection non esiste in questa istanza */ }
  };

  // --- accounts ---
  // list/view: l'utente vede SOLO il proprio record + admin/superadmin vedono tutto.
  // L'endpoint pubblico di admin-probe (1700000010) viene di fatto chiuso: usare
  // il tentativo di login per inferire la presenza di admin.
  apply('accounts', {
    listRule:   '@request.auth.id = id || @request.auth.role = "admin" || @request.auth.role = "superadmin"',
    viewRule:   '@request.auth.id = id || @request.auth.role = "admin" || @request.auth.role = "superadmin"',
    updateRule: '@request.auth.id = id || @request.auth.role = "admin" || @request.auth.role = "superadmin"',
  });

  // --- enti ---
  // Era listRule/viewRule = '' (anonimo). Email/telefono/indirizzo non devono essere pubblici.
  // Se serve branding pre-login, esporre solo logo+nome via collection dedicata.
  apply('enti', {
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
  });
}, (db) => {
  const dao = new Dao(db);

  const apply = (name, rules) => {
    try {
      const c = dao.findCollectionByNameOrId(name);
      for (const [k, v] of Object.entries(rules)) c[k] = v;
      dao.saveCollection(c);
    } catch (e) { /* ignore */ }
  };

  // Revert al pre-v2: rule più permissive di 1700000010 + 1700000018 + 1700000022
  apply('accounts', {
    listRule:   '(role = "admin" || role = "superadmin") || @request.auth.id != ""',
    viewRule:   '(role = "admin" || role = "superadmin") || @request.auth.id != ""',
    updateRule: '@request.auth.role = "admin" || @request.auth.role = "superadmin"',
  });
  apply('enti', { listRule: '', viewRule: '' });
});
