import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error módulo .mjs sem tipos
import * as cs from '../lib/code-scanning.mjs';

const root = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8').replace(/\r\n/g, '\n');
const formLabels = (file: string) => [...read('.github', 'ISSUE_TEMPLATE', file).matchAll(/^ {6}label: (.+)$/gm)].map((m) => m[1]!.trim());

const alert = (number: number, ruleId: string, severity = 'medium', path = 'a.mjs', line = 1) => ({
  number,
  html_url: `https://github.com/o/r/security/code-scanning/${number}`,
  rule: { id: ruleId, name: ruleId.split('/').pop(), security_severity_level: severity },
  most_recent_instance: { location: { path, start_line: line }, message: { text: `msg\n do  ${number}` } },
});

describe('groupAlerts', () => {
  it('agrupa por regra, ordena os alertas por número e a regra mais grave vem primeiro', () => {
    const g = cs.groupAlerts([alert(5, 'js/b', 'medium'), alert(2, 'js/a', 'high'), alert(1, 'js/b', 'medium'), alert(9, 'js/c', 'low')]);
    expect(g.map((x: { ruleId: string }) => x.ruleId)).toEqual(['js/a', 'js/b', 'js/c']);
    expect(g[1].alerts.map((a: { number: number }) => a.number)).toEqual([1, 5]);
  });

  it('a mensagem vira uma linha só e sem crases', () => {
    expect(cs.normalizeAlert(alert(3, 'js/x')).message).toBe('msg do 3');
    expect(cs.oneLine('a `b`\nc')).toBe("a 'b' c");
    expect(cs.oneLine('x'.repeat(300)).length).toBe(140);
    expect(cs.oneLine('pode conter <!-- aqui')).toBe('pode conter &lt;!-- aqui'); // nunca abre comentário HTML no corpo da issue
  });
});

describe('bloco gerenciado', () => {
  const open = cs.groupAlerts([alert(13, 'js/x', 'medium', 'p.mjs', 7), alert(14, 'js/x')])[0].alerts;

  it('lista os abertos desmarcados; o que sumiu continua listado, marcado como feito', () => {
    const first = cs.renderAlertBlock(open);
    expect(first).toContain('- [ ] https://github.com/o/r/security/code-scanning/13 · `p.mjs:7` · msg do 13');
    const next = cs.renderAlertBlock([open[1]], first);
    expect(next).toContain('- [ ] https://github.com/o/r/security/code-scanning/14');
    expect(next).toContain('- [x] https://github.com/o/r/security/code-scanning/13');
  });

  it('replaceBlock troca só o bloco e preserva o texto editado ao redor; sem bloco, acrescenta', () => {
    const body = `antes editado\n${cs.START}\nvelho\n${cs.END}\ndepois editado`;
    expect(cs.replaceBlock(body, 'novo')).toBe(`antes editado\n${cs.START}\nnovo\n${cs.END}\ndepois editado`);
    expect(cs.replaceBlock('sem bloco', 'novo')).toContain(`${cs.START}\nnovo\n${cs.END}`);
    expect(cs.readBlock(body)).toBe('velho');
    expect(cs.readBlock('nada')).toBe('');
  });
});

