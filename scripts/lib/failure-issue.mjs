// Issue automática de falha da release: monta o texto e decide entre abrir uma issue nova ou comentar na que já está aberta.
// Núcleo PURO (sem rede nem `gh`); o scripts/failure-issue.mjs faz as chamadas.

/** O GitHub aceita até 65.536 caracteres no corpo de uma issue/comentário; sobra folga para o cabeçalho. */
export const MAX_BODY = 60000;

export const LABEL = 'release-failure';
export const LABEL_COLOR = 'B60205';
export const LABEL_DESCRIPTION = 'A release automática falhou (aberta pelo pipeline)';

/** Cerca de código mais comprida que qualquer sequência de crases do texto (para o relatório não "fechar" a cerca). */
export function fenceFor(text) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/** Corpo da issue ou do comentário: link da execução + relatório (cortado se for enorme). */
export function failureBody({ report, runUrl, runNumber, sha }) {
  const head = [
    `A release automática **falhou** (execução [#${runNumber}](${runUrl})${sha ? `, commit \`${sha.slice(0, 7)}\`` : ''}).`,
    '',
    'Nada foi publicado por essa execução. Depois de corrigir, rode de novo: *Actions → Release → Run workflow* (ou o próximo merge na `main` tenta outra vez e herda os commits não lançados).',
    '',
    '### Relatório',
    '',
  ].join('\n');
  let body = report.trim();
  const room = MAX_BODY - head.length - 60;
  let truncated = false;
  if (body.length > room) {
    // mantém o FINAL do relatório: é onde está o erro
    body = body.slice(body.length - room);
    truncated = true;
  }
  const fence = fenceFor(body);
  return `${head}${truncated ? '_(relatório cortado: veja o início na página da execução)_\n\n' : ''}${fence}text\n${body}\n${fence}\n`;
}

export const issueTitle = (runNumber) => `Falha na release (execução #${runNumber})`;

/** Já existe uma issue aberta com o rótulo? Comenta nela (evita uma issue por falha); senão abre uma. */
export function planIssue(openIssueNumbers) {
  const n = openIssueNumbers?.[0];
  return n ? { action: 'comment', number: n } : { action: 'create' };
}
