<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { GnBadge, GnButton } from '@git-nexus/ui-kit';
import type { RepoSummary, RepositoryMeta } from '@git-nexus/git-core/pure';
import { useRepositoriesStore } from '../stores/repositories';
import { useWorkspaceStore } from '../stores/workspace';

const store = useRepositoriesStore();
const ws = useWorkspaceStore();
const manualPath = ref('');

onMounted(() => store.load());

async function open(repo: RepositoryMeta): Promise<void> {
  ws.open('repo', repo);
  await store.touch(repo.id);
}

async function remove(repo: RepositoryMeta): Promise<void> {
  ws.closeRepo(repo.id);
  await store.remove(repo.id);
}

async function pullOne(r: RepositoryMeta): Promise<void> {
  const res = await store.syncOne(r, 'pull');
  store.message = { kind: res.ok ? 'info' : 'error', text: `${r.name}: ${res.message}` };
}

async function addManual(): Promise<void> {
  const p = manualPath.value.trim();
  if (!p) return;
  await store.addPath(p);
  if (store.message?.kind === 'info') manualPath.value = '';
}

/** Resumo pronto do repositório (ou `null` enquanto carrega / se deu erro). */
const sum = (r: RepositoryMeta): RepoSummary | null => {
  const s = store.summaries[r.id];
  return s && !('error' in s) ? s : null;
};
const sumError = (r: RepositoryMeta): string => {
  const s = store.summaries[r.id];
  return s && 'error' in s ? s.error : '';
};
const changes = (s: RepoSummary) => s.staged + s.unstaged + s.untracked;

const fmt = (ts: number) => (ts ? new Date(ts).toLocaleString('pt-BR') : 'nunca aberto');
</script>

<template>
  <div class="conn">
    <header class="conn__head">
      <div>
        <h1>Repositórios</h1>
        <p class="muted">Adicione um repositório ou varra uma pasta raiz para catalogar todos os projetos dentro dela.</p>
      </div>
      <div class="conn__actions">
        <GnButton variant="primary" :disabled="store.busy" @click="store.addRepository()">Adicionar repositório…</GnButton>
        <GnButton :disabled="store.busy" @click="store.scanRoots()">Varrer pasta raiz…</GnButton>
      </div>
    </header>

    <form class="conn__manual" @submit.prevent="addManual">
      <input v-model="manualPath" placeholder="Ou cole um caminho, ex.: C:\projetos\app  ou  \\wsl$\Ubuntu\home\user\app" />
      <GnButton type="submit" :disabled="store.busy || !manualPath.trim()">Adicionar caminho</GnButton>
    </form>

    <div class="conn__bar">
      <input v-model="store.query" class="conn__search" placeholder="Buscar por nome ou caminho…" />
      <label class="muted opt"><input v-model="store.onlyPending" type="checkbox" /> Só com pendências</label>
      <GnButton size="sm" :disabled="!!store.progress" @click="store.refreshSummaries()">Atualizar status</GnButton>
      <GnButton size="sm" :disabled="!!store.progress" title="git fetch --all --prune em todos os repositórios" @click="store.fetchAll()">Buscar todos</GnButton>
      <GnButton size="sm" variant="primary" :disabled="!!store.progress" title="Pull só por fast-forward, onde há upstream, o repositório está atrás, não divergiu e a árvore está limpa" @click="store.pullSafe()">
        Atualizar seguros
      </GnButton>
    </div>
    <p v-if="store.progress" class="muted">{{ store.progress.label }}: {{ store.progress.done }}/{{ store.progress.total }}…</p>
    <div v-if="store.report" class="report">
      <div class="report__head">
        <strong>{{ store.report.title }}</strong>
        <GnButton size="sm" @click="store.report = null">Fechar</GnButton>
      </div>
      <p v-if="!store.report.items.length" class="muted">Nada a fazer: nenhum repositório se encaixa.</p>
      <ul>
        <li v-for="it in store.report.items" :key="it.name" :class="it.ok ? 'ok' : 'bad'">
          {{ it.ok ? '✔' : '✖' }} <strong>{{ it.name }}</strong> — {{ it.text }}
        </li>
      </ul>
    </div>

    <p v-if="store.busy" class="muted">Processando… (varreduras em pastas grandes podem levar alguns segundos)</p>
    <p v-if="store.message" :class="['msg', `msg--${store.message.kind}`]">{{ store.message.text }}</p>

    <p v-if="!store.filtered.length && !store.busy" class="muted empty">
      {{ store.repos.length ? 'Nenhum repositório corresponde à busca.' : 'Nenhum repositório catalogado ainda.' }}
    </p>

    <ul class="conn__list">
      <li v-for="r in store.filtered" :key="r.id" class="repo" @dblclick="open(r)">
        <div class="repo__main" @click="open(r)">
          <strong>{{ r.name }}</strong>
          <GnBadge v-if="r.isWsl" tone="accent">WSL2</GnBadge>
          <div class="repo__state">
            <template v-if="sum(r)">
              <GnBadge tone="accent" :title="sum(r)!.upstream ? 'Upstream: ' + sum(r)!.upstream : 'Sem upstream'">⎇ {{ sum(r)!.branch }}</GnBadge>
              <GnBadge v-if="sum(r)!.ahead" tone="accent" title="Commits locais ainda não enviados">↑{{ sum(r)!.ahead }}</GnBadge>
              <GnBadge v-if="sum(r)!.behind" tone="warn" title="Commits do remoto ainda não trazidos">↓{{ sum(r)!.behind }}</GnBadge>
              <GnBadge v-if="changes(sum(r)!)" tone="warn" title="Arquivos alterados, no stage ou novos">● {{ changes(sum(r)!) }} alteração(ões)</GnBadge>
              <GnBadge v-if="sum(r)!.conflicted" tone="danger">⚠ {{ sum(r)!.conflicted }} conflito(s)</GnBadge>
              <GnBadge v-if="!sum(r)!.upstream && !sum(r)!.detached" tone="neutral">sem upstream</GnBadge>
              <GnBadge v-if="sum(r)!.upstream && !sum(r)!.ahead && !sum(r)!.behind && !changes(sum(r)!) && !sum(r)!.conflicted" tone="success">em dia</GnBadge>
            </template>
            <span v-else-if="sumError(r)" class="state-err" :title="sumError(r)">sem acesso ao status</span>
            <span v-else class="muted">carregando status…</span>
            <span v-if="store.working[r.id]" class="muted">{{ store.working[r.id] === 'fetch' ? 'buscando…' : 'atualizando…' }}</span>
          </div>
          <div class="muted repo__path">{{ r.path }}</div>
          <div class="muted repo__time">{{ fmt(r.lastOpenedAt) }}</div>
        </div>
        <div class="repo__btns">
          <GnButton size="sm" variant="primary" @click="open(r)">Abrir</GnButton>
          <GnButton size="sm" :disabled="!!store.working[r.id]" title="git fetch --all --prune" @click="store.syncOne(r, 'fetch')">Buscar</GnButton>
          <GnButton size="sm" :disabled="!!store.working[r.id] || !sum(r)?.upstream" title="Pull somente por fast-forward" @click="pullOne(r)">Pull</GnButton>
          <GnButton size="sm" variant="danger" title="Remove só do catálogo; os arquivos não são tocados." @click="remove(r)">
            Remover
          </GnButton>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped lang="scss">
