<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import AskpassDialog from './components/AskpassDialog.vue';
import ConfettiRain from './components/ConfettiRain.vue';
import GitGate from './components/GitGate.vue';
import CoreInterface from './CoreInterface.vue';
import CommandPalette from './components/CommandPalette.vue';
import LocaleWelcome from './components/LocaleWelcome.vue';
import SearchWindow from './components/SearchWindow.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import { LOCALE_ASKED_KEY, shouldAskLocale } from './i18n/core';
import { isDialogOpen } from '@git-nexus/ui-kit';
import { api } from './api';
import { LOCALES, locale, setLocale, t } from './i18n';
import { notificationsEnabled, notifyUser } from './notifications';
import { FONT_PREFS, fontCode, fontUi, ligatures, setFontCode, setFontUi, setLigatures } from './font';
import { THEME_PREFS, setThemePref, themePref } from './theme';
import { useAskpassStore } from './stores/askpass';
import { useCommandsStore, type Command } from './stores/commands';
import { useRepositoriesStore } from './stores/repositories';
import { useSearchStore } from './stores/search';
import { useSettingsStore } from './stores/settings';
import { seedFromSelection } from './search-window-core';
import { enteredQuery, linesQuery } from './history-search-core';
import { useGitLogStore } from './stores/gitlog';
import { useGitInstallStore } from './stores/git-install';
import { useUpdateStore } from './stores/update';
import { HOME_TAB, useWorkspaceStore } from './stores/workspace';

const cmds = useCommandsStore();
const ws = useWorkspaceStore();
const repos = useRepositoriesStore();
const upd = useUpdateStore();
const askpass = useAskpassStore();
const gitLog = useGitLogStore();
const settings = useSettingsStore();
const search = useSearchStore();
const gitInstall = useGitInstallStore();
// primeira abertura: pergunta o idioma antes da primeira tela (só sem preferência guardada)
const askLocale = ref(shouldAskLocale(localStorage.getItem('gitnexus.locale'), localStorage.getItem(LOCALE_ASKED_KEY)));

const inRepo = () => !!ws.active?.repo;

const FONT_KEYWORDS = 'fonte tipografia jetbrains mono ligaduras código interface font typeface ligatures code ui';

