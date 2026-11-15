<script setup lang="ts">
// Bandeiras em SVG embutido: o Windows não desenha os emojis de bandeira (aparecem como letras "BR"/"US"), então não dá para usar texto.
// Os cantos arredondados vêm do próprio <span> (overflow hidden), sem <clipPath> com id, que quebra quando há várias bandeiras na página.
import type { FlagCode } from '../i18n';

defineProps<{ code: FlagCode }>();
const STRIPE = 16 / 13;
</script>

<template>
  <span class="flag" aria-hidden="true">
    <svg viewBox="0 0 24 16" width="20" height="14" focusable="false">
      <template v-if="code === 'br'">
        <rect width="24" height="16" fill="#009b3a" />
        <polygon points="12,1.7 22.2,8 12,14.3 1.8,8" fill="#fedf00" />
        <circle cx="12" cy="8" r="3.7" fill="#002776" />
        <path d="M8.5 7.3 Q12 6.1 15.5 8.9" fill="none" stroke="#fff" stroke-width="0.75" />
      </template>
      <template v-else>
        <rect width="24" height="16" fill="#fff" />
        <rect v-for="i in 7" :key="i" x="0" :y="(i - 1) * 2 * STRIPE" width="24" :height="STRIPE" fill="#b22234" />
        <rect width="10.5" :height="7 * STRIPE" fill="#3c3b6e" />
        <template v-for="r in 3" :key="r">
          <circle v-for="c in 4" :key="`${r}-${c}`" :cx="1.6 + (c - 1) * 2.4 + (r % 2 ? 0 : 1.2)" :cy="1.6 + (r - 1) * 2.2" r="0.5" fill="#fff" />
        </template>
      </template>
    </svg>
  </span>
</template>

<style scoped>
.flag { display: inline-block; flex: none; width: 20px; height: 14px; border-radius: 3px; overflow: hidden; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3); line-height: 0; }
.flag svg { display: block; }
</style>
