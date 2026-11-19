// Issues automáticas dos alertas do code scanning (CodeQL): agrupa os alertas abertos por regra, monta o texto das issues
// (no formato do formulário "Defeito") e decide o que criar, atualizar ou resolver.
// Núcleo PURO (sem rede nem `gh`); o scripts/code-scanning-issues.mjs faz as chamadas.

export const LABEL = 'code-scanning';
export const LABEL_COLOR = '5319E7';
export const LABEL_DESCRIPTION = 'Alertas do code scanning acompanhados pelo pipeline (aberta pela automação)';

export const MILESTONE_BASE = 'Correção dos alertas do code scanning';
export const MILESTONE_DESCRIPTION =
  'Zerar os alertas abertos do CodeQL (Security → Code scanning). Marco aberto pela automação; uma issue por regra e uma de acompanhamento. ' +
  'Regra do marco: corrigir a causa (não descartar o alerta) e manter os testes verdes. Quem fecha o marco é o dono do projeto, depois da conferência.';

export const START = '<!-- code-scanning:start -->';
export const END = '<!-- code-scanning:end -->';
export const TRACKING_MARKER = '<!-- code-scanning-tracking -->';
export const ruleMarker = (ruleId) => `<!-- code-scanning-rule: ${ruleId} -->`;

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'warning', 'error', 'note'];
const rank = (s) => {
  const i = SEVERITY_ORDER.indexOf(s ?? '');
  return i === -1 ? SEVERITY_ORDER.length : i;
};

