/**
 * api/home.ts — helper per i contatori della dashboard Home.
 *
 * Non esiste un endpoint /stats dedicato, quindi leggiamo le liste
 * con limit=1000 (abbondante per qualsiasi tenant reale) e contiamo
 * gli elementi restituiti.  In caso di errore la funzione rilancia
 * l'eccezione: useQuery la cattura e la pagina mostra 0/dash invece
 * di crashare.
 */

import { http } from '@/lib/api';
import type { Concorso, Fase, Candidato, Valutazione } from '@/types';

export interface DashboardCounts {
  concorsiTotal: number;
  concorsiAttivi: number;
  fasiTotal: number;
  fasiInCorso: number;
  candidatiTotal: number;
  valutazioniTotal: number;
}

export async function fetchDashboardCounts(): Promise<DashboardCounts> {
  const [concorsi, fasi, candidati, valutazioni] = await Promise.all([
    http.get<Concorso[]>('concorsi', { limit: 1000 }),
    http.get<Fase[]>('fasi', { limit: 1000 }),
    http.get<Candidato[]>('candidati', { limit: 1000 }),
    http.get<Valutazione[]>('valutazioni', { limit: 1000 }),
  ]);

  return {
    concorsiTotal: concorsi.length,
    concorsiAttivi: concorsi.filter((c) => c.stato === 'ATTIVO').length,
    fasiTotal: fasi.length,
    fasiInCorso: fasi.filter((f) => f.stato === 'IN_CORSO').length,
    candidatiTotal: candidati.length,
    valutazioniTotal: valutazioni.length,
  };
}
