import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';

export const useRepositoriesStore = defineStore('repositories', () => {
  const repos = ref<RepositoryMeta[]>([]);
  const query = ref('');
  const busy = ref(false);
  const message = ref<{ kind: 'info' | 'error'; text: string } | null>(null);

  const filtered = computed(() => {
    const q = query.value.trim().toLowerCase();
    if (!q) return repos.value;
    return repos.value.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
  });

  async function load(): Promise<void> {
    repos.value = await api.getKnownRepositories();
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    busy.value = true;
    message.value = null;
    try {
      return await fn();
    } catch (e) {
      message.value = { kind: 'error', text: errMsg(e) };
    } finally {
      busy.value = false;
    }
  }

  async function scanRoots(): Promise<void> {
    const dirs = await api.pickDirectories();
    if (dirs.length === 0) return;
    await scanPaths(dirs);
  }

  async function scanPaths(dirs: string[]): Promise<void> {
    const found = await run(() => api.scanDirectories(dirs));
    if (found) {
      message.value = { kind: 'info', text: `${found.length} repositório(s) encontrado(s).` };
      await load();
    }
  }

  async function addRepository(): Promise<void> {
    const dirs = await api.pickDirectories();
    for (const d of dirs) await addPath(d);
  }

  async function addPath(path: string): Promise<void> {
    const meta = await run(() => api.addRepositoryPath(path.trim()));
    if (meta) {
      message.value = { kind: 'info', text: `Repositório "${meta.name}" adicionado.` };
      await load();
    }
  }

  async function remove(id: string): Promise<void> {
    await run(() => api.removeRepository(id));
    await load();
  }

  async function touch(id: string): Promise<void> {
    await api.touchRepository(id);
    await load();
  }

  return { repos, query, busy, message, filtered, load, scanRoots, scanPaths, addRepository, addPath, remove, touch };
});
