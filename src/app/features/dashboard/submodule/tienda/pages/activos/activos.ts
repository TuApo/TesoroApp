import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

import { DocViewerService } from '@/app/shared/services/doc-viewer/doc-viewer.service';
import { environment } from '../../../../../../../environments/environment';
import { CapturaRostro, EcoCapturaRostro, reducir } from '../../../../../economiapp/components/eco-captura-rostro';
import { EcoFirma } from '../../../../../economiapp/components/eco-firma';
import { CONSENTIMIENTO_VERSION, RESPONSABLE, huellaDelTexto } from '../../../../../economiapp/consentimiento-biometrico';

/** Consentimiento propio de activos: compara con la foto de contratación, solo para esta entrega o devolución. */
const TEXTO_ACTIVO = `Autorizo a ${RESPONSABLE.razonSocial} a tomar una fotografía de mi rostro y compararla con la foto de mi contratación, con la única finalidad de verificar mi identidad para entregarme o recibirme un equipo o elemento de la empresa. Sé que no estoy obligado(a) a hacerlo y que, si no acepto, puedo identificarme con mi cédula original ante el encargado. Mis derechos los puedo ejercer en ${RESPONSABLE.correo}.`;
import { SelectorTienda } from '../../components/selector-tienda/selector-tienda';
import { ContextoTiendaService } from '../../service/contexto-tienda.service';
import { ActivoOficina, MovimientoActivo, TiendaService, VerificacionResumen } from '../../service/tienda.service';
import { EscanerCodigoComponent } from '@/app/shared/components/escaner-codigo/escaner-codigo.component';

const ESTADOS: Record<string, string> = { DISPONIBLE: 'Disponible', ASIGNADO: 'Asignado', MANTENIMIENTO: 'Mantenimiento', BAJA: 'De baja' };
const MOVS: Record<string, string> = { ALTA: 'Alta', ASIGNACION: 'Entregado', DEVOLUCION: 'Devuelto', TRASLADO: 'Traslado', MANTENIMIENTO: 'A mantenimiento', DISPONIBLE: 'Disponible', BAJA: 'Baja' };

