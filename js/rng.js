// Seedable PRNG (mulberry32). Estratto da db.js per consentire l'import nei
// test unit senza dipendenze del data layer. Usato per sorteggi riproducibili.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher–Yates shuffle seedato. Restituisce una copia ordinata di `arr`.
// Usato dal sorteggio ordine candidati per garantire riproducibilità (stesso seed → stesso ordine).
export function shuffleSeeded(arr, seed) {
  const rand = mulberry32(seed >>> 0);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
