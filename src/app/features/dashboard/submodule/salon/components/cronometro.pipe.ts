import { Pipe, PipeTransform } from '@angular/core';

/** Segundos → `mm:ss` (o `h:mm:ss` pasada la hora). Negativos o nulos → `00:00`. */
@Pipe({ name: 'cronometro', standalone: true })
export class CronometroPipe implements PipeTransform {
  transform(segundos: number | null | undefined): string {
    const s = Math.max(0, Math.floor(segundos ?? 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(r).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
}
