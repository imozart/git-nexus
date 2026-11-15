// Mensagens do núcleo (erros e avisos que chegam à tela) no idioma escolhido na interface.
// O núcleo não depende de Vue nem de catálogo: cada mensagem carrega as duas versões, `tm(português, english)`.
// O português é o idioma-fonte (e o padrão): os testes e quem nunca trocou de idioma continuam vendo o texto original.

export type MessageLocale = 'pt-BR' | 'en';

let current: MessageLocale = 'pt-BR';

/** Chamado quando a pessoa troca o idioma da interface (o processo principal e o worker mantêm cada um o seu). */
export function setMessageLocale(locale: string): void {
  current = locale === 'en' ? 'en' : 'pt-BR';
}

export const getMessageLocale = (): MessageLocale => current;

/** Texto no idioma atual. */
export const tm = (pt: string, en: string): string => (current === 'en' ? en : pt);
