// Detecção do Git (processo principal): acha um `git` que de fato executa e diz a versão. Sem Electron aqui dentro: o que roda comandos e olha o
// disco entra por parâmetro, então o arquivo é testável com um "sistema" falso. Os candidatos e a leitura de versão vêm de shared/git-install.ts.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { MIN_GIT_VERSION, effectiveMinGitVersion, gitCandidates, isOutdated, parseGitVersion, type DetectEnv } from '../shared/git-install';

export interface ExecResult {
  /** Saída (stdout + stderr). */
  output: string;
  /** Código de saída; `-1` quando o programa nem chegou a iniciar (não existe, sem permissão, tempo esgotado). */
  code: number;
}
export type Exec = (file: string, args: string[], opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv }) => Promise<ExecResult>;

/** Executa sem shell (vetor de argumentos) e nunca lança. */
export const realExec: Exec = (file, args, opts) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: opts?.timeoutMs ?? 10_000, windowsHide: true, env: opts?.env ?? process.env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : -1) : 0;
      resolve({ output: `${stdout ?? ''}${stderr ?? ''}`, code });
    });
  });

export interface DetectDeps extends DetectEnv {
  exec: Exec;
  exists: (path: string) => boolean;
  /** Versão mínima (padrão: a do app). */
  min?: string | null;
}

export interface Detected {
  status: 'ok' | 'missing' | 'outdated';
  path?: string;
  version?: string;
}

/** Variável para forçar o estado "sem Git" em testes de interface (e para quem quiser ver o fluxo): `GITNEXUS_FORCE_GIT_MISSING=1`. */
export const FORCE_MISSING_ENV = 'GITNEXUS_FORCE_GIT_MISSING';

/**
 * Procura o Git: o caminho guardado pelo app (`GITNEXUS_GIT_PATH`), o do PATH e os lugares conhecidos de cada sistema. O primeiro que responde
 * a `git --version` e é aceito vale; se só houver um antigo demais, devolve `outdated` com ele.
 */
export async function detectGit(d: DetectDeps): Promise<Detected> {
  if (d.env[FORCE_MISSING_ENV] === '1') return { status: 'missing' };
  const min = d.min === undefined ? MIN_GIT_VERSION : d.min;
  const cltInstalled = d.platform === 'darwin' ? (await d.exec('xcode-select', ['-p'])).code === 0 : undefined;
  const list = [...(d.env.GITNEXUS_GIT_PATH ? [d.env.GITNEXUS_GIT_PATH] : []), ...gitCandidates(d, { cltInstalled })];
  let old: Detected | null = null;
  for (const path of [...new Set(list)]) {
    if (path !== 'git' && !d.exists(path)) continue;
    const r = await d.exec(path, ['--version']);
    const version = r.code === 0 ? parseGitVersion(r.output) : null;
    if (!version) continue;
    if (!isOutdated(version, min)) return { status: 'ok', path, version };
    old ??= { status: 'outdated', path, version };
  }
  return old ?? { status: 'missing' };
}

/** `git`/`brew`/`make`… está no PATH? (procura o arquivo; no Windows tenta também `.exe`). */
export function makeHas(env: Record<string, string | undefined>, exists: (p: string) => boolean, platform: string): (bin: string) => boolean {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const exts = platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  return (bin) => dirs.some((dir) => exts.some((x) => exists(join(dir, bin + x))));
}

/**
 * Variáveis que fazem o worker (e os programas que o git chama) usarem o Git encontrado: o caminho absoluto e a pasta dele no começo do PATH.
 * Caminho relativo (`git`, o do PATH) não muda nada.
 */
export function gitEnvFor(path: string | undefined, env: Record<string, string | undefined>): Record<string, string> {
  if (!path || path === 'git') return {};
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const dir = dirname(path);
  const parts = (env[key] ?? '').split(delimiter).filter(Boolean);
  return { GITNEXUS_GIT_PATH: path, [key]: [dir, ...parts.filter((p) => p !== dir)].join(delimiter) };
}

/** Dependências reais (sistema de arquivos e processos). */
export const realDetectDeps = (dataDir: string): DetectDeps => ({
  platform: process.platform,
  env: process.env,
  dataDir,
  exec: realExec,
  exists: existsSync,
  min: effectiveMinGitVersion(process.env),
});
