<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { makePieces, pieceAt, pieceCount, rainFinished } from '../confetti-core';

// Chuva de confete do topo ao rodapé (como no GitHub Discussions). Puramente decorativa: fica por cima de tudo, não captura o mouse
// e não é anunciada por leitor de tela (o aviso "atualizado para a versão X" já cumpre esse papel).
const emit = defineEmits<{ (e: 'done'): void }>();

const canvas = ref<HTMLCanvasElement | null>(null);
let raf = 0;

onMounted(() => {
  const el = canvas.value;
  const ctx = el?.getContext('2d');
  // "Reduzir movimento" no sistema: sem animação (e sem canvas disponível, idem)
  if (!el || !ctx || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    emit('done');
    return;
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  el.width = Math.round(width * dpr);
  el.height = Math.round(height * dpr);
  ctx.scale(dpr, dpr);

  const pieces = makePieces(pieceCount(width), width);
  let start = 0;

  function frame(now: number): void {
    start ||= now;
    const ms = now - start;
    ctx!.clearRect(0, 0, width, height);
    for (const p of pieces) {
      const pose = pieceAt(p, ms, height);
      if (!pose.visible) continue;
      ctx!.save();
      ctx!.translate(pose.x, pose.y);
      ctx!.rotate(pose.rot);
      ctx!.fillStyle = p.color;
      if (p.round) {
        ctx!.beginPath();
        ctx!.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx!.fill();
      } else {
        ctx!.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx!.restore();
    }
    if (rainFinished(pieces, ms, height)) emit('done');
    else raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
});

onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <canvas ref="canvas" class="confetti" aria-hidden="true" />
</template>

<style scoped lang="scss">
.confetti {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  z-index: 3000; // acima dos diálogos (1100) e da paleta de comandos
  pointer-events: none;
}
</style>
