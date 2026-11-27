<script setup lang="ts">
// Filtros do Grafo (#294): o botão "Filtrar o grafo" com o selo da quantidade, os chips dos filtros ativos (cada um remove o seu), "Limpar tudo" e o popover (não modal) com
// branches, remotos, tags, autor (com autocompletar e "Só eu"), período, pasta ou arquivo, merges, não publicados e os favoritos. Cada mudança vale na hora: quem usa recarrega
// a lista com o novo filtro. A tradução para o `git log` mora no núcleo; aqui só a interface.
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { GnButton, GnIconButton, GnSegmented, GnTooltip } from '@git-nexus/ui-kit';
import type { HistoryFilter, RefScope } from '@git-nexus/git-core/pure';
import { api } from '../api';
import { t, type MessageKey } from '../i18n';
import {
  PERIODS, activeChips, deleteFavorite, filterCount, parseBranchList, parseFavorites, periodOf, removeChip, sameFilter, saveFavorite, withPeriod,
  type ChipId, type FilterFavorite, type PeriodId,
} from '../graph-filter-core';
import ComboBox from './ComboBox.vue';

const props = defineProps<{ modelValue: HistoryFilter; repoPath: string; repoId: string }>();
const emit = defineEmits<{ 'update:modelValue': [f: HistoryFilter] }>();

const f = computed(() => props.modelValue);
const chips = computed(() => activeChips(f.value));
const n = computed(() => filterCount(f.value));
const set = (patch: Partial<HistoryFilter>): void => emit('update:modelValue', { ...f.value, ...patch });
const replace = (next: HistoryFilter): void => emit('update:modelValue', next);

// --- textos digitados: valem depois de uma pausa (ou Enter), não a cada tecla ---------------------------------------------------------------------------------
const draft = reactive({ branches: '', author: '', path: '', since: '', until: '' });
watch(
  f,
  (v) => {
    draft.branches = (v.branches ?? []).join(', ');
    draft.author = v.author ?? '';
    draft.path = v.path ?? '';
    draft.since = periodOf(v) === 'custom' ? v.since ?? '' : '';
    draft.until = v.until ?? '';
  },
  { immediate: true },
);
let timer: ReturnType<typeof setTimeout> | undefined;
function later(fn: () => void): void {
  clearTimeout(timer);
  timer = setTimeout(fn, 350);
}
function commitText(key: 'author' | 'path' | 'since' | 'until'): void {
  clearTimeout(timer);
  const v = draft[key].trim();
  const next = { ...f.value };
  if (v) next[key] = v;
  else delete next[key];
  if (key === 'path' && !v) delete next.simplify;
  replace(next);
}
const typed = (key: 'author' | 'path' | 'since' | 'until'): void => later(() => commitText(key));
function commitBranches(): void {
  clearTimeout(timer);
  const list = parseBranchList(draft.branches);
  replace(list.length ? { ...f.value, scope: 'chosen', branches: list } : { ...f.value, scope: 'chosen', branches: undefined });
}
onBeforeUnmount(() => clearTimeout(timer));

// --- opções ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const SCOPE_LABEL: Record<RefScope, MessageKey> = { current: 'gf.scope.current', all: 'gf.scope.all', local: 'gf.scope.local', chosen: 'gf.scope.chosen' };
const scopeOptions = computed(() => (Object.keys(SCOPE_LABEL) as RefScope[]).map((v) => ({ value: v, label: t(SCOPE_LABEL[v]) })));
const PERIOD_LABEL: Record<PeriodId, MessageKey> = { any: 'gf.period.any', today: 'gf.period.today', '7d': 'gf.period.7d', '30d': 'gf.period.30d', custom: 'gf.period.custom' };
const periodOptions = computed(() => PERIODS.map((v) => ({ value: v, label: t(PERIOD_LABEL[v]) })));
const period = computed(() => periodOf(f.value));
function setScope(s: RefScope): void {
  const next = { ...f.value };
  if (s === 'current') delete next.scope;
  else next.scope = s;
  if (s !== 'chosen') delete next.branches;
  replace(next);
}

