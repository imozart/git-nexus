<script setup lang="ts">
// Log do Git do repositório: cada comando que o app executa, com horário, resultado e duração. Fica na parte de baixo da tela
// (como o "Git Log"/"Console" do IntelliJ) e recolhe até virar uma barra de uma linha.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { GitCommandEvent } from '@git-nexus/git-core/pure';
import { GnIcon } from '@git-nexus/ui-kit';
import { api } from '../api';
import { dateLocale, t } from '../i18n';
import { useGitLogStore } from '../stores/gitlog';

const props = defineProps<{ repoPath: string }>();
const open = defineModel<boolean>('open', { default: false });

const store = useGitLogStore();
const ONLY_KEY = 'gitnexus.gitLogOnlyChanges';
const HEIGHT_KEY = 'gitnexus.gitLogHeight';
const MIN_H = 120;

const onlyChanges = ref(localStorage.getItem(ONLY_KEY) === '1');
watch(onlyChanges, (v) => localStorage.setItem(ONLY_KEY, v ? '1' : '0'));
const height = ref(Math.max(MIN_H, Number(localStorage.getItem(HEIGHT_KEY)) || 240));

const all = computed(() => store.entries(props.repoPath));
const shown = computed(() => (onlyChanges.value ? all.value.filter((e) => !e.readOnly) : all.value));
const last = computed(() => all.value[all.value.length - 1]);
const total = computed(() => store.total(props.repoPath));

const keyOf = (e: GitCommandEvent) => `${e.startedAt}-${e.id}`;
const expanded = ref(new Set<string>());
/** Comando que falhou mostra o motivo sem precisar clicar; os demais abrem ao clicar. */
const isOpen = (e: GitCommandEvent) => Boolean(e.output) && (expanded.value.has(keyOf(e)) !== (e.code !== 0));
function toggle(e: GitCommandEvent): void {
  if (!e.output) return;
  const next = new Set(expanded.value);
  next.has(keyOf(e)) ? next.delete(keyOf(e)) : next.add(keyOf(e));
  expanded.value = next;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString(dateLocale.value, { hour12: false });

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
watch(open, (v) => {
  if (v) {
    stick = true;
    void toEnd();
  }
});

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
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
async function copy(): Promise<void> {
  const text = shown.value.map((e) => `[${time(e.startedAt)}] ${e.command}${e.code !== 0 ? `  (exit ${e.code})` : ''}`).join('\n');
  await api.copyText(text);
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), 1500);
}
onBeforeUnmount(() => clearTimeout(copiedTimer));
</script>

<template>
  <section class="log" :class="{ 'log--open': open }" :style="open ? { height: height + 'px' } : undefined" :aria-label="t('log.title')">
    <div v-if="open" class="log__grip" role="separator" aria-orientation="horizontal" @pointerdown="dragStart" @pointermove="dragMove" @pointerup="dragEnd" @pointercancel="dragEnd" />
    <header class="log__bar">
      <button type="button" class="log__toggle" :aria-expanded="open" :title="open ? t('log.collapse') : t('log.expand')" @click="open = !open">
        <GnIcon class="log__chev" :class="{ 'log__chev--open': open }" name="chevron-right" />
        <strong>{{ t('log.title') }}</strong>
        <span class="log__count">{{ t('log.count', { n: total }) }}</span>
        <code v-if="!open && last" class="log__last" :class="{ 'log__last--fail': last.code !== 0 }">{{ last.command }}</code>
      </button>
      <template v-if="open">
        <label class="log__opt" :title="t('log.onlyChangesTitle')"><input v-model="onlyChanges" type="checkbox" /> {{ t('log.onlyChanges') }}</label>
        <button type="button" class="log__btn" :disabled="!shown.length" @click="copy">{{ copied ? t('log.copied') : t('log.copy') }}</button>
        <button type="button" class="log__btn" :disabled="!all.length" @click="store.clear(repoPath)">{{ t('log.clear') }}</button>
      </template>
    </header>
    <div v-if="open" ref="body" class="log__body" @scroll.passive="onScroll">
      <p v-if="!shown.length" class="log__empty">{{ all.length ? t('log.emptyFiltered') : t('log.empty') }}</p>
      <ul v-else class="log__list">
        <li v-for="e in shown" :key="keyOf(e)" class="log__row" :class="{ 'log__row--read': e.readOnly, 'log__row--fail': e.code !== 0, 'log__row--has': e.output }" @click="toggle(e)">
          <span class="log__time">{{ time(e.startedAt) }}</span>
          <span class="log__st" :title="e.code === 0 ? '' : t('log.failed', { code: e.code })">{{ e.code === 0 ? '✓' : '✗' }}</span>
          <code class="log__cmd">{{ e.command }}</code>
          <span class="log__ms">{{ e.durationMs }} ms</span>
          <pre v-if="isOpen(e)" class="log__out">{{ e.output }}</pre>
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
  &__bar { display: flex; align-items: center; gap: 10px; padding: 0 8px 0 0; height: 28px; flex: none; background: var(--gn-surface); }
  &__toggle {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 100%; padding: 0 12px; font: inherit; font-size: 12px;
    color: var(--gn-text); background: none; border: none; cursor: pointer; text-align: left;
    &:hover { background: var(--gn-surface-2); }
  }
  &__chev { display: inline-block; font-size: 12px; color: var(--gn-muted); transition: transform 0.12s; &--open { transform: rotate(90deg); } }
  &__count { color: var(--gn-muted); font-size: 11px; padding: 1px 8px; background: var(--gn-surface-2); border-radius: 999px; }
  &__last { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--gn-mono); font-size: 11px; color: var(--gn-muted); &--fail { color: var(--gn-danger); } }
  &__opt { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--gn-muted); cursor: pointer; }
  &__btn {
    font: inherit; font-size: 11px; padding: 2px 9px; color: var(--gn-text); background: var(--gn-surface-2); border: 1px solid var(--gn-border); border-radius: 999px; cursor: pointer;
    &:hover:not(:disabled) { border-color: var(--gn-accent); }
    &:disabled { opacity: 0.45; cursor: default; }
  }
  &__body { flex: 1; min-height: 0; overflow: auto; font-family: var(--gn-mono); font-size: 12px; }
  &__empty { margin: 0; padding: 16px; color: var(--gn-muted); font-family: inherit; }
  &__list { list-style: none; margin: 0; padding: 2px 0; }
  &__row {
    display: grid; grid-template-columns: 68px 16px minmax(0, 1fr) auto; align-items: baseline; column-gap: 8px; padding: 1px 12px;
    &:hover { background: var(--gn-surface); }
    &--has { cursor: pointer; }
    &--read .log__cmd { color: var(--gn-muted); }
    &--fail .log__cmd, &--fail .log__st { color: var(--gn-danger); }
  }
  &__time { color: var(--gn-muted); font-size: 11px; }
  &__st { color: var(--gn-success); text-align: center; }
  &__cmd { font-family: inherit; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__ms { color: var(--gn-muted); font-size: 11px; text-align: right; }
  &__out {
    grid-column: 3 / -1; margin: 2px 0 4px; padding: 6px 10px; white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow: auto;
    color: var(--gn-muted); background: var(--gn-surface); border-left: 2px solid var(--gn-border); border-radius: 0 6px 6px 0; font-family: inherit; font-size: 11px;
  }
  &__row--fail &__out { border-left-color: var(--gn-danger); color: var(--gn-text); }
}
</style>
