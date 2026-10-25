/** Escapa texto para meterlo en el HTML que se imprime. */
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Imprime solo este HTML: un iframe oculto con su propia hoja, sin el resto de la app. */
export function imprimirHtml(cuerpo: string): void {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const doc = f.contentDocument!;
  doc.open(); doc.write(`<!doctype html><html><head><meta charset="utf-8"></head><body>${cuerpo}</body></html>`); doc.close();
  const imgs = Array.from(doc.images);
  Promise.all(imgs.map(i => i.complete ? Promise.resolve() : new Promise(r => { i.onload = i.onerror = r; }))).then(() => {
    f.contentWindow!.focus();
    f.contentWindow!.print();
    setTimeout(() => f.remove(), 60_000);
  });
}
