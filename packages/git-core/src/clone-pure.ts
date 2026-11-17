// Clonar e criar repositórios: a parte pura (sem Node), usada pela interface para mostrar o nome da pasta e validar os campos antes de chamar o git.
import { tm } from './messages.js';
import { classifyRemoteFailure, remoteFailureMessage } from './askpass-pure.js';

/** Caracteres que o Windows não aceita em nome de pasta (e que não fazem sentido em nenhum sistema). */
// eslint-disable-next-line no-control-regex
const ILLEGAL_IN_NAME = /[<>:"/\\|?*\u0000-\u001f]/;

/** Tira as barras (`/` e `\`) do fim. Laço simples: uma regex `[\\/]+$` fica quadrática em texto com muitas barras (CodeQL). */
function trimSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && (s[end - 1] === '/' || s[end - 1] === '\\')) end--;
  return s.slice(0, end);
}

/**
 * Nome da pasta que o `git clone` criaria a partir da URL: `https://host/grupo/projeto.git` → `projeto`, `git@host:grupo/projeto.git` →
 * `projeto`, `C:\repos\projeto\` → `projeto`. Vazio quando não dá para saber.
 */
export function repoNameFromUrl(url: string): string {
  let s = trimSlashes(url.trim());
  if (s.toLowerCase().endsWith('.git')) s = trimSlashes(s.slice(0, -4));
  // a última parte depois de "/", "\" ou ":" (scp-like: git@host:grupo/projeto)
  const last = s.split(/[\\/:]/).pop() ?? '';
  const name = last.replace(/[<>"|?*\u0000-\u001f]/g, '').trim();
  return name === '.' || name === '..' ? '' : name;
}

/** Nome válido para uma pasta nova: sem separadores nem caracteres proibidos, sem terminar em ponto ou espaço, nunca "." ou "..". */
export function isValidFolderName(name: string): boolean {
  const n = name;
  return n.length > 0 && n.length <= 200 && n !== '.' && n !== '..' && !ILLEGAL_IN_NAME.test(n) && !/[. ]$/.test(n) && n === n.trim();
}

/** Segue as regras de `git check-ref-format --branch` para o nome da branch inicial (o git faz a conferência final). */
export function isValidBranchName(name: string): boolean {
  if (!name || name === '@' || name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false;
  if (/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(name) || name.includes('..') || name.includes('@{') || name.includes('//')) return false;
  return name.split('/').every((part) => part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock'));
}

/** Por que um clone falhou, em categorias que a interface sabe explicar. */
export type CloneFailure = 'auth' | 'notFound' | 'network' | 'exists' | 'branch' | 'other';

/** Lê a saída de erro do `git clone` e diz qual foi a causa. Sem regex com `.*` entre partes (evita backtracking em saídas longas). */
export function classifyCloneFailure(output: string): CloneFailure {
  const low = output.toLowerCase();
  if (low.includes('already exists and is not an empty directory')) return 'exists';
  if (low.includes('remote branch') && low.includes('not found')) return 'branch';
  // o resto (acesso, não encontrado, rede) segue a regra única das operações com o remoto
  const k = classifyRemoteFailure(output);
  if (k === 'auth' || k === 'notFound' || k === 'network') return k;
  return 'other';
}

/** Mensagem para a pessoa, por causa; o texto cru do git vai junto quando a causa não é conhecida. */
export function cloneFailureMessage(kind: CloneFailure, raw: string): string {
  const detail = raw.trim().split('\n').filter((l) => l.trim()).slice(-2).join(' ');
  switch (kind) {
    case 'auth':
      return remoteFailureMessage('auth') ?? '';
    case 'notFound':
      return tm('Repositório não encontrado. Confira o endereço e se você tem acesso a ele.', 'Repository not found. Check the address and that you have access to it.');
    case 'network':
      return tm('Não foi possível conectar ao servidor. Confira o endereço e a conexão.', 'Could not connect to the server. Check the address and your connection.');
    case 'exists':
      return tm('A pasta de destino já existe e não está vazia. Escolha outro nome ou outra pasta.', 'The destination folder already exists and is not empty. Pick another name or folder.');
    case 'branch':
      return tm('A branch pedida não existe nesse repositório.', 'The requested branch does not exist in that repository.');
    default:
      return tm(`O clone falhou: ${detail || 'erro desconhecido'}`, `The clone failed: ${detail || 'unknown error'}`);
  }
}

/** Modelos de `.gitignore` oferecidos ao criar um repositório. */
export const GITIGNORE_TEMPLATES = [
  { id: 'none', label: '—' },
  { id: 'node', label: 'Node.js' },
  { id: 'java', label: 'Java (Maven/Gradle)' },
  { id: 'python', label: 'Python' },
  { id: 'dotnet', label: '.NET' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'ide', label: 'IDEs e sistemas (só o básico)' },
] as const;
export type GitignoreTemplate = (typeof GITIGNORE_TEMPLATES)[number]['id'];

const IDE = ['# IDEs e editores', '.idea/', '.vscode/', '*.iml', '*.swp', '', '# Sistema', '.DS_Store', 'Thumbs.db', ''];
const BODY: Record<Exclude<GitignoreTemplate, 'none' | 'ide'>, string[]> = {
  node: ['# Node.js', 'node_modules/', 'dist/', 'build/', 'coverage/', '*.log', 'npm-debug.log*', '.env', '.env.local', '.pnpm-store/', ''],
  java: ['# Java', '*.class', '*.jar', '*.war', 'target/', 'build/', '.gradle/', 'out/', 'hs_err_pid*', ''],
  python: ['# Python', '__pycache__/', '*.py[cod]', '.venv/', 'venv/', '.pytest_cache/', '*.egg-info/', 'dist/', 'build/', '.env', ''],
  dotnet: ['# .NET', 'bin/', 'obj/', '*.user', '*.suo', '.vs/', 'packages/', 'TestResults/', ''],
  go: ['# Go', '*.exe', '*.test', '*.out', 'vendor/', 'bin/', ''],
  rust: ['# Rust', 'target/', 'Cargo.lock.bak', '**/*.rs.bk', ''],
};

/** Conteúdo do `.gitignore` do modelo (já com as linhas de IDE e sistema). Vazio para "none". */
export function gitignoreContent(id: string): string {
  if (id === 'none') return '';
  const body = id === 'ide' ? [] : (BODY as Record<string, string[] | undefined>)[id];
  if (id !== 'ide' && !body) return '';
  return [...(body ?? []), ...IDE].join('\n');
}
