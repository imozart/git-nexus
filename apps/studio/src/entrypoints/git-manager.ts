// Estado do Git do computador e instalação "uma de cada vez" (processo principal). Sem Electron aqui dentro: detecção, instalação e o que fazer ao
// achar o Git entram por parâmetro, então o arquivo é testável. main.ts liga isto aos IPCs e ao bloqueio das chamadas.
import type { GitAvailability, GitInstallMethod, GitInstallProgress } from '@git-nexus/git-core/pure';
import type { Detected } from './git-detect';

export interface ManagerDeps {
  detect: () => Promise<Detected>;
  /** Faz a instalação; devolve o que a detecção achou depois dela. */
  install: (emit: (p: GitInstallProgress) => void, signal: AbortSignal) => Promise<Detected>;
  /** Método da instalação automática neste sistema (pode mudar: no macOS depende de o Homebrew existir). */
  method: () => GitInstallMethod;
  /** Versão mínima exigida, para mostrar na interface. */
  min: string | null;
  /** Achou (ou instalou) o Git: aplicar o caminho ao ambiente e reiniciar o worker. */
  onFound: (found: Detected) => void;
  log: (line: string) => void;
}

export class GitManager {
  private state: Detected = { status: 'missing' };
  private running: { abort: AbortController; promise: Promise<GitAvailability> } | null = null;
  /** Primeira detecção concluída (as chamadas esperam por ela para não recusar antes da hora). */
  readonly ready: Promise<void>;

  constructor(private readonly deps: ManagerDeps) {
    this.ready = this.refresh().then(() => undefined);
  }

  availability(): GitAvailability {
    const method = this.deps.method();
    return {
      status: this.state.status,
      ...(this.state.path ? { path: this.state.path } : {}),
      ...(this.state.version ? { version: this.state.version } : {}),
      ...(this.deps.min ? { minVersion: this.deps.min } : {}),
      method,
      canInstall: method !== 'manual',
    };
  }

  /** O app só funciona com o Git `ok`: ausente ou antigo demais bloqueia. */
  isBlocked(): boolean {
    return this.state.status !== 'ok';
  }

  async refresh(): Promise<GitAvailability> {
    const found = await this.deps.detect();
    this.apply(found);
    return this.availability();
  }

  private apply(found: Detected): void {
    const changed = found.path !== this.state.path || found.status !== this.state.status;
    this.state = found;
    if (changed) this.deps.log(`git: ${found.status}${found.version ? ` ${found.version}` : ''}${found.path ? ` (${found.path})` : ''}`);
    if (found.status === 'ok') this.deps.onFound(found);
  }

  /** Instala o Git. Chamar de novo durante a instalação devolve a mesma. Falhas propagam (a interface mostra o texto). */
  install(emit: (p: GitInstallProgress) => void): Promise<GitAvailability> {
    if (this.running) return this.running.promise;
    if (this.state.status === 'ok') return Promise.resolve(this.availability());
    const abort = new AbortController();
    const promise = this.deps
      .install(emit, abort.signal)
      .then((found) => {
        this.apply(found);
        return this.availability();
      })
      .finally(() => {
        this.running = null;
      });
    this.running = { abort, promise };
    return promise;
  }

  get installing(): boolean {
    return this.running !== null;
  }

  cancel(): void {
    this.running?.abort.abort();
  }
}
