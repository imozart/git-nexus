# Prompt de Instruções: **GitNexus (v1.0)**

> Arquivo de instruções do projeto. Referência de arquitetura: https://github.com/beekeeper-studio/beekeeper-studio/

Você é um Engenheiro de Software Principal e Arquiteto de Sistemas especialista em Electron, Vue 3, TypeScript e internals do Git. Sua missão é construir do zero a versão 1.0 (MVP) do **GitNexus**, um gerenciador de repositórios Git desktop portátil, de alto desempenho e focado em governança corporativa e resolução visual de conflitos.

---

### 1. CONTEXTO DO PROJETO E POSICIONAMENTO DE MERCADO

O mercado atual de clientes Git é marcado por compromissos técnicos: ferramentas visuais ricas como GitKraken são pesadas e exigem assinaturas pagas; opções nativas como Sublime Merge carecem de governança corporativa e gestão visual amigável; e ferramentas como GitHub Desktop e Sourcetree ignoram o Linux ou falham em fluxos avançados de engenharia.

O **GitNexus** surge para resolver duas dores centrais do desenvolvimento moderno:
1. **Falta de Padronização no Histórico:** Caixas de texto livre nas GUIs tradicionais geram mensagens de commit caóticas. Quando as empresas usam git hooks para forçar o padrão *Conventional Commits*, a validação só ocorre no final e o desenvolvedor costuma burlar a regra com `--no-verify`.
2. **Resolução Complexa de Conflitos:** Ferramentas de 2 vias omitem o ancestral comum (*Base Commit*), resultando em substituições acidentais de lógicas válidas.

Nossos diferenciais competitivos imediatos no MVP são: **Linter de Conventional Commits em tempo de digitação**, **Editor Visual de 3-Way Merge com trava de segurança**, **Workspace Tabulado** e **Execução Portátil de Alta Performance** otimizada para repositórios locais e cenários WSL2.

---

### 2. ARQUITETURA DO SISTEMA E TECNOLOGIAS (PADRÃO BEEKEEPER STUDIO)

A arquitetura deve ser estritamente baseada no modelo modular e de alto desempenho do **Beekeeper Studio**. Crie um Monorepo gerenciado por **PNPM Workspaces** (`pnpm-workspace.yaml`):

```
git-nexus/
├── pnpm-workspace.yaml
├── apps/
│   ├── studio/              # Aplicação Electron principal
│   └── ui-kit/              # Biblioteca de componentes Vue 3 + SCSS (@git-nexus/ui-kit)
└── packages/
    ├── git-core/            # Abstração isolada de comandos e driver Git
    └── governance-policy/   # Motor de validação sintática e regras de commit
```

#### Stack Tecnológica Obrigatória:
* **Runtime Desktop:** Electron (v31+) com isolamento de contexto rígido (`contextIsolation: true`, `nodeIntegration: false`).
* **Frontend:** Vue 3 (Composition API com `<script setup>`), TypeScript estrito, Pinia para estado reativo.
* **Build System:** **ESBuild** para compilação ultrarrápida do Processo Principal (Main) e Utilitário; **Vite** para o Processo de Renderização (Renderer) com HMR.
* **Arquitetura de Processos (Beekeeper Pattern) em `apps/studio/src/entrypoints/`:**
  * `main.ts`: Ciclo de vida de janelas nativas, diálogos do sistema e atalhos.
  * `preload.ts`: Ponte IPC segura expondo a API estritamente tipada via `contextBridge`.
  * `renderer.ts`: Ponto de entrada da interface de usuário Vue 3.
  * `utility.ts`: Processo Utilitário dedicado (`Electron UtilityProcess`) executado em background para chamadas intensivas do Git (parsing de grafos e diffs massivos), garantindo que a UI mantenha 60fps constantes sem congelamentos.

#### Requisitos de Portabilidade e Gerenciamento de Armazenamento:
* **Execução Portátil ("Portable"):** O aplicativo NÃO deve exigir instalação no sistema operacional. Deve ser empacotado como executável portátil/ZIP no Windows, AppImage no Linux e Bundle ZIP/DMG portátil no macOS.
* **Persistência Local e Seleção Livre de Pastas:**
  * O usuário pode adicionar pastas individuais de repositórios ou pastas "raiz" contendo múltiplos projetos espalhados pelo disco rígido.
  * O sistema deve realizar uma varredura recursiva eficiente para localizar estruturas `.git` em qualquer caminho local do computador.
  * As preferências, histórico e a lista de repositórios catalogados devem ser persistidos em um arquivo de banco de dados SQLite local (ou JSON indexado) salvo no diretório portátil (`userData` local/relativo), sem registrar chaves no sistema operacional.

---

