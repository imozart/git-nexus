<script setup lang="ts">
// Campo de pesquisa do app: UM campo com os controles DENTRO dele (✕ limpar, Aa maiúsculas, ab palavra inteira, .* expressão regular), no lugar de
// um <input> solto com três botões ao lado. Texto só por props (o kit não tem i18n); só tokens --gn-*.
//
//   <GnSearchField v-model="texto" v-model:case-sensitive="aa" v-model:whole-word="ab" v-model:regex="re"
//                  label="Pesquisar" :labels="{ clear, caseSensitive, wholeWord, regex }" :error="erroDaRegex" @enter="(voltar) => ir(voltar)" />
//
// `variant="replace"` é o campo "Substituir por": só o ✕ (e a caixa é sempre mantida na substituição).
//
// Acessibilidade: o campo é `role="searchbox"`; cada opção é um botão com `aria-pressed` e `aria-keyshortcuts`, com dica que traz o NOME e o ATALHO; ligado
// aparece com fundo e sublinhado (nunca só cor). O erro é um `role="alert"` ligado ao campo por `aria-describedby` (+ `aria-invalid`).
// Teclado: Enter / Shift+Enter (`enter`), Esc (`escape`), ↑/↓ percorrem o histórico (`history`), Alt+C / Alt+O / Alt+X ligam as opções
// (⌘+Alt no macOS; o AltGr dos teclados ABNT2/ISO nunca é atalho: ele digita, ver search-field-core.ts).
import { computed, nextTick, ref, useId } from 'vue';
import GnIcon from './GnIcon.vue';
import GnTooltip from './GnTooltip.vue';
import { ariaShortcut, fieldRows, stepHistory, toggleForKey, toggleTip, type HistoryCursor, type SearchToggle } from '../search-field-core';

export interface GnSearchLabels {
  /** Nome do botão ✕ (apaga o texto). */
  clear: string;
  caseSensitive: string;
  wholeWord: string;
  regex: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
    variant?: 'search' | 'replace';
    /** Nome do campo para leitor de tela (obrigatório: não há texto visível). */
    label: string;
    labels: GnSearchLabels;
    placeholder?: string;
    /** Mensagem de erro (regex inválida): borda de erro e `role="alert"`. Vazio: sem erro. */
    error?: string;
    /** Buscas anteriores (a mais nova por último), percorridas com ↑ e ↓. */
    history?: readonly string[];
    /** ⌘ no lugar de Ctrl nos atalhos. Sem valor: detecta pelo sistema. */
    mac?: boolean;
    disabled?: boolean;
  }>(),
  { caseSensitive: false, wholeWord: false, regex: false, variant: 'search', placeholder: '', error: '', history: () => [], mac: undefined, disabled: false },
);
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void;
  (e: 'update:caseSensitive', v: boolean): void;
  (e: 'update:wholeWord', v: boolean): void;
  (e: 'update:regex', v: boolean): void;
  /** Enter (`backwards` = Shift+Enter). */
  (e: 'enter', backwards: boolean): void;
  (e: 'escape'): void;
}>();

const input = ref<HTMLTextAreaElement>();
const errId = useId();
const isMac = computed(() => props.mac ?? (typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform)));
const rows = computed(() => fieldRows(props.modelValue));
let cursor: HistoryCursor = { index: -1, draft: '' };

const toggles = computed(() => {
  if (props.variant !== 'search') return [];
  return [
    { key: 'case' as SearchToggle, text: 'Aa', name: props.labels.caseSensitive, on: props.caseSensitive, test: 'sf-case', cls: 'is-case' },
    { key: 'word' as SearchToggle, text: 'ab', name: props.labels.wholeWord, on: props.wholeWord, test: 'sf-word', cls: 'is-word' },
    { key: 'regex' as SearchToggle, text: '.*', name: props.labels.regex, on: props.regex, test: 'sf-regex', cls: 'is-regex' },
  ];
});

function flip(t: SearchToggle): void {
  if (t === 'case') emit('update:caseSensitive', !props.caseSensitive);
  else if (t === 'word') emit('update:wholeWord', !props.wholeWord);
  else emit('update:regex', !props.regex);
}

function onInput(e: Event): void {
  cursor = { index: -1, draft: '' };
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value);
}

/** ✕: apaga o texto como uma EDIÇÃO do campo (Ctrl+Z traz de volta), devolve o foco e não mexe nas opções. */
function clear(): void {
  const el = input.value;
  if (!el) return;
  el.focus();
  el.select();
  // `delete` mantém a pilha de desfazer do navegador; sem suporte (ou sem efeito), apaga direto
  if (!document.execCommand?.('delete') || el.value) {
    el.value = '';
    emit('update:modelValue', '');
  }
}

/** A seta só percorre o histórico quando o cursor está na primeira (↑) ou na última (↓) linha: nas outras, move o cursor do texto de várias linhas. */
function onArrow(e: KeyboardEvent, dir: -1 | 1): void {
  const el = e.target as HTMLTextAreaElement;
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
  const before = el.value.slice(0, el.selectionStart);
  const after = el.value.slice(el.selectionEnd);
  if (dir === -1 ? /[\r\n]/.test(before) : /[\r\n]/.test(after)) return;
  const step = stepHistory(props.history, cursor, props.modelValue, dir);
  if (!step) return;
  e.preventDefault();
  cursor = step.cursor;
  emit('update:modelValue', step.value);
  void nextTick(() => input.value?.setSelectionRange(step.value.length, step.value.length));
}

