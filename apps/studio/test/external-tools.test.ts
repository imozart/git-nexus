import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { editorLaunches, launchFirst, terminalLaunches, type Spawned } from '../src/entrypoints/external-tools';

describe('terminalLaunches', () => {
  it('Windows: Windows Terminal primeiro, depois PowerShell e cmd, sempre na pasta do repositório', () => {
    const l = terminalLaunches('win32', 'C:\\repos\\meu repo');
    expect(l.map((x) => x.name)).toEqual(['Windows Terminal', 'PowerShell', 'Prompt de Comando']);
    expect(l[0]).toMatchObject({ command: 'wt.exe', args: ['-d', 'C:\\repos\\meu repo'] });
    expect(l[1]).toMatchObject({ cwd: 'C:\\repos\\meu repo' });
  });

  it('macOS abre o Terminal na pasta; Linux tenta os terminais comuns', () => {
    expect(terminalLaunches('darwin', '/Users/a/r')[0]).toMatchObject({ command: 'open', args: ['-a', 'Terminal', '/Users/a/r'] });
    const linux = terminalLaunches('linux', '/home/a/r');
    expect(linux.map((x) => x.command)).toEqual(['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']);
    expect(linux[1]!.args).toEqual(['--working-directory=/home/a/r']);
  });

  it('o caminho NUNCA vira parte de uma linha de comando: pasta com caracteres de shell vai intacta, só como argumento ou diretório', () => {
    const esquisito = 'C:\\repos\\a & calc ; "x" $(z)';
    for (const l of [...terminalLaunches('win32', esquisito), ...terminalLaunches('linux', esquisito), ...terminalLaunches('darwin', esquisito)]) {
      expect(l.command).toMatch(/^[\w.-]+$/); // o comando é só o nome do programa, sem nada do caminho
      for (const a of l.args) expect(a.includes('calc') ? a.endsWith(esquisito) : true).toBe(true); // o caminho entra inteiro, num único argumento
    }
  });
});

describe('editorLaunches', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };

  it('Windows: acha o Code.exe (por usuário ou por máquina) e só ele; nada de code.cmd', () => {
    const porUsuario = 'C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
    expect(editorLaunches('win32', 'C:\\r', env, (p) => p === porUsuario)).toEqual([{ name: 'VS Code', command: porUsuario, args: ['C:\\r'] }]);
    expect(editorLaunches('win32', 'C:\\r', env, () => false)).toEqual([]);
    expect(editorLaunches('win32', 'C:\\r', env, () => true).every((x) => x.command.endsWith('.exe'))).toBe(true);
  });

  it('macOS usa open -a; Linux tenta code e codium', () => {
    expect(editorLaunches('darwin', '/r', {}, () => false)[0]).toMatchObject({ command: 'open', args: ['-a', 'Visual Studio Code', '/r'] });
    expect(editorLaunches('linux', '/r', {}, () => false).map((x) => x.command)).toEqual(['code', 'codium']);
  });
});

/** Processo filho falso: ou "inicia" (`spawn`) ou falha (`error`, como o ENOENT). */
function fake(behaviours: Record<string, 'ok' | 'enoent' | 'throw'>, log: string[] = []) {
  return (command: string, args: string[], options: { shell: false; detached: true }) => {
    log.push(`${command} ${args.join(' ')}|shell=${options.shell}|detached=${options.detached}`);
    const b = behaviours[command] ?? 'enoent';
    if (b === 'throw') throw new Error('EINVAL');
    const ee = new EventEmitter() as EventEmitter & Spawned;
    (ee as unknown as { unref: () => void }).unref = () => undefined;
    queueMicrotask(() => (b === 'ok' ? ee.emit('spawn') : ee.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }))));
    return ee;
  };
}

describe('launchFirst', () => {
  const opts = [
    { name: 'A', command: 'a', args: ['x'] },
    { name: 'B', command: 'b', args: ['y'] },
    { name: 'C', command: 'c', args: ['z'] },
  ];

  it('pula os que não existem ou lançam e devolve o primeiro que inicia', async () => {
    const log: string[] = [];
    expect(await launchFirst(opts, fake({ a: 'enoent', b: 'throw', c: 'ok' }, log) as never)).toBe('C');
    expect(log).toHaveLength(3);
  });

  it('para no primeiro que funciona e nunca usa shell', async () => {
    const log: string[] = [];
    expect(await launchFirst(opts, fake({ a: 'ok', b: 'ok' }, log) as never)).toBe('A');
    expect(log).toEqual(['a x|shell=false|detached=true']);
  });

  it('nenhum funciona: devolve null (a tela explica em vez de falhar calada)', async () => {
    expect(await launchFirst(opts, fake({}) as never)).toBeNull();
    expect(await launchFirst([], fake({}) as never)).toBeNull();
  });
});