const CHIP_LABEL: Record<ChipId, (v: HistoryFilter) => string> = {
  scope: (v) => (v.scope === 'chosen' ? t('gf.chip.chosen', { v: (v.branches ?? []).join(', ') || '—' }) : t('gf.chip.scope', { v: t(SCOPE_LABEL[v.scope ?? 'current']) })),
  remotes: () => t('gf.remotes'),
  tags: () => t('gf.tags'),
  author: (v) => t('gf.chip.author', { v: v.author ?? '' }),
  period: (v) => (periodOf(v) === 'custom' ? t('gf.chip.range', { since: v.since || '…', until: v.until || '…' }) : t(PERIOD_LABEL[periodOf(v)])),
  path: (v) => t('gf.chip.path', { v: v.path ?? '' }),
  noMerges: () => t('gf.noMerges'),
  unpublished: () => t('gf.unpublished'),
  simplify: () => t('gf.simplify'),
};
const chipText = (id: ChipId): string => CHIP_LABEL[id](f.value);

// --- autor: autocompletar do repositório e "só eu" -------------------------------------------------------------------------------------------------------------------------
const authors = ref<string[]>([]);
async function loadAuthors(): Promise<void> {
  if (authors.value.length) return;
  try {
    authors.value = [...new Set((await api.getAuthors(props.repoPath)).map((a) => a.name))];
  } catch {
    authors.value = [];
  }
}
async function onlyMe(): Promise<void> {
  try {
    const mail = (await api.getGitConfig(props.repoPath)).find((e) => e.key === 'user.email')?.value;
    if (mail) {
      draft.author = mail;
      commitText('author');
    }
  } catch {
    /* sem e-mail configurado: o campo fica como estava */
  }
}

// --- favoritos (por repositório) ---------------------------------------------------------------------------------------------------------------------------------------
const FAV_KEY = computed(() => `gitnexus.graphFavs.${props.repoId}`);
const favs = ref<FilterFavorite[]>(parseFavorites(localStorage.getItem(FAV_KEY.value)));
const favName = ref('');
const persistFavs = (): void => localStorage.setItem(FAV_KEY.value, JSON.stringify(favs.value));
const favOptions = computed(() => favs.value.map((x) => x.name));
const favPick = ref('');
// o favorito escolhido só continua "escolhido" enquanto o filtro for igual ao dele (senão escolher o mesmo de novo não faria nada)
watch(f, (v) => {
  const x = favs.value.find((a) => a.name === favPick.value);
  if (!x || !sameFilter(x.filter, v)) favPick.value = '';
});
function applyFav(name: string): void {
  const x = favs.value.find((v) => v.name === name);
  favPick.value = name;
  if (x) replace({ ...x.filter });
}
function saveFav(): void {
  if (!favName.value.trim()) return;
  favs.value = saveFavorite(favs.value, favName.value, f.value);
  persistFavs();
  favPick.value = favName.value.trim();
  favName.value = '';
}
function delFav(): void {
  if (!favPick.value) return;
  favs.value = deleteFavorite(favs.value, favPick.value);
  persistFavs();
  favPick.value = '';
}

// --- popover: Esc fecha, Tab preso, clique fora fecha, o foco volta ao botão ---------------------------------------------------------------------------------------------
const open = ref(false);
const btn = ref<InstanceType<typeof GnButton>>();
const pop = ref<HTMLElement>();
const btnEl = (): HTMLElement | undefined => btn.value?.$el as HTMLElement | undefined;
const focusables = () => [...(pop.value?.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled]), [tabindex="0"]') ?? [])].filter((el) => el.getClientRects().length > 0);
async function openPop(): Promise<void> {
  open.value = true;
  void loadAuthors();
  await nextTick();
  focusables()[0]?.focus();
  document.addEventListener('mousedown', onOutside, true);
}
function closePop(back = true): void {
  open.value = false;
  document.removeEventListener('mousedown', onOutside, true);
  if (back) btnEl()?.focus();
}
function onOutside(e: MouseEvent): void {
  const el = e.target as HTMLElement;
  if (pop.value?.contains(el) || btnEl()?.contains(el) || el.closest('.cbx__list')) return;
  closePop(false);
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (document.querySelector('.cbx__list')) return;
    e.preventDefault();
    e.stopPropagation();
    closePop();
  } else if (e.key === 'Tab') {
    const list = focusables();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    const to = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1;
    e.preventDefault();
    list[to]!.focus();
  }
}
onBeforeUnmount(() => document.removeEventListener('mousedown', onOutside, true));
</script>

