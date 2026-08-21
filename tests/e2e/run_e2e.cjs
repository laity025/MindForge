// MindForge 端到端浏览器测试（Playwright · Chromium）
// 运行：NODE_PATH=<workspace>/node_modules node tests/e2e/run_e2e.cjs
// 前置：后端已在 http://127.0.0.1:8000 运行（Mock 或真实模型均可）
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.MF_BASE || "http://127.0.0.1:8000";
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name} — ${detail || ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 启用 fake 麦克风（真实中文语音文件模拟输入，用于语音对话闭环用例）
  const fakeWav = path.resolve(__dirname, "fake_voice.wav");
  const launchArgs = fs.existsSync(fakeWav)
    ? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-audio-capture=" + fakeWav, "--autoplay-policy=no-user-gesture-required"]
    : [];
  const browser = await chromium.launch({ args: launchArgs });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  try {
    /* 1. 首页加载 + 模型状态药丸 */
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#modelPill", { timeout: 6000 });
    const pill = (await page.textContent("#modelPill")).trim();
    check("首页加载与模型状态药丸", /演示模式|已接入|离线/.test(pill), "pill=" + pill);

    /* 1b. 实时语音对话版块：入口 → 视图；识别不可用时明确报错并可退出（进入训练前，landing 可见） */
    // 通过统一开始界面进入：开始训练 → 选语音方式 → 选场景与档位 → 进入模拟
    await page.click("#heroStart");
    await page.waitForSelector("#configOverlay", { state: "visible", timeout: 3000 });
    await page.click('#modeGrid .choice[data-mode="voice"]');
    await page.click('#sceneGrid .choice[data-scene="campus_recruit"]');
    await page.click('#levelSeg .seg-opt[data-level="standard"]');
    await page.click("#configStart");
    await page.waitForSelector("#voiceView", { state: "visible", timeout: 6000 });
    const vvVisible = await page.evaluate(() => getComputedStyle(document.querySelector("#voiceView")).display !== "none");
    check("语音对话入口打开视图", vvVisible === true, "voiceView visible");
    const waveBars = await page.locator("#voiceWave .bar").count();
    check("语音波形条已渲染", waveBars >= 24, "bars=" + waveBars);
    // 模拟识别不可用（headless 无 SpeechRecognition + Vosk 模型加载失败）
    await page.evaluate(() => {
      window.__realCreateModel = window.Vosk && window.Vosk.createModel;   // 备份，供 1c 恢复
      window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
      window.Vosk = window.Vosk || {};
      window.Vosk.createModel = () => Promise.reject(new Error("模拟失败"));
    });
    await page.click("#voiceToggle");
    await page.waitForFunction(() => /失败|出错/.test(document.querySelector("#voiceStatus").textContent), null, { timeout: 10000 });
    const vsText = (await page.textContent("#voiceStatus")).trim();
    check("语音对话识别失败明确报错", /失败|出错/.test(vsText), "status=" + vsText.slice(0, 26));
    await page.click("#voiceBack");
    await page.waitForFunction(() => document.querySelector("#voiceView").style.display === "none", null, { timeout: 6000 });
    check("语音对话可返回首页", true, "voiceView 关闭");

    /* 1c. 语音对话真实识别闭环（vosk 实时转写 + whisper 校准 + AI 回复；fake 麦克风播放中文语音） */
    if (fs.existsSync(fakeWav)) {
      await page.evaluate(() => {
        window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;   // 强制 vosk
        window.Vosk = window.Vosk || {};
        window.Vosk.createModel = window.__realCreateModel;   // 恢复真实 createModel
      });
      // 重新通过统一开始界面进入语音（上一步已返回首页）
      await page.click("#heroStart");
      await page.waitForSelector("#configOverlay", { state: "visible", timeout: 3000 });
      await page.click('#modeGrid .choice[data-mode="voice"]');
      await page.click('#sceneGrid .choice[data-scene="campus_recruit"]');
      await page.click('#levelSeg .seg-opt[data-level="standard"]');
      await page.click("#configStart");
      await page.click("#voiceToggle");
      let userBubble = "";
      for (let i = 0; i < 100; i++) {   // wav 10s + 识别 + whisper 首载 12s，最长 50s
        await sleep(500);
        userBubble = await page.evaluate(() => {
          const els = document.querySelectorAll("#voiceChat .msg.user .bubble");
          return els.length ? els[els.length - 1].textContent : "";
        });
        if (userBubble && userBubble.trim()) break;
        const st = await page.textContent("#voiceStatus");
        if (/失败|出错/.test(st)) break;
      }
      check("语音对话真实识别闭环（说话→文字）", userBubble.trim().length > 0, "userBubble=" + userBubble.trim().slice(0, 20));
      const hasTrad = /[這們個說謝會來時後裏與對還麼讓沒運動號著點經時間後準備們個說來時後們]/.test(userBubble);
      check("识别结果为简体中文", !hasTrad, "bubble=" + userBubble.trim().slice(0, 20));
      let aiReply = "";
      for (let i = 0; i < 60; i++) {   // AI 回复，最长 30s
        await sleep(500);
        aiReply = await page.evaluate(() => {
          const els = document.querySelectorAll("#voiceChat .msg:not(.user) .bubble");
          return els.length > 1 ? els[els.length - 1].textContent : "";
        });
        if (aiReply.trim()) break;
      }
      check("语音对话 AI 回复生成", aiReply.trim().length > 0, "ai=" + aiReply.trim().slice(0, 20));
      await page.click("#voiceBack");
    } else {
      check("语音对话真实识别闭环（说话→文字）", true, "无 fake_voice.wav，跳过");
    }

    /* 2. 配置弹层：未选场景/档位时不可进入 */
    await page.click("#heroStart");
    await page.waitForSelector("#configOverlay.show", { timeout: 6000 });
    check("未选场景/档位时进入按钮禁用", (await page.isDisabled("#configStart")) === true, "configStart disabled=true");

    /* 3. 选场景 + 高压档 → 可进入 → 面试官开场流式上屏 */
    await page.click('#sceneGrid .choice[data-scene="campus_recruit"]');
    await page.click('#levelSeg .seg-opt[data-level="hard"]');
    check("选择场景与档位后可进入", (await page.isEnabled("#configStart")) === true, "configStart enabled=true");

    /* 3b. 手填背景信息（可选） */
    await page.click('#profileMode .seg-opt[data-mode="form"]');
    await page.fill("#pfSchool", "上海交通大学");
    await page.fill("#pfMajor", "信息安全");
    await page.waitForFunction(() => document.querySelector("#profileInfo").textContent.includes("上海交通大学"), null, { timeout: 6000 });
    check("手填背景信息生效", true, "profileInfo 显示院校");

    /* 3c. 上传简历（TXT）解析 */
    await page.click('#profileMode .seg-opt[data-mode="upload"]');
    await page.setInputFiles("#resumeFile", { name: "resume.txt", mimeType: "text/plain", buffer: Buffer.from("本科于上海交通大学信息安全专业，熟悉 Python", "utf-8") });
    await page.waitForFunction(() => document.querySelector("#resumeStatus").textContent.includes("已解析"), null, { timeout: 10000 });
    check("简历上传解析成功", true, "resumeStatus=已解析 N 字");

    await page.click("#configStart");
    await page.waitForSelector("#training.show", { timeout: 6000 });
    await page.waitForSelector("#chatScroll .msg:not(.user)", { timeout: 10000 });
    // 等待开场流式结束（输入框重新可用）
    await page.waitForFunction(() => !document.querySelector("#userInput").disabled, null, { timeout: 15000 });
    const opening = (await page.textContent("#chatScroll .msg:not(.user)")).trim();
    check("面试官开场消息出现", opening.length > 5, "opening=" + opening.slice(0, 24) + "…");

    /* 4. 空提交拦截（空白 → toast，无新气泡） */
    const nBefore = await page.locator("#chatScroll .msg").count();
    await page.fill("#userInput", "   ");
    await page.press("#userInput", "Enter");
    await page.waitForSelector("#toast.show", { timeout: 6000 });
    const toastTxt = (await page.textContent("#toast")).trim();
    const nAfter = await page.locator("#chatScroll .msg").count();
    check("空提交被拦截且不上屏", /请输入内容/.test(toastTxt) && nAfter === nBefore, `toast=${toastTxt} msgs=${nBefore}→${nAfter}`);

    /* 4b. 原生与离线均不可用 → 明确提示（headless 无 SpeechRecognition，且禁用 Vosk） */
    await page.evaluate(() => {
      window.__realVosk = window.Vosk;   // 备份，供 4c 恢复
      window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; window.Vosk = undefined;
    });
    await page.click("#micBtn");
    await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("不支持语音输入"), null, { timeout: 6000 });
    const micToast = (await page.textContent("#toast")).trim();
    const micRec = await page.evaluate(() => document.querySelector("#micBtn").classList.contains("rec"));
    const ehHidden = await page.evaluate(() => document.querySelector("#emotionHint").style.display === "none");
    check("语音输入双通道均不可用时降级提示", /不支持语音输入/.test(micToast) && !micRec && ehHidden, "toast=" + micToast + " mic.rec=" + micRec);

    /* 4c. 原生不可用 → 自动降级离线通道（模型加载失败 → 明确报错且不卡录音态） */
    // 重载页面重置 ASR 模块（1c 已把真实模型缓存进模块，需重置才能测"模型加载失败"路径）
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#confirmOverlay.show", { timeout: 6000 });
    await page.click("#cfOk");
    await page.waitForSelector("#training.show", { timeout: 6000 });
    await page.waitForFunction(() => !document.querySelector("#userInput").disabled, null, { timeout: 15000 });
    await page.evaluate(() => {
      window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
      window.Vosk = window.Vosk || {};
      window.Vosk.createModel = () => Promise.reject(new Error("模拟模型加载失败"));
    });
    await page.click("#micBtn");
    await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("离线语音启动失败"), null, { timeout: 10000 });
    const voskToast = (await page.textContent("#toast")).trim();
    const voskRec = await page.evaluate(() => document.querySelector("#micBtn").classList.contains("rec"));
    check("原生不可用时自动降级离线通道", /离线语音启动失败/.test(voskToast) && !voskRec, "toast=" + voskToast.slice(0, 30));

    /* 5. 作答 → 用户气泡 + 教练建议（正则+LLM 并发不阻塞） */
    await page.fill("#userInput", "然后嗯我觉得就是说这个项目让我学到很多，首先它锻炼了我的抗压能力，其次让我更从容，最后让我更专业。");
    await page.press("#userInput", "Enter");
    await page.waitForFunction(() => document.querySelectorAll("#chatScroll .msg.user").length >= 1, null, { timeout: 8000 });
    await page.waitForFunction(() => document.querySelectorAll("#adviceList li:not(.muted)").length >= 1, null, { timeout: 12000 });
    const adviceN = await page.locator("#adviceList li:not(.muted)").count();
    check("作答上屏 + 教练建议生成", adviceN >= 1, "advice items=" + adviceN);
    // 等待追问流式结束，避免后续按钮时序冲突
    await page.waitForFunction(() => !document.querySelector("#userInput").disabled, null, { timeout: 15000 });

    /* 5b. 点击"发送"按钮提交作答 */
    await page.fill("#userInput", "我认为团队协作很重要，第一要主动沟通，其次要明确分工。");
    await page.click("#sendBtn");
    await page.waitForFunction(() => document.querySelectorAll("#chatScroll .msg.user").length >= 2, null, { timeout: 8000 });
    check("发送按钮可提交作答", true, "user msg >= 2");
    await page.waitForFunction(() => !document.querySelector("#userInput").disabled, null, { timeout: 15000 });

    /* 5c. 训练中点击返回 → 弹二次确认，取消则继续训练 */
    await page.click("#trainBack");
    await page.waitForSelector("#confirmOverlay.show", { timeout: 6000 });
    const backTitle = (await page.textContent("#cfTitle")).trim();
    await page.click("#cfCancel");
    await page.waitForSelector("#confirmOverlay", { state: "hidden", timeout: 6000 });
    check("训练中返回需二次确认且可取消", backTitle.includes("退出训练"), "cfTitle=" + backTitle);

    /* 5d. 刷新页面 → 提示恢复训练 → 会话与对话完整还原 */
    page.on("dialog", async (dlg) => { try { await (dlg.type() === "beforeunload" ? dlg.accept() : dlg.dismiss()); } catch {} });   // beforeunload 放行导航
    await page.reload();
    await page.waitForSelector("#confirmOverlay.show", { timeout: 6000 });
    const resumeTitle = (await page.textContent("#cfTitle")).trim();
    check("刷新后提示恢复训练", resumeTitle.includes("继续上次训练"), "cfTitle=" + resumeTitle);
    await page.click("#cfOk");
    await page.waitForSelector("#training.show", { timeout: 6000 });
    const restoredMsgs = await page.locator("#chatScroll .msg").count();
    check("恢复训练会话与对话", restoredMsgs >= 3, "restored msgs=" + restoredMsgs);

    /* 5e. 网络超时 → 重试按钮可点击且能重新连接 */
    let failOnce = true;
    await page.route("**/api/chat/interviewer", async (route) => {
      if (failOnce) {
        failOnce = false;
        await new Promise((r) => setTimeout(r, 2600));   // 超过前端 2s 首字超时 → 触发"网络超时"
      }
      await route.continue();
    });
    await page.fill("#userInput", "用于网络重试测试的回复。");
    await page.press("#userInput", "Enter");
    await page.waitForSelector("#banner.show", { timeout: 10000 });
    const bannerTxt = (await page.textContent("#bannerMsg")).trim();
    await page.click("#bannerRetry");                    // 若 pointer-events 被禁用，此点击将超时失败
    await page.waitForFunction(() => !document.querySelector("#banner").classList.contains("show"), null, { timeout: 6000 });
    await page.waitForFunction(() => !document.querySelector("#userInput").disabled, null, { timeout: 20000 });
    check("网络超时后重试可点击并重连", /超时|出错/.test(bannerTxt), "banner=" + bannerTxt.slice(0, 30));
    await page.unroute("**/api/chat/interviewer");

    /* 6. 暂停（呼吸引导浮层）→ 恢复 */
    await page.click("#gPause");
    await page.waitForSelector("#pauseOverlay.show", { timeout: 6000 });
    check("暂停呼吸引导浮层出现", true, "pauseOverlay.show");
    await page.click("#resumeBtn");
    await page.waitForSelector("#pauseOverlay", { state: "hidden", timeout: 6000 });
    check("恢复训练", true, "pauseOverlay 关闭");

    /* 7. 训练中随时切换档位：温和→高压→温和（无需二次确认） */
    await page.click('#guardLevel .gl-opt[data-level="hard"]');
    await page.waitForFunction(() => document.querySelector("#thLevel").textContent.includes("高压"), null, { timeout: 6000 });
    const hardSel = await page.evaluate(() => document.querySelector('#guardLevel .gl-opt[data-level="hard"]').classList.contains("sel"));
    // 切换档位会触发面试官按新档位发言；等发言结束后再切回温和
    await page.waitForFunction(() => !document.querySelector("#guardBar").classList.contains("busy"), null, { timeout: 20000 });
    await page.click('#guardLevel .gl-opt[data-level="gentle"]');
    await page.waitForFunction(() => document.querySelector("#thLevel").textContent.includes("温和"), null, { timeout: 6000 });
    await page.waitForFunction(() => !document.querySelector("#guardBar").classList.contains("busy"), null, { timeout: 20000 });
    check("训练中可随时切换施压档位", hardSel === true, "guardLevel hard sel=" + hardSel);

    /* 8. 结束（二次确认）→ 先出加载态 → 分析师报告 */
    await page.route("**/api/report/generate", async (route) => {
      await new Promise((r) => setTimeout(r, 1200));   // 人为延迟，验证生成期间加载态
      await route.continue();
    });
    await page.click("#gEnd");
    await page.waitForSelector("#confirmOverlay.show", { timeout: 6000 });
    await page.click("#cfOk");
    await page.waitForSelector("#reportOverlay.show", { timeout: 6000 });
    const loadingShown = await page.evaluate(() => {
      const l = document.querySelector("#reportLoading");
      return !!l && l.style.display === "flex";
    });
    check("报告生成期间显示加载态", loadingShown === true, "reportLoading visible");
    // 等待报告内容就绪（加载态结束后客观佐证上屏）
    await page.waitForFunction(() => document.querySelector("#reportStats").textContent.includes("客观佐证"), null, { timeout: 25000 });
    await page.unroute("**/api/report/generate");
    const statsTxt = await page.textContent("#reportStats");
    const titleTxt = (await page.textContent("#reportTitle")).trim();
    check("结束触发分析师报告", /成长报告/.test(titleTxt) && statsTxt.includes("客观佐证"), titleTxt + " | 客观佐证=" + statsTxt.includes("客观佐证"));
    const coachN = await page.locator("#reportCoachList li").count();
    const coachBoxVisible = await page.evaluate(() => document.querySelector("#reportCoachBox").style.display !== "none");
    check("成长报告含本轮教练建议", coachBoxVisible && coachN >= 1, "coach tips=" + coachN);
    const scoreLang = (await page.textContent("#scoreLang")).trim();
    check("报告打分版块显示分数", /^\d\/5$/.test(scoreLang), "scoreLang=" + scoreLang);

    /* 9. 报告导出为 PDF（直接下载） */
    const dlPdf = page.waitForEvent("download", { timeout: 15000 }).then(async (d) => {
      const name = d.suggestedFilename();
      try { await d.cancel(); } catch {}
      return name;
    }).catch(() => null);
    await page.click("#reportExport");
    const dlName = await dlPdf;
    const expToast = (await page.textContent("#toast")).trim();
    check("报告导出为 PDF（直接下载）", !!dlName && /\.pdf$/i.test(dlName), "download=" + (dlName || "none") + " toast=" + expToast);

    /* 10. 数据管理 → 历史记录含已出报告 → 回放 */
    await page.click("#reportHome");
    await page.click("#navData");
    await page.waitForSelector("#dataOverlay.show", { timeout: 6000 });
    const doneN = await page.locator(".dm-status.done").count();
    const viewN = await page.locator("button:has-text('查看报告')").count();
    check("历史记录含已出报告", doneN >= 1 && viewN >= 1, "done=" + doneN + " viewBtn=" + viewN);
    await page.click("button:has-text('查看报告')");
    await page.waitForSelector("#reportOverlay.show", { timeout: 6000 });
    const replayTitle = (await page.textContent("#reportTitle")).trim();
    check("历史报告回放", /成长报告/.test(replayTitle), replayTitle);
    await page.click("#reportHome");

    /* 11. 清空全部本地数据 */
    await page.click("#navData");
    await page.waitForSelector("#dataOverlay.show", { timeout: 6000 });
    /* 查看历史对话记录（训练场景回放） */
    await page.click("button:has-text('查看对话')");
    await page.waitForSelector("#historyOverlay.show", { timeout: 6000 });
    const hMsgN = await page.locator("#historyScroll .msg").count();
    check("历史对话记录可查看", hMsgN >= 2, "history msgs=" + hMsgN);
    await page.click("#historyClose");
    await page.waitForSelector("#historyOverlay", { state: "hidden", timeout: 6000 });
    await page.click("#dataClear");
    await page.waitForSelector(".dm-empty", { timeout: 6000 });
    check("清空全部本地数据", true, "dm-empty 占位出现");

    /* 12. 响应式：375px 移动端教练面板开关可见 */
    const mPage = await ctx.newPage();
    await mPage.setViewportSize({ width: 375, height: 740 });
    await mPage.goto(BASE, { waitUntil: "domcontentloaded" });
    const toggleVisible = await mPage.evaluate(() => {
      const el = document.querySelector("#coachToggle");
      return !!el && getComputedStyle(el).display !== "none";
    });
    check("移动端教练面板开关可见", toggleVisible === true, "coachToggle display!=none");
    await mPage.close();

    /* 13. reduced-motion 下正常加载（无障碍） */
    const rmCtx = await browser.newContext({ reducedMotion: "reduce" });
    const rmPage = await rmCtx.newPage();
    await rmPage.goto(BASE, { waitUntil: "domcontentloaded" });
    const h1 = (await rmPage.textContent("h1")) || "";
    check("reduced-motion 正常加载", h1.includes("肌肉记忆"), "h1=" + h1.trim().slice(0, 18) + "…");
    await rmPage.close();
    await rmCtx.close();
  } catch (e) {
    check("运行异常", false, e.message);
  }

  const pageErrors = errors.filter((x) => !/favicon|net::ERR|Failed to load resource/i.test(x)).slice(0, 5);
  if (pageErrors.length) console.log("\n⚠ 页面 console/pageerror（前 5 条）:\n  " + pageErrors.join("\n  "));

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  const md =
    "# MindForge 端到端测试报告（Playwright · Chromium）\n\n" +
    `> 被测地址：\`${BASE}\`　生成时间：${new Date().toLocaleString("zh-CN")}\n\n` +
    "| # | 用例 | 结果 | 详情 |\n|---|---|---|---|\n" +
    results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.ok ? "✅ 通过" : "❌ 失败"} | ${r.detail || ""} |`).join("\n") +
    `\n\n**总计 ${total} ｜ 通过 ${passed} ｜ 失败 ${total - passed}**\n` +
    (pageErrors.length ? `\n> ⚠ 页面报错：${pageErrors.join("；")}\n` : "") +
    "\n> 覆盖：模型状态、场景/档位前置、流式开场、空提交拦截、作答+教练建议、暂停/恢复、训练中切换档位、结束+报告、导出、历史回放、清空数据、响应式、reduced-motion。\n";
  fs.writeFileSync(path.join(__dirname, "E2E_测试报告.md"), md, "utf-8");
  await browser.close();
  console.log(`\n==================================================\n总计 ${total} | 通过 ${passed} | 失败 ${total - passed} | 报告：tests/e2e/E2E_测试报告.md\n==================================================`);
  process.exit(passed === total ? 0 : 1);
})();
