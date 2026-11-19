/**
 * Tira os comentários HTML (`<!-- ... -->`) de um texto e repete até não haver mais nenhum para cortar. Um único
 * `replace(/<!--[\s\S]*?-->/g, '')` deixa passar o que o corte junta, como em `<!<!---->-->` (sobra `<!-->`, que o navegador lê como outro
 * comentário): é o alerta `js/incomplete-multi-character-sanitization` do CodeQL. Aqui o corte vai do primeiro `<!--` até o próximo `-->` e
 * o que ele une volta a ser examinado. Um `<!--` sem `-->` depois dele não é comentário completo e fica como está.
 */
export function stripHtmlComments(text: string): string {
  let out = text;
  let from = 0;
  for (;;) {
    const open = out.indexOf('<!--', from);
    if (open < 0) return out;
    const close = out.indexOf('-->', open + 4);
    if (close < 0) return out;
    out = out.slice(0, open) + out.slice(close + 3);
    from = Math.max(0, open - 3); // o corte pode ter juntado `<!-` com `-` e formado um `<!--` novo
  }
}
