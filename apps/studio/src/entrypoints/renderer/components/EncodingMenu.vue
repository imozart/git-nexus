<script setup lang="ts">
// Lista de codificações (rodapé do app): "Automática" + todas as do catálogo, por grupo, com pesquisa. Abre para CIMA, ancorada no rodapé.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { ENCODING_GROUPS, FILE_ENCODINGS, type EncodingChoice, type EncodingGroup, type FileEncoding } from '@git-nexus/git-core/pure';
import { t, type MessageKey } from '../i18n';

const props = defineProps<{
  /** Posição do botão do rodapé (a lista abre acima dele). */
  anchor: { left: number; top: number };
  /** Codificação em uso. */
  current: FileEncoding;
  /** O que a detecção automática concluiu. */
  detected: FileEncoding;
  /** A pessoa não escolheu nada para este arquivo (vale a detectada). */
  auto: boolean;
}>();
const emit = defineEmits<{ (e: 'select', choice: EncodingChoice): void; (e: 'close'): void }>();

const el = ref<HTMLDivElement>();
const input = ref<HTMLInputElement>();
const listEl = ref<HTMLDivElement>();
const query = ref('');
const active = ref(0);

const GROUP_KEY: Record<EncodingGroup, MessageKey> = {
  unicode: 'enc.group.unicode',
  'west-europe': 'enc.group.west-europe',
  'central-europe': 'enc.group.central-europe',
  'baltic-nordic': 'enc.group.baltic-nordic',
  cyrillic: 'enc.group.cyrillic',
  greek: 'enc.group.greek',
  turkish: 'enc.group.turkish',
  hebrew: 'enc.group.hebrew',
  arabic: 'enc.group.arabic',
  thai: 'enc.group.thai',
  vietnamese: 'enc.group.vietnamese',
  japanese: 'enc.group.japanese',
  'chinese-simplified': 'enc.group.chinese-simplified',
  'chinese-traditional': 'enc.group.chinese-traditional',
  korean: 'enc.group.korean',
};
const groupLabel = (g: EncodingGroup) => t(GROUP_KEY[g]);

interface Row {
  key: string;
  choice: EncodingChoice;
  label: string;
  note?: string;
  group?: EncodingGroup;
}

const rows = computed<Row[]>(() => {
  const q = query.value.trim().toLowerCase();
  const out: Row[] = [];
  if (!q || t('enc.autoOption').toLowerCase().includes(q) || 'auto'.includes(q)) out.push({ key: 'auto', choice: 'auto', label: t('enc.autoOption') });
  for (const g of ENCODING_GROUPS) {
    for (const e of FILE_ENCODINGS) {
      if (e.group !== g) continue;
      if (q && !`${e.label} ${e.id} ${groupLabel(g)}`.toLowerCase().includes(q)) continue;
      out.push({ key: e.id, choice: e.id, label: e.label, group: g });
    }
  }
  return out;
});

/** Cabeçalho do grupo antes da primeira linha dele. */
const showGroup = (i: number) => rows.value[i]?.group !== undefined && rows.value[i - 1]?.group !== rows.value[i]!.group;
const isCurrent = (r: Row) => (r.choice === 'auto' ? props.auto : !props.auto && r.choice === props.current);

const pos = ref({ left: props.anchor.left, bottom: window.innerHeight - props.anchor.top + 6 });

function pick(r: Row | undefined): void {
  if (r) emit('select', r.choice);
}
function move(delta: number): void {
  const n = rows.value.length;
  if (!n) return;
  active.value = (active.value + delta + n) % n;
  void nextTick(() => listEl.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }));
}
function onKey(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') emit('close');
  else if (ev.key === 'ArrowDown') (ev.preventDefault(), move(1));
  else if (ev.key === 'ArrowUp') (ev.preventDefault(), move(-1));
  else if (ev.key === 'Enter') (ev.preventDefault(), pick(rows.value[active.value]));
}
function onOutside(ev: MouseEvent): void {
  if (el.value && !el.value.contains(ev.target as Node) && !(ev.target as HTMLElement).closest('[data-testid="encoding-btn"]')) emit('close');
}

onMounted(async () => {
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => emit('close'), { once: true });
  await nextTick();
  const r = el.value?.getBoundingClientRect();
  if (r) pos.value = { left: Math.max(4, Math.min(props.anchor.left, window.innerWidth - r.width - 4)), bottom: pos.value.bottom };
  active.value = Math.max(0, rows.value.findIndex(isCurrent));
  input.value?.focus();
  listEl.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'center' });
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <Teleport to="body">
    <div ref="el" class="enc" role="dialog" :aria-label="t('enc.title')" data-testid="encoding-menu" :style="{ left: pos.left + 'px', bottom: pos.bottom + 'px' }">
      <input ref="input" v-model="query" class="enc__search" type="search" :placeholder="t('enc.search')" :aria-label="t('enc.search')" @input="active = 0" />
      <div ref="listEl" class="enc__list" role="listbox" :aria-label="t('enc.title')">
        <template v-for="(r, i) in rows" :key="r.key">
          <div v-if="showGroup(i)" class="enc__group" role="presentation">{{ groupLabel(r.group!) }}</div>
          <div
            class="enc__row"
            :class="{ 'enc__row--on': isCurrent(r), 'enc__row--active': i === active }"
            role="option"
            :aria-selected="isCurrent(r)"
            :data-active="i === active"
            :data-testid="`enc-${r.key}`"
            @click="pick(r)"
            @mousemove="active = i"
          >
            <span class="enc__check" aria-hidden="true">{{ isCurrent(r) ? '✓' : '' }}</span>
            <span class="enc__name">{{ r.label }}</span>
            <span v-if="r.choice === detected && r.choice !== 'auto'" class="enc__note">{{ t('enc.detected') }}</span>
          </div>
        </template>
        <div v-if="!rows.length" class="enc__none">{{ t('enc.noMatch') }}</div>
      </div>
      <div class="enc__foot">{{ t('enc.note') }}</div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.enc {
  position: fixed;
  z-index: var(--gn-z-popover);
  width: 300px;
  display: flex;
  flex-direction: column;
  background: var(--gn-surface);
  border: 1px solid var(--gn-border);
  border-radius: var(--gn-radius-lg);
  box-shadow: var(--gn-shadow-md);
  animation: gn-fade-in var(--gn-enter) ease-out;
  font-size: 13px;
  &__search { margin: 8px; padding: 5px 8px; font: inherit; color: var(--gn-text); background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); &:focus { outline: none; border-color: var(--gn-accent); } &:focus-visible { box-shadow: var(--gn-ring); } }
  &__list { max-height: min(55vh, 420px); overflow: auto; padding-bottom: 4px; }
  &__group { padding: 8px 12px 3px; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--gn-muted); }
  &__row { display: flex; align-items: center; gap: 8px; padding: 4px 12px; cursor: pointer; &--active { background: var(--gn-surface-2); } &--on { color: var(--gn-accent); font-weight: 600; } }
  &__check { width: 12px; text-align: center; }
  &__name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  &__note { font-size: 11px; color: var(--gn-muted); font-weight: 400; }
  &__none { padding: 12px; color: var(--gn-muted); }
  &__foot { padding: 7px 12px; border-top: 1px solid var(--gn-border); font-size: 11px; color: var(--gn-muted); }
}
</style>
