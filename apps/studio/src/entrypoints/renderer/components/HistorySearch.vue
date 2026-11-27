<script setup lang="ts">
// O painel "Buscar na história" do grafo (fase 9 da #233; barra compacta na #292): UMA linha com o campo da pesquisa (Aa, ab, .*), o modo (quando entrou ou
// saiu, linhas alteradas que casam, mensagem), Buscar e o botão Filtros; o escopo, o autor, o período e o arquivo ou máscara moram num popover (não modal), e os
// filtros ativos aparecem como chips que se removem um a um. Roda no worker (`startHistorySearch`): os commits chegam em lotes, dá para parar e a página de 200
// tem "carregar mais". O painel não desenha a lista: entrega os commits achados a quem o usa (`v-model:hits`), que os mostra na lista do grafo.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { GnButton, GnIconButton, GnSearchField, GnTooltip, regexProblem } from '@git-nexus/ui-kit';
import { summarizeHistory, type HistoryDone, type HistoryHit, type HistoryQuery, type RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { t } from '../i18n';
import { canFollow, canSearch, emptyForm, formFromQuery, historyMemory, toQuery, type HistoryForm } from '../history-search-core';
import ComboBox from './ComboBox.vue';

const props = defineProps<{
  repo: RepositoryMeta;
  /** Quem abre a história de fora (a janela de pesquisa, o editor, a paleta) manda o pedido; `n` sobe a cada pedido novo. */
  target?: { query: HistoryQuery; n: number } | null;
  /** O commit aberto na lista (os atalhos do resumo o selecionam). */
  selected?: string;
}>();
const emit = defineEmits<{ select: [hash: string]; /** O pedido de fora já foi aplicado (quem guarda o pedido pode soltá-lo). */ consumed: [] }>();
/** Os commits achados (`null` = nenhuma busca na tela: a lista mostra a história inteira). */
const hits = defineModel<HistoryHit[] | null>('hits', { default: null });
/** O pedido da busca que está na tela (o destaque do diff usa o mesmo texto e as mesmas opções). */
const active = defineModel<HistoryQuery | null>('active', { default: null });

/** Há uma busca rodando (a lista de fora usa para não dizer "nenhum commit" no meio dela). */
const runningOut = defineModel<boolean>('running', { default: false });
const running = ref(false);
watch(running, (v) => (runningOut.value = v), { immediate: true });
// os commits chegam em lotes, vários no mesmo instante: o acumulado fica aqui (o `v-model` só reflete depois que quem usa atualiza, e um lote leria o valor velho)
let acc: HistoryHit[] = [];
const form = reactive<HistoryForm>(historyMemory.has(props.repo.id) ? { ...emptyForm(), ...historyMemory.get(props.repo.id)! } : emptyForm());
watch(form, () => historyMemory.set(props.repo.id, JSON.parse(JSON.stringify(form)) as HistoryForm), { deep: true });
const done = ref<HistoryDone | null>(null);
const examined = ref<number | undefined>();
const error = ref('');
let seq = 0;
let currentId = '';

const root = ref<HTMLElement>();
const fieldWrap = ref<HTMLElement>();
const filtersBtn = ref<InstanceType<typeof GnButton>>();
const pop = ref<HTMLElement>();
const popOpen = ref(false);
const sumHidden = ref(false);

const fieldLabels = computed(() => ({ clear: t('find.clear'), caseSensitive: t('find.case'), wholeWord: t('find.word'), regex: t('find.regex') }));
const modeOptions = computed(() => [
  { value: 'pickaxe', label: t('hs.mode.pickaxe') },
  { value: 'lines', label: t('hs.mode.lines') },
  { value: 'message', label: t('hs.mode.message') },
]);
const scopeOptions = computed(() => [
  { value: 'current', label: t('hs.scope.current') },
  { value: 'all', label: t('hs.scope.all') },
  { value: 'branch', label: t('hs.scope.branch') },
  { value: 'range', label: t('hs.scope.range') },
  { value: 'tags', label: t('hs.scope.tags') },
]);
const regexError = computed(() => (form.regex && !form.lines ? regexProblem(form.text) ?? '' : ''));
const ready = computed(() => canSearch(form) && !regexError.value);
const followOk = computed(() => canFollow(form));
const summary = computed(() => summarizeHistory(hits.value ?? []));
/** "Primeira vez que entrou / última vez que saiu" só faz sentido na busca de quando o texto entrou ou saiu. */
const summaryOn = computed(() => !sumHidden.value && active.value?.mode === 'pickaxe' && !!active.value.text && !!hits.value?.length && !!(summary.value.firstAdded || summary.value.lastRemoved));
const more = computed(() => !!done.value?.truncated && done.value.nextSkip !== undefined);
const hint = computed(() => t(('hs.mode.hint.' + form.mode) as 'hs.mode.hint.pickaxe'));

// --- filtros ativos: um chip por filtro, que o remove (e refaz a busca, se havia uma) -------------------------------------------------------------------------------
interface FilterChip {
  id: string;
  label: string;
  clear: () => void;
}
const scopeLabel = computed(() => scopeOptions.value.find((o) => o.value === form.scope)?.label ?? form.scope);
const chips = computed<FilterChip[]>(() => {
  const d = emptyForm();
  const out: FilterChip[] = [];
  if (form.scope !== d.scope) {
    const rev = (form.scope === 'branch' || form.scope === 'range') && form.revision.trim() ? `${scopeLabel.value}: ${form.revision.trim()}` : scopeLabel.value;
    out.push({ id: 'scope', label: t('hs.chip.scope', { v: rev }), clear: () => Object.assign(form, { scope: d.scope, revision: d.revision }) });
  }
  if (form.author.trim()) out.push({ id: 'author', label: t('hs.chip.author', { v: form.author.trim() }), clear: () => (form.author = d.author) });
  if (form.since.trim()) out.push({ id: 'since', label: t('hs.chip.since', { v: form.since.trim() }), clear: () => (form.since = d.since) });
  if (form.until.trim()) out.push({ id: 'until', label: t('hs.chip.until', { v: form.until.trim() }), clear: () => (form.until = d.until) });
  if (!form.lines && form.include.trim()) out.push({ id: 'include', label: t('hs.chip.include', { v: form.include.trim() }), clear: () => (form.include = d.include) });
  if (form.follow && followOk.value) out.push({ id: 'follow', label: t('hs.follow'), clear: () => (form.follow = false) });
  return out;
});
function removeChip(c: FilterChip): void {
  c.clear();
  if (hits.value || running.value) void run(); // a busca na tela passa a valer com o filtro a menos
}

function stop(): void {
  if (running.value) void api.cancelSearch(currentId).catch(() => undefined);
}

/** Roda a busca; com `next`, continua da página seguinte (acrescenta aos commits que já estão na lista). */
async function run(next = false): Promise<void> {
  if (!ready.value) return;
  if (running.value) stop();
  popOpen.value = false;
  const skip = next ? done.value?.nextSkip ?? 0 : 0;
  const q = toQuery(form, skip);
  currentId = `hs-${Date.now().toString(36)}-${++seq}`;
  if (!next) {
    acc = [];
    hits.value = [];
    active.value = { ...q, skip: undefined };
    examined.value = undefined;
    sumHidden.value = false;
  }
  error.value = '';
  done.value = null;
  running.value = true;
  try {
    await api.startHistorySearch(props.repo.path, q, currentId);
  } catch (e) {
    running.value = false;
    error.value = errMsg(e);
  }
}

function clear(): void {
  stop();
  Object.assign(form, { ...emptyForm(), scope: form.scope });
  acc = [];
  hits.value = null;
  active.value = null;
  done.value = null;
  error.value = '';
  running.value = false;
}

const offBatch = api.onHistoryBatch((e) => {
  if (e.id !== currentId) return;
  acc = acc.concat(e.hits);
  hits.value = acc;
  if (e.examined !== undefined) examined.value = e.examined;
});
const offDone = api.onHistoryDone((e) => {
  if (e.id !== currentId) return;
  running.value = false;
  done.value = e;
  if (e.examined !== undefined) examined.value = e.examined;
  error.value = e.ok ? '' : e.message ?? t('hs.failed');
});
onBeforeUnmount(() => {
  offBatch();
  offDone();
  window.removeEventListener('keydown', onWindowKey, true);
  document.removeEventListener('mousedown', onOutside, true);
  if (running.value) void api.cancelSearch(currentId).catch(() => undefined);
});

// um pedido de fora (janela de pesquisa, editor, paleta): preenche o formulário e já busca; os filtros além do texto aparecem como chips (sem abrir o popover)
watch(
  () => props.target?.n,
  () => {
    if (!props.target) return;
    Object.assign(form, formFromQuery(props.target.query));
    emit('consumed');
    void run();
  },
  { immediate: true },
);
// trocar de repositório: a busca antiga não vale mais
watch(
  () => props.repo.id,
  () => clear(),
);
// o `--follow` só existe com um arquivo: sem ele a opção sai sozinha
watch(followOk, (ok) => {
  if (!ok) form.follow = false;
});

// --- teclado: Ctrl+F e "/" focam o campo; o popover tem Esc, Tab preso e devolve o foco ---------------------------------------------------------------------------
/** Só vale com a visão do Grafo na tela (a visão fica montada, escondida, enquanto a pessoa está em outra). */
const visible = (): boolean => !!root.value && root.value.getClientRects().length > 0;
function focusField(): void {
  fieldWrap.value?.querySelector<HTMLElement>('textarea, input')?.focus();
}
function onWindowKey(e: KeyboardEvent): void {
  if (!visible() || e.defaultPrevented) return;
  const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor');
  const ctrlF = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f';
  const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing;
  if (!ctrlF && !slash) return;
  e.preventDefault();
  e.stopPropagation(); // o Ctrl+F do app abriria a janela de pesquisa do repositório (Ctrl+Shift+F continua levando a ela)
  if (!form.lines) focusField();
}
onMounted(() => window.addEventListener('keydown', onWindowKey, true));

const focusables = () => [...(pop.value?.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled]), [tabindex="0"]') ?? [])].filter((el) => el.getClientRects().length > 0);
async function openPop(): Promise<void> {
  popOpen.value = true;
  await nextTick();
  focusables()[0]?.focus();
  document.addEventListener('mousedown', onOutside, true);
}
function closePop(back = true): void {
  popOpen.value = false;
  document.removeEventListener('mousedown', onOutside, true);
  if (back) (filtersBtn.value?.$el as HTMLElement | undefined)?.focus();
}
const togglePop = (): void => void (popOpen.value ? closePop() : openPop());
/** Clicar fora fecha (a lista do ComboBox é teleportada para o <body>, mas pertence ao popover). */
function onOutside(e: MouseEvent): void {
  const el = e.target as HTMLElement;
  if (pop.value?.contains(el) || (filtersBtn.value?.$el as HTMLElement | undefined)?.contains(el) || el.closest('.cbx__list')) return;
  closePop(false);
}
function onPopKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (document.querySelector('.cbx__list')) return; // o Esc é da lista do ComboBox aberta
    e.preventDefault();
    e.stopPropagation();
    closePop();
    return;
  }
  if (e.key !== 'Tab') return;
  const list = focusables();
  if (!list.length) return;
  const i = list.indexOf(document.activeElement as HTMLElement);
  const to = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1;
  e.preventDefault();
  list[to]!.focus();
}

