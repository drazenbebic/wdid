import chalk from 'chalk';

declare const __VERSION__: string;

const isoArt = String.raw`      ___           ___                       ___
     /\__\         /\  \          ___        /\  \
    /:/ _/_       /::\  \        /\  \      /::\  \
   /:/ /\__\     /:/\:\  \       \:\  \    /:/\:\  \
  /:/ /:/ _/_   /:/  \:\__\      /::\__\  /:/  \:\__\
 /:/_/:/ /\__\ /:/__/ \:|__|  __/:/\/__/ /:/__/ \:|__|
 \:\/:/ /:/  / \:\  \ /:/  / /\/:/  /    \:\  \ /:/  /
  \::/_/:/  /   \:\  /:/  /  \::/__/      \:\  /:/  /
   \:\/:/  /     \:\/:/  /    \:\__\       \:\/:/  /
    \::/  /       \::/__/      \/__/        \::/__/
     \/__/         ~~                        ~~`;

function gradientPaint(
  text: string,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): string {
  const lines = text.split('\n');
  const maxY = Math.max(lines.length - 1, 1);
  const maxX = Math.max(1, ...lines.map(l => l.length - 1));

  return lines
    .map((line, y) =>
      Array.from(line, (ch, x) => {
        if (ch === ' ') {
          return ch;
        }

        const t = (y / maxY + x / maxX) / 2;
        const r = Math.round(from[0] + (to[0] - from[0]) * t);
        const g = Math.round(from[1] + (to[1] - from[1]) * t);
        const b = Math.round(from[2] + (to[2] - from[2]) * t);

        return chalk.rgb(r, g, b)(ch);
      }).join(''),
    )
    .join('\n');
}

export const banner =
  gradientPaint(isoArt, [34, 211, 238], [217, 70, 239]) +
  '  ' +
  chalk.rgb(217, 70, 239)(`v${__VERSION__}`) +
  '\n';
