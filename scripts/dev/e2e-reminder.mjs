// 端到端验证：定时提醒是否真的写进 /state 的 say 叶子（= 前端对话气泡的数据源）。
// 用法：node test-reminder.mjs
// 流程：读成品配置 → 排一条"下一分钟"的提醒 → 轮询 /state 等它出现 → 恢复原配置。
const BASE = 'http://127.0.0.1:59791/dsh-pet-jt-7340';

const pad = (n) => String(n).padStart(2, '0');
const nextMinute = () => {
  const d = new Date(Date.now() + 60_000);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
};

const getConfig = async () => (await fetch(BASE + '/config')).json();

const putConfig = async (body) => {
  const res = await fetch(BASE + '/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
};

/** 从成品聚合里挑出设置页会提交的那几个字段（模拟一次真实的「保存」） */
const saveBody = (cfg, patch) => ({
  pets: cfg.main.pets,
  notificationsEnabled: cfg.main.notificationsEnabled,
  whisperImageEnabled: cfg.main.whisperImageEnabled,
  chatImageEnabled: cfg.main.chatImageEnabled,
  confineToScreen: cfg.main.confineToScreen,
  physics: cfg.main.physics,
  font: cfg.main.font,
  whisperModel: cfg.main.whisperModel,
  chatModel: cfg.main.chatModel,
  chatMemoryRounds: cfg.main.chatMemoryRounds,
  chatImageLimit: cfg.main.chatImageLimit,
  reminders: cfg.main.reminders,
  visibilityCycle: cfg.main.visibilityCycle,
  ...patch,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const before = await getConfig();
  const time = nextMinute();
  const text = '测试提醒：该喝水啦（dsh-pet-jt E2E）';
  const body = saveBody(before, {
    reminders: { enabled: true, tasks: [{ id: 'e2e', time, text, enabled: true }] },
  });
  const saved = await putConfig(body);
  console.log('PUT reminders →', saved.status);
  const afterSave = JSON.parse(saved.text);
  console.log('落盘后的 reminders =', JSON.stringify(afterSave.main.reminders));

  const petId = afterSave.main.pets[0].id;
  console.log('等待触发', time, '（目标宠物', petId + '）…');

  let hit = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && !hit) {
    await sleep(2000);
    const st = await (await fetch(BASE + '/state')).json();
    const say = st.pets?.[petId]?.say?.data;
    if (say && typeof say.text === 'string' && say.text.includes('该喝水')) {
      hit = { say, at: new Date().toTimeString().slice(0, 8) };
    }
  }
  if (!hit) {
    console.log('✗ 120 秒内没有等到 say 叶子');
  } else {
    console.log('✓ 收到 say 叶子', hit.at, JSON.stringify(hit.say));
    console.log(
      hit.say.duration === 12000 && hit.say.anim === true
        ? '✓ duration=12s / anim=true（复用对话气泡通道）'
        : '✗ duration/anim 与预期不符',
    );
  }

  // 恢复：关掉提醒、清空任务（不留测试残留）
  const restored = await putConfig(
    saveBody(await getConfig(), { reminders: { enabled: false, tasks: [] } }),
  );
  console.log('恢复 reminders →', restored.status, JSON.stringify(JSON.parse(restored.text).main.reminders));
  process.exit(hit ? 0 : 1);
};

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
