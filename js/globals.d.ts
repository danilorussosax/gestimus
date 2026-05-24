// Dichiarazioni ambient per i global caricati via CDN (senza import) e per le
// API non-standard usate nel frontend vanilla. Usato dal type-check (checkJs).
interface Window {
  /** jsPDF UMD (cdn jspdf + plugin autotable). */
  jspdf?: { jsPDF: new (...args: any[]) => any;[k: string]: any };
  /** marked (markdown renderer) per Admin → Manuale. */
  marked?: { parse(md: string, opts?: any): string;[k: string]: any };
  /** Safari legacy: prefisso webkit per AudioContext (beep timer). */
  webkitAudioContext?: typeof AudioContext;
}
