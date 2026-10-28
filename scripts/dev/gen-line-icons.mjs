// 第二批候选：极简线条 logo × Q 版可爱小鲸鱼（10 张）。
//
// 两段式：
//   1) 生图：flux/sana 对"line art"不敏感，但对「coloring book page / black lines on white」
//      这种"具体媒介"描述很听话 → 先用它拿到**粗描边的涂色书插画**；
//   2) 后处理（prepare-line-icons.mjs）：拉普拉斯边缘 + 阈值 → 只留轮廓线 → 染品牌蓝，
//      才是真正"极简线条"的成品。
//
// 免费层：每 45 秒 1 张（全局限速走 ./pollinations.mjs），10 张约 9 分钟。
// 用法：node scripts/dev/gen-line-icons.mjs [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateImage } from './pollinations.mjs';

const outDir = process.argv[2] ?? 'assets/icon-candidates/line';
mkdirSync(outDir, { recursive: true });

const PREFIX =
  'coloring book page, black lines only on white paper, thick clean strokes, no shading, ';
const SUFFIX = ', simple outline drawing, centered, no text, no watermark';

const PROMPTS = [
  'cute chibi baby whale, big round body, tiny tail fin, one dot eye, small smile',
  'cute chibi whale spouting a little water splash, tiny fins',
  'chibi whale wearing a tiny beanie hat and scarf, cute',
  'kawaii whale face inside a circle, two dot eyes, tiny smile',
  'whale curled into a circle, tail near its head, cute outline',
  'chibi whale holding a small heart, simple strokes',
  'chubby whale lying on its belly, tiny side fins, happy face',
  'baby whale with a tiny fish friend swimming beside it',
  'chibi whale wearing round glasses, cute nerdy look',
  'sleeping chibi whale with three z letters above, cozy',
];

for (let i = 0; i < PROMPTS.length; i += 1) {
  const prompt = PREFIX + PROMPTS[i] + SUFFIX;
  console.log(`生成 ${i + 1}/${PROMPTS.length} …`);
  const started = Date.now();
  const bytes = await generateImage(prompt, {
    seed: i * 41 + 211,
    onWait: (s) => console.log(`  … 冷却 ${s}s`),
  });
  if (!bytes) {
    console.log(`l${i + 1}: FAILED`);
    continue;
  }
  writeFileSync(join(outDir, `l${i + 1}.jpg`), bytes);
  console.log(`l${i + 1}: ${bytes.length}B ${Date.now() - started}ms`);
}
console.log('DONE');
