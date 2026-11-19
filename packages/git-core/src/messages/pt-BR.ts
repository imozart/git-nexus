// Mensagens do núcleo em português (idioma-fonte): toda chave nasce aqui. As traduções (en.ts etc.) caem neste arquivo quando faltar uma chave.
// Chave = area.assunto; `{nome}` é variável; "um|{n} muitos" é plural (formas na ordem zero, one, two, few, many, other do idioma).
const messages = {
  // Git LFS (lfs.ts)
  'lfs.notUsed': 'Este repositório não usa Git LFS.',
  'lfs.notInstalled': 'O Git LFS não está instalado neste computador. Instale-o (git-lfs.com) para baixar os arquivos.',
  'lfs.notLfsFiles': 'Esses arquivos não são do Git LFS.',
  'lfs.allDownloaded': 'Todos os arquivos LFS já estão baixados.',
  'lfs.downloadFailed': 'Não foi possível baixar os arquivos do Git LFS.',
  'lfs.downloaded': 'Baixado. Ainda como ponteiro: {pointers}.',
  // busca no conteúdo (content-search.ts)
  'search.tooLong': 'O texto procurado passa de {max} caracteres.',
  'search.badRegex': 'Expressão regular inválida: {detail}',
  'search.failed': 'A busca falhou.',
  'search.outsideRepo': 'Arquivo fora do repositório.',
} as const;

export default messages;
export type MessageKey = keyof typeof messages;