/** Comandos globais; os do repositório aberto são registrados pelas próprias telas. */
function globalCommands(): Command[] {
  const nav = t('cmd.group.nav');
  const reposGroup = t('cmd.group.repos');
  const toolsGroup = t('cmd.group.tools');
  const app = t('cmd.group.app');
  // palavras-chave em português e inglês: a busca acha o comando em qualquer um dos idiomas
  const list: Command[] = [
    { id: 'go.home', title: t('cmd.home'), group: nav, shortcut: 'Mod+1', keywords: 'inicio home lista repositorios start', run: () => (ws.activeId = HOME_TAB) },
    { id: 'tab.next', title: t('cmd.nextTab'), group: nav, shortcut: 'Mod+PageDown', run: () => step(1) },
    { id: 'tab.prev', title: t('cmd.prevTab'), group: nav, shortcut: 'Mod+PageUp', run: () => step(-1) },
    { id: 'tab.close', title: t('cmd.closeTab'), group: nav, shortcut: 'Alt+W', when: () => ws.activeId !== HOME_TAB, run: () => ws.close(ws.activeId) },
    { id: 'app.zoomIn', title: t('cmd.zoomIn'), group: app, keywords: 'zoom aumentar ampliar maior lupa zoom in bigger', run: () => void api.setZoom('in') },
    { id: 'app.zoomOut', title: t('cmd.zoomOut'), group: app, keywords: 'zoom diminuir reduzir menor zoom out smaller', run: () => void api.setZoom('out') },
    { id: 'app.zoomReset', title: t('cmd.zoomReset'), group: app, keywords: 'zoom restaurar padrão 100 reset normal', run: () => void api.setZoom('reset') },
    {
      id: 'app.settings',
      title: t('cmd.settings'),
      group: app,
      shortcut: 'Mod+,',
      keywords: 'configurações preferências opções ajustes fonte aparência settings preferences options appearance font',
      run: () => settings.open(),
    },
    ...THEME_PREFS.filter((p) => p !== themePref.value).map((p) => ({
      id: `app.theme.${p}`,
      title: t('cmd.theme', { name: t(`theme.${p}`) }),
      group: app,
      keywords: 'tema claro escuro sistema theme light dark system aparência cores',
      run: () => setThemePref(p),
    })),
    ...FONT_PREFS.filter((p) => p !== fontUi.value).map((p) => ({
      id: `app.fontUi.${p}`,
      title: t('cmd.fontUi', { name: t(`font.${p}`) }),
      group: app,
      keywords: FONT_KEYWORDS,
      run: () => setFontUi(p),
    })),
    ...FONT_PREFS.filter((p) => p !== fontCode.value).map((p) => ({
      id: `app.fontCode.${p}`,
      title: t('cmd.fontCode', { name: t(`font.${p}`) }),
      group: app,
      keywords: FONT_KEYWORDS,
      run: () => setFontCode(p),
    })),
    {
      id: 'app.ligatures',
      title: ligatures.value === 'on' ? t('cmd.ligaturesOff') : t('cmd.ligaturesOn'),
      group: app,
      keywords: FONT_KEYWORDS,
      run: () => setLigatures(ligatures.value === 'on' ? 'off' : 'on'),
    },
    {
      id: 'app.notifToggle',
      title: notificationsEnabled.value ? t('cmd.notifOff') : t('cmd.notifOn'),
      group: app,
      keywords: 'notificação notificacoes aviso avisos alerta notifications alerts desligar ligar',
      run: () => {
        notificationsEnabled.value = !notificationsEnabled.value;
        upd.say(notificationsEnabled.value ? t('notif.on') : t('notif.off'));
      },
    },
    {
      id: 'app.notifTest',
      title: t('cmd.notifTest'),
      group: app,
      keywords: 'notificação teste testar notifications test',
      run: async () => upd.say((await notifyUser({ title: t('notif.testTitle'), body: t('notif.testBody') }, true)) ? t('notif.testSent') : t('notif.testBlocked')),
    },
    { id: 'app.update', title: t('cmd.update'), group: app, keywords: 'nova versão upgrade atualizar update', run: () => upd.check(true) },
    {
      id: 'app.updateToggle',
      title: upd.enabled ? t('cmd.autoOff') : t('cmd.autoOn'),
      group: app,
      keywords: 'update atualização automática',
      run: () => upd.setEnabled(!upd.enabled),
    },
    ...LOCALES.filter((l) => l.id !== locale.value).map((l) => ({
      id: `app.lang.${l.id}`,
      title: t('cmd.language', { name: l.label }),
      group: app,
      keywords: 'idioma língua language locale',
      run: () => setLocale(l.id),
    })),
    { id: 'repo.clone', title: t('cmd.clone'), group: reposGroup, keywords: 'clonar clone baixar url git clone', run: () => { ws.activeId = HOME_TAB; repos.createDialog = 'clone'; } },
    { id: 'repo.new', title: t('cmd.newRepo'), group: reposGroup, keywords: 'novo criar init iniciar repositório new create', run: () => { ws.activeId = HOME_TAB; repos.createDialog = 'init'; } },
    { id: 'repo.add', title: t('cmd.addRepo'), group: reposGroup, keywords: 'novo pasta new folder add', run: () => repos.addRepository() },
    { id: 'repo.scan', title: t('cmd.scan'), group: reposGroup, keywords: 'scanner catalogar scan catalog', run: () => repos.scanRoots() },
    { id: 'repo.status', title: t('cmd.status'), group: reposGroup, keywords: 'refresh', run: () => repos.refreshSummaries() },
    {
      id: 'repo.fetchAll',
      title: t('cmd.fetchAll'),
      group: reposGroup,
      keywords: 'fetch remoto remote',
      run: () => {
        ws.activeId = HOME_TAB;
        return repos.fetchAll();
      },
    },
    {
      id: 'repo.pullSafe',
      title: t('cmd.pullSafe'),
      group: reposGroup,
      keywords: 'pull fast-forward',
      run: () => {
        ws.activeId = HOME_TAB;
        return repos.pullSafe();
      },
    },
  ];
  // um comando por repositório catalogado
  for (const r of repos.repos) {
    list.push({
      id: `open.${r.id}`,
      title: t('cmd.open', { name: r.name }),
      group: reposGroup,
      keywords: r.path,
      run: async () => {
        ws.openRepo(r);
        await repos.touch(r.id);
      },
    });
  }
  // atalhos para as abas do repositório ativo
  const repo = ws.active?.repo;
  if (repo) {
    list.push(
      // Ctrl+F e Ctrl+Shift+F abrem a mesma janela; com o foco num editor, o Ctrl+F é da barra daquele arquivo (o editor trata antes e este atalho nem dispara)
      {
        id: 'search.window',
        title: t('cmd.search'),
        group: nav,
        shortcut: 'Mod+F',
        alias: 'Mod+Shift+F',
        keywords: 'buscar procurar pesquisar grep conteudo código texto substituir search find replace',
        when: inRepo,
        run: () => search.open(repo, selectedText()),
      },
      // Ctrl+Shift+H: a mesma janela com a linha "Substituir por" (substituir em vários arquivos, com prévia e desfazer)
      {
        id: 'search.replace',
        title: t('cmd.searchReplace'),
        group: nav,
        shortcut: 'Mod+Shift+H',
        keywords: 'substituir trocar renomear replace rename varios arquivos massa',
        when: inRepo,
        run: () => search.open(repo, selectedText(), null, true),
      },
      // buscar na história (fase 9 da #233): o texto selecionado vira a busca; "Quando isto entrou ou saiu?" e "Histórico destas linhas" valem para o arquivo aberto na janela de pesquisa
      {
        id: 'search.index',
        title: t('cmd.searchIndex'),
        group: nav,
        keywords: 'índice indice busca acelerar rápida trigramas search index speed up faster',
        when: inRepo,
        run: () => search.openIndex(repo),
      },
      {
        id: 'history.search',
        title: t('cmd.historySearch'),
        group: nav,
        keywords: 'buscar procurar história historico pickaxe quando entrou saiu git log search history',
        when: inRepo,
        run: () => ws.openHistory(repo, { text: selectedText(), mode: 'pickaxe' }),
      },
      {
        id: 'history.entered',
        title: t('cmd.historyEntered'),
        group: nav,
        keywords: 'quando entrou saiu texto selecionado pickaxe when added removed',
        when: () => inRepo() && !!(search.fileContext?.()?.text.trim() || selectedText()),
        run: () => {
          const c = search.fileContext?.();
          const text = c?.text.trim() ? c.text : selectedText();
          search.close();
          ws.openHistory(c?.repo ?? repo, enteredQuery(text));
        },
      },
      {
        id: 'history.lines',
        title: t('cmd.historyLines'),
        group: nav,
        keywords: 'histórico linhas trecho git log -L line history',
        when: () => inRepo() && !!search.fileContext?.() && !search.fileContext()!.dirty,
        run: () => {
          const c = search.fileContext?.();
          if (!c) return;
          search.close();
          ws.openHistory(c.repo, linesQuery(c.file, c));
        },
      },
      { id: 'view.staging', title: t('cmd.staging'), group: nav, shortcut: 'Mod+Alt+1', keywords: 'commit alterações changes', when: inRepo, run: () => ws.open('repo', repo) },
      { id: 'view.graph', title: t('cmd.graph'), group: nav, shortcut: 'Mod+Alt+2', keywords: 'log commits busca history search', when: inRepo, run: () => ws.open('graph', repo) },
      { id: 'view.tools', title: t('cmd.tools'), group: nav, shortcut: 'Mod+Alt+3', keywords: 'ferramentas stash tags rebase tools', when: inRepo, run: () => ws.open('tools', repo) },
      { id: 'view.merge', title: t('cmd.merge'), group: nav, shortcut: 'Mod+Alt+4', keywords: 'merge resolver conflicts resolve', when: () => inRepo() && ws.hasConflictView(repo.id), run: () => ws.open('merge', repo) },
      { id: 'ops.abort', title: t('cmd.abortOperation'), group: nav, keywords: 'abortar merge rebase cherry-pick revert cancelar abort', when: () => inRepo() && !!ws.ops[repo.id]?.kind, run: () => document.querySelector<HTMLElement>('.core__pane:not([style*="display: none"]) [data-testid="op-abort"]')?.click() },
      { id: 'tools.ops', title: t('cmd.ops'), group: toolsGroup, keywords: 'undo reflog desfazer', when: inRepo, run: () => ws.openTools(repo, 'ops') },
      { id: 'tools.stash', title: t('cmd.stash'), group: toolsGroup, keywords: 'guardar shelf', when: inRepo, run: () => ws.openTools(repo, 'stash') },
      { id: 'tools.hosting', title: t('cmd.hosting'), group: toolsGroup, keywords: 'github gitlab pr mr pipeline criar create', when: inRepo, run: () => ws.openTools(repo, 'hosting') },
      { id: 'tools.version', title: t('cmd.version'), group: toolsGroup, keywords: 'release tag semver notas próxima notes', when: inRepo, run: () => ws.openTools(repo, 'version') },
      { id: 'tools.rebase', title: t('cmd.rebase'), group: toolsGroup, keywords: 'squash reordenar reword fixup drop reescrever reorder', when: inRepo, run: () => ws.openTools(repo, 'rebase') },
      { id: 'tools.file', title: t('cmd.file'), group: toolsGroup, keywords: 'autoria anotar history', when: inRepo, run: () => ws.openTools(repo, 'file') },
    );
  }
  return list;
}

