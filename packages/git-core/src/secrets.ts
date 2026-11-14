import { runGit } from './runner.js';
import type { SecretFinding, SecretsConfig } from './types/ipc.js';

/** Marcador que o desenvolvedor coloca na linha para dizer "isto não é um segredo". */
export const ALLOW_MARKER = 'gitnexus:allow-secret';

interface Rule {
  name: string;
  re: RegExp;
  /** Filtro extra sobre o trecho encontrado (descarta placeholders / baixa entropia). */
  accept?: (match: string, groups: string[]) => boolean;
}

const PLACEHOLDER = /(your|example|sample|dummy|changeme|change_me|placeholder|xxxx|\*\*\*|<[^>]+>|\$\{|process\.env|%\w+%|todo|fake|test)/i;

/** Entropia de Shannon (bits por caractere): senhas/tokens reais costumam passar de ~3. */
export function entropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const RULES: Rule[] = [
  { name: 'Chave privada (PEM/SSH/PGP)', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'Chave de acesso AWS', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'Token do GitHub', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
  { name: 'Token do GitLab', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Token do Slack', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Chave de API do Google', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Chave secreta do Stripe', re: /\b[sr]k_live_[0-9A-Za-z]{20,}\b/ },
  { name: 'Token do npm', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  {
    name: 'Credenciais em URL de conexão',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:([^\s@'"]{4,})@[^\s'"]+/i,
    accept: (_m, g) => !PLACEHOLDER.test(g[0] ?? ''),
  },
  {
    name: 'Senha/segredo atribuído no código',
    re: /\b(?:pass(?:word|wd)?|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i,
    accept: (_m, g) => !PLACEHOLDER.test(g[0] ?? '') && entropy(g[0] ?? '') >= 3,
  },
];

/** Mostra só o começo do trecho: o segredo completo nunca sai do scanner. */
export function mask(s: string): string {
  const t = s.trim();
  return t.length <= 8 ? '••••' : `${t.slice(0, 4)}••••••••`;
}

/** Aplica as regras a UMA linha; devolve a primeira ocorrência (uma linha = no máximo um achado). */
export function scanLine(line: string): { rule: string; preview: string } | null {
  if (line.includes(ALLOW_MARKER)) return null;
  for (const r of RULES) {
    const m = r.re.exec(line);
    if (!m) continue;
    if (r.accept && !r.accept(m[0], m.slice(1))) continue;
    return { rule: r.name, preview: mask(m[1] ?? m[0]) };
  }
  return null;
}

const SENSITIVE_FILE: Array<[RegExp, string]> = [
  [/(^|\/)\.env(\.(?!example$|sample$|template$|dist$)[^/]+)?$/i, 'Arquivo .env (variáveis de ambiente)'],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, 'Chave privada SSH'],
  [/\.(pem|key|pfx|p12|jks|keystore)$/i, 'Arquivo de chave/certificado'],
  [/(^|\/)\.htpasswd$/, 'Arquivo de senhas (.htpasswd)'],
  [/(^|\/)(credentials|secrets?)\.(json|ya?ml)$/i, 'Arquivo de credenciais'],
];

/** Transforma um glob simples (`**`, `*`, `?`) em regex ancorada. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Linhas adicionadas (`+`) por arquivo a partir de um diff `-U0`. */
export function parseAddedLines(diff: string): Array<{ file: string; line: number; text: string }> {
  const out: Array<{ file: string; line: number; text: string }> = [];
  let file = '';
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.startsWith('+++ b/') ? raw.slice(6) : '';
      continue;
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff ')) continue;
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      line = Number(h[1]);
      continue;
    }
    if (raw.startsWith('+') && file) {
      out.push({ file, line, text: raw.slice(1).replace(/\r$/, '') });
      line++;
    }
  }
  return out;
}

const MAX_LINE = 2000; // linhas gigantes (minificados) não valem a análise

/**
 * Procura segredos e arquivos sensíveis no que está em stage. Só olha linhas ADICIONADAS:
 * segredos já existentes no histórico não são tema deste commit.
 */
export async function scanStagedSecrets(repoPath: string, cfg: SecretsConfig): Promise<SecretFinding[]> {
  if (cfg.mode === 'off') return [];
  const ignored = cfg.ignorePaths.map(globToRegExp);
  const isIgnored = (f: string) => ignored.some((r) => r.test(f));
  const findings: SecretFinding[] = [];

  const diff = await runGit(repoPath, ['-c', 'core.quotepath=off', 'diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=AMCR']);
  for (const a of parseAddedLines(diff.stdout)) {
    if (isIgnored(a.file) || a.text.length > MAX_LINE) continue;
    const hit = scanLine(a.text);
    if (hit) findings.push({ kind: 'secret', file: a.file, line: a.line, rule: hit.rule, preview: hit.preview });
  }

  const names = await runGit(repoPath, ['diff', '--cached', '--name-only', '-z', '--diff-filter=AMCR']);
  const files = names.stdout.split('\0').filter(Boolean).filter((f) => !isIgnored(f));

  for (const f of files) {
    const rule = SENSITIVE_FILE.find(([re]) => re.test(f));
    if (rule) findings.push({ kind: 'sensitive-file', file: f, rule: rule[1], preview: f });
  }

  if (cfg.maxFileSizeMb > 0 && files.length) {
    const r = await runGit(repoPath, ['cat-file', '--batch-check=%(objectsize)'], {
      stdin: files.map((f) => `:${f}`).join('\n') + '\n',
      check: false,
    });
    const limit = cfg.maxFileSizeMb * 1024 * 1024;
    r.stdout.split('\n').forEach((s, i) => {
      const size = Number(s);
      if (Number.isFinite(size) && size >= limit && files[i])
        findings.push({ kind: 'large-file', file: files[i]!, rule: `Arquivo grande (${(size / 1024 / 1024).toFixed(1)} MB)`, preview: files[i]! });
    });
  }
  return findings;
}
