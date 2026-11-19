<script setup lang="ts">
// Busca no conteúdo dos arquivos (git grep): texto ou expressão regular, maiúsculas, palavra inteira e filtro de caminhos. Os resultados vêm
// agrupados por arquivo; clicar numa ocorrência abre as linhas ao redor, ali mesmo, com atalhos para o histórico e o blame do arquivo.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton, GnTooltip } from '@git-nexus/ui-kit';
import { matchRanges, type ContentMatch, type ContentSearchResult, type FileContext, type RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../../api';
import { t } from '../../i18n';
import { useWorkspaceStore } from '../../stores/workspace';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

const query = ref('');
const regex = ref(false);
const caseSensitive = ref(false);
const wholeWord = ref(false);
const paths = ref('');
const result = ref<ContentSearchResult | null>(null);
const loading = ref(false);
const error = ref('');
/** O que foi buscado de fato (os destaques seguem isto, não o que está sendo digitado). */
const searched = ref({ pattern: '', regex: false, caseSensitive: false, wholeWord: false });
const input = ref<HTMLInputElement | null>(null);

const collapsed = ref(new Set<string>());
const opened = ref<{ key: string; ctx: FileContext | null; error: string } | null>(null);

const groups = computed(() => {
  const by = new Map<string, ContentMatch[]>();
  for (const m of result.value?.matches ?? []) (by.get(m.file) ?? by.set(m.file, []).get(m.file)!).push(m);
  return [...by.entries()].map(([file, matches]) => ({ file, matches }));
});

let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

async function run(): Promise<void> {
  clearTimeout(timer);
  const mine = ++seq;
  const pattern = query.value;
  if (!pattern.trim()) {
    result.value = null;
    error.value = '';
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const r = await api.searchContent(props.repo.path, { pattern, regex: regex.value, caseSensitive: caseSensitive.value, wholeWord: wholeWord.value, paths: paths.value });
    if (mine !== seq) return; // chegou uma busca mais nova: esta resposta está velha
    searched.value = { pattern, regex: regex.value, caseSensitive: caseSensitive.value, wholeWord: wholeWord.value };
    collapsed.value = new Set();
    opened.value = null;
    if (r.ok) result.value = r;
    else {
      result.value = null;
      error.value = r.message ?? t('search.failed');
    }
  } catch (e) {
    if (mine === seq) {
      result.value = null;
      error.value = errMsg(e);
    }
  } finally {
    if (mine === seq) loading.value = false;
  }
}

/** Busca sozinha pouco depois de parar de digitar. */
function later(): void {
  clearTimeout(timer);
  timer = setTimeout(run, 350);
}
watch([query, regex, caseSensitive, wholeWord, paths], later);

/** Pedaços da linha, marcando o que casou. */
function pieces(text: string): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = [];
  let at = 0;
  for (const [a, b] of matchRanges(text, searched.value)) {
    if (a > at) out.push({ text: text.slice(at, a), hit: false });
    out.push({ text: text.slice(a, b), hit: true });
    at = b;
  }
  if (at < text.length || !out.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

const keyOf = (m: ContentMatch) => `${m.file}:${m.line}`;

async function toggle(m: ContentMatch): Promise<void> {
  const key = keyOf(m);
  if (opened.value?.key === key) {
    opened.value = null;
    return;
  }
  opened.value = { key, ctx: null, error: '' };
  try {
    const ctx = await api.getFileContext(props.repo.path, m.file, m.line, 6);
    if (opened.value?.key === key) opened.value = { key, ctx, error: '' };
  } catch (e) {
    if (opened.value?.key === key) opened.value = { key, ctx: null, error: errMsg(e) };
  }
}

function toggleFile(file: string): void {
  const next = new Set(collapsed.value);
  if (!next.delete(file)) next.add(file);
  collapsed.value = next;
}

async function copyRef(m: ContentMatch): Promise<void> {
  await api.copyText(`${m.file}:${m.line}`).catch(() => undefined);
}

onMounted(async () => {
  await nextTick();
  input.value?.focus();
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  seq++;
});
</script>

<template>
  <section class="sp" data-testid="search-panel">
    <form class="sp__bar" @submit.prevent="run">
      <input ref="input" v-model="query" class="sp__input" data-testid="search-input" :placeholder="t('search.placeholder')" spellcheck="false" autocomplete="off" />
      <button type="button" class="sp__tog" data-testid="search-case" :aria-pressed="caseSensitive" @click="caseSensitive = !caseSensitive">Aa<GnTooltip :text="t('search.case')" /></button>
      <button type="button" class="sp__tog" data-testid="search-word" :aria-pressed="wholeWord" @click="wholeWord = !wholeWord"><u>ab</u><GnTooltip :text="t('search.word')" /></button>
      <button type="button" class="sp__tog" data-testid="search-regex" :aria-pressed="regex" @click="regex = !regex">.*<GnTooltip :text="t('search.regex')" /></button>
      <GnButton type="submit" variant="primary" :disabled="loading || !query.trim()">{{ t('search.go') }}</GnButton>
    </form>
    <label class="sp__paths">
      <span>{{ t('search.paths') }}</span>
      <input v-model="paths" data-testid="search-paths" :placeholder="t('search.pathsPh')" spellcheck="false" autocomplete="off" />
    </label>

    <p v-if="error" class="sp__err" role="alert" data-testid="search-error">{{ error }}</p>
    <p v-else-if="loading" class="sp__muted" data-testid="search-loading">{{ t('search.searching') }}</p>
    <p v-else-if="result && !result.matches.length" class="sp__muted" data-testid="search-empty">{{ t('search.none') }}</p>
    <p v-else-if="!result" class="sp__muted">{{ t('search.hint') }}</p>

    <template v-if="result?.matches.length">
      <p class="sp__summary" data-testid="search-summary">
        {{ t('search.matches', { n: result.matches.length }) }} {{ t('search.inFiles', { n: result.files }) }}
        <span v-if="result.truncated" class="sp__warn">{{ t('search.truncated') }}</span>
      </p>
      <ul class="sp__files">
        <li v-for="g in groups" :key="g.file" class="sp__file" data-testid="search-file">
          <button type="button" class="sp__fhead" :aria-expanded="!collapsed.has(g.file)" @click="toggleFile(g.file)">
            <span class="sp__caret">{{ collapsed.has(g.file) ? '▸' : '▾' }}</span>
            <span class="sp__fname">{{ g.file }}</span>
            <GnBadge tone="neutral">{{ g.matches.length }}</GnBadge>
          </button>
          <ul v-if="!collapsed.has(g.file)" class="sp__matches">
            <li v-for="m in g.matches" :key="keyOf(m)">
              <button type="button" class="sp__match" :class="{ 'sp__match--open': opened?.key === keyOf(m) }" data-testid="search-match" @click="toggle(m)">
                <span class="sp__ln">{{ m.line }}</span>
                <span class="sp__text"><template v-for="(p, i) in pieces(m.text)" :key="i"><mark v-if="p.hit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></span>
              </button>
              <div v-if="opened?.key === keyOf(m)" class="sp__ctx" data-testid="search-context">
                <p v-if="opened.error" class="sp__err">{{ opened.error }}</p>
                <p v-else-if="!opened.ctx" class="sp__muted">{{ t('search.loadingContext') }}</p>
                <template v-else>
                  <pre class="sp__code"><span v-for="(l, i) in opened.ctx.lines" :key="i" class="sp__cl" :class="{ 'sp__cl--hit': opened.ctx.start + i === m.line }"><i>{{ opened.ctx.start + i }}</i>{{ l }}</span></pre>
                  <div class="sp__actions">
                    <GnButton size="sm" @click="ws.openTools(repo, 'file', m.file, 'history')">{{ t('search.history') }}</GnButton>
                    <GnButton size="sm" @click="ws.openTools(repo, 'file', m.file, 'blame')">{{ t('search.blame') }}</GnButton>
                    <GnButton size="sm" @click="copyRef(m)">{{ t('search.copyRef') }}</GnButton>
                  </div>
                </template>
              </div>
            </li>
          </ul>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped lang="scss">
.sp {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  &__bar { display: flex; gap: 6px; align-items: center; }
  &__input { flex: 1; font-family: var(--gn-mono); }
  &__tog {
    min-width: 32px; padding: 5px 7px; font: 600 12px var(--gn-mono); color: var(--gn-muted); background: var(--gn-bg);
    border: 1px solid var(--gn-border); border-radius: var(--gn-radius); cursor: pointer;
    &:hover { border-color: var(--gn-accent); }
    &[aria-pressed='true'] { color: var(--gn-text); border-color: var(--gn-accent); background: color-mix(in srgb, var(--gn-accent) 22%, var(--gn-bg)); }
  }
  &__paths { display: flex; align-items: center; gap: 8px; > span { font-size: 12px; color: var(--gn-muted); white-space: nowrap; } input { flex: 1; } }
  &__muted { margin: 4px 0; color: var(--gn-muted); }
  &__err { margin: 4px 0; color: var(--gn-danger); white-space: pre-wrap; word-break: break-word; }
  &__summary { margin: 4px 0 0; font-size: 12px; color: var(--gn-muted); }
  &__warn { margin-left: 8px; color: var(--gn-warn); }
  &__files, &__matches { list-style: none; margin: 0; padding: 0; }
  &__file { margin-bottom: 6px; border: 1px solid var(--gn-border); border-radius: var(--gn-radius); overflow: hidden; }
  &__fhead {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 9px; font: inherit; text-align: left; color: var(--gn-text);
    background: var(--gn-surface-2); border: 0; cursor: pointer;
  }
  &__fname { flex: 1; font-family: var(--gn-mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__match {
    display: flex; gap: 10px; width: 100%; padding: 2px 9px; font: 12px var(--gn-mono); text-align: left; color: var(--gn-text);
    background: transparent; border: 0; cursor: pointer;
    &:hover, &--open { background: color-mix(in srgb, var(--gn-accent) 14%, transparent); }
  }
  &__ln { min-width: 38px; text-align: right; color: var(--gn-muted); flex-shrink: 0; }
  &__text { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
  mark { background: color-mix(in srgb, var(--gn-warn) 45%, transparent); color: inherit; border-radius: 2px; }
  &__ctx { margin: 2px 9px 8px 57px; border: 1px solid var(--gn-border); border-radius: var(--gn-radius); background: var(--gn-bg); }
  &__code { margin: 0; padding: 6px 0; font: 12px/1.5 var(--gn-mono); overflow-x: auto; }
  &__cl { display: block; padding: 0 10px; white-space: pre; i { display: inline-block; min-width: 38px; margin-right: 10px; text-align: right; font-style: normal; color: var(--gn-muted); } &--hit { background: color-mix(in srgb, var(--gn-accent) 20%, transparent); } }
  &__actions { display: flex; gap: 6px; padding: 6px 10px; border-top: 1px solid var(--gn-border); }
}
</style>
