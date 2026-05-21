/// <reference path="../pb_data/types.d.ts" />

// Sposta la configurazione SMTP dalla collection globale `platform_settings`
// alla collection `tenants`: ogni ente ha le sue credenziali SMTP, che il super
// admin configura nel modale "Modifica ente" e che possono essere propagate al
// PB del singolo ente con `scripts/apply-ente-smtp.sh`.
//
// Motivazione: enti diversi possono usare provider SMTP diversi (es. SendGrid
// per uno, Postmark per un altro, Gmail per un terzo) → la centralizzazione
// non si addice.
//
// Pulizia: rimuoviamo dai campi di `platform_settings` quelli legati a SMTP,
// lasciando solo `app_url` per il branding globale. La collection resta esistente
// per backward-compat ma diventa "platform settings minimali".

migrate((db) => {
  const dao = new Dao(db);

  // ---- 1. Aggiungi campi SMTP a `tenants` (idempotente) ----
  const tenants = dao.findCollectionByNameOrId('tenants');
  const addIfMissing = (name, type, options) => {
    if (!tenants.schema.getFieldByName(name)) {
      tenants.schema.addField(new SchemaField({ name, type, options: options || {} }));
    }
  };
  addIfMissing('smtp_enabled',   'bool',   {});
  addIfMissing('smtp_host',      'text',   { max: 200 });
  addIfMissing('smtp_port',      'number', { min: 1, max: 65535, noDecimal: true });
  addIfMissing('smtp_username',  'text',   { max: 200 });
  addIfMissing('smtp_password',  'text',   { max: 500 });
  addIfMissing('smtp_tls',       'select', { maxSelect: 1, values: ['none', 'starttls', 'tls'] });
  addIfMissing('sender_address', 'email',  {});
  addIfMissing('sender_name',    'text',   { max: 100 });
  addIfMissing('smtp_last_propagated_at', 'date', {});
  addIfMissing('smtp_last_propagation_result', 'text', { max: 1000 });
  dao.saveCollection(tenants);

  // ---- 2. Rimuovi i campi SMTP da `platform_settings` se presenti ----
  try {
    const ps = dao.findCollectionByNameOrId('platform_settings');
    const removeIfPresent = (name) => {
      const f = ps.schema.getFieldByName(name);
      if (f) ps.schema.removeField(f.id);
    };
    ['smtp_enabled', 'smtp_host', 'smtp_port', 'smtp_username', 'smtp_password',
     'smtp_tls', 'sender_address', 'sender_name',
     'last_propagated_at', 'last_propagation_result'].forEach(removeIfPresent);
    dao.saveCollection(ps);
  } catch (e) {
    // platform_settings non esiste (es. tenant senza migration 031) → skip.
  }
}, (db) => {
  const dao = new Dao(db);
  // Down: rimuovi i campi SMTP dai tenants.
  try {
    const tenants = dao.findCollectionByNameOrId('tenants');
    ['smtp_enabled', 'smtp_host', 'smtp_port', 'smtp_username', 'smtp_password',
     'smtp_tls', 'sender_address', 'sender_name',
     'smtp_last_propagated_at', 'smtp_last_propagation_result'].forEach(name => {
      const f = tenants.schema.getFieldByName(name);
      if (f) tenants.schema.removeField(f.id);
    });
    dao.saveCollection(tenants);
  } catch (e) {}
});
