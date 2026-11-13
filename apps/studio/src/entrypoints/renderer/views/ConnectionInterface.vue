<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { GnBadge, GnButton } from '@git-nexus/ui-kit';
import type { RepositoryMeta } from '@git-nexus/git-core/pure';
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

async function addManual(): Promise<void> {
  const p = manualPath.value.trim();
  if (!p) return;
  await store.addPath(p);
  if (store.message?.kind === 'info') manualPath.value = '';
}

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

    <input v-model="store.query" class="conn__search" placeholder="Buscar por nome ou caminho…" />

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
          <div class="muted repo__path">{{ r.path }}</div>
          <div class="muted repo__time">{{ fmt(r.lastOpenedAt) }}</div>
        </div>
        <div class="repo__btns">
          <GnButton size="sm" variant="primary" @click="open(r)">Abrir</GnButton>
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
  &__search { width: 100%; margin-bottom: 12px; }
  &__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
}
.muted { color: var(--gn-muted); margin: 0; }
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
  &__btns { display: flex; gap: 6px; }
}
</style>
