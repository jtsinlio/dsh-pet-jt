// pollinations 免费层的小客户端：**全局限速**（每 45 秒 1 张）+ 402/503 退避重试。
// 为什么单独抽出来：免费层是按 IP 计数的，任何"并发/循环里直接 fetch"都会被 402 打回；
// 所有请求必须走同一个闸门（记录上一次请求时刻），否则退避算不准。
const BASE = 'https://image.pollinations.ai/prompt/';
const GAP_MS = 48_000;

let lastAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等到"距离上一次请求满 48 秒"再发车 */
async function gate() {
  const wait = lastAt + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
}

/**
 * 生成一张图。
 * @param {string} prompt 提示词
 * @param {{seed?: number, size?: number, retries?: number, onWait?: (s: number) => void}} [opts]
 * @returns {Promise<Buffer|null>} 成功返回图片字节，失败返回 null
 */
export async function generateImage(prompt, opts = {}) {
  const size = opts.size ?? 768;
  const retries = opts.retries ?? 10;
  const url =
    BASE +
    encodeURIComponent(prompt) +
    `?width=${size}&height=${size}&nologo=true&seed=${opts.seed ?? 1}`;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    await gate();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      const body = await res.text().catch(() => '');
      const retry = /Retry after (\d+)\s*s/i.exec(body);
      if (retry) {
        const wait = (Number(retry[1]) + 2) * 1000;
        opts.onWait?.(Math.round(wait / 1000));
        await sleep(wait);
        continue;
      }
      if (res.status === 503) {
        opts.onWait?.(15);
        await sleep(15_000);
        continue;
      }
      console.log('  … HTTP ' + res.status + ' ' + body.slice(0, 100));
      await sleep(10_000);
    } catch (e) {
      console.log('  … 网络错误 ' + (e && e.message ? e.message : e));
      await sleep(10_000);
    }
  }
  return null;
}