### 3. ESCOPO DO MVP (FUNCIONALIDADES ESSENCIAIS)

#### A. Gerenciador de Repositórios e Mapeamento (`ConnectionInterface`)
* Tela inicial para listagem, busca e catalogação de repositórios em múltiplos diretórios do computador.
* **Suporte Transparente a WSL2:** No Windows, ao identificar caminhos de rede virtualizados do WSL2 (`\\wsl$\...`), alternar automaticamente o modo de execução para isolar a checagem de estado do Git e evitar bloqueios do arquivo `.git/index.lock` e gargalos do protocolo 9P.

#### B. Workspace Tabulado Multi-Contexto (`CoreInterface`)
* Navegação por abas dinâmicas permitindo alternar instantaneamente entre:
  * Aba do Repositório (Staging & Commits).
  * Aba do Grafo e Histórico de Commits.
  * Aba da Ferramenta de Resolução de Conflitos 3-Way.

#### C. Enforcer de Conventional Commits (`CommitForm.vue`)
* Formulário estruturado e guiado (sem caixa de texto livre):
  * **Tipo:** Seletor interativo (`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`).
  * **Escopo:** Campo opcional/obrigatório.
  * **Título:** Contador de caracteres ao vivo (máximo de 50 caracteres).
  * **Número do Ticket:** Validação por expressão regular (ex.: `[A-Z]+-\d+`).
  * **Corpo e Breaking Changes:** Campos formatados para contextualização.
* **Linter em Tempo Real:** Validação sintática instantânea durante a digitação. O botão "Commit" permanece desabilitado enquanto a mensagem não atingir 100% de conformidade.
* Exibição do *stdout/stderr* dos Git Hooks locais diretamente na interface.

#### D. Editor Visual Tridimensional de Conflitos (`MergeConflictResolver.vue`)
* Painel de 3 colunas paralelas (*Ours / Base Ancestral / Theirs*) + Painel Inferior do Resultado da Fusão com destaque de sintaxe (CodeMirror ou Monaco Editor).
* Ações rápidas por bloco de código e **Trava de Segurança:** O botão "Marcar como Resolvido" permanece bloqueado enquanto existirem marcadores de conflito (`<<<<<<<`, `=======`, `>>>>>>>`) no arquivo.

---

### 4. CONTRATOS DE DADOS E IPC TYPESCRIPT (PARA SUAS INTERFACES)

Crie os contratos de comunicação inter-processos em `packages/git-core/src/types/ipc.ts`:

```typescript
export interface RepositoryMeta {
  id: string;
  name: string;
  path: string;
  isWsl: boolean;
  lastOpenedAt: number;
}

export interface ConventionalCommitInput {
  type: 'feat' | 'fix' | 'docs' | 'style' | 'refactor' | 'perf' | 'test' | 'build' | 'ci' | 'chore';
  scope?: string;
  ticketNumber?: string;
  subject: string;
  body?: string;
  breakingChanges?: string;
}

export interface MergeConflictBlock {
  filePath: string;
  ours: string;
  base: string;
  theirs: string;
  hasUnresolvedMarkers: boolean;
}

export interface GitNexusIPC {
  // Gestão de Pastas e Repositórios Portáteis
  scanDirectories(rootPaths: string[]): Promise<RepositoryMeta[]>;
  getKnownRepositories(): Promise<RepositoryMeta[]>;
  addRepositoryPath(path: string): Promise<RepositoryMeta>;
  
  // Execução Git via UtilityProcess
  getGitStatus(repoPath: string): Promise<{ branch: string; staged: string[]; unstaged: string[] }>;
  validateCommitMessage(input: ConventionalCommitInput): { isValid: boolean; errors: string[] };
  executeCommit(repoPath: string, input: ConventionalCommitInput): Promise<{ commitHash: string }>;
  
  // Resolução 3-Way
  getMergeConflicts(repoPath: string): Promise<MergeConflictBlock[]>;
  resolveConflictFile(repoPath: string, filePath: string, mergedContent: string): Promise<boolean>;
}
```

---

### 5. ORDEM DE EXECUÇÃO RECOMENDADA

1. Configurar a estrutura do Monorepo no PNPM com `pnpm-workspace.yaml` e as dependências base.
2. Criar os tipos de IPC e o pacote `@git-nexus/git-core` com o driver de integração do Git.
3. Configurar os scripts de compilação no `apps/studio` (ESBuild para `main.ts`/`utility.ts` e Vite para `renderer.ts`).
4. Implementar o escaneamento de repositórios em diretórios arbitrários na `ConnectionInterface`.
5. Construir a interface do `CommitForm.vue` com o linter sintático e o resolver de conflitos 3-Way.
6. Ajustar o `electron-builder` para gerar empacotamentos portáteis (ZIP/AppImage).
