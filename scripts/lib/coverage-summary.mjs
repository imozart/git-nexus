// Resumo da cobertura em Markdown (para a página da execução no GitHub). Núcleo PURO: recebe o coverage-summary.json do vitest.

const METRICS = [
  ['lines', 'Linhas'],
  ['statements', 'Instruções'],
  ['branches', 'Ramos'],
  ['functions', 'Funções'],
];

const pct = (m) => (m && Number.isFinite(m.pct) ? `${m.pct.toFixed(2)}%` : '–');

/** `summary` é o conteúdo de coverage/coverage-summary.json; `root` é a pasta do repositório (para encurtar os caminhos). */
export function renderCoverage(summary, root = '', worst = 5) {
  const total = summary.total ?? {};
  const rel = (p) => p.replace(/\\/g, '/').replace(root.replace(/\\/g, '/').replace(/\/?$/, '/'), '');
  const lines = ['## Cobertura de testes', '', '| Métrica | Cobertura | Cobertas / total |', '|---|---|---|'];
  for (const [key, label] of METRICS) lines.push(`| ${label} | ${pct(total[key])} | ${total[key]?.covered ?? 0} / ${total[key]?.total ?? 0} |`);

  const files = Object.entries(summary)
    .filter(([k, v]) => k !== 'total' && v.lines?.total > 0)
    .map(([k, v]) => ({ file: rel(k), pct: v.lines.pct, missing: v.lines.total - v.lines.covered }))
    .sort((a, b) => a.pct - b.pct || b.missing - a.missing)
    .slice(0, worst);
  if (files.length) {
    lines.push('', `### ${files.length} arquivos com menor cobertura de linhas`, '', '| Arquivo | Linhas | Sem cobertura |', '|---|---|---|');
    for (const f of files) lines.push(`| \`${f.file}\` | ${f.pct.toFixed(1)}% | ${f.missing} |`);
  }
  return lines.join('\n') + '\n';
}
