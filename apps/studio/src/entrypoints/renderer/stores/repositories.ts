import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { RepoSummary, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';

export const useRepositoriesStore = defineStore('repositories', () => {
  const repos = ref<RepositoryMeta[]>([]);
  const query = ref('');
  const busy = ref(false);
  const message = ref<{ kind: 'info' | 'error'; text: string } | null>(null);

  const filtered = computed(() => {
    const q = query.value.trim().toLowerCase();
    const base = onlyPending.value ? repos.value.filter(needsAttention) : repos.value;
    if (!q) return base;
    return base.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
  });

  async function load(): Promise<void> {
    repos.value = await api.getKnownRepositories();
    void refreshSummaries();
  }

  // --- painel: estado de cada repositório ---------------------------------------------------------
  type Summary = RepoSummary | { error: string };
  const summaries = ref<Record<string, Summary>>({});
  /** Repositórios com uma operação (status/fetch/pull) em andamento. */
  const working = ref<Record<string, string>>({});
  const progress = ref<{ label: string; done: number; total: number } | null>(null);
  const report = ref<{ title: string; items: { name: string; ok: boolean; text: string }[] } | null>(null);
  const onlyPending = ref(false);

  /** Roda `fn` sobre os itens, `n` por vez. */
  async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
    let i = 0;
    await Promise.all(
      Array.from({ length: Math.min(n, items.length) }, async () => {
        while (i < items.length) await fn(items[i++]!);
      }),
    );
  }

  async function summarize(r: RepositoryMeta): Promise<void> {
    try {
      summaries.value[r.id] = await api.getRepoSummary(r.path);
    } catch (e) {
      summaries.value[r.id] = { error: errMsg(e) };
    }
  }

  async function refreshSummaries(): Promise<void> {
    await pool([...repos.value], 4, summarize);
  }

  const isOk = (s: Summary | undefined): s is RepoSummary => !!s && !('error' in s);
  const isDirty = (s: RepoSummary) => s.staged + s.unstaged + s.conflicted > 0;
  /** Precisa de atenção: alterações locais, commits para enviar/receber ou conflitos. */
  const needsAttention = (r: RepositoryMeta) => {
    const s = summaries.value[r.id];
    return !s || !isOk(s) || isDirty(s) || s.untracked > 0 || s.ahead > 0 || s.behind > 0;
  };

  async function syncOne(r: RepositoryMeta, kind: 'fetch' | 'pull'): Promise<{ ok: boolean; message: string }> {
    working.value[r.id] = kind;
    try {
      const res = kind === 'fetch' ? await api.fetchRepo(r.path) : await api.pullRepo(r.path);
      await summarize(r);
      return res;
    } catch (e) {
      return { ok: false, message: errMsg(e) };
    } finally {
      delete working.value[r.id];
    }
  }

  async function runBatch(title: string, list: RepositoryMeta[], kind: 'fetch' | 'pull'): Promise<void> {
    if (!list.length) {
      report.value = { title, items: [] };
      return;
    }
    const items: { name: string; ok: boolean; text: string }[] = [];
    progress.value = { label: title, done: 0, total: list.length };
    await pool(list, 4, async (r) => {
      const res = await syncOne(r, kind);
      items.push({ name: r.name, ok: res.ok, text: res.message });
      progress.value!.done++;
    });
    progress.value = null;
    report.value = { title, items: items.sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name)) };
  }

  const fetchAll = () => runBatch('Buscar de todos os remotos', [...repos.value], 'fetch');

  /** Pull só onde é seguro: tem upstream, está atrás, não está à frente (sem divergência) e a árvore está limpa. */
  function pullSafe(): Promise<void> {
    const safe = repos.value.filter((r) => {
      const s = summaries.value[r.id];
      return isOk(s) && !!s.upstream && !s.detached && s.behind > 0 && s.ahead === 0 && !isDirty(s);
    });
    return runBatch('Atualizar (pull fast-forward) onde é seguro', safe, 'pull');
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

  return { summaries, working, progress, report, onlyPending, needsAttention, refreshSummaries, fetchAll, pullSafe, syncOne, repos, query, busy, message, filtered, load, scanRoots, scanPaths, addRepository, addPath, remove, touch };
});
