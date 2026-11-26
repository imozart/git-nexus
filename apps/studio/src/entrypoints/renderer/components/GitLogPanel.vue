<script setup lang="ts">
// Log do Git do repositório: cada comando que o app executa, com horário, resultado e duração. Fica na parte de baixo da tela
// (como o "Git Log"/"Console" do IntelliJ) e recolhe até virar uma barra de uma linha. Por padrão mostra "Minhas ações" (o que a pessoa pediu e o que
// altera o repositório); as consultas que o app faz sozinho (status, buscas, índice) ficam em "Tudo" e "Só leitura".
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { GitCommandEvent } from '@git-nexus/git-core/pure';
import { GnBadge, GnButton, GnIcon, GnIconButton, GnSegmented, GnTooltip } from '@git-nexus/ui-kit';
import { api } from '../api';
import { dateLocale, t, type MessageKey } from '../i18n';
import { LOG_FILTERS, exportText, filterEntries, isError, isMine, logLine, parseFilter, stamp, type LogFilter } from '../gitlog-core';
import { useGitLogStore } from '../stores/gitlog';

const props = defineProps<{ repoPath: string }>();
const open = defineModel<boolean>('open', { default: false });

const store = useGitLogStore();
const FILTER_KEY = 'gitnexus.gitLogFilter';
const MASK_KEY = 'gitnexus.gitLogMask';
const HEIGHT_KEY = 'gitnexus.gitLogHeight';
const MIN_H = 120;

const filter = ref<LogFilter>(parseFilter(localStorage.getItem(FILTER_KEY)));
watch(filter, (v) => localStorage.setItem(FILTER_KEY, v));
const mask = ref(localStorage.getItem(MASK_KEY) === '1');
watch(mask, (v) => localStorage.setItem(MASK_KEY, v ? '1' : '0'));
const query = ref('');
const height = ref(Math.max(MIN_H, Number(localStorage.getItem(HEIGHT_KEY)) || 240));

const all = computed(() => store.entries(props.repoPath));
const shown = computed(() => filterEntries(all.value, filter.value, query.value));
const lastMine = computed(() => [...all.value].reverse().find(isMine));
const total = computed(() => store.total(props.repoPath));
const background = computed(() => store.backgroundTotal(props.repoPath));
const fresh = computed(() => store.unseenErrors(props.repoPath));
const errorCount = computed(() => all.value.filter(isError).length);

const FILTER_LABELS: Record<LogFilter, MessageKey> = { mine: 'log.f.mine', all: 'log.f.all', read: 'log.f.read', errors: 'log.f.errors' };
const filterOptions = computed(() =>
  LOG_FILTERS.map((f) => ({ value: f, label: f === 'errors' && errorCount.value ? `${t(FILTER_LABELS[f])} ${errorCount.value}` : t(FILTER_LABELS[f]) })),
);

