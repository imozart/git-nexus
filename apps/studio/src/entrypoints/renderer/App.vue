<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import CoreInterface from './CoreInterface.vue';
import CommandPalette from './components/CommandPalette.vue';
import { LOCALES, locale, setLocale, t } from './i18n';
import { useCommandsStore, type Command } from './stores/commands';
import { useRepositoriesStore } from './stores/repositories';
import { useUpdateStore } from './stores/update';
import { HOME_TAB, useWorkspaceStore } from './stores/workspace';

const cmds = useCommandsStore();
const ws = useWorkspaceStore();
const repos = useRepositoriesStore();
const upd = useUpdateStore();

const inRepo = () => !!ws.active?.repo;

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
        ws.open('repo', r);
        await repos.touch(r.id);
      },
    });
  }
  // atalhos para as abas do repositório ativo
  const repo = ws.active?.repo;
  if (repo) {
    list.push(
      { id: 'view.staging', title: t('cmd.staging'), group: nav, keywords: 'commit alterações changes', when: inRepo, run: () => ws.open('repo', repo) },
      { id: 'view.graph', title: t('cmd.graph'), group: nav, keywords: 'log commits busca history search', when: inRepo, run: () => ws.open('graph', repo) },
      { id: 'view.merge', title: t('cmd.merge'), group: nav, keywords: 'merge resolver conflicts resolve', when: inRepo, run: () => ws.open('merge', repo) },
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

function step(delta: number): void {
  const i = ws.tabs.findIndex((t) => t.id === ws.activeId);
  const next = ws.tabs[(i + delta + ws.tabs.length) % ws.tabs.length];
  if (next) ws.activeId = next.id;
}

function onKeydown(ev: KeyboardEvent): void {
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
let updTimers: ReturnType<typeof setTimeout>[] = [];
onMounted(() => {
  off = cmds.register(globalCommands);
  // atualização: 8 s depois de abrir (não atrasa a abertura) e a cada 12 h
  updTimers = [setTimeout(() => void upd.check(), 8000)];
  const iv = setInterval(() => void upd.check(), 12 * 3600 * 1000);
  updTimers.push(iv as unknown as ReturnType<typeof setTimeout>);
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  off?.();
  updTimers.forEach((t) => clearTimeout(t));
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <CoreInterface />
  <CommandPalette />
</template>
