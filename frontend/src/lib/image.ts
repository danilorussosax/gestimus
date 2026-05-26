/**
 * Ridimensiona un'immagine lato client (canvas) e ritorna un nuovo File JPEG.
 * Per file non-immagine, SVG o in caso di errore ritorna il file originale.
 * Usato prima dell'upload (es. foto iscrizione) per non spedire originali enormi.
 */
export async function resizeImageToFile(
  file: File,
  maxPx = 800,
  quality = 0.85,
): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file;
  try {
    const url = URL.createObjectURL(file);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('no 2d context')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('image load failed'));
      img.src = url;
    }).finally(() => URL.revokeObjectURL(url));

    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
