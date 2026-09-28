/**
 * Representacion de un correo enviado tal como se ve al abrirlo en el buzon (vista de lectura
 * al estilo Gmail), para guardarla como SOPORTE del envio (revision funcional 2026-09-28).
 *
 * Todo lo que se pinta sale del registro real del envio (ledger de ms-hr): asunto, remitente,
 * destinatarios, copias, fecha, el HTML exacto que se envio y los adjuntos que viajaron. El pie
 * dice de donde sale la vista (registro #, modo) para que el soporte no se confunda con una
 * captura del buzon del destinatario. No usa logos ni marcas de terceros.
 *
 * Funciones puras: generan un documento HTML completo que el dialogo muestra en un iframe
 * aislado y que tambien se imprime (Guardar como PDF) o se convierte en imagen.
 */

export interface AdjuntoVista {
  nombre: string;
  /** data:image/png de la primera pagina; null = sin miniatura (se pinta el icono). */
  miniatura: string | null;
}

export interface DatosCorreoGmail {
  asunto: string;
  remitenteNombre: string;
  /** null = no se sabe que cuenta del pool lo envio (envios anteriores a que se guardara). */
  remitenteCorreo: string | null;
  para: string[];
  cc: string[];
  /** null = aun no se envia (vista previa del lote de hoy). */
  fecha: Date | null;
  /** HTML del cuerpo YA saneado (ver `sanearCuerpo`). */
  cuerpoHtml: string;
  adjuntos: AdjuntoVista[];
  /** Texto del pie: de donde sale esta vista. */
  pie: string;
}

const ZONA = 'America/Bogota';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const COLORES_AVATAR = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#c5221f', '#12848e', '#b06000'];

/** Partes de una fecha en la hora de Bogota, sin depender de la zona del navegador. */
function partes(fecha: Date): { anio: number; mes: number; dia: number; semana: number; hora: string } {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(fecha);
  const v = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  const semana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(v('weekday'));
  const hh = v('hour') === '24' ? '00' : v('hour');
  return { anio: +v('year'), mes: +v('month'), dia: +v('day'), semana, hora: `${hh}:${v('minute')}` };
}

/** Cabecera del mensaje: "vie, 26 sept 2026, 19:00". */
export function fechaCabecera(fecha: Date): string {
  const p = partes(fecha);
  return `${DIAS[p.semana]}, ${p.dia} ${MESES[p.mes - 1]} ${p.anio}, ${p.hora}`;
}

/** Detalle del mensaje: "26 sept 2026, 19:00". */
export function fechaDetalle(fecha: Date): string {
  const p = partes(fecha);
  return `${p.dia} ${MESES[p.mes - 1]} ${p.anio}, ${p.hora}`;
}