/** A seleção do momento (campo de texto ou página) que vira a pesquisa: uma linha, curta; senão vazio. */
function selectedText(): string {
  const el = document.activeElement;
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.selectionStart !== null && el.selectionEnd !== null) return seedFromSelection(el.value.slice(el.selectionStart, el.selectionEnd));
  return seedFromSelection(window.getSelection()?.toString() ?? '');
}

function step(delta: number): void {
  const i = ws.tabs.findIndex((t) => t.id === ws.activeId);
  const next = ws.tabs[(i + delta + ws.tabs.length) % ws.tabs.length];
  if (next) ws.activeId = next.id;
}

function onKeydown(ev: KeyboardEvent): void {
  if (isDialogOpen()) return; // com um diálogo aberto, os atalhos globais (Ctrl+K inclusive) ficam quietos
  if (ev.defaultPrevented) return; // quem tem o foco já tratou a tecla (o editor com Ctrl+F, por exemplo)
  const mod = ev.ctrlKey || ev.metaKey;
  const k = ev.key.toLowerCase();
  // paleta: Ctrl/⌘+K (e Ctrl/⌘+Shift+P, como em outros editores)
  if (mod && !ev.altKey && ((k === 'k' && !ev.shiftKey) || (k === 'p' && ev.shiftKey))) {
    ev.preventDefault();
    cmds.toggle();
    return;
  }
  if (cmds.isOpen) return; // a paleta cuida das próprias teclas
  const c = cmds.byShortcut(ev);
  if (c) {
    ev.preventDefault();
    void cmds.run(c);
  }
}

