// Abrir o repositório no terminal e no editor. Parte testável (sem Electron): quais programas tentar em cada sistema e como lançá-los.
// NUNCA passa pelo shell: o caminho do repositório vai como argumento (ou como diretório de trabalho), então nome de pasta com `&`, `;` ou aspas
// não executa nada. Programas que só existem como script (`code.cmd`, no Windows) ficam de fora de propósito: precisariam do shell.
// Os caminhos do Windows são montados com `win32.join` (e não com o `join` do sistema): assim o resultado é o mesmo em qualquer plataforma, inclusive no teste.
import { win32 } from 'node:path';

export interface Launch {
  /** Nome para a mensagem ("Windows Terminal", "VS Code"). */
  name: string;
  command: string;
  args: string[];
  /** Diretório de trabalho (alguns terminais só abrem na pasta do processo). */
  cwd?: string;
}

/** Terminais a tentar, do mais comum ao menos. O primeiro que iniciar vale. */
export function terminalLaunches(platform: NodeJS.Platform | string, dir: string): Launch[] {
  switch (platform) {
    case 'win32':
      return [
        { name: 'Windows Terminal', command: 'wt.exe', args: ['-d', dir] },
        { name: 'PowerShell', command: 'powershell.exe', args: ['-NoExit'], cwd: dir },
        { name: 'Prompt de Comando', command: 'cmd.exe', args: [], cwd: dir },
      ];
    case 'darwin':
      return [{ name: 'Terminal', command: 'open', args: ['-a', 'Terminal', dir] }];
    default:
      return [
        { name: 'x-terminal-emulator', command: 'x-terminal-emulator', args: [], cwd: dir },
        { name: 'GNOME Terminal', command: 'gnome-terminal', args: [`--working-directory=${dir}`] },
        { name: 'Konsole', command: 'konsole', args: ['--workdir', dir] },
        { name: 'xfce4-terminal', command: 'xfce4-terminal', args: [`--working-directory=${dir}`] },
        { name: 'xterm', command: 'xterm', args: [], cwd: dir },
      ];
  }
}

/**
 * Editores a tentar. No Windows o VS Code é procurado pelo `Code.exe` (instalação por usuário ou por máquina) e não pelo `code.cmd` do PATH;
 * `exists` diz se um caminho existe (injetado para o teste não depender da máquina).
 */
export function editorLaunches(platform: NodeJS.Platform | string, dir: string, env: Record<string, string | undefined>, exists: (p: string) => boolean): Launch[] {
  if (platform === 'win32') {
    const roots = [env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles, env['ProgramFiles(x86)']].filter((r): r is string => !!r);
    const out: Launch[] = [];
    for (const [name, folder, exe] of [
      ['VS Code', 'Microsoft VS Code', 'Code.exe'],
      ['VSCodium', 'VSCodium', 'VSCodium.exe'],
    ] as const) {
      for (const r of roots) {
        const full = win32.join(r, folder, exe);
        if (exists(full)) out.push({ name, command: full, args: [dir] });
      }
    }
    return out;
  }
  if (platform === 'darwin') {
    return [
      { name: 'VS Code', command: 'open', args: ['-a', 'Visual Studio Code', dir] },
      { name: 'VSCodium', command: 'open', args: ['-a', 'VSCodium', dir] },
    ];
  }
  return [
    { name: 'VS Code', command: 'code', args: [dir] },
    { name: 'VSCodium', command: 'codium', args: [dir] },
  ];
}

/** O que `launchFirst` precisa de um processo filho (o `ChildProcess` do Node serve). */
export interface Spawned {
  once(event: 'spawn', cb: () => void): unknown;
  once(event: 'error', cb: (e: Error) => void): unknown;
  unref(): void;
}
export type SpawnFn = (command: string, args: string[], options: { cwd?: string; detached: true; stdio: 'ignore'; shell: false; windowsHide: false }) => Spawned;

/** Tenta cada opção até uma iniciar (`spawn`); `ENOENT` e afins passam para a próxima. Devolve o nome do que abriu ou `null`. */
export async function launchFirst(options: Launch[], spawn: SpawnFn): Promise<string | null> {
  for (const o of options) {
    const ok = await new Promise<boolean>((resolve) => {
      try {
        const child = spawn(o.command, o.args, { ...(o.cwd ? { cwd: o.cwd } : {}), detached: true, stdio: 'ignore', shell: false, windowsHide: false });
        child.once('spawn', () => {
          child.unref();
          resolve(true);
        });
        child.once('error', () => resolve(false));
      } catch {
        resolve(false);
      }
    });
    if (ok) return o.name;
  }
  return null;
}
