<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import CoreInterface from './CoreInterface.vue';
import CommandPalette from './components/CommandPalette.vue';
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
  const list: Command[] = [
    { id: 'go.home', title: 'Ir para Repositórios', group: 'Navegação', shortcut: 'Mod+1', keywords: 'inicio home lista', run: () => (ws.activeId = HOME_TAB) },
    { id: 'tab.next', title: 'Próxima aba', group: 'Navegação', shortcut: 'Mod+PageDown', run: () => step(1) },
    { id: 'tab.prev', title: 'Aba anterior', group: 'Navegação', shortcut: 'Mod+PageUp', run: () => step(-1) },
    {
      id: 'tab.close',
      title: 'Fechar aba atual',
      group: 'Navegação',
      shortcut: 'Alt+W',
      when: () => ws.activeId !== HOME_TAB,
      run: () => ws.close(ws.activeId),
    },
    { id: 'app.update', title: 'Verificar atualizações do GitNexus', group: 'Aplicativo', keywords: 'nova versão upgrade', run: () => upd.check(true) },
    {
      id: 'app.updateToggle',
      title: upd.enabled ? 'Desligar a verificação automática de atualizações' : 'Ligar a verificação automática de atualizações',
      group: 'Aplicativo',
      run: () => upd.setEnabled(!upd.enabled),
    },
    { id: 'repo.add', title: 'Adicionar repositório…', group: 'Repositórios', keywords: 'novo pasta', run: () => repos.addRepository() },
    { id: 'repo.scan', title: 'Varrer pasta raiz…', group: 'Repositórios', keywords: 'scanner catalogar', run: () => repos.scanRoots() },
    { id: 'repo.status', title: 'Atualizar status de todos os repositórios', group: 'Repositórios', run: () => repos.refreshSummaries() },
    {
      id: 'repo.fetchAll',
      title: 'Buscar (fetch) de todos os repositórios',
      group: 'Repositórios',
      keywords: 'fetch remoto',
      run: () => {
        ws.activeId = HOME_TAB;
        return repos.fetchAll();
      },
    },
    {
      id: 'repo.pullSafe',
      title: 'Atualizar (pull) onde é seguro',
      group: 'Repositórios',
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
      title: `Abrir repositório: ${r.name}`,
      group: 'Repositórios',
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
      { id: 'view.staging', title: 'Abrir Staging', group: 'Navegação', keywords: 'commit alterações', when: inRepo, run: () => ws.open('repo', repo) },
      { id: 'view.graph', title: 'Abrir Grafo / Histórico', group: 'Navegação', keywords: 'log commits busca', when: inRepo, run: () => ws.open('graph', repo) },
      { id: 'view.merge', title: 'Abrir Conflitos', group: 'Navegação', keywords: 'merge resolver', when: inRepo, run: () => ws.open('merge', repo) },
      { id: 'tools.ops', title: 'Ferramentas: histórico de operações (desfazer)', group: 'Ferramentas', keywords: 'undo reflog', when: inRepo, run: () => ws.openTools(repo, 'ops') },
      { id: 'tools.stash', title: 'Ferramentas: stash', group: 'Ferramentas', keywords: 'guardar shelf', when: inRepo, run: () => ws.openTools(repo, 'stash') },
      { id: 'tools.version', title: 'Ferramentas: versão e changelog', group: 'Ferramentas', keywords: 'release tag semver notas próxima', when: inRepo, run: () => ws.openTools(repo, 'version') },
      { id: 'tools.rebase', title: 'Ferramentas: rebase interativo', group: 'Ferramentas', keywords: 'squash reordenar reword fixup drop reescrever', when: inRepo, run: () => ws.openTools(repo, 'rebase') },
      { id: 'tools.file', title: 'Ferramentas: histórico de arquivo e blame', group: 'Ferramentas', keywords: 'autoria anotar', when: inRepo, run: () => ws.openTools(repo, 'file') },
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