/** Uma linha só, sem quebras, crases nem `<` (uma mensagem com `<!--` abriria um comentário HTML e engoliria o resto da issue), cortada em `max` caracteres. */
export function oneLine(text, max = 140) {
  const s = String(text ?? '').replace(/\s+/g, ' ').replace(/`/g, "'").replace(/</g, '&lt;').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Número do alerta a partir da URL (…/security/code-scanning/42). */
export const alertNumberFromUrl = (url) => Number(/\/security\/code-scanning\/(\d+)/.exec(String(url))?.[1]) || null;

/** Normaliza um alerta da API (`GET /code-scanning/alerts`) para o que o texto usa. */
export function normalizeAlert(a) {
  const loc = a.most_recent_instance?.location ?? {};
  return {
    number: a.number,
    url: a.html_url,
    ruleId: a.rule?.id ?? 'regra-desconhecida',
    ruleName: a.rule?.name ?? '',
    severity: a.rule?.security_severity_level ?? a.rule?.severity ?? '',
    path: loc.path ?? '',
    line: loc.start_line ?? 0,
    message: oneLine(a.most_recent_instance?.message?.text ?? a.rule?.description ?? ''),
  };
}

/** Agrupa os alertas por regra: mais grave primeiro e, empatando, pelo identificador da regra. */
export function groupAlerts(alerts) {
  const byRule = new Map();
  for (const a of alerts.map(normalizeAlert)) {
    const g = byRule.get(a.ruleId) ?? { ruleId: a.ruleId, ruleName: a.ruleName, severity: a.severity, alerts: [] };
    if (rank(a.severity) < rank(g.severity)) g.severity = a.severity;
    g.alerts.push(a);
    byRule.set(a.ruleId, g);
  }
  for (const g of byRule.values()) g.alerts.sort((x, y) => x.number - y.number);
  return [...byRule.values()].sort((x, y) => rank(x.severity) - rank(y.severity) || x.ruleId.localeCompare(y.ruleId));
}

export const ruleIssueTitle = (ruleId) => `bug: alertas ${ruleId} no code scanning`;

/** Linha de um alerta dentro do bloco gerenciado. */
export const alertLine = (a, done = false) => `- [${done ? 'x' : ' '}] ${a.url} · \`${a.path}:${a.line}\` · ${a.message}`;

/** Extrai o bloco gerenciado (entre os marcadores) de um corpo, ou '' se não houver. */
export function readBlock(body) {
  const s = String(body ?? '');
  const i = s.indexOf(START);
  const j = s.indexOf(END);
  return i !== -1 && j > i ? s.slice(i + START.length, j).trim() : '';
}

/**
 * Bloco com os alertas: os abertos desmarcados e, dos que já estavam listados e não estão mais abertos
 * (corrigidos ou dispensados), a linha antiga marcada como feita.
 */
export function renderAlertBlock(openAlerts, previousBlock = '') {
  const open = new Set(openAlerts.map((a) => a.number));
  const lines = openAlerts.map((a) => alertLine(a));
  for (const line of previousBlock.split('\n')) {
    const n = alertNumberFromUrl(line);
    if (n && !open.has(n) && /^- \[[ x]\]/.test(line)) lines.push(line.replace(/^- \[ \]/, '- [x]'));
  }
  return lines.join('\n');
}

/** Troca só o bloco gerenciado do corpo (o resto, que a pessoa pode ter editado, fica como está). */
export function replaceBlock(body, block) {
  const s = String(body ?? '');
  const i = s.indexOf(START);
  const j = s.indexOf(END);
  const wrapped = `${START}\n${block}\n${END}`;
  if (i === -1 || j < i) return `${s.trimEnd()}\n\n${wrapped}\n`;
  return `${s.slice(0, i)}${wrapped}${s.slice(j + END.length)}`;
}

const SEVERITY_PT = { critical: 'crítica', high: 'alta', medium: 'média', low: 'baixa', error: 'erro', warning: 'aviso', note: 'nota' };
export const severityPt = (s) => SEVERITY_PT[s] ?? (s || 'não informada');

/** Corpo da issue de uma regra, na ordem e com os títulos do formulário "Defeito" (.github/ISSUE_TEMPLATE/bug.yml). */
export function ruleIssueBody({ group, repo, version }) {
  const n = group.alerts.length;
  return [
    '### O que aconteceu',
    '',
    `O code scanning (CodeQL) mantém ${n} alerta${n === 1 ? '' : 's'} aberto${n === 1 ? '' : 's'} da regra \`${group.ruleId}\`${group.ruleName ? ` (${group.ruleName})` : ''}, severidade ${severityPt(group.severity)}.`,
    '',
    `Todos: https://github.com/${repo}/security/code-scanning?query=is%3Aopen+rule%3A${encodeURIComponent(group.ruleId)}`,
    '',
    '### Como reproduzir',
    '',
    `1. Abrir os alertas abaixo (Security → Code scanning)`,
    `2. Ver o arquivo e a linha de cada um`,
    '',
    '### O que você esperava que acontecesse',
    '',
    'Nenhum alerta aberto desta regra. A correção deve tratar a causa; descartar o alerta só vale como último recurso, com o motivo registrado.',
    '',
    '### Versão do GitNexus',
    '',
    version,
    '',
    '### Sistema operacional',
    '',
    'Outro (descreva em "Contexto adicional")',
    '',
    '### Como você instalou',
    '',
    'Compilei do código-fonte',
    '',
    '### Versão do Git',
    '',
    '_No response_',
    '',
    '### Comandos git executados (painel de log)',
    '',
    '_No response_',
    '',
    '### Capturas de tela ou GIFs',
    '',
    '_No response_',
    '',
    '### Contexto adicional',
    '',
    'Issue aberta pela automação (`.github/workflows/code-scanning-issues.yml`). A lista abaixo é atualizada a cada execução: o que some do code scanning fica marcado como feito e, quando não resta nenhum, a issue é fechada.',
    '',
    'O vínculo oficial do alerta com a issue (*Relationship → Add security alert*) não tem API e fica por conta de quem for corrigir.',
    '',
    START,
    renderAlertBlock(group.alerts),
    END,
    '',
    ruleMarker(group.ruleId),
    '',
    '### Confirmações',
    '',
    '- [x] Procurei nas issues existentes e não achei o mesmo problema.',
    '- [x] Não colei senhas, tokens nem dados privados nos textos, logs e capturas.',
    '',
  ].join('\n');
}

/** Issue aberta (com o rótulo) que acompanha a regra, achada pelo marcador no corpo. */
export const findRuleIssue = (issues, ruleId) => issues.find((i) => String(i.body ?? '').includes(ruleMarker(ruleId)));
export const findTrackingIssue = (issues) => issues.find((i) => String(i.body ?? '').includes(TRACKING_MARKER));

/** Regras de uma issue de regra aberta (a que o marcador aponta), ou null. */
export const ruleOf = (issue) => /<!-- code-scanning-rule: (.+?) -->/.exec(String(issue.body ?? ''))?.[1] ?? null;

/**
 * Decide o que fazer: criar a issue de regras novas, atualizar a lista das que já têm issue aberta e resolver
 * (comentar e fechar) as issues cujo alerta não está mais aberto.
 */
export function planSync(alerts, issues) {
  const groups = groupAlerts(alerts);
  const ruleIssues = issues.filter((i) => ruleOf(i));
  const seen = new Set(groups.map((g) => g.ruleId));
  return {
    groups,
    create: groups.filter((g) => !findRuleIssue(ruleIssues, g.ruleId)),
    update: groups.flatMap((g) => {
      const issue = findRuleIssue(ruleIssues, g.ruleId);
      return issue ? [{ issue, group: g }] : [];
    }),
    resolve: ruleIssues.filter((i) => !seen.has(ruleOf(i))),
  };
}

/** Marco aberto da automação: o primeiro cujo título começa com a base; senão, o título do novo (com a data). */
export function pickMilestone(milestones, today) {
  const open = milestones.find((m) => m.state === 'open' && m.title.startsWith(MILESTONE_BASE));
  return open ? { existing: open } : { title: `${MILESTONE_BASE} (${today})` };
}

/** Linha do acompanhamento: `- [ ] #209 · js/regra · 8 alertas abertos`. */
export const trackingLine = ({ number, ruleId, open }) =>
  `- [${open === 0 ? 'x' : ' '}] #${number} · \`${ruleId}\` · ${open === 0 ? 'sem alertas abertos' : `${open} alerta${open === 1 ? '' : 's'} aberto${open === 1 ? '' : 's'}`}`;

/** Bloco do acompanhamento: as linhas desta execução e, das execuções anteriores, as issues que não aparecem mais (feitas). */
export function renderTrackingBlock(items, previousBlock = '') {
  const known = new Set(items.map((i) => i.number));
  const lines = items.map(trackingLine);
  for (const line of previousBlock.split('\n')) {
    const n = Number(/^- \[[ x]\] #(\d+)/.exec(line)?.[1]);
    if (n && !known.has(n)) lines.push(line.replace(/^- \[ \]/, '- [x]'));
  }
  return lines.join('\n');
}

/** Corpo da issue de acompanhamento, no formato do formulário "Funcionalidade" (como as dos outros marcos). */
export function trackingIssueBody({ milestoneUrl, block }) {
  return [
    '### Qual problema isso resolve',
    '',
    'Os alertas abertos do code scanning (CodeQL) precisam ser corrigidos. Esta issue é só o **acompanhamento**: não é fechada por PR; a automação marca cada regra quando os alertas dela somem e fecha esta issue quando não resta nenhum.',
    '',
    '### Como você imagina a solução',
    '',
    'Uma issue e um PR por regra, com base na `main` (`Closes #N`, milestone no PR). Regras:',
    '',
    START,
    block,
    END,
    '',
    '**Critério de conclusão:** a página de code scanning sem alertas abertos na `main`. Corrigir a causa; não descartar alertas.',
    '',
    '### Alternativas que você considerou',
    '',
    'Descartar os alertas: esconde o problema do painel sem corrigir o padrão.',
    '',
    '### Área do app',
    '',
    'Outra / não sei',
    '',
    '### Contexto adicional',
    '',
    `Marco: ${milestoneUrl}`,
    '',
    TRACKING_MARKER,
    '',
    '### Participação',
    '',
    '- [ ] Posso ajudar a testar uma versão beta dessa funcionalidade.',
    '- [x] Tenho interesse em implementar (abra a issue primeiro; combinamos antes do PR).',
    '',
  ].join('\n');
}
