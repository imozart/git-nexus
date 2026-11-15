// Descrição dos comandos git executados pelo app (aba "Log"): texto legível, sem segredos, e se o comando só lê ou altera o repositório.
// Módulo PURO (sem Node): usado pelo runner (que emite o evento) e pelos testes.

/** Máximo de caracteres de saída guardados por comando. */
export const MAX_OUTPUT = 4000;

const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi;
const HEADER = /\b(authorization|proxy-authorization|private-token|x-access-token)\s*[:=]\s*[^\r\n"']*/gi;
const KV_SECRET = /\b(password|passwd|token|secret|access_token)=[^\s&]+/gi;

/** Remove credenciais de um texto: `https://user:token@host`, cabeçalhos de autorização e `password=`/`token=`. */
export function redactSecrets(text: string): string {
  return text
    .replace(URL_USERINFO, '$1***@')
    .replace(HEADER, (_m, name: string) => `${name}: ***`)
    .replace(KV_SECRET, (_m, name: string) => `${name}=***`);
}

const needsQuotes = /[\s"'\\]|^$/;
const quote = (a: string) => (needsQuotes.test(a) ? `"${a.replace(/(["\\])/g, '\\$1')}"` : a);

/** `git status --porcelain` como o usuário digitaria, já sem segredos. */
export function formatGitCommand(args: readonly string[]): string {
  return redactSecrets(['git', ...args].map(quote).join(' '));
}

/** Opções globais do git que antecedem o subcomando; devolve o índice do subcomando e os argumentos depois dele. */
function split(args: readonly string[]): { sub: string; rest: string[] } {
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a === '-c' || a === '-C' || a === '--git-dir' || a === '--work-tree' || a === '--namespace') i += 2;
    else if (a.startsWith('-')) i += 1;
    else break;
  }
  return { sub: args[i] ?? '', rest: args.slice(i + 1) };
}

/** Subcomandos que nunca alteram o repositório. */
const ALWAYS_READ = new Set([
  'status', 'log', 'diff', 'show', 'rev-parse', 'rev-list', 'for-each-ref', 'ls-files', 'ls-tree', 'ls-remote', 'cat-file', 'blame',
  'describe', 'shortlog', 'merge-base', 'name-rev', 'grep', 'check-ignore', 'count-objects', 'var', 'version', 'diff-tree', 'diff-index',
  'diff-files', 'show-ref', 'cherry', 'whatchanged', 'verify-commit', 'verify-tag', 'fsck', 'help', 'check-attr', 'range-diff', 'for-each-repo',
]);

const positional = (rest: readonly string[]) => rest.filter((a) => !a.startsWith('-'));

/** O comando só consulta (status, log, diff...)? Na dúvida devolve `false`: é melhor mostrar como alteração do que esconder. */
export function isReadOnlyGit(args: readonly string[]): boolean {
  const { sub, rest } = split(args);
  if (ALWAYS_READ.has(sub)) return true;
  switch (sub) {
    case 'branch':
      return rest.includes('--list') || rest.includes('--show-current') || rest.includes('-l') || positional(rest).length === 0;
    case 'tag':
      return rest.includes('-l') || rest.includes('--list') || positional(rest).length === 0;
    case 'remote':
      return positional(rest).length === 0 || ['show', 'get-url'].includes(positional(rest)[0]!);
    case 'stash':
      return ['list', 'show'].includes(positional(rest)[0] ?? '');
    case 'reflog':
      return !['expire', 'delete'].includes(positional(rest)[0] ?? '');
    case 'config':
      return rest.some((a) => ['--get', '--get-all', '--get-regexp', '--list', '-l', '--get-urlmatch'].includes(a));
    case 'worktree':
      return positional(rest)[0] === 'list';
    case 'symbolic-ref':
      return positional(rest).length <= 1 && !rest.includes('-d');
    default:
      return false;
  }
}

/** Corta a saída no limite, sem segredos e sem linhas vazias nas pontas. */
export function trimOutput(text: string, max = MAX_OUTPUT): string {
  const clean = redactSecrets(text).replace(/\r/g, '').trim();
  return clean.length > max ? `${clean.slice(0, max)}\n…` : clean;
}
