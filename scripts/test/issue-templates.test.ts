import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// O GitHub só valida um formulário de issue quando alguém abre "New issue": um erro de estrutura derruba o formulário em silêncio.
// Estas verificações pegam, antes do merge, os erros mais comuns (id repetido, label que não existe, tipo inválido, campo sem rótulo).
const root = join(__dirname, '..', '..');
const dir = join(root, '.github', 'ISSUE_TEMPLATE');
const read = (f: string) => readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n');
const forms = readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f) && f !== 'config.yml')
  .map((f) => ({ file: f, text: read(f) }));
const catalog = new Set((JSON.parse(readFileSync(join(root, '.github', 'labels.json'), 'utf8')) as Array<{ name: string }>).map((l) => l.name));

/** Itens de `body:` (cada `  - type: …` e o bloco até o próximo). */
function items(text: string): Array<{ type: string; text: string }> {
  const body = text.slice(text.indexOf('\nbody:\n') + 7);
  return body
    .split(/^(?=  - type: )/m)
    .filter((b) => b.startsWith('  - type: '))
    .map((b) => ({ type: /^ {2}- type: (\S+)/.exec(b)![1]!, text: b }));
}

describe('formulários de issue (.github/ISSUE_TEMPLATE)', () => {
  it('há os seis formulários esperados', () => {
    expect(forms.map((f) => f.file).sort()).toEqual(['bug.yml', 'desempenho.yml', 'documentacao.yml', 'funcionalidade.yml', 'idioma.yml', 'pergunta.yml']);
  });

  for (const f of forms) {
    describe(f.file, () => {
      it('tem nome, descrição, prefixo de título e labels entre aspas', () => {
        expect(f.text).toMatch(/^name: \S/m);
        expect(f.text).toMatch(/^description: \S/m);
        expect(f.text).toMatch(/^title: "[a-z0-9]+: "$/m);
        expect(f.text).toMatch(/^labels: \[("[^"]+"(, )?)+\]$/m);
        expect(f.text).toMatch(/^body:$/m);
      });

      it('só usa labels que existem no catálogo e sempre marca para triagem', () => {
        const labels = [...(/^labels: \[(.*)\]$/m.exec(f.text)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
        expect(labels).toContain('triagem');
        for (const l of labels) expect(catalog.has(l), `${f.file}: label "${l}" não está em .github/labels.json`).toBe(true);
      });

      it('os campos têm tipo válido, rótulo e id único (só minúsculas, números, "-" e "_")', () => {
        const list = items(f.text);
        expect(list.length).toBeGreaterThan(2);
        const ids: string[] = [];
        for (const it of list) {
          expect(['markdown', 'textarea', 'input', 'dropdown', 'checkboxes'], `${f.file}: tipo ${it.type}`).toContain(it.type);
          if (it.type === 'markdown') {
            expect(it.text).toMatch(/^ {6}value: \|?/m);
            continue;
          }
          const id = /^ {4}id: (\S+)$/m.exec(it.text)?.[1];
          expect(id, `${f.file}: campo ${it.type} sem id`).toBeTruthy();
          expect(id).toMatch(/^[a-z0-9_-]+$/);
          ids.push(id!);
          expect(it.text, `${f.file}: ${id} sem label`).toMatch(/^ {6}label: \S/m);
        }
        expect(new Set(ids).size, `${f.file}: id repetido`).toBe(ids.length);
      });

      it('dropdowns têm opções; campos que não são checkboxes dizem se são obrigatórios', () => {
        for (const it of items(f.text)) {
          if (it.type === 'dropdown') expect(it.text, f.file).toMatch(/^ {6}options:\n( {8}- \S.*\n?)+/m);
          if (['textarea', 'input', 'dropdown'].includes(it.type)) expect(it.text, f.file).toMatch(/^ {4}validations:\n {6}required: (true|false)$/m);
          if (it.type === 'checkboxes') expect(it.text, f.file).toMatch(/^ {8}- label: \S/m);
        }
      });

      it('tem pelo menos um campo obrigatório (formulário vazio de exigência vira texto livre)', () => {
        expect(f.text).toMatch(/required: true/);
      });
    });
  }

  it('defeito e lentidão pedem a versão do app e o sistema (sem isso o relato não é reproduzível)', () => {
    for (const file of ['bug.yml', 'desempenho.yml']) {
      const t = forms.find((f) => f.file === file)!.text;
      expect(t, file).toMatch(/id: versao\n[\s\S]*?required: true/);
      expect(t, file).toMatch(/id: sistema\n[\s\S]*?required: true/);
    }
  });

  it('lentidão pede o tamanho do repositório (arquivos rastreados)', () => {
    expect(forms.find((f) => f.file === 'desempenho.yml')!.text).toMatch(/id: arquivos\n[\s\S]*?required: true/);
  });
});

describe('config.yml da tela de nova issue', () => {
  const text = read('config.yml');

  it('desliga a issue em branco: tudo passa por um formulário', () => {
    expect(text).toMatch(/^blank_issues_enabled: false$/m);
  });

  it('os atalhos têm nome, link https e descrição', () => {
    const links = text.split(/^ {2}- name: /m).slice(1);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      expect(l).toMatch(/^ {4}url: https:\/\/\S+$/m);
      expect(l).toMatch(/^ {4}about: \S/m);
    }
  });
});
