// Barra de título integrada às abas (veja shared/title-bar.ts): marca o <html> com a moldura da janela (`data-titlebar`), que o CSS usa para
// a região de arrasto e as margens, e, no Windows/Linux, informa ao processo principal as cores da faixa de abas para o overlay dos botões
// nativos acompanharem o tema (escuro/claro) na hora.
import { watch } from 'vue';
import { cssColorToHex } from '../../shared/title-bar';
import { api } from './api';
import { theme } from './theme';

const mode = api.titleBar ?? 'native';
document.documentElement.dataset.titlebar = mode;

/** Cores atuais da faixa de abas (os tokens do tema em vigor), ou null se o navegador devolver algo que não seja uma cor simples. */
export function currentTitleBarColors(): { color: string; symbolColor: string } | null {
  const css = getComputedStyle(document.documentElement);
  const color = cssColorToHex(css.getPropertyValue('--gn-bg'));
  const symbolColor = cssColorToHex(css.getPropertyValue('--gn-text'));
  return color && symbolColor ? { color, symbolColor } : null;
}

if (mode === 'overlay') {
  // depois de o tema virar atributo do <html> (theme.ts), lê os tokens já com os valores do tema novo
  watch(
    theme,
    () => {
      const colors = currentTitleBarColors();
      if (colors) void api.setTitleBar(colors).catch(() => undefined); // sem suporte (alguns gerenciadores de janela do Linux): a moldura padrão segue
    },
    { immediate: true, flush: 'post' },
  );
}