let off: (() => void) | undefined;
let stopGit: (() => void) | undefined;
let updTimers: ReturnType<typeof setTimeout>[] = [];
onMounted(() => {
  off = cmds.register(globalCommands);
  gitLog.start();
  askpass.listen();
  stopGit = gitInstall.start(); // Git ausente (ou antigo): aviso, bloqueio e instalação automática
  // atualização: 8 s depois de abrir (não atrasa a abertura) e a cada 12 h
  updTimers = [setTimeout(() => void upd.check(), 8000)];
  const iv = setInterval(() => void upd.check(), 12 * 3600 * 1000);
  updTimers.push(iv as unknown as ReturnType<typeof setTimeout>);
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  off?.();
  stopGit?.();
  updTimers.forEach((t) => clearTimeout(t));
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <CoreInterface />
  <CommandPalette />
  <SettingsDialog v-if="settings.isOpen" @close="settings.close()" />
  <SearchWindow v-if="search.isOpen && search.repo" :repo="search.repo" :seed="search.seed" :preset="search.preset ?? undefined" :replace="search.replace" :open-n="search.n" @close="search.close()" />
  <LocaleWelcome v-if="askLocale" @done="askLocale = false" />
  <AskpassDialog />
  <GitGate />
  <ConfettiRain v-if="upd.celebrating" @done="upd.celebrating = false" />
</template>
