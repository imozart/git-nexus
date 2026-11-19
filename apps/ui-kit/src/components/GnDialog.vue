<script setup lang="ts">
// Diálogo modal: fundo escurecido, caixa com elevação, foco preso, Esc, clique no fundo, devolução do foco e fundo inerte. Uma cópia só do
// comportamento no lugar do overlay repetido em cada diálogo. O pai continua dono do estado (v-if): aqui só sai o evento "close".
//
// Decisão: é um <div role="dialog"> projetado no <body>, NÃO o <dialog> nativo com showModal(). O modal nativo entra na top layer e fica acima de
// qualquer z-index, escondendo os menus do app (ComboBox, ContextMenu) que também vivem no <body>. Regra de camadas: um menu aberto de dentro de
// um diálogo precisa de z-index >= var(--gn-z-dialog). Hoje nenhum abre (o ComboBox usa 80 e fica como está).
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { FOCUSABLE, dialogStack, newDialogId, nextFocusIndex } from '../dialog-core';

const props = withDefaults(
  defineProps<{
    /** Largura da caixa (CSS). */
    width?: string;
    /** Altura máxima (CSS); a caixa é uma coluna flex e o conteúdo rola por conta do diálogo. */
    maxHeight?: string;
    /** "alertdialog" para confirmações. */
    role?: 'dialog' | 'alertdialog';
    /** id do título (vira aria-labelledby). Informe este OU "label". */
    labelledby?: string;
    /** Nome acessível direto (aria-label), para diálogo sem título visível com id. */
    label?: string;
    /** id do texto descritivo (aria-describedby). */
    describedby?: string;
    /** Se verdadeiro, Esc e clique no fundo emitem "close". */
    dismissable?: boolean;
    /** Seletor de quem recebe o foco ao abrir; padrão: o primeiro elemento focável. Se nada casar, a própria caixa. */
    initialFocus?: string;
  }>(),
  { width: 'min(520px, 92vw)', maxHeight: '90vh', role: 'dialog', dismissable: true },
);
const emit = defineEmits<{ (e: 'close', reason: 'escape' | 'backdrop'): void }>();

const id = newDialogId();
const box = ref<HTMLElement>();
let opener: HTMLElement | null = null;

const focusables = () => [...(box.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.getClientRects().length > 0);

/** Esc e Tab, na fase de captura: só o diálogo do topo trata, e o Esc não chega ao App nem à paleta. */
function onKey(e: KeyboardEvent) {
  if (!dialogStack.isTop(id)) return;
  if (e.key === 'Escape') {
    // um controle de dentro da caixa com a lista aberta (aria-expanded="true": combobox, menu) trata o Esc primeiro: fecha a lista, não o diálogo.
    // Procura o controle na caixa (e não pelo foco): a lista do ComboBox é projetada no <body> e o foco pode estar no campo de busca dela, fora da caixa.
    if (box.value?.querySelector('[aria-expanded="true"]')) return;
    e.stopPropagation();
    e.preventDefault();
    if (props.dismissable) emit('close', 'escape');
    return;
  }
  if (e.key !== 'Tab') return;
  const list = focusables();
  const next = nextFocusIndex(list.length, list.indexOf(document.activeElement as HTMLElement), e.shiftKey);
  e.preventDefault();
  (next < 0 ? box.value : list[next])?.focus();
}

// Fechar por clique no fundo só vale se o mousedown E o mouseup foram no fundo: soltar o mouse fora depois de selecionar texto não fecha.
let downOnBackdrop = false;
const onDown = (e: MouseEvent) => { downOnBackdrop = e.target === e.currentTarget; };
const onUp = (e: MouseEvent) => {
  const ok = downOnBackdrop && e.target === e.currentTarget;
  downOnBackdrop = false;
  if (ok && props.dismissable) emit('close', 'backdrop');
};

onMounted(() => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialogStack.push(id);
  // o fundo (#app) fica inerte para teclado e leitor de tela; os diálogos vivem no <body>, fora dele, e continuam interativos
  document.getElementById('app')?.setAttribute('inert', '');
  document.addEventListener('keydown', onKey, true);
  const target = (props.initialFocus ? box.value?.querySelector<HTMLElement>(props.initialFocus) : null) ?? focusables()[0] ?? box.value;
  target?.focus();
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey, true);
  dialogStack.remove(id);
  if (dialogStack.size() === 0) document.getElementById('app')?.removeAttribute('inert');
  if (opener && opener !== document.body && document.contains(opener)) opener.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="gn-dlg" @mousedown="onDown" @mouseup="onUp">
      <div
        ref="box"
        class="gn-dlg__box"
        :role="role"
        aria-modal="true"
        :aria-labelledby="labelledby"
        :aria-label="label"
        :aria-describedby="describedby"
        tabindex="-1"
        :style="{ width, maxHeight }"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.gn-dlg {
  position: fixed;
  inset: 0;
  z-index: var(--gn-z-dialog);
  display: grid;
  place-items: center;
  background: var(--gn-backdrop);
  animation: gn-fade-in var(--gn-enter) ease-out;

  &__box {
    background: var(--gn-surface);
    border: 1px solid var(--gn-border);
    border-radius: var(--gn-radius-lg);
    box-shadow: var(--gn-shadow-lg);
    display: flex;
    flex-direction: column;
    max-width: 100%;
    outline: none;
    animation: gn-pop-in var(--gn-enter) ease-out;
  }
}
</style>
