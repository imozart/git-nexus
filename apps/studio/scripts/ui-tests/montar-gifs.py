#!/usr/bin/env python3
"""Monta os GIFs de docs/media a partir dos quadros que `tests/media.mjs` grava (<cena>-<n>.png).

    python apps/studio/scripts/ui-tests/montar-gifs.py <pasta-dos-quadros> <pasta-de-saida>

Cada GIF é uma apresentação de poucos quadros (3 a 5), de 1,5 a 3 s cada, em loop. O `commit-linter.png` (usado na página do projeto e no
manifesto do Flatpak, scripts/lib/flatpak.mjs) é o quadro da mensagem aprovada. Precisa de Pillow (`pip install pillow`).
"""
import sys
from pathlib import Path

from PIL import Image

# cena -> duração (ms) de cada quadro
CENAS = {
    'commit-linter': [2200, 2200, 3000, 3000, 3000],
    'conflito': [2600, 3200, 2600, 3200],
    'desfazer': [3000, 3000, 3000],
    'paleta': [2200, 2000, 2000, 3000],
    'rebase': [3000, 3000, 2600, 3000],
    'stage-por-linha': [3000, 2200, 3000, 3000],
}
PNG = ('commit-linter', 4)  # (cena, quadro) que vira commit-linter.png


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    for cena, tempos in CENAS.items():
        quadros = [Image.open(src / f'{cena}-{i}.png').convert('RGB') for i in range(1, len(tempos) + 1)]
        # paleta adaptativa por quadro: o texto fica nítido e o arquivo, pequeno
        pal = [q.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for q in quadros]
        pal[0].save(dst / f'{cena}.gif', save_all=True, append_images=pal[1:], duration=tempos, loop=0, optimize=True, disposal=1)
        print(f'{cena}.gif: {len(quadros)} quadros, {(dst / f"{cena}.gif").stat().st_size // 1024} KB')
    cena, n = PNG
    Image.open(src / f'{cena}-{n}.png').convert('RGB').save(dst / 'commit-linter.png', optimize=True)
    print('commit-linter.png ok')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
