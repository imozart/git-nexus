<script setup lang="ts">
// Combobox padrão do app, no visual do seletor de idioma: botão (ou campo) com seta e lista flutuante de cantos arredondados,
// item atual marcado, teclado completo. Substitui <select> e <datalist> nativos, cujas listas o sistema desenha e não dá para estilizar.
//
//  - modo seleção (padrão): botão + lista; `v-model` é o `value` da opção escolhida.
//  - modo `searchable`: campo de texto livre com sugestões filtradas (ex.: caminho de arquivo). A lista mostra no máximo `max` itens
//    (o <datalist> nativo criava um <option> por arquivo e travava o app em repositórios grandes).
//
// A lista vai para o <body> (Teleport) com posição fixa: não é cortada por painéis com rolagem e abre para cima se faltar espaço.
import { computed, nextTick, onBeforeUnmount, ref, watch, type CSSProperties } from 'vue';
import { DEFAULT_MAX, filterOptions, labelOf, optionOf, type ComboInput, type ComboOption } from '../combo-core';
import { t } from '../i18n';

const props = withDefaults(
  defineProps<{
    options: readonly ComboInput[];
    searchable?: boolean;
    placeholder?: string;
    title?: string;
    ariaLabel?: string;
    /** Fonte monoespaçada (caminhos, ramos). */
    mono?: boolean;
    /** Botão arredondado como o seletor de idioma do cabeçalho. */
    pill?: boolean;
    /** Ocupa a largura toda do contêiner (campo de formulário). */
    block?: boolean;
    /** Lado em que a lista se alinha ao botão. */
    align?: 'left' | 'right';
    /** Máximo de itens na lista (só modo `searchable`). */
    max?: number;
    disabled?: boolean;
  }>(),
  { searchable: false, align: 'left', max: DEFAULT_MAX },
);
const model = defineModel<string>({ default: '' });
/** O usuário confirmou um valor: escolheu na lista, deu Enter ou saiu do campo com o texto alterado. */
const emit = defineEmits<{ commit: [value: string] }>();

const listId = `cbx-${Math.random().toString(36).slice(2, 9)}`;
const root = ref<HTMLElement>();
const field = ref<HTMLInputElement | HTMLButtonElement>();
const list = ref<HTMLElement>();
const open = ref(false);
const active = ref(-1);
/** No modo `searchable`: a lista só filtra pelo texto depois que o usuário digita (ao abrir, mostra as primeiras). */
const typed = ref(false);
let valueOnFocus = '';

const normalized = computed(() => (props.searchable ? [] : props.options.map(optionOf)));
const current = computed<ComboOption | undefined>(() => normalized.value.find((o) => o.value === model.value));
const result = computed(() =>
  props.searchable
    ? filterOptions(props.options, typed.value ? model.value : '', props.max)
    : { items: normalized.value, total: normalized.value.length, hidden: 0 },
);
const shown = computed(() => result.value.items);
const activeId = computed(() => (open.value && active.value >= 0 ? `${listId}-${active.value}` : undefined));
const selectable = (o: ComboOption | undefined): o is ComboOption => !!o && !o.disabled;

// --- posição ------------------------------------------------------------------------------------------------------------
const pos = ref<CSSProperties>({});
function place(): void {
  const r = root.value?.getBoundingClientRect();
  if (!r) return;
  const below = window.innerHeight - r.bottom;
  const up = below < 220 && r.top > below;
  const room = (up ? r.top : below) - 16;
  pos.value = {
    minWidth: `${Math.round(r.width)}px`,
    maxHeight: `${Math.max(120, Math.min(340, room))}px`,
    ...(props.align === 'right' ? { right: `${Math.round(window.innerWidth - r.right)}px` } : { left: `${Math.round(r.left)}px` }),
    ...(up ? { bottom: `${Math.round(window.innerHeight - r.top + 6)}px` } : { top: `${Math.round(r.bottom + 6)}px` }),
  };
}

