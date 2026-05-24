// Catalogo piani SaaS Gestimus.
// Single source of truth: usato da UI super-admin (selezione piano in create/edit)
// e — in futuro — dalla pagina pricing pubblica e dai gating server-side.
//
// Tutti i prezzi sono IVA inclusa (22%). I limiti sono inclusivi del numero indicato.

export const PIANI = {
  trial: {
    key: 'trial',
    nome: 'Trial gratuito',
    descrizione: 'Demo a tempo: 30 giorni per provare il sistema senza impegno.',
    prezzo_eur: 0,
    durata_giorni: 30,
    limit_concorsi: 1,
    limit_iscritti_annui: 5,
    is_ppe: false,
    badge_color: 'sky',
    cta: 'Prova gratis',
  },
  starter: {
    key: 'starter',
    nome: 'Starter',
    descrizione: 'Per chi organizza un paio di concorsi piccoli all\'anno.',
    prezzo_eur: 150,
    durata_giorni: 365,
    limit_concorsi: 2,
    limit_iscritti_annui: 100,
    is_ppe: false,
    badge_color: 'emerald',
    cta: 'Attiva Starter',
  },
  pro: {
    key: 'pro',
    nome: 'Pro',
    descrizione: 'Il piano consigliato — miglior rapporto qualità/prezzo per scuole e conservatori medi.',
    prezzo_eur: 230,
    durata_giorni: 365,
    limit_concorsi: 5,
    limit_iscritti_annui: 500,
    is_ppe: false,
    badge_color: 'brand',
    cta: 'Attiva Pro',
    featured: true,
  },
  ultra: {
    key: 'ultra',
    nome: 'Ultra',
    descrizione: 'Volumi alti, fino a 10 concorsi e 2000 iscritti l\'anno.',
    prezzo_eur: 350,
    durata_giorni: 365,
    limit_concorsi: 10,
    limit_iscritti_annui: 2000,
    is_ppe: false,
    badge_color: 'amber',
    cta: 'Attiva Ultra',
  },
  ppe: {
    key: 'ppe',
    nome: 'Pay-per-Event',
    descrizione: 'Niente canone: paghi €100 setup per ogni concorso attivato + €1 per ogni iscritto (persona fisica: un quartetto = 4 iscritti).',
    prezzo_eur: 0,
    durata_giorni: null, // pay-as-you-go, nessuna scadenza
    limit_concorsi: null, // illimitato
    limit_iscritti_annui: null, // illimitato
    is_ppe: true,
    ppe_setup_per_concorso: 100,
    ppe_per_iscritto: 1,
    badge_color: 'slate',
    cta: 'Attiva PPE',
  },
};

export const PIANO_KEYS = Object.keys(PIANI);

export function getPianoOrDefault(/** @type {string} */ key) {
  return /** @type {Record<string, any>} */ (PIANI)[key] || PIANI.trial;
}

// Restituisce le impostazioni iniziali da scrivere su `tenants` quando l'admin
// assegna un piano a un ente. `now` è opzionale (default = adesso); torna un
// oggetto pronto da merge nel record tenant.
export function pianoDefaults(/** @type {string} */ key, now = new Date()) {
  const p = getPianoOrDefault(key);
  const inizio = now.toISOString();
  const scadenza = p.durata_giorni
    ? new Date(now.getTime() + p.durata_giorni * 24 * 60 * 60 * 1000).toISOString()
    : '';
  return {
    piano: p.key,
    piano_inizio: inizio,
    piano_scadenza: scadenza,
    limit_concorsi: p.limit_concorsi ?? 0,
    limit_iscritti_annui: p.limit_iscritti_annui ?? 0,
    ppe_setup_per_concorso: p.ppe_setup_per_concorso ?? 0,
    ppe_per_iscritto: p.ppe_per_iscritto ?? 0,
  };
}

// Stato runtime del piano: scaduto / attivo / scadenza vicina (<7 giorni).
// `tenant` è il record raw da PB (snake_case).
export function pianoStatus(/** @type {any} */ tenant, now = new Date()) {
  const p = getPianoOrDefault(tenant?.piano);
  if (p.is_ppe || !tenant?.piano_scadenza) {
    return { state: 'active', label: p.is_ppe ? 'Pay-as-you-go' : 'Attivo', daysLeft: null };
  }
  const exp = new Date(tenant.piano_scadenza);
  const diffMs = exp.getTime() - now.getTime();
  const daysLeft = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffMs < 0) return { state: 'expired', label: `Scaduto il ${exp.toLocaleDateString('it-IT')}`, daysLeft };
  if (daysLeft <= 7) return { state: 'expiring', label: `Scade tra ${daysLeft + 1}g`, daysLeft };
  return { state: 'active', label: `Attivo · scade ${exp.toLocaleDateString('it-IT')}`, daysLeft };
}

// Formattazione prezzo human-readable.
export function pianoPriceLabel(/** @type {string} */ key) {
  const p = getPianoOrDefault(key);
  if (p.is_ppe) {
    return `€${p.ppe_setup_per_concorso}/concorso + €${p.ppe_per_iscritto.toFixed(2)}/iscr`;
  }
  if (p.prezzo_eur === 0) return 'Gratis';
  return `€${p.prezzo_eur}/anno`;
}
