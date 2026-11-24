<script setup lang="ts">
// O painel "Buscar na história" do grafo (fase 9 da #233): o mesmo campo da pesquisa (Aa, ab, .*), os três modos em linguagem de gente (quando entrou ou
// saiu, linhas alteradas que casam, mensagem), o escopo (branch atual, todos, um branch/tag/commit, intervalo A..B, só tags), autor, período, arquivo ou
// máscara e "seguir renomeações". Roda no worker (`startHistorySearch`): os commits chegam em lotes, dá para parar e a página de 200 tem "carregar mais".
// O painel não desenha a lista: entrega os commits achados a quem o usa (`v-model:hits`), que os mostra na lista do grafo.
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { GnButton, GnIconButton, GnSearchField, regexProblem } from '@git-nexus/ui-kit';
import { summarizeHistory, type HistoryDone, type HistoryHit, type HistoryQuery, type RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { t } from '../i18n';
import { canFollow, canSearch, emptyForm, formFromQuery, toQuery, type HistoryForm } from '../history-search-core';
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
const form = reactive<HistoryForm>(emptyForm());
const done = ref<HistoryDone | null>(null);
const examined = ref<number | undefined>();
const error = ref('');
let seq = 0;
let currentId = '';

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
const summaryOn = computed(() => active.value?.mode === 'pickaxe' && !!active.value.text && !!hits.value?.length && !!(summary.value.firstAdded || summary.value.lastRemoved));
const more = computed(() => !!done.value?.truncated && done.value.nextSkip !== undefined);
const hint = computed(() => t(('hs.mode.hint.' + form.mode) as 'hs.mode.hint.pickaxe'));

function stop(): void {
  if (running.value) void api.cancelSearch(currentId).catch(() => undefined);
}

/** Roda a busca; com `next`, continua da página seguinte (acrescenta aos commits que já estão na lista). */
async function run(next = false): Promise<void> {
  if (!ready.value) return;
  if (running.value) stop();
  const skip = next ? done.value?.nextSkip ?? 0 : 0;
  const q = toQuery(form, skip);
  currentId = `hs-${Date.now().toString(36)}-${++seq}`;
  if (!next) {
    acc = [];
    hits.value = [];
    active.value = { ...q, skip: undefined };
    examined.value = undefined;
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
  if (running.value) void api.cancelSearch(currentId).catch(() => undefined);
});

// um pedido de fora (janela de pesquisa, editor, paleta): mostra no formulário e já busca
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
defineExpose({ run, stop, clear });
</script>

<template>
  <section class="hs" role="search" :aria-label="t('hs.label')" data-testid="hs-panel">
    <div v-if="form.lines" class="hs__chip" data-testid="hs-range">
      <span class="hs__chip-text">{{ t('hs.range', { file: form.lines.file, start: form.lines.start, end: form.lines.end }) }}</span>
      <GnIconButton icon="x" :label="t('hs.rangeLeave')" data-testid="hs-range-leave" @click="form.lines = null" />
    </div>
    <form class="hs__row" @submit.prevent="run()">
      <GnSearchField
        v-if="!form.lines"
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
      <ComboBox v-if="!form.lines" v-model="form.mode" :options="modeOptions" :aria-label="t('hs.mode')" data-testid="hs-mode" />
      <GnButton v-if="!running" tone="accent" size="sm" type="submit" :disabled="!ready" data-testid="hs-go">{{ t('hs.search') }}</GnButton>
      <GnButton v-else size="sm" data-testid="hs-stop" @click="stop">{{ t('hs.stop') }}</GnButton>
      <GnButton v-if="hits || form.text || form.lines" size="sm" variant="ghost" data-testid="hs-clear" @click="clear">{{ t('hs.clear') }}</GnButton>
    </form>
    <p v-if="!form.lines" class="hs__hint muted">{{ hint }}</p>
    <div class="hs__row hs__row--filters">
      <ComboBox v-model="form.scope" :options="scopeOptions" :aria-label="t('hs.scope')" data-testid="hs-scope" />
      <input
        v-if="form.scope === 'branch' || form.scope === 'range'"
        v-model="form.revision"
        class="hs__in hs__in--rev"
        :placeholder="form.scope === 'range' ? t('hs.rangePh') : t('hs.revisionPh')"
        :aria-label="t('hs.revision')"
        spellcheck="false"
        data-testid="hs-revision"
        @keydown.enter.prevent="run()"
      />
      <input v-model="form.author" class="hs__in" :placeholder="t('hs.author')" :aria-label="t('hs.author')" spellcheck="false" data-testid="hs-author" @keydown.enter.prevent="run()" />
      <input v-model="form.since" class="hs__in hs__in--date" :placeholder="t('hs.since')" :aria-label="t('hs.since')" spellcheck="false" data-testid="hs-since" @keydown.enter.prevent="run()" />
      <input v-model="form.until" class="hs__in hs__in--date" :placeholder="t('hs.until')" :aria-label="t('hs.until')" spellcheck="false" data-testid="hs-until" @keydown.enter.prevent="run()" />
      <input v-if="!form.lines" v-model="form.include" class="hs__in hs__in--path" :placeholder="t('hs.include')" :aria-label="t('hs.include')" spellcheck="false" data-testid="hs-include" @keydown.enter.prevent="run()" />
      <span v-if="form.folder" class="hs__chip hs__chip--small" data-testid="hs-folder">
        {{ t('hs.folder', { dir: form.folder }) }}
        <GnIconButton icon="x" :label="t('hs.folderLeave')" @click="form.folder = ''" />
      </span>
      <label v-if="followOk" class="hs__chk"><input v-model="form.follow" type="checkbox" data-testid="hs-follow" /> {{ t('hs.follow') }}</label>
    </div>

    <div class="hs__status">
      <span class="hs__count" role="status" aria-live="polite" :aria-busy="running" data-testid="hs-count">{{ hits || running ? counter : '' }}</span>
      <GnButton v-if="more" size="sm" data-testid="hs-more" @click="run(true)">{{ t('hs.more') }}</GnButton>
    </div>
    <p v-if="error" class="hs__err" role="alert" data-testid="hs-error">{{ error }}</p>
    <p v-else-if="done?.ok && done.message" class="hs__note" role="status" data-testid="hs-note">{{ done.message }}</p>
    <p v-if="done?.ok && done.reason === 'noCommits'" class="hs__note" role="status">{{ done.message }}</p>
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
    </p>
  </section>
</template>

<style scoped lang="scss">
.hs {
  display: flex; flex-direction: column; gap: 6px; padding: 8px 14px; border-bottom: 1px solid var(--gn-border);
  &__row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; &--filters { input { min-width: 0; } } }
  &__field { flex: 1; min-width: 240px; }
  &__in { width: 130px; &--rev { width: 150px; } &--date { width: 170px; } &--path { width: 200px; } }
  &__chk { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; }
  &__hint { margin: 0; font-size: 12px; }
  &__status { display: flex; align-items: center; gap: 10px; min-height: 22px; }
  &__count { font-size: 12px; color: var(--gn-muted); }
  &__err { margin: 0; color: var(--gn-danger); font-size: 12.5px; }
  &__note { margin: 0; color: var(--gn-warn); font-size: 12.5px; }
  &__sum { margin: 0; font-size: 12.5px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
  &__chip {
    display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; padding: 2px 4px 2px 10px; border: 1px solid var(--gn-border); border-radius: 999px; background: var(--gn-surface-2); font-size: 12px;
    &--small { padding-left: 8px; }
  }
  &__chip-text { font-family: var(--gn-mono); }
}
.muted { color: var(--gn-muted); }
</style>