// --- abrir / fechar -----------------------------------------------------------------------------------------------------
function onDocDown(e: MouseEvent): void {
  const n = e.target as Node;
  if (!root.value?.contains(n) && !list.value?.contains(n)) close();
}
function onViewportChange(e: Event): void {
  if (e.type === 'scroll' && list.value?.contains(e.target as Node)) return; // rolar a própria lista não fecha
  close();
}
function show(): void {
  if (open.value || props.disabled) return;
  if (props.searchable && !props.options.length) return; // nada a sugerir: campo comum
  open.value = true;
  place();
  active.value = props.searchable ? -1 : shown.value.findIndex((o) => o.value === model.value);
  document.addEventListener('mousedown', onDocDown, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);
  void scrollToActive();
}
function close(refocus = false): void {
  if (!open.value) return;
  open.value = false;
  document.removeEventListener('mousedown', onDocDown, true);
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, true);
  if (refocus) field.value?.focus();
}
onBeforeUnmount(() => close());
watch(() => props.disabled, (d) => d && close());

async function scrollToActive(): Promise<void> {
  await nextTick();
  if (activeId.value) document.getElementById(activeId.value)?.scrollIntoView({ block: 'nearest' });
}

// --- escolher -----------------------------------------------------------------------------------------------------------
function pick(o: ComboOption): void {
  if (!selectable(o)) return;
  model.value = o.value;
  valueOnFocus = o.value;
  typed.value = false;
  emit('commit', o.value);
  close(true);
}
function move(delta: number): void {
  const n = shown.value.length;
  if (!n) return;
  let i = active.value;
  for (let step = 0; step < n; step++) {
    i = i < 0 ? (delta > 0 ? 0 : n - 1) : (i + delta + n) % n;
    if (selectable(shown.value[i])) break;
  }
  active.value = i;
  void scrollToActive();
}

function onKey(e: KeyboardEvent): void {
  if (props.disabled) return;
  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      e.preventDefault();
      if (!open.value) show();
      else move(e.key === 'ArrowDown' ? 1 : -1);
      break;
    case 'Home':
    case 'End':
      if (open.value && !props.searchable) {
        e.preventDefault();
        active.value = -1; // a partir de "nenhum": +1 vai ao primeiro, -1 ao último
        move(e.key === 'Home' ? 1 : -1);
      }
      break;
    case 'Enter':
      if (open.value && active.value >= 0) {
        e.preventDefault();
        pick(shown.value[active.value]!);
      } else if (props.searchable) {
        typed.value = false;
        valueOnFocus = model.value;
        emit('commit', model.value);
        close();
      } else {
        e.preventDefault();
        open.value ? close() : show();
      }
      break;
    case ' ':
      if (!props.searchable) {
        e.preventDefault();
        if (open.value && active.value >= 0) pick(shown.value[active.value]!);
        else open.value ? close() : show();
      }
      break;
    case 'Escape':
      if (open.value) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
      break;
    case 'Tab':
      close();
      break;
  }
}

// --- modo campo ---------------------------------------------------------------------------------------------------------
function onInput(e: Event): void {
  model.value = (e.target as HTMLInputElement).value;
  typed.value = true;
  active.value = -1;
  if (!open.value) show();
  else place();
}
function onFocus(): void {
  valueOnFocus = model.value;
  typed.value = false;
  show();
}
function onBlur(): void {
  close();
  typed.value = false;
  if (model.value !== valueOnFocus) {
    valueOnFocus = model.value;
    emit('commit', model.value);
  }
}
function toggle(): void {
  if (open.value) close();
  else show();
}
</script>