<template>
  <div class="gf" data-testid="gf">
    <GnButton ref="btn" size="sm" :tone="n ? 'accent' : undefined" aria-haspopup="dialog" :aria-expanded="open" aria-controls="gf-pop" data-testid="gf-btn" @click="open ? closePop() : openPop()">
      {{ t('gf.title') }}<span v-if="n" class="gf__badge" :aria-label="t('gf.active', { n })" data-testid="gf-n">{{ n }}</span>
      <GnTooltip :text="t('gf.tip')" />
    </GnButton>
    <div v-if="chips.length" class="gf__chips" role="list" :aria-label="t('gf.chips')" data-testid="gf-chips">
      <span v-for="c in chips" :key="c" class="gf__chip" role="listitem" :data-chip="c">
        {{ chipText(c) }}
        <GnIconButton icon="x" :label="t('gf.remove', { label: chipText(c) })" @click="replace(removeChip(f, c))" />
      </span>
      <GnButton size="sm" variant="ghost" data-testid="gf-clear" @click="replace({})">{{ t('gf.clearAll') }}</GnButton>
    </div>

    <div v-show="open" id="gf-pop" ref="pop" class="gf__pop" role="dialog" aria-modal="false" :aria-label="t('gf.title')" data-testid="gf-pop" @keydown="onKey">
      <div class="gf__sec">
        <span class="gf__lbl">{{ t('gf.branches') }}</span>
        <GnSegmented :model-value="f.scope ?? 'current'" :options="scopeOptions" :aria-label="t('gf.branches')" data-testid="gf-scope" @update:model-value="setScope($event as RefScope)" />
        <input v-if="f.scope === 'chosen'" v-model="draft.branches" class="gf__in" :placeholder="t('gf.chosenPh')" :aria-label="t('gf.chosen')" spellcheck="false" data-testid="gf-chosen" @keydown.enter.prevent="commitBranches" @blur="commitBranches" />
      </div>
      <div class="gf__sec gf__sec--checks">
        <label v-if="f.scope !== 'all'"><input type="checkbox" :checked="!!f.remotes" data-testid="gf-remotes" @change="set({ remotes: ($event.target as HTMLInputElement).checked || undefined })" /> {{ t('gf.remotes') }}</label>
        <label v-if="f.scope !== 'all'"><input type="checkbox" :checked="!!f.tags" data-testid="gf-tags" @change="set({ tags: ($event.target as HTMLInputElement).checked || undefined })" /> {{ t('gf.tags') }}</label>
        <label><input type="checkbox" :checked="!!f.noMerges" data-testid="gf-nomerges" @change="set({ noMerges: ($event.target as HTMLInputElement).checked || undefined })" /> {{ t('gf.noMerges') }}</label>
        <label><input type="checkbox" :checked="!!f.unpublished" data-testid="gf-unpub" @change="set({ unpublished: ($event.target as HTMLInputElement).checked || undefined })" /> {{ t('gf.unpublished') }}</label>
      </div>
      <div class="gf__sec">
        <span class="gf__lbl">{{ t('gf.author') }}</span>
        <ComboBox v-model="draft.author" class="gf__combo" searchable :options="authors" :placeholder="t('gf.authorPh')" :aria-label="t('gf.author')" data-testid="gf-author" @commit="commitText('author')" @update:model-value="typed('author')" />
        <GnButton size="sm" data-testid="gf-me" @click="onlyMe">{{ t('gf.me') }}<GnTooltip :text="t('gf.meTip')" /></GnButton>
      </div>
      <div class="gf__sec">
        <span class="gf__lbl">{{ t('gf.period') }}</span>
        <GnSegmented :model-value="period" :options="periodOptions" :aria-label="t('gf.period')" data-testid="gf-period" @update:model-value="replace(withPeriod(f, $event as PeriodId))" />
        <template v-if="period === 'custom'">
          <input v-model="draft.since" class="gf__in gf__in--date" :placeholder="t('gf.since')" :aria-label="t('gf.since')" spellcheck="false" data-testid="gf-since" @input="typed('since')" @keydown.enter.prevent="commitText('since')" />
          <input v-model="draft.until" class="gf__in gf__in--date" :placeholder="t('gf.until')" :aria-label="t('gf.until')" spellcheck="false" data-testid="gf-until" @input="typed('until')" @keydown.enter.prevent="commitText('until')" />
        </template>
      </div>
      <div class="gf__sec">
        <span class="gf__lbl">{{ t('gf.path') }}</span>
        <input v-model="draft.path" class="gf__in gf__in--wide" :placeholder="t('gf.pathPh')" :aria-label="t('gf.path')" spellcheck="false" data-testid="gf-path" @input="typed('path')" @keydown.enter.prevent="commitText('path')" />
        <label v-if="f.path"><input type="checkbox" :checked="!!f.simplify" data-testid="gf-simplify" @change="set({ simplify: ($event.target as HTMLInputElement).checked || undefined })" /> {{ t('gf.simplify') }}</label>
      </div>
      <div class="gf__sec">
        <span class="gf__lbl">{{ t('gf.favs') }}</span>
        <ComboBox v-if="favOptions.length" :model-value="favPick" class="gf__combo" :options="favOptions" :placeholder="t('gf.favPick')" :aria-label="t('gf.favs')" data-testid="gf-fav" @update:model-value="applyFav" />
        <GnButton v-if="favPick" size="sm" tone="danger" data-testid="gf-fav-del" @click="delFav">{{ t('gf.favDel') }}</GnButton>
        <input v-model="favName" class="gf__in" :placeholder="t('gf.favName')" :aria-label="t('gf.favName')" data-testid="gf-fav-name" @keydown.enter.prevent="saveFav" />
        <GnButton size="sm" :disabled="!favName.trim() || !n" data-testid="gf-fav-save" @click="saveFav">{{ t('gf.favSave') }}</GnButton>
      </div>
      <div class="gf__btns">
        <GnButton size="sm" variant="ghost" data-testid="gf-reset" @click="replace({})">{{ t('gf.reset') }}</GnButton>
        <GnButton size="sm" tone="accent" data-testid="gf-close" @click="closePop()">{{ t('hs.close') }}</GnButton>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.gf {
  position: relative; display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px;
  &__badge { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; margin-left: 5px; padding: 0 4px; border-radius: 999px; font-size: 10.5px; font-weight: 700; background: var(--gn-accent-solid); color: #fff; }
  &__chips { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
  &__chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px 2px 8px; border: 1px solid var(--gn-border); border-radius: 999px; background: var(--gn-surface-2); font-size: 12px; }
  &__pop {
    position: absolute; left: 0; top: 100%; z-index: var(--gn-z-popover); width: min(620px, 90vw); margin-top: 4px; padding: 12px 14px; display: grid; gap: 10px;
    background: var(--gn-surface); border: 1px solid var(--gn-border); border-radius: var(--gn-radius-lg); box-shadow: var(--gn-shadow-md);
  }
  &__sec { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; &--checks { gap: 14px; font-size: 12.5px; label { display: inline-flex; align-items: center; gap: 4px; } } label { font-size: 12.5px; display: inline-flex; align-items: center; gap: 4px; } }
  &__lbl { min-width: 70px; font-size: 12px; color: var(--gn-muted); }
  &__in { width: 180px; &--wide { flex: 1; min-width: 200px; } &--date { width: 150px; } }
  &__combo { min-width: 200px; }
  &__btns { display: flex; justify-content: flex-end; gap: 8px; }
}
</style>
