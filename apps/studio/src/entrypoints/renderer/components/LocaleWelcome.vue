<script setup lang="ts">
// Primeira abertura: escolha simples do idioma (nome nativo, o do sistema já marcado), ANTES da primeira tela. Escolher troca a interface na hora e
// grava a preferência; dá para pular ("Usar o idioma do sistema"). Só aparece quando não há nada guardado (quem atualiza de uma versão anterior já tem
// `gitnexus.locale` e não vê isto). A lista vem do catálogo (SUPPORTED_LOCALES). É um GnDialog: foco preso, Esc pula.
import { computed } from 'vue';
import { GnButton, GnDialog } from '@git-nexus/ui-kit';
import { LOCALES, locale, setLocalePref, t } from '../i18n';
import { LOCALE_ASKED_KEY } from '../i18n/core';

const emit = defineEmits<{ (e: 'done'): void }>();

const options = computed(() => LOCALES.map((l) => ({ id: l.id, label: l.label })));

function finish(): void {
  localStorage.setItem(LOCALE_ASKED_KEY, '1'); // não pergunta de novo, mesmo se a pessoa pulou
  emit('done');
}
function skip(): void {
  setLocalePref('system'); // o sistema continua valendo
  finish();
}
</script>

<template>
  <GnDialog width="min(420px, 92vw)" labelledby="welcome-title" initial-focus='input[type="radio"]:checked' @close="skip">
    <div class="lw" data-testid="locale-welcome">
      <h3 id="welcome-title">{{ t('welcome.title') }}</h3>
      <p class="lw__hint">{{ t('welcome.hint') }}</p>
      <fieldset class="lw__list">
        <legend class="lw__legend">{{ t('settings.language') }}</legend>
        <label v-for="o in options" :key="o.id" class="lw__opt" :class="{ 'lw__opt--on': o.id === locale }">
          <input type="radio" name="welcome-locale" :value="o.id" :checked="o.id === locale" @click="setLocalePref(o.id)" />
          {{ o.label }}
        </label>
      </fieldset>
      <div class="lw__btns">
        <GnButton type="button" data-testid="locale-welcome-skip" @click="skip">{{ t('welcome.skip') }}</GnButton>
        <GnButton type="button" variant="primary" data-testid="locale-welcome-continue" @click="finish">{{ t('welcome.continue') }}</GnButton>
      </div>
    </div>
  </GnDialog>
</template>

<style scoped lang="scss">
.lw {
  padding: 18px 20px;
  h3 { margin: 0 0 6px; font-size: 15px; }
  &__hint { margin: 0 0 12px; font-size: 12px; color: var(--gn-muted); }
  &__list { display: grid; gap: 6px; margin: 0 0 16px; padding: 0; border: 0; }
  &__legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); } // só para leitor de tela
  &__opt {
    display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer;
    background: var(--gn-surface-2); border: 1px solid var(--gn-border); border-radius: var(--gn-radius);
    &:hover, &--on { border-color: var(--gn-accent); }
  }
  &__btns { display: flex; justify-content: flex-end; gap: 8px; }
}
</style>
