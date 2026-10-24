import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * Entrada por el QR de la finca leído con la cámara del sistema (`/campo/qr?f=&t=`):
 * reenvía a la marcación con el QR ya leído. Sin pantalla propia.
 */
@Component({
  selector: 'app-campo-qr-entrada',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p style="padding:24px;font:600 16px system-ui">Abriendo la marcación…</p>`,
})
export class QrEntradaComponent {
  constructor() {
    const q = inject(ActivatedRoute).snapshot.queryParamMap;
    void inject(Router).navigate(['/dashboard/campo/marcar'], {
      queryParams: { f: q.get('f'), t: q.get('t') }, replaceUrl: true,
    });
  }
}
