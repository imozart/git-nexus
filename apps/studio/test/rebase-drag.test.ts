import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Feedback do arraste no rebase interativo (issue #160): a linha de origem fica marcada, o reset cobre cancelar e soltar fora, e nada de cor ou layout novo.
const src = readFileSync(join(__dirname, '..', 'src', 'entrypoints', 'renderer', 'components', 'tools', 'RebasePanel.vue'), 'utf8').replace(/\r\n/g, '\n');

describe('RebasePanel: linha arrastada', () => {
  it('a linha de origem recebe row--dragging, e o destino continua com row--over', () => {
    expect(src).toContain("'row--dragging': dragFrom === i");
    expect(src).toContain("'row--over': dragOver === i && dragFrom !== i");
  });
  it('o estilo é só opacidade e a sombra pequena do token (nada de cor, posição ou tamanho)', () => {
    expect(src).toContain('&--dragging { opacity: 0.55; box-shadow: var(--gn-shadow-sm); }');
    expect(src).toContain('&--over { border-color: var(--gn-accent); box-shadow: 0 -2px 0 var(--gn-accent); }'); // o indicador de destino não mudou
  });
  it('dragend zera a origem e o destino (cobre Esc e soltar fora das linhas), como o drop', () => {
    expect(src).toContain('@dragend="dragFrom = dragOver = -1"');
    expect(src).toContain('dragFrom.value = dragOver.value = -1;');
  });
});