<template>
  <div ref="root" class="cbx" :class="{ 'cbx--mono': mono, 'cbx--pill': pill, 'cbx--block': block, 'cbx--open': open, 'cbx--field': searchable, 'cbx--disabled': disabled }">
    <template v-if="searchable">
      <input
        ref="field"
        class="cbx__input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        autocomplete="off"
        spellcheck="false"
        :value="model"
        :placeholder="placeholder"
        :title="title"
        :aria-label="ariaLabel ?? title"
        :aria-expanded="open"
        :aria-controls="listId"
        :aria-activedescendant="activeId"
        :disabled="disabled"
        @input="onInput"
        @focus="onFocus"
        @click="show"
        @blur="onBlur"
        @keydown="onKey"
      />
      <svg v-if="options.length" class="cbx__caret cbx__caret--field" viewBox="0 0 10 6" width="9" height="6" aria-hidden="true" @mousedown.prevent="toggle"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </template>
    <button
      v-else
      ref="field"
      type="button"
      class="cbx__btn"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-label="ariaLabel ?? title"
      :title="title"
      :disabled="disabled"
      @click="toggle"
      @keydown="onKey"
    >
      <span class="cbx__value"><slot name="value" :option="current">{{ current ? labelOf(current) : (placeholder ?? model) }}</slot></span>
      <svg class="cbx__caret" viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>

    <Teleport to="body">
      <ul v-if="open" :id="listId" ref="list" class="cbx__list" :class="{ 'cbx__list--mono': mono }" role="listbox" :aria-label="ariaLabel ?? title" :style="pos" @mousedown.prevent>
        <li
          v-for="(o, i) in shown"
          :id="`${listId}-${i}`"
          :key="o.value"
          role="option"
          class="cbx__opt"
          :class="{ 'cbx__opt--active': i === active, 'cbx__opt--selected': o.value === model, 'cbx__opt--disabled': o.disabled }"
          :aria-selected="o.value === model"
          :aria-disabled="o.disabled"
          @mousedown.prevent="pick(o)"
          @mousemove="!o.disabled && (active = i)"
        >
          <slot name="option" :option="o" :selected="o.value === model">
            <span class="cbx__label">{{ labelOf(o) }}</span>
            <span v-if="o.hint" class="cbx__hint">{{ o.hint }}</span>
          </slot>
          <svg v-if="o.value === model" class="cbx__check" viewBox="0 0 12 10" width="12" height="10" aria-hidden="true"><path d="M1 5.2l3.2 3.2L11 1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </li>
        <li v-if="!shown.length" class="cbx__note">{{ t('combo.none') }}</li>
        <li v-else-if="result.hidden > 0" class="cbx__note">{{ t('combo.more', { n: result.hidden }) }}</li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.cbx {
  position: relative; display: inline-flex; min-width: 0; font-size: 12px;
  &--field { display: flex; flex: 1; }
  &--block { display: flex; width: 100%; }
  &--block &__btn { flex: 1; justify-content: space-between; padding: 6px 9px; background: var(--gn-bg); font-size: 13px; }
  &--mono .cbx__btn, &--mono .cbx__input { font-family: var(--gn-mono); }
  &--disabled { opacity: 0.55; }
  &__btn {
    display: inline-flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 10px; font: inherit; color: var(--gn-text);
    background: var(--gn-surface); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); cursor: pointer;
    transition: border-color 0.12s;
    &:hover:not(:disabled), &[aria-expanded='true'] { border-color: var(--gn-accent); }
    &:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: 1px; }
    &:disabled { cursor: default; }
  }
  &--pill &__btn { border-radius: 999px; font-weight: 600; color: var(--gn-muted); &:hover:not(:disabled), &[aria-expanded='true'] { color: var(--gn-text); } }
  &__value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__input { flex: 1; min-width: 0; padding-right: 26px; font-size: inherit; }
  &__caret { flex: none; opacity: 0.7; &--field { position: absolute; right: 9px; top: 50%; margin-top: -3px; cursor: pointer; color: var(--gn-muted); } }
}
</style>

<!-- A lista está no <body> (Teleport): estilos globais com prefixo próprio, iguais aos do seletor de idioma. -->
<style lang="scss">
.cbx__list {
  position: fixed; z-index: 1101; /* acima dos diálogos (z-index 1100): o combobox também abre de dentro deles */ width: max-content; max-width: min(640px, 92vw); margin: 0; padding: 5px; list-style: none; overflow-y: auto;
  background: var(--gn-surface-2); border: 1px solid var(--gn-border); border-radius: 12px; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.38);
  font-size: 13px;
  &--mono { font-family: var(--gn-mono); font-size: 12px; }
}
.cbx__opt {
  display: flex; align-items: center; gap: 10px; padding: 6px 10px; color: var(--gn-text); border-radius: 8px; cursor: pointer;
  &--active { background: rgba(79, 134, 247, 0.18); }
  &--selected { font-weight: 600; }
  &--disabled { opacity: 0.45; cursor: default; }
}
.cbx__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cbx__hint { color: var(--gn-muted); font-size: 11px; white-space: nowrap; }
.cbx__check { flex: none; color: var(--gn-accent); }
.cbx__note { padding: 6px 10px; color: var(--gn-muted); font-size: 12px; }
</style>