const counter = computed(() => {
  const d = done.value;
  const n = hits.value?.length ?? 0;
  const found = t('hs.found', { n });
  const exam = examined.value;
  const total = d?.total;
  const seen = exam !== undefined ? (total !== undefined ? t('hs.examinedOf', { n: exam, total }) : t('hs.examined', { n: exam })) : '';
  const parts = [running.value ? t('hs.running') : '', found, seen].filter(Boolean);
  if (d?.cancelled) parts.push(t('hs.cancelled'));
  return parts.join(' · ');
});

const fmt = (h: HistoryHit | undefined) => (h ? `${h.shortHash} — ${h.subject}` : '');
defineExpose({ run, stop, clear, focusField });
</script>

<template>
  <section ref="root" class="hs" role="search" :aria-label="t('hs.label')" data-testid="hs-panel">
    <div v-if="form.lines" class="hs__chip" data-testid="hs-range">
      <span class="hs__chip-text">{{ t('hs.range', { file: form.lines.file, start: form.lines.start, end: form.lines.end }) }}</span>
      <GnIconButton icon="x" :label="t('hs.rangeLeave')" data-testid="hs-range-leave" @click="form.lines = null" />
    </div>
    <!-- a barra: uma linha só (o modo, o que ele faz em tooltip) -->
    <form class="hs__bar" @submit.prevent="run()">
      <div v-if="!form.lines" ref="fieldWrap" class="hs__fieldwrap">
        <GnSearchField
          v-model="form.text"
          v-model:case-sensitive="form.caseSensitive"
          v-model:whole-word="form.wholeWord"
          v-model:regex="form.regex"
          class="hs__field"
          :label="t('hs.field')"
          :placeholder="t('hs.placeholder')"
          :labels="fieldLabels"
          :error="regexError"
          @enter="run()"
          @escape="clear"
        />
      </div>
      <ComboBox v-if="!form.lines" v-model="form.mode" :options="modeOptions" :aria-label="t('hs.mode')" :title="hint" data-testid="hs-mode" />
      <GnButton v-if="!running" tone="accent" size="sm" type="submit" :disabled="!ready" data-testid="hs-go">{{ t('hs.search') }}</GnButton>
      <GnButton v-else size="sm" data-testid="hs-stop" @click="stop">{{ t('hs.stop') }}</GnButton>
      <GnButton ref="filtersBtn" size="sm" :tone="chips.length ? 'accent' : undefined" aria-haspopup="dialog" :aria-expanded="popOpen" aria-controls="hs-pop" data-testid="hs-filters" @click="togglePop">
        {{ t('hs.filters') }}<span v-if="chips.length" class="hs__badge" data-testid="hs-filters-n" :aria-label="t('hs.filtersActive', { n: chips.length })">{{ chips.length }}</span>
        <GnTooltip :text="t('hs.filtersTitle')" />
      </GnButton>
      <GnButton v-if="hits || form.text || form.lines" size="sm" variant="ghost" data-testid="hs-clear" @click="clear">{{ t('hs.clear') }}</GnButton>
      <span class="hs__count" role="status" aria-live="polite" :aria-busy="running" data-testid="hs-count">{{ hits || running ? counter : '' }}</span>
      <GnButton v-if="more" size="sm" data-testid="hs-more" @click="run(true)">{{ t('hs.more') }}</GnButton>
    </form>

    <!-- os filtros ativos, um chip cada: remover o chip refaz a busca -->
    <div v-if="chips.length || form.folder" class="hs__chips" role="list" :aria-label="t('hs.filtersTitle')" data-testid="hs-chips">
      <span v-for="c in chips" :key="c.id" class="hs__chip hs__chip--small" role="listitem" :data-chip="c.id">
        {{ c.label }}
        <GnIconButton icon="x" :label="t('hs.chip.remove', { label: c.label })" @click="removeChip(c)" />
      </span>
      <span v-if="form.folder" class="hs__chip hs__chip--small" role="listitem" data-testid="hs-folder">
        {{ t('hs.folder', { dir: form.folder }) }}
        <GnIconButton icon="x" :label="t('hs.folderLeave')" @click="form.folder = ''" />
      </span>
    </div>

    <!-- o popover (não modal): escopo, autor, período e arquivo. Fica montado e escondido: o estado dos campos não se perde ao fechar -->
    <div v-show="popOpen" id="hs-pop" ref="pop" class="hs__pop" role="dialog" aria-modal="false" :aria-label="t('hs.filtersTitle')" data-testid="hs-pop" @keydown="onPopKey">
      <div class="hs__grid">
        <ComboBox v-model="form.scope" :options="scopeOptions" :aria-label="t('hs.scope')" data-testid="hs-scope" />
        <input
          v-if="form.scope === 'branch' || form.scope === 'range'"
          v-model="form.revision"
          class="hs__in"
          :placeholder="form.scope === 'range' ? t('hs.rangePh') : t('hs.revisionPh')"
          :aria-label="t('hs.revision')"
          spellcheck="false"
          data-testid="hs-revision"
          @keydown.enter.prevent="run()"
        />
        <input v-model="form.author" class="hs__in" :placeholder="t('hs.author')" :aria-label="t('hs.author')" spellcheck="false" data-testid="hs-author" @keydown.enter.prevent="run()" />
        <input v-model="form.since" class="hs__in" :placeholder="t('hs.since')" :aria-label="t('hs.since')" spellcheck="false" data-testid="hs-since" @keydown.enter.prevent="run()" />
        <input v-model="form.until" class="hs__in" :placeholder="t('hs.until')" :aria-label="t('hs.until')" spellcheck="false" data-testid="hs-until" @keydown.enter.prevent="run()" />
        <input v-if="!form.lines" v-model="form.include" class="hs__in hs__in--wide" :placeholder="t('hs.include')" :aria-label="t('hs.include')" spellcheck="false" data-testid="hs-include" @keydown.enter.prevent="run()" />
        <label v-if="followOk" class="hs__chk"><input v-model="form.follow" type="checkbox" data-testid="hs-follow" /> {{ t('hs.follow') }}</label>
      </div>
      <div class="hs__popbtns">
        <GnButton size="sm" variant="ghost" data-testid="hs-pop-close" @click="closePop()">{{ t('hs.close') }}</GnButton>
        <GnButton size="sm" tone="accent" :disabled="!ready" data-testid="hs-pop-go" @click="run()">{{ t('hs.search') }}</GnButton>
      </div>
    </div>

    <p v-if="error" class="hs__err" role="alert" data-testid="hs-error">{{ error }}</p>
    <p v-else-if="done?.ok && done.message" class="hs__note" role="status" data-testid="hs-note">{{ done.message }}</p>
    <p v-if="done?.ok && done.reason === 'noCommits'" class="hs__note" role="status">{{ done.message }}</p>
    <!-- o resumo vira uma faixa fina, dispensável -->
    <p v-if="summaryOn" class="hs__sum" data-testid="hs-summary">
      <template v-if="summary.firstAdded">
        {{ t('hs.firstAdded') }}
        <GnButton size="sm" variant="ghost" :aria-pressed="selected === summary.firstAdded.hash" data-testid="hs-first" @click="emit('select', summary.firstAdded!.hash)">{{ fmt(summary.firstAdded) }}</GnButton>
      </template>
      <template v-if="summary.lastRemoved">
        {{ t('hs.lastRemoved') }}
        <GnButton size="sm" variant="ghost" :aria-pressed="selected === summary.lastRemoved.hash" data-testid="hs-last" @click="emit('select', summary.lastRemoved!.hash)">{{ fmt(summary.lastRemoved) }}</GnButton>
      </template>
      <span v-if="more" class="muted">{{ t('hs.partial') }}</span>
      <GnIconButton class="hs__sumx" icon="x" :label="t('hs.sumClose')" data-testid="hs-summary-close" @click="sumHidden = true" />
    </p>
  </section>
