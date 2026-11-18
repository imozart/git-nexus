<script setup lang="ts">
// Combobox padrão do app, no visual do seletor de idioma: botão (ou campo) com seta e lista flutuante de cantos arredondados,
// item atual marcado, teclado completo. Substitui <select> e <datalist> nativos, cujas listas o sistema desenha e não dá para estilizar.
//
//  - modo seleção (padrão): botão + lista; `v-model` é o `value` da opção escolhida.
//  - modo `searchable`: campo de texto livre com sugestões filtradas (ex.: caminho de arquivo). A lista mostra no máximo `max` itens
//    (o <datalist> nativo criava um <option> por arquivo e travava o app em repositórios grandes).
//  - `filterable` (só no modo seleção): a lista ganha um campo de busca no topo que filtra as opções; o valor continua sendo sempre uma opção da lista
//    (diferente do `searchable`, em que o texto digitado é o valor).
//  - opções com `group`: a lista mostra o título do grupo antes do primeiro item dele (as opções do mesmo grupo vêm juntas).
//  - `collapsibleGroups`: o título do grupo vira um botão que expande e recolhe os itens, com a seta que gira (como os cartões de Novidades);
//    `collapsedGroups` diz quais começam recolhidos. Uma busca (`filterable`) mostra todos os resultados, e o grupo do valor atual abre sozinho.
//
// A lista vai para o <body> (Teleport) com posição fixa: não é cortada por painéis com rolagem e abre para cima se faltar espaço.
import { computed, nextTick, onBeforeUnmount, ref, watch, type CSSProperties } from 'vue';
import { GnIcon } from '@git-nexus/ui-kit';
import { DEFAULT_MAX, filterOptions, labelOf, optionOf, sortByGroup, type ComboInput, type ComboOption } from '../combo-core';
import { t } from '../i18n';

const props = withDefaults(
  defineProps<{
    options: readonly ComboInput[];
    searchable?: boolean;
    /** Modo seleção com busca: a lista abre com um campo de busca no topo que filtra as opções (o valor continua sendo uma opção). */
    filterable?: boolean;
    /** Os títulos de grupo viram botões que expandem e recolhem os itens do grupo. */
    collapsibleGroups?: boolean;
    /** Grupos que começam recolhidos (com `collapsibleGroups`). */
    collapsedGroups?: readonly string[];
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
  { searchable: false, filterable: false, collapsibleGroups: false, collapsedGroups: () => [], align: 'left', max: DEFAULT_MAX },
);
const model = defineModel<string>({ default: '' });
/** O usuário confirmou um valor: escolheu na lista, deu Enter ou saiu do campo com o texto alterado. */
const emit = defineEmits<{ commit: [value: string] }>();

const listId = `cbx-${Math.random().toString(36).slice(2, 9)}`;
const root = ref<HTMLElement>();
const field = ref<HTMLInputElement | HTMLButtonElement>();
const list = ref<HTMLElement>();
const searchEl = ref<HTMLInputElement>();
/** Texto do campo de busca da lista (modo `filterable`). */
const query = ref('');
const open = ref(false);
const active = ref(-1);
/** No modo `searchable`: a lista só filtra pelo texto depois que o usuário digita (ao abrir, mostra as primeiras). */
const typed = ref(false);
let valueOnFocus = '';

const normalized = computed(() => (props.searchable ? [] : props.options.map(optionOf)));
const current = computed<ComboOption | undefined>(() => normalized.value.find((o) => o.value === model.value));
const result = computed(() => {
  if (props.searchable) return filterOptions(props.options, typed.value ? model.value : '', props.max);
  if (props.filterable && query.value.trim()) {
    const r = filterOptions(props.options, query.value, props.max);
    return { ...r, items: sortByGroup(props.options, r.items) }; // o filtro ordena por relevância: os grupos voltam juntos
  }
  return { items: normalized.value, total: normalized.value.length, hidden: 0 };
});
/** Grupos recolhidos agora (a cada abertura volta ao que `collapsedGroups` diz). */
const collapsed = ref(new Set<string>());
const searching = computed(() => props.filterable && query.value.trim() !== '');
/** Com busca ativa todos os resultados aparecem, mesmo de grupo recolhido. */
const isCollapsed = (g?: string): boolean => !!g && props.collapsibleGroups && !searching.value && collapsed.value.has(g);
/** Só os itens visíveis: é neles que valem o teclado e os índices de `active`. */
const shown = computed(() => result.value.items.filter((o) => !isCollapsed(o.group)));
type Row = { kind: 'group'; name: string; open: boolean; count: number } | { kind: 'opt'; o: ComboOption; i: number };
/** As linhas da lista, na ordem: título de grupo (mesmo recolhido, com a contagem) e os itens visíveis dele. */
const rows = computed<Row[]>(() => {
  const counts = new Map<string, number>();
  for (const o of result.value.items) if (o.group) counts.set(o.group, (counts.get(o.group) ?? 0) + 1);
  const out: Row[] = [];
  let last = '';
  let i = 0;
  for (const o of result.value.items) {
    if (o.group && o.group !== last) out.push({ kind: 'group', name: o.group, open: !isCollapsed(o.group), count: counts.get(o.group) ?? 0 });
    last = o.group ?? '';
    if (!isCollapsed(o.group)) out.push({ kind: 'opt', o, i: i++ });
  }
  return out;
});
function toggleGroup(name: string): void {
  if (!props.collapsibleGroups) return;
  const next = new Set(collapsed.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  collapsed.value = next;
  active.value = -1;
  void nextTick(place); // a altura da lista mudou (pode abrir para cima)
}
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
  query.value = '';
  collapsed.value = new Set(props.collapsedGroups);
  const cur = props.searchable ? undefined : props.options.map(optionOf).find((o) => o.value === model.value);
  if (cur?.group) collapsed.value.delete(cur.group); // o grupo do valor atual abre sozinho
  active.value = props.searchable ? -1 : shown.value.findIndex((o) => o.value === model.value);
  document.addEventListener('mousedown', onDocDown, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);
  void scrollToActive();
  if (props.filterable) void nextTick(() => searchEl.value?.focus()); // a digitação vai direto para a busca
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
      if (open.value && !props.searchable && !props.filterable) {
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
        close(props.filterable); // com a busca aberta o foco está nela: volta para o botão
      }
      break;
    case 'Tab':
      close(props.filterable);
      break;
  }
}