describe('issue da regra', () => {
  const group = cs.groupAlerts([alert(13, 'js/bad-code-sanitization'), alert(14, 'js/bad-code-sanitization')])[0];
  const body: string = cs.ruleIssueBody({ group, repo: 'o/r', version: '1.17.0' });

  it('segue os campos do formulário Defeito, na ordem', () => {
    expect([...body.matchAll(/^### (.+)$/gm)].map((m) => m[1])).toEqual(formLabels('bug.yml'));
  });

  it('traz a regra, a contagem, a versão, a lista e o marcador que a identifica', () => {
    expect(body).toContain('2 alertas abertos da regra `js/bad-code-sanitization`');
    expect(body).toContain('1.17.0');
    expect(body).toContain('/security/code-scanning/13');
    expect(cs.findRuleIssue([{ number: 7, body }], 'js/bad-code-sanitization')?.number).toBe(7);
    expect(cs.findRuleIssue([{ number: 7, body }], 'js/outra')).toBeUndefined();
    expect(cs.ruleOf({ body })).toBe('js/bad-code-sanitization');
  });

  it('o título tem o prefixo do formulário (bug: )', () => {
    expect(cs.ruleIssueTitle('js/x')).toBe('bug: alertas js/x no code scanning');
  });
});

describe('planSync', () => {
  const body = (rule: string) => cs.ruleIssueBody({ group: cs.groupAlerts([alert(1, rule)])[0], repo: 'o/r', version: '1.0.0' });

  it('regra nova cria; regra com issue aberta atualiza; issue sem alerta resolve (sem duplicar)', () => {
    const issues = [
      { number: 10, body: body('js/a') },
      { number: 11, body: body('js/gone') },
      { number: 12, body: cs.TRACKING_MARKER },
    ];
    const plan = cs.planSync([alert(1, 'js/a'), alert(2, 'js/b')], issues);
    expect(plan.create.map((g: { ruleId: string }) => g.ruleId)).toEqual(['js/b']);
    expect(plan.update.map((u: { issue: { number: number } }) => u.issue.number)).toEqual([10]);
    expect(plan.resolve.map((i: { number: number }) => i.number)).toEqual([11]); // o acompanhamento nunca é "resolvido" como regra
  });

  it('sem alertas e sem issues, não há nada a fazer', () => {
    const plan = cs.planSync([], []);
    expect([plan.create, plan.update, plan.resolve]).toEqual([[], [], []]);
  });
});

describe('marco e acompanhamento', () => {
  it('reaproveita o marco aberto da automação; senão propõe um novo com a data (o título é único mesmo com marcos fechados)', () => {
    const ms = [
      { title: cs.MILESTONE_BASE, state: 'closed' },
      { title: 'Outro', state: 'open' },
    ];
    expect(cs.pickMilestone(ms, '2026-12-01')).toEqual({ title: `${cs.MILESTONE_BASE} (2026-12-01)` });
    const open = { title: `${cs.MILESTONE_BASE} (2026-12-01)`, state: 'open' };
    expect(cs.pickMilestone([...ms, open], '2027-01-01')).toEqual({ existing: open });
  });

  it('o bloco do acompanhamento marca como feita a regra sem alertas e mantém as de execuções anteriores', () => {
    const first = cs.renderTrackingBlock([
      { number: 209, ruleId: 'js/a', open: 8 },
      { number: 210, ruleId: 'js/b', open: 1 },
    ]);
    expect(first).toContain('- [ ] #209 · `js/a` · 8 alertas abertos');
    expect(first).toContain('- [ ] #210 · `js/b` · 1 alerta aberto');
    const next = cs.renderTrackingBlock([{ number: 209, ruleId: 'js/a', open: 0 }], first);
    expect(next).toContain('- [x] #209 · `js/a` · sem alertas abertos');
    expect(next).toContain('- [x] #210'); // não apareceu nesta execução: já estava resolvida
  });

  it('a issue de acompanhamento segue o formulário Funcionalidade e traz o marcador', () => {
    const body: string = cs.trackingIssueBody({ milestoneUrl: 'https://github.com/o/r/milestone/5', block: '- [ ] #1' });
    expect([...body.matchAll(/^### (.+)$/gm)].map((m) => m[1])).toEqual(formLabels('funcionalidade.yml'));
    expect(cs.findTrackingIssue([{ number: 1, body }])?.number).toBe(1);
  });
});

describe('workflow code-scanning-issues.yml', () => {
  const text = read('.github', 'workflows', 'code-scanning-issues.yml');

  it('roda toda semana e à mão, com permissões mínimas só no job', () => {
    expect(text).toMatch(/cron: '0 10 \* \* 1'/);
    expect(text).toContain('workflow_dispatch:');
    expect(text).toMatch(/^permissions:\n {2}contents: read/m);
    expect(text).toContain('security-events: read');
    expect(text).toContain('issues: write');
  });

  it('a opção dry entra por variável de ambiente, nunca interpolada no script', () => {
    for (const line of text.split('\n').filter((l) => l.includes('code-scanning-issues.mjs') && !l.trim().startsWith('#'))) expect(line).not.toContain('${{');
    expect(text).toMatch(/DRY: \$\{\{ inputs\.dry && '--dry' \|\| '' \}\}/);
  });

  it('o rótulo da automação fica de fora do fechamento por inatividade', () => {
    expect(read('.github', 'workflows', 'stale.yml')).toMatch(/exempt-issue-labels:.*\bcode-scanning\b/);
  });
});
