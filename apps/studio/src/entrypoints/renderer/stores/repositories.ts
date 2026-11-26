import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { RepoSummary, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { t } from '../i18n';
import { filterRepos, needsAttention as summaryNeedsAttention, nextSort, parseHomePrefs, sortRepos, type HomeDensity, type HomeFilter, type HomeSort } from '../home-core';

const HOME_PREFS_KEY = 'gitnexus.home';
/** Quantos repositórios resumem ao mesmo tempo (cada resumo roda dois processos curtos do git): com 200 repositórios, 6 por vez mantém a tela fluida. */
const SUMMARY_CONCURRENCY = 6;

export const useRepositoriesStore = defineStore('repositories', () => {
  const repos = ref<RepositoryMeta[]>([]);
  const query = ref('');
  /** A primeira leitura do catálogo terminou (antes disso, "catálogo vazio" seria um falso aviso). */
  const loaded = ref(false);
  const busy = ref(false);
  const message = ref<{ kind: 'info' | 'error'; text: string } | null>(null);
  /** Diálogo de clonar / criar repositório aberto na tela inicial (a paleta de comandos também o abre). */
  const createDialog = ref<'clone' | 'init' | null>(null);

  // Como a lista aparece (ordem, filtros e densidade): lembrado entre as aberturas, como as demais preferências.
  const saved = parseHomePrefs(typeof localStorage === 'undefined' ? null : localStorage.getItem(HOME_PREFS_KEY));
  const sort = ref<HomeSort>(saved.sort);
  const dir = ref(saved.dir);
  const density = ref<HomeDensity>(saved.density);
  const filters = ref<HomeFilter[]>(saved.filters);
  watch([sort, dir, density, filters], () => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(HOME_PREFS_KEY, JSON.stringify({ sort: sort.value, dir: dir.value, density: density.value, filters: filters.value }));
  });
  /** Escolhe a ordenação (a mesma de novo inverte a direção). */
  function setSort(s: HomeSort): void {
    const n = nextSort({ sort: sort.value, dir: dir.value }, s);
    sort.value = n.sort;
    dir.value = n.dir;
  }
  function toggleFilter(f: HomeFilter): void {
    filters.value = filters.value.includes(f) ? filters.value.filter((x) => x !== f) : [...filters.value, f];
  }

  /** A lista como aparece: filtrada e ordenada. */
  const filtered = computed(() => sortRepos(filterRepos(repos.value, summaries.value, filters.value, query.value), summaries.value, sort.value, dir.value));

  async function load(): Promise<void> {
    repos.value = await api.getKnownRepositories();
    loaded.value = true;
    void refreshSummaries();
  }

  // --- painel: estado de cada repositório ---------------------------------------------------------
  type Summary = RepoSummary | { error: string };
  const summaries = ref<Record<string, Summary>>({});
  /** Repositórios com uma operação (status/fetch/pull) em andamento. */
  const working = ref<Record<string, string>>({});
  const progress = ref<{ label: string; done: number; total: number } | null>(null);
  const report = ref<{ title: string; items: { name: string; ok: boolean; text: string }[] } | null>(null);

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
    await pool([...repos.value], SUMMARY_CONCURRENCY, summarize);
  }

  const isOk = (s: Summary | undefined): s is RepoSummary => !!s && !('error' in s);
  const isDirty = (s: RepoSummary) => s.staged + s.unstaged + s.conflicted > 0;
  /** Precisa de atenção: alterações locais, commits para enviar/receber ou conflitos. */
  const needsAttention = (r: RepositoryMeta) => summaryNeedsAttention(summaries.value[r.id]);

  /** `silent`: em lote (vários repositórios) nunca abre diálogo de credencial; o botão da linha, sim. */
  async function syncOne(r: RepositoryMeta, kind: 'fetch' | 'pull', silent = false): Promise<{ ok: boolean; message: string }> {
    working.value[r.id] = kind;
    try {
      const res = kind === 'fetch' ? await api.fetchRepo(r.path, silent) : await api.pullRepo(r.path, silent);
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
      const res = await syncOne(r, kind, true);
      items.push({ name: r.name, ok: res.ok, text: res.message });
      progress.value!.done++;
    });
    progress.value = null;
    report.value = { title, items: items.sort((a, b) => Number(a.ok) - Number(b.ok) || a.name.localeCompare(b.name)) };
  }

  const fetchAll = () => runBatch(t('batch.fetch'), [...repos.value], 'fetch');

  /** Pull só onde é seguro: tem upstream, está atrás, não está à frente (sem divergência) e a árvore está limpa. */
  function pullSafe(): Promise<void> {
    const safe = repos.value.filter((r) => {
      const s = summaries.value[r.id];
      return isOk(s) && !!s.upstream && !s.detached && s.behind > 0 && s.ahead === 0 && !isDirty(s);
    });
    return runBatch(t('batch.pull'), safe, 'pull');
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
      message.value = { kind: 'info', text: t('repos.found', { n: found.length }) };
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
      message.value = { kind: 'info', text: t('repos.added', { name: meta.name }) };
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

  return { loaded, createDialog, summaries, working, progress, report, sort, dir, density, filters, setSort, toggleFilter, needsAttention, refreshSummaries, fetchAll, pullSafe, syncOne, repos, query, busy, message, filtered, load, scanRoots, scanPaths, addRepository, addPath, remove, touch };
});
