import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Convenções de interface (docs/INTERFACE.md) que o compilador não vê. O objetivo é que botão, seletor e ícone venham do ui-kit (Gn*), e não de
// HTML e CSS refeitos em cada tela. Quem precisa de uma exceção de verdade a registra aqui, com o motivo: a lista só deve encolher.
const renderer = join(__dirname, '..', 'src', 'entrypoints', 'renderer');

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? vueFiles(join(dir, e.name)) : e.name.endsWith('.vue') ? [join(dir, e.name)] : []));
}
const files = vueFiles(renderer).map((f) => ({ rel: relative(renderer, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8').replace(/\r\n/g, '\n') }));
const template = (text: string) => text.slice(0, text.indexOf('<style') < 0 ? text.length : text.indexOf('<style'));

/** `<button>` cru permitido por arquivo (quantidade máxima). Cada um tem um motivo; o resto deve usar GnButton/GnIconButton/GnSegmented. */
const RAW_BUTTONS: Record<string, { max: number; why: string }> = {
  'components/ComboBox.vue': { max: 1, why: 'gatilho do combo: é o próprio componente de seleção' },
  'components/ContextMenu.vue': { max: 1, why: 'item de menu (não é botão de ação com aparência de botão)' },
  'components/GitHubButton.vue': { max: 1, why: 'botão da marca do GitHub: segue o padrão do GitHub, de propósito' },
  'components/ToolStripe.vue': { max: 1, why: 'aba vertical das barras laterais' },
  'components/ChangesTree.vue': { max: 1, why: 'seta de expandir/recolher do grupo (ícone dentro de um alvo de 16px)' },
  'components/CommitForm.vue': { max: 1, why: 'chip de tipo de commit (candidato a GnChip)' },
  'components/GitLogPanel.vue': { max: 3, why: 'alternância do painel e os dois botões em pílula (candidatos a GnButton)' },
  'components/MergeConflictResolver.vue': { max: 1, why: 'atalho de bloco dentro da lista de conflitos' },
  'components/SideBySideDiff.vue': { max: 5, why: 'controles compactos por linha do diff (candidatos a GnIconButton size="xs") e a dobra de linhas' },
  'components/tools/StashPanel.vue': { max: 1, why: 'link-botão de "guardar só alguns arquivos"' },
  'CoreInterface.vue': { max: 1, why: 'botão "Comandos" da barra superior (candidato a GnButton)' },
};

describe('botões vêm do ui-kit', () => {
  it('nenhuma tela ganha um <button> cru novo (a lista de exceções só encolhe)', () => {
    for (const f of files) {
      const n = (template(f.text).match(/<button\b/g) ?? []).length;
      const allowed = RAW_BUTTONS[f.rel]?.max ?? 0;
      expect(n, `${f.rel}: ${n} <button> crus, permitido ${allowed}. Use GnButton, GnIconButton ou GnSegmented (docs/INTERFACE.md).`).toBeLessThanOrEqual(allowed);
    }
  });

  it('toda exceção registrada ainda existe (se o botão cru sumiu, tire a linha da lista)', () => {
    for (const [rel, { max }] of Object.entries(RAW_BUTTONS)) {
      const f = files.find((x) => x.rel === rel);
      expect(f, `${rel} não existe mais`).toBeDefined();
      const n = (template(f!.text).match(/<button\b/g) ?? []).length;
      expect(n, `${rel} tem ${n} botões crus, a lista diz ${max}: ajuste para o número real`).toBe(max);
    }
  });

  it('o CSS do seletor segmentado não volta a ser copiado nas telas (é o GnSegmented)', () => {
    for (const f of files) expect(f.text, f.rel).not.toMatch(/^\.seg\s*\{/m);
  });

  it('botão só de ícone usa GnIconButton: nenhum <GnButton> com apenas um glifo de seta como texto', () => {
    for (const f of files) expect(template(f.text), f.rel).not.toMatch(/<GnButton[^>]*>\s*[↑↓←→▲▼×]\s*<\/GnButton>/);
  });
});

describe('ícones', () => {
  it('as telas não usam emoji nem setas de texto como ícone de botão (use GnIcon)', () => {
    for (const f of files) expect(template(f.text), f.rel).not.toMatch(/[⏱👤]/u);
  });
});

describe('cores dos botões (docs/INTERFACE.md)', () => {
  it('"Atualizar" é neutro em todas as telas (mesma ação, mesma aparência)', () => {
    for (const f of files) {
      for (const m of template(f.text).matchAll(/<GnButton([^>]*)>\s*\{\{\s*t\('rv\.refresh'\)\s*\}\}/g)) {
        expect(m[1], `${f.rel}: «Atualizar» com tom/variante`).not.toMatch(/tone="|variant="primary"/);
      }
    }
  });

  it('só uma ação sólida (primary) azul por tela de ferramenta: o resto é contorno (tone) ou neutro', () => {
    // Abrir (linha da lista de repositórios) e Aplicar e remover (linha do stash) repetem N vezes: nunca sólidos.
    const conn = files.find((f) => f.rel === 'views/ConnectionInterface.vue')!;
    expect(template(conn.text)).not.toMatch(/<GnButton[^>]*variant="primary"[^>]*>\s*\{\{\s*t\('home\.open'\)/);
    const stash = files.find((f) => f.rel === 'components/tools/StashPanel.vue')!;
    expect(template(stash.text)).not.toMatch(/<GnButton[^>]*variant="primary"[^>]*>\{\{\s*t\('stash\.applyDrop'\)/);
  });
});
