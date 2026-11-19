import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Diálogos migrados para o GnDialog (issues #156 e #163): a caixa, o overlay, o Esc e o clique no fundo são do kit; aqui só o conteúdo.
const comp = (n: string) => readFileSync(join(__dirname, '..', 'src', 'entrypoints', 'renderer', 'components', n), 'utf8').replace(/\r\n/g, '\n');
const css = (src: string) => src.slice(src.indexOf('<style'));
const DIALOGS = ['ConfirmDialog.vue', 'ChangelogDialog.vue', 'BranchDialog.vue', 'AskpassDialog.vue', 'RepoCreateDialog.vue'];

describe.each(DIALOGS)('%s usa o GnDialog', (file) => {
  const src = comp(file);
  it('importa e usa o <GnDialog> (sem Teleport, overlay nem Esc próprios)', () => {
    expect(src).toMatch(/import \{[^}]*\bGnDialog\b[^}]*\} from '@git-nexus\/ui-kit'/);
    expect(src).toContain('<GnDialog');
    expect(src).not.toContain('<Teleport');
    expect(src).not.toMatch(/addEventListener\('keydown'/);
    expect(src).not.toContain('@mousedown.self');
    expect(src).not.toMatch(/ev\.key === 'Escape'|e\.key === 'Escape'/);
  });
  it('o CSS não tem posição fixa, z-index, fundo preto nem sombra própria', () => {
    const style = css(src);
    expect(style).not.toMatch(/position:\s*fixed/);
    expect(style).not.toMatch(/z-index/);
    expect(style).not.toMatch(/rgba\(\s*0,\s*0,\s*0/);
    expect(style).not.toMatch(/box-shadow/);
  });
});

describe('semântica de cada diálogo', () => {
  it('ConfirmDialog: alertdialog, título ligado por useId e foco inicial em Cancelar (Enter nunca confirma sem querer)', () => {
    const s = comp('ConfirmDialog.vue');
    expect(s).toContain('role="alertdialog"');
    expect(s).toContain('useId()');
    expect(s).toContain(':labelledby="titleId"');
    expect(s).toContain('initial-focus="[data-cancel]"');
    expect(s).toMatch(/<GnButton data-cancel @click="emit\('cancel'\)"/);
    expect(s).toContain("@close=\"emit('cancel')\"");
  });
  it('ChangelogDialog: mantém o aria-labelledby="cl-title" e fecha por "close"', () => {
    const s = comp('ChangelogDialog.vue');
    expect(s).toContain('labelledby="cl-title"');
    expect(s).toContain('id="cl-title"');
    expect(s).toContain("@close=\"emit('close')\"");
  });
  it('BranchDialog: cancela por "cancel" e o foco inicial é o primeiro campo', () => {
    const s = comp('BranchDialog.vue');
    expect(s).toContain("@close=\"emit('cancel')\"");
    expect(s).toContain('initial-focus="input"');
  });
  it('AskpassDialog: só existe com pedido (v-if), cancelar resolve com null e o data-testid vai para o formulário', () => {
    const s = comp('AskpassDialog.vue');
    expect(s).toContain('<GnDialog v-if="req"');
    expect(s).toContain('@close="send(null)"');
    expect(s).toContain('class="ak__form" data-testid="askpass"');
  });
  it('RepoCreateDialog: enquanto ocupado, Esc e clique no fundo não fecham (:dismissable reativo) e o foco inicial é o primeiro campo do modo', () => {
    const s = comp('RepoCreateDialog.vue');
    expect(s).toContain(':dismissable="!busy"');
    expect(s).toContain('initial-focus="[data-initial]"');
    expect(s).toMatch(/v-model="url" data-initial/);
    expect(s).toContain(":data-initial=\"mode === 'init' ? '' : undefined\"");
  });
});

describe('App.vue', () => {
  it('os atalhos globais (Ctrl+K inclusive) ficam quietos com um diálogo aberto', () => {
    const app = readFileSync(join(__dirname, '..', 'src', 'entrypoints', 'renderer', 'App.vue'), 'utf8');
    expect(app).toContain('if (isDialogOpen()) return;');
  });
});
