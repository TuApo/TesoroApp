import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';

import { CfgAjustes } from './cfg-ajustes';
import { CfgAuditoria } from './cfg-auditoria';
import { CfgCatalogos, SeccionCatalogo } from './cfg-catalogos';
import { CfgReglas } from './cfg-reglas';
import { CfgSistema } from './cfg-sistema';
import { CfgZonas } from './cfg-zonas';

type Pestana = SeccionCatalogo | 'zonas' | 'reglas' | 'ajustes' | 'sistema' | 'auditoria' | 'privacidad';

const PESTANAS: { id: Pestana; texto: string; icono: string }[] = [
  { id: 'sedes', texto: 'Sedes', icono: 'location_on' },
  { id: 'agentes', texto: 'Agentes de sitio', icono: 'router' },
  { id: 'grabadores', texto: 'Grabadores', icono: 'dns' },
  { id: 'camaras', texto: 'Cámaras', icono: 'videocam' },
  { id: 'grupos', texto: 'Grupos', icono: 'label' },
  { id: 'mosaicos', texto: 'Mosaicos', icono: 'grid_view' },
  { id: 'zonas', texto: 'Zonas', icono: 'pentagon' },
  { id: 'reglas', texto: 'Reglas', icono: 'rule' },
  { id: 'ajustes', texto: 'Ajustes y canales', icono: 'tune' },
  { id: 'sistema', texto: 'Sistema / IA / GPU', icono: 'memory' },
  { id: 'auditoria', texto: 'Auditoría', icono: 'policy' },
  { id: 'privacidad', texto: 'Privacidad', icono: 'privacy_tip' },
];
const CATALOGOS: Pestana[] = ['sedes', 'agentes', 'grabadores', 'camaras', 'grupos', 'mosaicos'];

/**
 * Configuración del módulo, en pestañas (la elegida queda en `?tab=` para poder enlazarla).
 * El orden sigue el camino natural de una instalación: sede → agente (si hace falta) →
 * grabador → cámaras → zonas → reglas → canales.
 */
@Component({
  selector: 'app-seguridad-configuracion',
  standalone: true,
  imports: [MatIconModule, CfgCatalogos, CfgZonas, CfgReglas, CfgAjustes, CfgSistema, CfgAuditoria],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="pestanas-cfg" aria-label="Secciones de configuración">
      @for (p of pestanas; track p.id) {
        <button type="button" class="pestana-cfg" [class.activa]="pestana() === p.id" [attr.aria-current]="pestana() === p.id ? 'page' : null" (click)="ir(p.id)">
          <mat-icon aria-hidden="true">{{ p.icono }}</mat-icon><span>{{ p.texto }}</span>
        </button>
      }
    </nav>
    @if (esCatalogo()) {
      <sg-cfg-catalogos [seccion]="catalogo()" (irAZonas)="abrirZonas($event)" />
    } @else {
      @switch (pestana()) {
        @case ('zonas') { <sg-cfg-zonas [camaraInicial]="camaraZonas()" /> }
        @case ('reglas') { <sg-cfg-reglas /> }
        @case ('ajustes') { <sg-cfg-ajustes modo="ajustes" /> }
        @case ('privacidad') { <sg-cfg-ajustes modo="privacidad" /> }
        @case ('sistema') { <sg-cfg-sistema /> }
        @case ('auditoria') { <sg-cfg-auditoria /> }
      }
    }
  `,
  styleUrls: ['../../styles/seguridad-comun.css', './configuracion.css'],
  host: { class: 'cfg-raiz' },
})
export class SeguridadConfiguracion {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly pestanas = PESTANAS;
  readonly pestana = signal<Pestana>('sedes');
  readonly camaraZonas = signal<string | null>(null);

  constructor() {
    const q = this.route.snapshot.queryParamMap;
    const t = q.get('tab') as Pestana | null;
    if (t && PESTANAS.some((p) => p.id === t)) this.pestana.set(t);
    const cam = q.get('camara');
    if (cam) this.camaraZonas.set(cam);
  }

  esCatalogo(): boolean { return CATALOGOS.includes(this.pestana()); }
  catalogo(): SeccionCatalogo { return this.pestana() as SeccionCatalogo; }

  ir(p: Pestana): void {
    this.pestana.set(p);
    this.router.navigate([], { relativeTo: this.route, queryParams: { tab: p, camara: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  abrirZonas(camaraId: string): void {
    this.camaraZonas.set(camaraId);
    this.pestana.set('zonas');
    this.router.navigate([], { relativeTo: this.route, queryParams: { tab: 'zonas', camara: camaraId }, queryParamsHandling: 'merge', replaceUrl: true });
  }
}