.conn {
  padding: 20px 28px;
  max-width: 1100px;
  margin: 0 auto;
  h1 { margin: 0 0 4px; font-size: 20px; }
  &__head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
  &__actions { display: flex; gap: 8px; flex-shrink: 0; }
  &__manual { display: flex; gap: 8px; margin-bottom: 10px; input { flex: 1; } }
  &__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
  &__search { flex: 1; min-width: 220px; }
  &__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
}
.muted { color: var(--gn-muted); margin: 0; }
.opt { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; }
.state-err { color: var(--gn-danger); font-size: 12px; }
.report {
  border: 1px solid var(--gn-border); border-radius: var(--gn-radius); padding: 8px 12px; margin-bottom: 12px; background: var(--gn-bg);
  &__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; font-size: 12px; max-height: 180px; overflow: auto; }
  .ok { color: var(--gn-success); }
  .bad { color: var(--gn-danger); }
}
.empty { padding: 30px 0; text-align: center; }
.msg {
  padding: 7px 10px;
  border-radius: var(--gn-radius);
  margin: 0 0 10px;
  white-space: pre-wrap;
  &--info { background: rgba(79, 181, 106, 0.12); color: var(--gn-success); }
  &--error { background: rgba(239, 106, 98, 0.12); color: var(--gn-danger); }
}
.repo {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--gn-surface-2);
  border: 1px solid var(--gn-border);
  border-radius: var(--gn-radius);
  &:hover { border-color: var(--gn-accent); }
  &__main { flex: 1; min-width: 0; cursor: pointer; }
  &__path { font-family: var(--gn-mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__time { font-size: 11px; }
  &__state { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: 3px 0; }
  &__btns { display: flex; gap: 6px; }
}
</style>