export function escapar(v: string | null | undefined): string {
  return (v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Lista de correos a partir de "a@x.co, b@y.co" o de un arreglo. */
export function listaCorreos(v: string | string[] | null | undefined): string[] {
  const crudo = Array.isArray(v) ? v : (v ?? '').split(/[,;]/);
  return crudo.map((s) => s.trim()).filter(Boolean);
}

export function colorAvatar(semilla: string): string {
  let h = 0;
  for (const ch of semilla) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORES_AVATAR[h % COLORES_AVATAR.length];
}

/**
 * Quita del cuerpo todo lo que pueda ejecutar o traer contenido: scripts, iframes, objetos,
 * formularios, atributos on*, URLs javascript:. El cuerpo sale de la plantilla fija del
 * backend (valores ya escapados), pero la vista se imprime desde un documento del mismo
 * origen, asi que se sanea igual.
 */
export function sanearCuerpo(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html ?? ''}</body>`, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, form, base, meta, link, frame, frameset')
    .forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      const nombre = a.name.toLowerCase();
      const valor = a.value.trim().toLowerCase();
      if (nombre.startsWith('on')) el.removeAttribute(a.name);
      else if ((nombre === 'href' || nombre === 'src' || nombre === 'xlink:href')
        && (valor.startsWith('javascript:') || valor.startsWith('vbscript:'))) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}

// Iconos (Material, 24x24) en linea: la vista no depende de fuentes de iconos.
const ICONO = {
  estrella: 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z',
  responder: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
  reenviar: 'M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z',
  mas: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  imprimir: 'M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z',
  ventana: 'M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  desplegar: 'M7 10l5 5 5-5z',
};

function svg(path: string, tam = 20): string {
  return `<svg class="gm-ico" width="${tam}" height="${tam}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
}

/** "Un archivo adjunto" / "3 archivos adjuntos". */
export function tituloAdjuntos(n: number): string {
  return n === 1 ? 'Un archivo adjunto' : `${n} archivos adjuntos`;
}

/** El documento HTML completo de la vista. */
export function componerCorreoGmail(d: DatosCorreoGmail): string {
  const inicial = (d.remitenteNombre.trim()[0] ?? '?').toUpperCase();
  const color = colorAvatar(d.remitenteCorreo ?? d.remitenteNombre);
  const para = d.para.length ? d.para : ['(sin destinatario)'];
  const lineaPara = `para ${escapar(para.join(', '))}${d.cc.length ? `, cc: ${escapar(d.cc.join(', '))}` : ''}`;
  const fechaCab = d.fecha ? fechaCabecera(d.fecha) : 'Borrador · sin enviar';

  const filasDetalle = [
    ['de:', `<b>${escapar(d.remitenteNombre)}</b>${d.remitenteCorreo ? ` &lt;${escapar(d.remitenteCorreo)}&gt;` : ''}`],
    ['para:', escapar(para.join(', '))],
    ...(d.cc.length ? [['cc:', escapar(d.cc.join(', '))]] : []),
    ['fecha:', d.fecha ? escapar(fechaDetalle(d.fecha)) : 'sin enviar (vista previa)'],
    ['asunto:', escapar(d.asunto)],
    ...(d.remitenteCorreo ? [['enviado por:', escapar(d.remitenteCorreo.split('@')[1] ?? '')]] : []),
  ].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');

  const tarjetasAdjuntos = d.adjuntos.map((a) => `
      <div class="gm-adj">
        <div class="gm-adj-mini">${a.miniatura
          ? `<img src="${a.miniatura}" alt="">`
          : '<div class="gm-adj-vacio"><span class="gm-pdf gm-pdf--grande">PDF</span></div>'}</div>
        <div class="gm-adj-pie"><span class="gm-pdf">PDF</span><span class="gm-adj-nombre" title="${escapar(a.nombre)}">${escapar(a.nombre)}</span></div>
      </div>`).join('');

  const bloqueAdjuntos = d.adjuntos.length ? `
    <section class="gm-adjuntos">
      <div class="gm-adj-titulo">${tituloAdjuntos(d.adjuntos.length)}</div>
      <div class="gm-adj-grilla">${tarjetasAdjuntos}</div>
    </section>` : '';

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>${escapar(d.asunto || 'Correo')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #f6f8fc; color: #1f1f1f; }
  body { font-family: "Google Sans", Roboto, Arial, Helvetica, sans-serif; padding: 16px; }
  .gm-hoja { max-width: 940px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 20px 24px 18px; }
  .gm-ico { fill: #444746; flex-shrink: 0; }
  .gm-asunto-fila { display: flex; align-items: flex-start; gap: 12px; margin: 0 0 18px 56px; }
  .gm-asunto { flex: 1; margin: 0; font-size: 22px; line-height: 28px; font-weight: 400; color: #1f1f1f; word-break: break-word; }
  .gm-asunto-iconos { display: flex; gap: 14px; padding-top: 4px; }
  .gm-cab { display: flex; gap: 16px; align-items: flex-start; }
  .gm-avatar { width: 40px; height: 40px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 500; flex-shrink: 0; }
  .gm-cab-centro { flex: 1; min-width: 0; }
  .gm-de { font-size: 14px; line-height: 20px; }
  .gm-de b { font-weight: 700; color: #1f1f1f; }
  .gm-de span { font-size: 12px; color: #5e5e5e; }
  .gm-para { display: flex; align-items: center; font-size: 12px; line-height: 20px; color: #5e5e5e; overflow: hidden; }
  .gm-para span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gm-cab-der { display: flex; align-items: center; gap: 14px; font-size: 12px; color: #5e5e5e; white-space: nowrap; }
  .gm-detalle { margin: 10px 0 6px 56px; padding: 12px 16px; max-width: 620px; border-radius: 8px; background: #fff; box-shadow: 0 1px 3px 0 rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15); }
  .gm-detalle table { border-collapse: collapse; font-size: 12px; line-height: 20px; }
  .gm-detalle th { text-align: right; color: #5e5e5e; font-weight: 400; padding: 0 10px 0 0; vertical-align: top; white-space: nowrap; }
  .gm-detalle td { color: #1f1f1f; word-break: break-word; }
  .gm-cuerpo { margin: 18px 0 8px 56px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.45; color: #222; overflow-x: auto; }
  .gm-adjuntos { margin: 18px 0 0 56px; padding-top: 16px; border-top: 1px solid #e3e3e3; }
  .gm-adj-titulo { font-size: 14px; font-weight: 500; color: #444746; margin-bottom: 12px; }
  .gm-adj-grilla { display: flex; flex-wrap: wrap; gap: 12px; }
  .gm-adj { width: 180px; height: 122px; border: 1px solid #dadce0; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; background: #fff; break-inside: avoid; }
  .gm-adj-mini { flex: 1; overflow: hidden; background: #f1f3f4; }
  .gm-adj-mini img { width: 100%; display: block; }
  .gm-adj-vacio { height: 100%; display: flex; align-items: center; justify-content: center; }
  .gm-adj-pie { height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 10px; background: #f2f2f2; border-top: 1px solid #e3e3e3; }
  .gm-pdf { background: #d93025; color: #fff; font: 700 9px/1 Roboto, Arial, sans-serif; padding: 3px 3px; border-radius: 2px; letter-spacing: .02em; }
  .gm-pdf--grande { font-size: 14px; padding: 6px 7px; border-radius: 3px; }
  .gm-adj-nombre { font-size: 12px; color: #1f1f1f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gm-acciones { display: flex; gap: 12px; margin: 22px 0 4px 56px; }
  .gm-btn { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 20px 0 16px; border: 1px solid #747775; border-radius: 18px; font-size: 14px; font-weight: 500; color: #444746; background: #fff; }
  .gm-pie { max-width: 940px; margin: 10px auto 0; font: 11px/1.45 Roboto, Arial, sans-serif; color: #5e5e5e; text-align: center; }
  @media (max-width: 640px) {
    body { padding: 8px; }
    .gm-hoja { padding: 16px 14px; }
    .gm-asunto-fila, .gm-detalle, .gm-cuerpo, .gm-adjuntos, .gm-acciones { margin-left: 0; }
    .gm-cab-der .gm-ico { display: none; }
  }
  @media print {
    @page { margin: 12mm; }
    html, body { background: #ffffff; padding: 0; }
    .gm-hoja { max-width: none; border-radius: 0; padding: 0; }
    .gm-detalle { box-shadow: none; border: 1px solid #dadce0; }
  }
</style></head>
<body>
  <main class="gm-hoja">
    <div class="gm-asunto-fila">
      <h1 class="gm-asunto">${escapar(d.asunto || '(sin asunto)')}</h1>
      <div class="gm-asunto-iconos">${svg(ICONO.imprimir)}${svg(ICONO.ventana)}</div>
    </div>
    <div class="gm-cab">
      <div class="gm-avatar" style="background:${color}">${escapar(inicial)}</div>
      <div class="gm-cab-centro">
        <div class="gm-de"><b>${escapar(d.remitenteNombre)}</b>${d.remitenteCorreo ? ` <span>&lt;${escapar(d.remitenteCorreo)}&gt;</span>` : ''}</div>
        <div class="gm-para"><span>${lineaPara}</span>${svg(ICONO.desplegar, 18)}</div>
      </div>
      <div class="gm-cab-der"><span>${escapar(fechaCab)}</span>${svg(ICONO.estrella)}${svg(ICONO.responder)}${svg(ICONO.mas)}</div>
    </div>
    <div class="gm-detalle"><table>${filasDetalle}</table></div>
    <div class="gm-cuerpo">${d.cuerpoHtml}</div>
    ${bloqueAdjuntos}
    <div class="gm-acciones">
      <span class="gm-btn">${svg(ICONO.responder)}Responder</span>
      <span class="gm-btn">${svg(ICONO.reenviar)}Reenviar</span>
    </div>
  </main>
  <p class="gm-pie">${escapar(d.pie)}</p>
</body></html>`;
}