</template>

<style scoped lang="scss">
.hs {
  position: relative; display: flex; flex-direction: column; gap: 4px; padding: 4px 14px; border-bottom: 1px solid var(--gn-border);
  // a barra: 36 px de altura, sem quebrar em duas linhas (o campo cede)
  &__bar { display: flex; align-items: center; gap: 6px; min-height: 36px; flex-wrap: nowrap; }
  &__fieldwrap { flex: 1 1 200px; min-width: 160px; }
  &__field { width: 100%; }
  &__badge { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; margin-left: 5px; padding: 0 4px; border-radius: 999px; font-size: 10.5px; font-weight: 700; background: var(--gn-accent-solid); color: #fff; }
  &__count { flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--gn-muted); }
  &__chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; padding-bottom: 2px; }
  &__pop {
    position: absolute; left: 14px; top: 100%; z-index: var(--gn-z-popover); width: min(560px, calc(100% - 28px)); margin-top: 2px; padding: 12px;
    background: var(--gn-surface); border: 1px solid var(--gn-border); border-radius: var(--gn-radius-lg); box-shadow: var(--gn-shadow-md);
  }
  &__grid { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; input { min-width: 0; } }
  &__in { width: 150px; &--wide { width: 100%; } }
  &__chk { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; }
  &__popbtns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
  &__err { margin: 0; color: var(--gn-danger); font-size: 12.5px; }
  &__note { margin: 0; color: var(--gn-warn); font-size: 12.5px; }
  &__sum { margin: 0; font-size: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; padding: 2px 0; }
  &__sumx { margin-left: auto; }
  &__chip {
    display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; padding: 2px 4px 2px 10px; border: 1px solid var(--gn-border); border-radius: 999px; background: var(--gn-surface-2); font-size: 12px;
    &--small { padding-left: 8px; }
  }
  &__chip-text { font-family: var(--gn-mono); }
}
.muted { color: var(--gn-muted); }
</style>
