import { Component, OnDestroy, OnInit, ChangeDetectionStrategy, signal, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme.service';


declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        on: (channel: string, func: (...args: any[]) => void) => () => void;
        send: (channel: string, ...args: any[]) => void;
        invoke: (channel: string, ...args: any[]) => Promise<any>;
        removeAllListeners: (channel: string) => void;
      };
      version: { get: () => Promise<string> };
      env: { get: () => Promise<string> };
      fingerprint: { get: () => Promise<{ success: boolean; data?: string; error?: string }> };
      pdf: {
        editExternal: (fileUrl: string) => Promise<any>;
        readFile: () => Promise<any>;
        finishEdit: () => Promise<any>;
        openInWindow: (payload: { base64: string; title?: string; width?: number; height?: number }) => Promise<{ success: boolean; error?: string }>;
        onFileChanged: (callback: (data: any) => void) => () => void;
      };
      shell: {
        openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
      };
      db: {
        saveRequestQueue: (req: {
          method: string;
          url: string;
          body: string | null;
          headers: string | null;
          idempotencyKey?: string | null;
          userId?: string | null;
        }) => Promise<{ success: boolean; id?: number; error?: string }>;
        saveMultipartRequest: (payload: {
          method: string;
          url: string;
          headers: string | null;
          formFields: { name: string; value: string }[];
          files: { fieldName: string; fileName: string; mimeType: string | null; storedPath: string }[];
          idempotencyKey?: string | null;
          userId?: string | null;
        }) => Promise<{ success: boolean; id?: number; error?: string }>;
        getRequestFiles: (requestId: number) => Promise<{
          id: number; field_name: string; file_name: string; mime_type: string | null; stored_path: string;
        }[]>;
        getPendingRequests: (opts?: { userId?: string | null }) => Promise<any[]>;
        getFailedRequests: (opts?: { userId?: string | null }) => Promise<any[]>;
        deleteRequest: (id: number) => Promise<{ success: boolean; changes?: number }>;
        retryRequest: (id: number) => Promise<{ success: boolean; changes?: number }>;
        discardRequest: (id: number) => Promise<{ success: boolean; changes?: number }>;
        cacheSave: (data: { url: string; data: string }) => Promise<{ success: boolean }>;
        cacheGet: (url: string) => Promise<any>;
        cacheGetAllUrls: () => Promise<string[]>;
        cacheInvalidatePrefix: (prefix: string) => Promise<{ success: boolean; changes?: number }>;
        markRequestStatus: (data: { id: number; status: string; error?: string }) => Promise<{ success: boolean; changes?: number }>;
        // En 401: borra solo cache (la cola sobrevive al re-login del mismo usuario).
        clearCache: () => Promise<{ success: boolean; error?: string }>;
        // En logout manual confirmado: borra cola + uploads.
        clearQueue: () => Promise<{ success: boolean; error?: string }>;
        // Alias retro (cache + cola). Se mantiene para compat.
        clearUserData: () => Promise<{ success: boolean; error?: string }>;
      };
      offline: {
        saveUpload: (payload: { base64: string; fileName: string; mimeType: string }) =>
          Promise<{ success: boolean; storedPath?: string; size?: number; mimeType?: string | null; error?: string }>;
        readUpload: (storedPath: string) =>
          Promise<{ success: boolean; base64?: string; error?: string }>;
        deleteUpload: (storedPath: string) =>
          Promise<{ success: boolean; error?: string }>;
      };
    };
  }
}

type UpdaterState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'Tesoreria';

  // Se inyecta aquí para que el tema quede aplicado (y escuchando el modo del
  // sistema, si esa es la preferencia) desde el arranque, en cualquier ruta.
  private readonly theme = inject(ThemeService);

  // ─── Updater overlay state ───────────────────────────────────────────────
  // Mostrar el overlay desde el segundo cero bloquea login y navegación hasta
  // que el updater confirme si hay actualización pendiente. Sin esto los
  // usuarios entraban, hacían trabajo, y la actualización quedaba en limbo.
  readonly state = signal<UpdaterState>('idle');
  readonly version = signal<string>('');
  readonly percent = signal<number>(0);
  readonly transferredBytes = signal<number>(0);
  readonly totalBytes = signal<number>(0);
  readonly bytesPerSecond = signal<number>(0);

  readonly transferredMb = computed(() => (this.transferredBytes() / 1024 / 1024).toFixed(1));
  readonly totalMb = computed(() => (this.totalBytes() / 1024 / 1024).toFixed(1));
  readonly speedMb = computed(() => (this.bytesPerSecond() / 1024 / 1024).toFixed(1));
  readonly eta = computed(() => {
    const remaining = this.totalBytes() - this.transferredBytes();
    const speed = this.bytesPerSecond();
    if (!speed || remaining <= 0) return '';
    const seconds = Math.ceil(remaining / speed);
    if (seconds < 60) return `~${seconds}s restantes`;
    const minutes = Math.ceil(seconds / 60);
    return `~${minutes} min restantes`;
  });

  private cleanupFns: (() => void)[] = [];
  private safetyTimer: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit() {
    if (typeof window === 'undefined' || !window.electron) {
      // Build web/SSR: nada que hacer.
      return;
    }

    // Solo bloqueamos en producción. En dev el updater no corre y no queremos
    // congelar el flujo de hot-reload.
    let env = 'production';
    try { env = await window.electron.env.get(); } catch { /* asumimos prod */ }

    if (env !== 'production') {
      this.setupUpdateListeners(); // listener defensivo por si el dev fuerza un release
      return;
    }

    this.state.set('checking');
    this.setupUpdateListeners();

    // Doble red de seguridad además del timeout en main: si por algún motivo
    // el evento no llega al renderer (preload reload, IPC dropped) destrabamos.
    this.safetyTimer = setTimeout(() => {
      if (this.state() === 'checking') {
        this.state.set('idle');
      }
    }, 15000);
  }

  ngOnDestroy() {
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
  }

  private listen(channel: string, handler: (...args: any[]) => void) {
    const unsub = window.electron.ipcRenderer.on(channel, handler);
    if (typeof unsub === 'function') this.cleanupFns.push(unsub);
  }

  private setupUpdateListeners(): void {
    this.listen('update-not-available', () => {
      this.state.set('idle');
    });

    this.listen('update-available', (info: any) => {
      this.version.set(info?.version || '');
      this.state.set('available');
    });

    this.listen('update-progress', (p: any) => {
      this.percent.set(Math.floor(p?.percent ?? 0));
      this.transferredBytes.set(p?.transferred ?? 0);
      this.totalBytes.set(p?.total ?? 0);
      this.bytesPerSecond.set(p?.bytesPerSecond ?? 0);
      this.state.set('downloading');
    });

    this.listen('update-downloaded', () => {
      this.state.set('ready');
    });

    this.listen('update-error', (error: any) => {
      const msg = typeof error === 'string' ? error : error?.message || String(error);
      console.warn('[autoUpdater]', msg);
      // Si falla el updater no queremos dejar al usuario bloqueado: liberamos
      // la app para que pueda trabajar normalmente.
      if (this.state() !== 'ready') {
        this.state.set('idle');
      }
    });
  }
}