/**
 * Activos de oficina: lo que hay en cada punto y quién lo tiene. Entregar y recibir de
 * vuelta exige identificar a la persona (rostro o cédula), foto del documento y su firma.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-activos',
  imports: [CommonModule, FormsModule, MatIconModule, SelectorTienda, EcoCapturaRostro, EcoFirma, EscanerCodigoComponent],
  templateUrl: './activos.html',
  styleUrls: ['../../styles/tienda-comun.css', './activos.css'],
})
export class Activos {
  private api = inject(TiendaService);
  readonly ctx = inject(ContextoTiendaService);
  private visor = inject(DocViewerService);
  readonly ESTADOS = ESTADOS;
  readonly MOVS = MOVS;
  readonly TEXTO = TEXTO_ACTIVO;

  readonly estado = signal('');
  readonly q = signal('');
  readonly lista = signal<ActivoOficina[]>([]);
  readonly resumen = signal<{ estado: string; n: number; valor: number }[]>([]);
  readonly sel = signal<(ActivoOficina & { movimientos: MovimientoActivo[] }) | null>(null);
  readonly error = signal<string | null>(null);
  readonly ocupado = signal(false);

  // Alta
  readonly creando = signal(false);
  nuevo: Partial<ActivoOficina> = { estado_fisico: 'BUENO' };

  // Entrega / devolución
  readonly accion = signal<'' | 'entregar' | 'devolver' | 'trasladar' | 'estado'>('');
  readonly cedula = signal('');
  readonly persona = signal<{ nombre: string | null; foto_doc_id: string | null } | null>(null);
  readonly modo = signal<'rostro' | 'cedula'>('rostro');
  readonly acepta = signal(false);
  readonly verificacion = signal<VerificacionResumen | null>(null);
  readonly fotoDocumento = signal<string | null>(null);
  readonly fotoEstado = signal<string | null>(null);
  readonly firma = signal<Blob | null>(null);
  readonly estadoFisico = signal('BUENO');
  readonly nota = signal('');
  readonly destino = signal('');
  readonly nuevoEstado = signal('MANTENIMIENTO');

  readonly listoEntregar = computed(() => !!this.verificacion()?.aprueba && !!this.firma()
    && (this.accion() === 'devolver' || !!this.fotoDocumento()));

  constructor() {
    this.ctx.cargar();
    effect(() => { this.ctx.tiendaId(); this.estado(); untracked(() => this.cargar()); });
  }

  async cargar(): Promise<void> {
    try {
      const r = await firstValueFrom(this.api.activos({ tienda: this.ctx.tiendaId() ?? undefined, estado: this.estado(), q: this.q() }));
      this.lista.set(r.activos); this.resumen.set(r.resumen.por_estado); this.error.set(null);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudieron cargar los activos'); }
  }
  cuenta(e: string): number { return +(this.resumen().find(x => x.estado === e)?.n ?? 0); }

  async abrir(id: string): Promise<void> {
    try { this.sel.set(await firstValueFrom(this.api.activo(id))); this.cancelarAccion(); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo abrir'); }
  }

  async crear(): Promise<void> {
    const t = this.ctx.tiendaId(); if (!t) { this.error.set('Elija la tienda u oficina arriba'); return; }
    this.ocupado.set(true);
    try {
      const a = await firstValueFrom(this.api.crearActivo({ ...this.nuevo, tienda_id: t }));
      this.creando.set(false); this.nuevo = { estado_fisico: 'BUENO' }; await this.cargar(); this.abrir(a.id);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo crear'); }
    finally { this.ocupado.set(false); }
  }

  empezar(a: '' | 'entregar' | 'devolver' | 'trasladar' | 'estado'): void {
    this.cancelarAccion(); this.accion.set(a);
    const s = this.sel();
    if (a === 'devolver' && s?.asignado_cedula) { this.cedula.set(s.asignado_cedula); this.buscarPersona(); }
  }
  cancelarAccion(): void {
    this.accion.set(''); this.cedula.set(''); this.persona.set(null); this.verificacion.set(null); this.fotoDocumento.set(null);
    this.fotoEstado.set(null); this.firma.set(null); this.estadoFisico.set('BUENO'); this.nota.set(''); this.acepta.set(false); this.modo.set('rostro');
  }

  async buscarPersona(): Promise<void> {
    const c = this.cedula().trim(); if (!c) return;
    try { const e = await firstValueFrom(this.api.expediente(c)); this.persona.set({ nombre: e.nombre, foto_doc_id: e.foto_doc_id }); }
    catch { this.persona.set({ nombre: null, foto_doc_id: null }); }
  }

  async conRostro(c: CapturaRostro): Promise<void> {
    this.ocupado.set(true); this.error.set(null);
    try {
      const v = await firstValueFrom(this.api.verificarRostroActivo(this.cedula().trim(), c.blob, c.vivacidad,
        { version: CONSENTIMIENTO_VERSION, sha256: await huellaDelTexto(TEXTO_ACTIVO) }));
      this.verificacion.set(v);
      if (!v.aprueba) this.error.set('El rostro no coincide con la foto de contratación. Verifique con la cédula original.');
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo verificar'); }
    finally { this.ocupado.set(false); }
  }
  async conCedula(): Promise<void> {
    this.ocupado.set(true); this.error.set(null);
    try { this.verificacion.set(await firstValueFrom(this.api.verificarPresencialActivo(this.cedula().trim(), this.nota().trim() || 'Cédula original revisada'))); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo registrar'); }
    finally { this.ocupado.set(false); }
  }

  async foto(cual: 'documento' | 'estado', ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0]; const s = this.sel(); if (!f || !s) return;
    try {
      const id = await firstValueFrom(this.api.subirArchivo(await reducir(f, 1800), `${cual}.jpg`, s.id, 'STORE_ACTIVO'));
      (cual === 'documento' ? this.fotoDocumento : this.fotoEstado).set(id);
    } catch { this.error.set('No se pudo subir la foto'); }
  }

  async confirmar(): Promise<void> {
    const s = this.sel(); if (!s || !this.listoEntregar()) return;
    this.ocupado.set(true); this.error.set(null);
    try {
      const firmaId = await firstValueFrom(this.api.subirArchivo(this.firma()!, 'firma.png', s.id, 'STORE_ACTIVO'));
      const cuerpo = { cedula: this.cedula().trim(), nombre: this.persona()?.nombre ?? null, verificacion_id: this.verificacion()!.id,
        foto_documento_doc_id: this.fotoDocumento(), firma_doc_id: firmaId, foto_estado_doc_id: this.fotoEstado(),
        estado_fisico: this.estadoFisico(), nota: this.nota().trim() || null };
      await firstValueFrom(this.accion() === 'entregar' ? this.api.asignarActivo(s.id, cuerpo) : this.api.devolverActivo(s.id, cuerpo));
      await this.cargar(); await this.abrir(s.id);
    } catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo registrar'); }
    finally { this.ocupado.set(false); }
  }

  async trasladar(): Promise<void> {
    const s = this.sel(); if (!s || !this.destino()) return;
    try { await firstValueFrom(this.api.trasladarActivo(s.id, this.destino(), this.nota().trim() || null)); await this.cargar(); await this.abrir(s.id); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo trasladar'); }
  }
  async cambiarEstado(): Promise<void> {
    const s = this.sel(); if (!s) return;
    try { await firstValueFrom(this.api.estadoActivo(s.id, this.nuevoEstado(), this.nota().trim() || null)); await this.cargar(); await this.abrir(s.id); }
    catch (e: any) { this.error.set(e?.error?.error ?? 'No se pudo cambiar el estado'); }
  }

  ver(doc: string | null): void { if (doc) this.visor.openInNewTab(`${environment.apiUrl}/api/v1/documents/${doc}/download`); }
}