// --- busca dentro da lista (modo `filterable`) ---------------------------------------------------------------------------
/** A busca só trata o que move a lista; o resto (letras, espaço, Home, End) é digitação no campo. */
function onSearchKey(e: KeyboardEvent): void {
  if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) onKey(e);
}
function onSearchInput(e: Event): void {
  query.value = (e.target as HTMLInputElement).value;
  active.value = shown.value.findIndex(selectable); // Enter escolhe o primeiro resultado
  place();
  void scrollToActive();
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
        <li v-if="filterable" class="cbx__search" role="presentation">
          <input
            ref="searchEl"
            type="text"
            role="searchbox"
            autocomplete="off"
            spellcheck="false"
            :value="query"
            :placeholder="t('combo.search')"
            :aria-label="t('combo.search')"
            :aria-controls="listId"
            :aria-activedescendant="activeId"
            @mousedown.stop
            @input="onSearchInput"
            @keydown="onSearchKey"
          />
        </li>
        <template v-for="r in rows" :key="r.kind === 'group' ? 'g:' + r.name : r.o.value">
          <li
            v-if="r.kind === 'group'"
            class="cbx__group"
            :class="{ 'cbx__group--toggle': collapsibleGroups }"
            :role="collapsibleGroups ? 'button' : 'presentation'"
            :aria-expanded="collapsibleGroups ? r.open : undefined"
            :tabindex="collapsibleGroups ? -1 : undefined"
            @mousedown.prevent="toggleGroup(r.name)"
          >
            <GnIcon v-if="collapsibleGroups" class="cbx__chev" name="chevron-right" />
            <span class="cbx__group-name">{{ r.name }}</span>
            <span v-if="collapsibleGroups" class="cbx__group-count">{{ r.count }}</span>
          </li>
          <li
            v-else
            :id="`${listId}-${r.i}`"
            role="option"
            class="cbx__opt"
            :class="{ 'cbx__opt--active': r.i === active, 'cbx__opt--selected': r.o.value === model, 'cbx__opt--disabled': r.o.disabled }"
            :aria-selected="r.o.value === model"
            :aria-disabled="r.o.disabled"
            @mousedown.prevent="pick(r.o)"
            @mousemove="!r.o.disabled && (active = r.i)"
          >
            <slot name="option" :option="r.o" :selected="r.o.value === model">
              <span class="cbx__label">{{ labelOf(r.o) }}</span>
              <span v-if="r.o.hint" class="cbx__hint">{{ r.o.hint }}</span>
            </slot>
            <svg v-if="r.o.value === model" class="cbx__check" viewBox="0 0 12 10" width="12" height="10" aria-hidden="true"><path d="M1 5.2l3.2 3.2L11 1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </li>
        </template>
        <li v-if="!result.items.length" class="cbx__note">{{ t('combo.none') }}</li>
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
.cbx__search { position: sticky; top: -5px; z-index: 1; margin: -5px -5px 4px; padding: 6px 5px 6px; background: var(--gn-surface-2); border-radius: 12px 12px 0 0; input { width: 100%; font-size: 12px; } }
.cbx__group { display: flex; align-items: center; gap: 6px; padding: 8px 10px 3px; color: var(--gn-muted); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; cursor: default; }
// título de grupo recolhível: um cartão pequeno (contorno, cantos, seta que gira ao abrir), como as versões do diálogo Novidades
.cbx__group--toggle { margin: 4px 0 2px; padding: 6px 10px; border: 1px solid var(--gn-border); border-radius: 8px; color: var(--gn-text); font-size: 12px; letter-spacing: 0; text-transform: none; cursor: pointer; user-select: none; &:hover, &[aria-expanded='true'] { border-color: var(--gn-accent); } }
.cbx__chev { flex: none; color: var(--gn-muted); transition: transform 140ms ease-out; }
.cbx__group[aria-expanded='true'] .cbx__chev { transform: rotate(90deg); }
.cbx__group-name { flex: 1; }
.cbx__group-count { color: var(--gn-muted); font-size: 11px; font-weight: 400; }
.cbx__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cbx__hint { color: var(--gn-muted); font-size: 11px; white-space: nowrap; }
.cbx__check { flex: none; color: var(--gn-accent); }
.cbx__note { padding: 6px 10px; color: var(--gn-muted); font-size: 12px; }
</style>