function onKeydown(e: KeyboardEvent): void {
  const t = toggleForKey(e, isMac.value);
  if (t && props.variant === 'search') {
    e.preventDefault();
    flip(t);
    return;
  }
  if (e.target !== input.value) return;
  if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
    e.preventDefault();
    emit('enter', e.shiftKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    emit('escape');
  } else if (e.key === 'ArrowUp') onArrow(e, -1);
  else if (e.key === 'ArrowDown') onArrow(e, 1);
}

defineExpose({
  focus: () => input.value?.focus(),
  /** Foca e seleciona o texto (abrir a busca de novo com um texto já digitado). */
  select: () => {
    input.value?.focus();
    input.value?.select();
  },
});
</script>

<template>
  <div class="gn-sf-wrap">
  <div class="gn-sf" :class="{ 'gn-sf--error': !!error, 'gn-sf--disabled': disabled }" data-testid="search-field" @keydown="onKeydown">
    <textarea
      ref="input"
      class="gn-sf__input"
      role="searchbox"
      aria-multiline="true"
      :aria-label="label"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errId : undefined"
      :rows="rows"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      wrap="off"
      data-testid="sf-input"
      @input="onInput"
    ></textarea>
    <div class="gn-sf__ctrls">
      <button v-if="modelValue" type="button" class="gn-sf__btn gn-sf__btn--clear" :aria-label="labels.clear" :disabled="disabled" data-testid="sf-clear" @click="clear">
        <GnIcon name="x" :size="12" />
        <GnTooltip :text="labels.clear" />
      </button>
      <button
        v-for="b in toggles"
        :key="b.key"
        type="button"
        class="gn-sf__btn gn-sf__btn--toggle"
        :class="[b.cls, { 'is-on': b.on }]"
        :aria-label="b.name"
        :aria-pressed="b.on"
        :aria-keyshortcuts="ariaShortcut(b.key, isMac)"
        :disabled="disabled"
        :data-testid="b.test"
        @click="flip(b.key)"
      >
        <span aria-hidden="true">{{ b.text }}</span>
        <GnTooltip :text="toggleTip(b.name, b.key, isMac)" />
      </button>
    </div>
  </div>
  <div v-if="error" :id="errId" class="gn-sf__error" role="alert" data-testid="sf-error">{{ error }}</div>
  </div>
</template>

<style scoped lang="scss">
.gn-sf-wrap { min-width: 0; }
.gn-sf {
  display: flex; align-items: flex-start; gap: 2px; min-width: 0;
  background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius-sm);
  padding: 0 3px 0 0; transition: border-color var(--gn-motion-fast), box-shadow var(--gn-motion-fast);
  &:hover:not(.gn-sf--disabled) { border-color: color-mix(in srgb, var(--gn-accent) 45%, var(--gn-border)); }
  &:focus-within { border-color: var(--gn-accent); box-shadow: var(--gn-ring); }
  &--error, &--error:hover:not(.gn-sf--disabled), &--error:focus-within { border-color: var(--gn-danger); }
  &--error:focus-within { box-shadow: 0 0 0 3px color-mix(in srgb, var(--gn-danger) 30%, transparent); }
  &--disabled { opacity: 0.55; }
}
// o texto ocupa o que sobra ao lado dos botões (que são IRMÃOS, não flutuam sobre ele): texto longo nunca passa por baixo dos controles
.gn-sf__input {
  flex: 1 1 auto; min-width: 0; box-sizing: border-box; resize: none; overflow: hidden; border: 0; outline: none; background: transparent; color: var(--gn-text);
  font: inherit; font-family: var(--gn-mono); font-size: 12.5px; line-height: 18px; padding: 4px 8px; white-space: pre; text-overflow: ellipsis;
  &::placeholder { color: var(--gn-muted); }
}
.gn-sf__ctrls { display: flex; align-items: center; flex: none; gap: 1px; height: 26px; }
// botões de 24 px, sem borda em repouso
.gn-sf__btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; flex: none;
  min-width: 24px; height: 24px; padding: 0 3px; border: 1px solid transparent; border-radius: var(--gn-radius-sm); background: transparent; color: var(--gn-muted);
  font-family: var(--gn-mono); font-size: 11.5px; font-weight: 600; line-height: 1; cursor: pointer;
  transition: background var(--gn-motion-fast), color var(--gn-motion-fast);
  &:hover:not(:disabled) { background: color-mix(in srgb, var(--gn-mix) 10%, transparent); color: var(--gn-text); }
  &:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: -2px; }
  &:disabled { cursor: default; }
}
// ligado: fundo translúcido E sublinhado (não depende só de cor)
.gn-sf__btn--toggle.is-on {
  background: color-mix(in srgb, var(--gn-accent) 24%, transparent); color: var(--gn-text); border-color: color-mix(in srgb, var(--gn-accent) 55%, transparent);
  box-shadow: inset 0 -2px 0 var(--gn-accent);
}
.gn-sf__error { margin-top: 3px; color: var(--gn-danger); font-size: 11.5px; line-height: 1.35; }
</style>
