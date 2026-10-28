// 图标候选生成（免费额度版）：pollinations.ai 免费层限「每 45 秒 1 张」，所以串行 + 退避重试。
// 用法：node scripts/dev/gen-icons.mjs [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'assets/icon-candidates';
mkdirSync(outDir, { recursive: true });

const BASE = 'https://image.pollinations.ai/prompt/';
const SUFFIX =
  ', app icon, centered, plain background, soft studio lighting, no text, no letters, no watermark, high quality';

const PROMPTS = [
  // 1 扁平贴纸：最贴近现在那只小鲸鱼，但线条与配色更精致
  'kawaii chibi baby blue whale mascot with white belly and tiny side fins, deepseek blue, happy smile, flat vector sticker style, thick clean outline',
  // 2 软 3D 玩偶：质感最好，缩到 32px 也认得出
  'adorable soft 3d render of a chibi blue whale plush mascot, glossy surface, big sparkly eyes, rosy cheeks, deepseek blue, rounded square icon',
  // 3 极简几何：小尺寸最清晰
  'minimal flat whale mascot logo, two tone blue, geometric rounded shapes, negative space, modern app icon',
  // 4 喷水小鲸鱼：辨识度最高
  'kawaii baby blue whale spouting a tiny water splash, chibi mascot, rounded square icon, blue gradient background, cute face',
  // 5 戴围巾的小鲸鱼：有点人格化、更"宠物"
  'chubby chibi whale mascot wearing a tiny knitted scarf, big cute eyes, pastel blue and white, flat vector illustration, rounded app icon',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 402 的正文会带 "Retry after Ns"，按它退避；其它错误重试两次。 */
async function fetchImage(url) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      const body = await res.text().catch(() => '');
      const retry = /Retry after (\d+)\s*s/i.exec(body);
      if (retry) {
        const wait = (Number(retry[1]) + 3) * 1000;
        console.log(`  … 免费额度冷却 ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      console.log('  … HTTP ' + res.status + ' ' + body.slice(0, 120));
      await sleep(5000);
    } catch (e) {
      console.log('  … 网络错误 ' + (e && e.message ? e.message : e));
      await sleep(5000);
    }
  }
  return null;
}

for (let i = 0; i < PROMPTS.length; i += 1) {
  const url =
    BASE + encodeURIComponent(PROMPTS[i] + SUFFIX) + '?width=768&height=768&nologo=true&seed=' + (i * 17 + 5);
  console.log(`生成候选 ${i + 1}/${PROMPTS.length} …`);
  const started = Date.now();
  const bytes = await fetchImage(url);
  if (!bytes) {
    console.log(`c${i + 1}: FAILED`);
    continue;
  }
  const file = join(outDir, `c${i + 1}.jpg`);
  writeFileSync(file, bytes);
  console.log(`c${i + 1}: ${bytes.length}B ${Date.now() - started}ms → ${file}`);
  await sleep(47_000); // 免费层：每 45 秒一张
}