const keyOf = (e: GitCommandEvent) => `${e.startedAt}-${e.id}`;
const expanded = ref(new Set<string>());
/** Comando que falhou mostra o motivo sem precisar abrir; os demais abrem pelo botão da linha (ou clicando nela). */
const isOpen = (e: GitCommandEvent) => Boolean(e.output) && (expanded.value.has(keyOf(e)) !== isError(e));
function toggle(e: GitCommandEvent): void {
  if (!e.output) return;
  const next = new Set(expanded.value);
  next.has(keyOf(e)) ? next.delete(keyOf(e)) : next.add(keyOf(e));
  expanded.value = next;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString(dateLocale.value, { hour12: false });
const statusText = (e: GitCommandEvent) => (e.code === 0 ? t('log.ok') : t('log.failed', { code: e.code }));

// abrir o log: os erros novos passam a ser "vistos" (some o ponto do rodapé)
watch(
  open,
  (v) => {
    if (v) {
      store.markSeen(props.repoPath);
      stick = true;
      void toEnd();
    }
  },
  { immediate: true },
);
watch(fresh, (n) => {
  if (open.value && n) store.markSeen(props.repoPath);
});

// --- rolagem: acompanha o fim da lista, a menos que o usuário tenha subido para ler ------------------------
const body = ref<HTMLElement>();
let stick = true;
const onScroll = () => {
  const el = body.value;
  if (el) stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
};
async function toEnd(): Promise<void> {
  await nextTick();
  if (body.value && stick) body.value.scrollTop = body.value.scrollHeight;
}
watch(() => shown.value.length, toEnd);

// --- altura ajustável arrastando a borda de cima ------------------------------------------------------------
let dragFrom: { y: number; h: number } | null = null;
function dragStart(e: PointerEvent): void {
  dragFrom = { y: e.clientY, h: height.value };
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}
function dragMove(e: PointerEvent): void {
  if (!dragFrom) return;
  const max = Math.max(MIN_H, window.innerHeight - 220);
  height.value = Math.min(max, Math.max(MIN_H, dragFrom.h + (dragFrom.y - e.clientY)));
}
function dragEnd(): void {
  if (dragFrom) localStorage.setItem(HEIGHT_KEY, String(Math.round(height.value)));
  dragFrom = null;
}

// --- ações -------------------------------------------------------------------------------------------------------------
/** Texto de um aviso curto ("Copiado ✓") que some sozinho. */
const note = ref('');
let noteTimer: ReturnType<typeof setTimeout> | undefined;
function say(key: MessageKey): void {
  note.value = t(key);
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => (note.value = ''), 1800);
}
async function copyShown(): Promise<void> {
  await api.copyText(shown.value.map(logLine).join('\n'));
  say('log.copied');
}
async function copyCommand(e: GitCommandEvent): Promise<void> {
  await api.copyText(e.command);
  say('log.copiedCommand');
}
async function copyOutput(e: GitCommandEvent): Promise<void> {
  await api.copyText(e.output ?? '');
  say('log.copiedOutput');
}
/** Baixa o log da sessão inteira (não só o filtro) como texto, para anexar a um relato de bug; o segredo já saiu de cada comando no núcleo. */
function exportLog(): void {
  const text = exportText(all.value, { mask: mask.value, repoPath: props.repoPath });
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = `gitnexus-log-${stamp(d.getTime()).replace(/[: ]/g, (c) => (c === ' ' ? '_' : '-'))}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  say('log.exported');
}
onBeforeUnmount(() => clearTimeout(noteTimer));
</script>

<template>
  <section class="log" :class="{ 'log--open': open }" :style="open ? { height: height + 'px' } : undefined" :aria-label="t('log.title')">
    <div v-if="open" class="log__grip" role="separator" aria-orientation="horizontal" @pointerdown="dragStart" @pointermove="dragMove" @pointerup="dragEnd" @pointercancel="dragEnd" />
    <header class="log__bar">
      <GnButton variant="ghost" class="log__toggle" :aria-expanded="open" @click="open = !open">
        <GnIcon class="log__chev" :class="{ 'log__chev--open': open }" name="chevron-right" />
        <strong>{{ t('log.title') }}</strong>
        <span class="log__count" data-testid="log-count">{{ t('log.count', { n: total }) }}</span>
        <span v-if="background" class="log__bg" data-testid="log-bg">{{ t('log.countBg', { n: background }) }}</span>
        <span v-if="!open && fresh" class="log__dot" role="img" :aria-label="t('log.newErrors', { n: fresh })" data-testid="log-dot" />
        <code v-if="!open && lastMine" class="log__last" :class="{ 'log__last--fail': isError(lastMine) }">{{ lastMine.command }}</code>
        <GnTooltip :text="open ? t('log.collapse') : t('log.expand')" />
      </GnButton>
      <template v-if="open">
        <GnSegmented v-model="filter" class="log__filter" :options="filterOptions" :aria-label="t('log.filter')" :title="t('log.filterTitle')" data-testid="log-filter" />
        <input v-model="query" class="log__q" type="text" :placeholder="t('log.search')" :aria-label="t('log.search')" data-testid="log-search" />
        <span v-if="note" class="log__note" role="status">{{ note }}</span>
        <label class="log__opt"><input v-model="mask" type="checkbox" data-testid="log-mask" /> {{ t('log.mask') }}<GnTooltip :text="t('log.maskTitle')" /></label>
        <GnButton size="sm" :disabled="!shown.length" @click="copyShown">{{ t('log.copy') }}</GnButton>
        <GnButton size="sm" :disabled="!all.length" data-testid="log-export" @click="exportLog">{{ t('log.export') }}<GnTooltip :text="t('log.exportTitle')" /></GnButton>
        <GnButton size="sm" :disabled="!all.length" @click="store.clear(repoPath)">{{ t('log.clear') }}</GnButton>
      </template>
    </header>
    <div v-if="open" ref="body" class="log__body" @scroll.passive="onScroll">
      <p v-if="!shown.length" class="log__empty" data-testid="log-empty">{{ !all.length ? t('log.empty') : query ? t('log.emptyFiltered') : t(filter === 'mine' ? 'log.emptyMine' : filter === 'errors' ? 'log.emptyErrors' : 'log.emptyFiltered') }}</p>
      <ul v-else class="log__list" :aria-label="t('log.title')">
        <li v-for="e in shown" :key="keyOf(e)" class="log__row" :class="{ 'log__row--read': e.readOnly, 'log__row--fail': isError(e), 'log__row--soft': e.code !== 0 && !isError(e), 'log__row--has': e.output, 'log__row--bg': e.origin === 'background' }" :data-origin="e.origin" @click="toggle(e)">
          <span class="log__time">{{ time(e.startedAt) }}</span>
          <span class="log__st" role="img" :aria-label="statusText(e)">{{ e.code === 0 ? '✓' : '✗' }}<GnTooltip :text="e.code === 0 ? '' : t('log.failed', { code: e.code })" /></span>
          <span class="log__line">
            <code class="log__cmd">{{ e.command }}</code>
            <GnBadge v-if="e.origin === 'background'" tone="neutral" class="log__origin">{{ t('log.origin.background') }}<GnTooltip :text="t('log.origin.backgroundTip')" /></GnBadge>
          </span>
          <span class="log__ms">{{ e.durationMs }} ms</span>
          <span class="log__acts" @click.stop>
            <GnIconButton v-if="e.output" :icon="isOpen(e) ? 'down' : 'right'" :label="isOpen(e) ? t('log.hideOutput') : t('log.showOutput')" :aria-expanded="isOpen(e)" data-testid="log-toggle-output" @click="toggle(e)" />
            <GnIconButton icon="copy" :label="t('log.copyCommand')" data-testid="log-copy-cmd" @click="copyCommand(e)" />
            <GnIconButton v-if="e.output" icon="copy" tone="accent" :label="t('log.copyOutput')" data-testid="log-copy-out" @click="copyOutput(e)" />
          </span>
          <pre v-if="isOpen(e)" class="log__out" tabindex="0" :aria-label="t('log.output')">{{ e.output }}</pre>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped lang="scss">
.log {
  position: relative; flex: none; display: flex; flex-direction: column; min-height: 0;
  background: var(--gn-bg); border-top: 1px solid var(--gn-border);
  &__grip { position: absolute; left: 0; right: 0; top: -3px; height: 6px; cursor: ns-resize; z-index: 2; touch-action: none; &:hover { background: var(--gn-accent); opacity: 0.5; } }
  &__bar { display: flex; align-items: center; gap: 8px; padding: 0 8px 0 0; min-height: 30px; flex: none; flex-wrap: wrap; background: var(--gn-surface); }
  // .gn-btn junto: ganha do estilo do botão sem !important
  .log__toggle.gn-btn {
    flex: 1 1 260px; min-width: 0; justify-content: flex-start; gap: 8px; height: 30px; padding: 0 12px; font: inherit; font-size: 12px;
    color: var(--gn-text); background: none; border: none; border-radius: 0; text-align: left;
    &:hover { background: var(--gn-surface-2); }
  }
  &__chev { display: inline-block; font-size: 12px; color: var(--gn-muted); transition: transform var(--gn-motion-fast); &--open { transform: rotate(90deg); } }
  &__count { color: var(--gn-muted); font-size: 11px; padding: 1px 8px; background: var(--gn-surface-2); border-radius: 999px; }
  &__bg { color: var(--gn-muted); font-size: 11px; opacity: 0.8; }
  &__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--gn-danger); flex-shrink: 0; }
  &__last { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--gn-mono); font-size: 11px; color: var(--gn-muted); &--fail { color: var(--gn-danger); } }
  &__q { width: 190px; font-size: 12px; padding: 3px 8px; }
  &__note { font-size: 11px; color: var(--gn-success); }
  &__opt { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--gn-muted); cursor: pointer; }
  &__body { flex: 1; min-height: 0; overflow: auto; font-family: var(--gn-mono); font-size: 12px; }
  &__empty { margin: 0; padding: 16px; color: var(--gn-muted); font-family: inherit; }
  &__list { list-style: none; margin: 0; padding: 2px 0; }
  &__row {
    display: grid; grid-template-columns: 68px 16px minmax(0, 1fr) 64px 84px; align-items: baseline; column-gap: 8px; padding: 1px 12px;
    &:hover, &:focus-within { background: var(--gn-surface); }
    &--has { cursor: pointer; }
    &--read .log__cmd { color: var(--gn-muted); }
    &--fail .log__cmd, &--fail .log__st { color: var(--gn-danger); }
    &--soft .log__st { color: var(--gn-muted); }
    &--bg .log__time, &--bg .log__ms { opacity: 0.75; }
  }
  &__time { color: var(--gn-muted); font-size: 11px; }
  &__st { color: var(--gn-success); text-align: center; }
  &__line { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  &__cmd { font-family: inherit; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  &__origin { flex-shrink: 0; font-size: 10px; }
  &__ms { color: var(--gn-muted); font-size: 11px; text-align: right; }
  // as ações da linha ficam fora do caminho: aparecem ao passar o mouse e quando o foco está na linha (teclado)
  &__acts { display: inline-flex; justify-content: flex-end; gap: 2px; align-self: center; opacity: 0; &:focus-within { opacity: 1; } }
  &__row:hover &__acts, &__row:focus-within &__acts { opacity: 1; }
  &__out {
    grid-column: 3 / -1; margin: 2px 0 4px; padding: 6px 10px; white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow: auto;
    color: var(--gn-muted); background: var(--gn-surface); border-left: 2px solid var(--gn-border); border-radius: 0 6px 6px 0; font-family: inherit; font-size: 11px;
  }
  &__row--fail &__out { border-left-color: var(--gn-danger); color: var(--gn-text); }
}
</style>
