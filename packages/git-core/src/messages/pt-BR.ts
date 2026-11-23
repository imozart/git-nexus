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
  'search.badMask': 'Máscara de arquivo inválida: {mask}',
  'search.badRevision': 'Revisão inválida: {rev}',
  'search.noRevision': 'A revisão "{rev}" não existe neste repositório.',
  'search.timeout': 'A busca passou de {s} s e foi interrompida: refine o texto ou os filtros.',
  // janela (main.ts)
  'window.err.titleBarColors': 'Cores da barra de título inválidas.',
  // instalação do Git (git-install.ts)
  'git.err.cancelled': 'Instalação cancelada.',
  'git.err.tooBig': 'O arquivo é grande demais.',
  'git.err.queryStatus': 'O servidor respondeu {status} ao consultar {host}.',
  'git.err.downloadStatus': 'O servidor respondeu {status} ao baixar o arquivo.',
  'git.err.redirected': 'O download foi redirecionado para um endereço não permitido.',
  'git.err.sha256Failed': 'A conferência de integridade (SHA-256) falhou: o arquivo não foi executado.',
  'git.err.noInstaller': 'Não encontrei o instalador do Git para este Windows na página oficial.',
  'git.err.noSha256': 'A release não informa o SHA-256 do instalador; por segurança, nada foi executado.',
  'git.err.badSignature': 'A assinatura digital do instalador não é válida: nada foi executado.',
  'git.err.installerExit': 'O instalador do Git terminou com erro (código {code}).',
  'git.err.brewExit': 'O Homebrew não conseguiu instalar o Git (código {code}).',
  'git.err.confirmMac': 'Confirme a instalação na janela do macOS.',
  'git.err.cltTimeout': 'As Command Line Tools não foram instaladas a tempo.',
  'git.err.indexRedirected': 'O índice do código-fonte foi redirecionado para um endereço não permitido.',
  'git.err.noSource': 'Não encontrei o código-fonte do Git no site oficial.',
  'git.err.noSourceSha': 'O site oficial não publica o SHA-256 deste arquivo; por segurança, nada foi compilado.',
  'git.err.missingTools': 'Faltam ferramentas para compilar o Git ({missing}) e não foi possível pedir permissão para instalá-las. Instale-as ou use "Instalar manualmente".',
  'git.err.depsFailed': 'Não foi possível instalar as ferramentas de compilação (permissão negada ou falha do gerenciador de pacotes).',
  'git.err.extracting': 'Descompactando…',
  'git.err.extractFailed': 'Não foi possível descompactar o código-fonte do Git.',
  'git.err.buildFailed': 'A compilação do Git falhou. Detalhes no log do app.',
  'git.err.installFailed': 'A instalação do Git falhou. Detalhes no log do app.',
  'git.err.noAuto': 'Este sistema não tem instalação automática do Git.',
  'git.err.notResponding': 'A instalação terminou, mas o Git não respondeu. Tente "Verificar de novo" ou instale manualmente.',
  'git.err.outdatedAfter': 'O Git foi instalado, mas a versão ({version}) ainda é menor que a mínima do app. Use "Instalar manualmente" para obter a mais recente.',
  'git.err.unavailable': 'O Git não está instalado neste computador.',
  'git.err.logHint': 'Detalhes no log: ',
} as const;

export default messages;
export type MessageKey = keyof typeof messages;
