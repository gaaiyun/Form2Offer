const trackerApi = globalThis.Form2OfferJobTracker;

const els = {
  status: document.getElementById("status"),
  openOptions: document.getElementById("openOptions"),
  startAutofillBtn: document.getElementById("startAutofillBtn"),
  startAgentBtn: document.getElementById("startAgentBtn"),
  showProfilePanelBtn: document.getElementById("showProfilePanelBtn"),
  clearMarksBtn: document.getElementById("clearMarksBtn"),
  rememberAnswersBtn: document.getElementById("rememberAnswersBtn"),
  openAnswers: document.getElementById("openAnswers"),
  openTracker: document.getElementById("openTracker"),
  applicationCaptureForm: document.getElementById("applicationCaptureForm"),
  captureFeedback: document.getElementById("captureFeedback"),
  captureCandidateField: document.getElementById("captureCandidateField"),
  captureCandidate: document.getElementById("captureCandidate"),
  captureCompanyName: document.getElementById("captureCompanyName"),
  captureJobTitle: document.getElementById("captureJobTitle"),
  captureAppliedAt: document.getElementById("captureAppliedAt"),
  captureStatus: document.getElementById("captureStatus"),
  captureChannel: document.getElementById("captureChannel"),
  captureNotes: document.getElementById("captureNotes"),
  saveApplication: document.getElementById("saveApplication"),
  updateBanner: document.getElementById("updateBanner"),
  updateText: document.getElementById("updateText"),
  reloadExtension: document.getElementById("reloadExtension"),
  insightPlatform: document.getElementById("insightPlatform"),
  insightSummary: document.getElementById("insightSummary"),
  insightItems: document.getElementById("insightItems"),
  insightResume: document.getElementById("insightResume"),
  insightApplied: document.getElementById("insightApplied"),
  insightTipsBox: document.getElementById("insightTipsBox"),
  insightTips: document.getElementById("insightTips"),
  agentState: document.getElementById("agentState"),
  agentHint: document.getElementById("agentHint"),
  enableAgentLink: document.getElementById("enableAgentLink"),
  importStagedProfile: document.getElementById("importStagedProfile")
};

const DEFAULT_START_LABEL = els.startAutofillBtn.textContent;
const CONTENT_SCRIPT_FILES = [
  "src/safety-policy.js",
  "src/date-utils.js",
  "src/project-utils.js",
  "src/profile-utils.js",
  "src/job-tracker.js",
  "src/answer-library.js",
  "src/platform-knowledge.js",
  "src/fill-rules.js",
  "src/content.js"
];
const VERDICT_TEXT = {
  ok: "未发现不满足的硬门槛",
  risk: "有需要留意的要求",
  block: "有硬门槛不满足，建议先别投",
  unknown: "在设置页填写“我的门槛”后可判断是否满足"
};
let capturedJobPageInfo = null;
let capturedJobCandidates = [];

els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
els.startAutofillBtn.addEventListener("click", () => {
  void startAutofill();
});
els.startAgentBtn.addEventListener("click", () => {
  void startAgentTask();
});
els.showProfilePanelBtn.addEventListener("click", () => {
  void showProfilePanel();
});
els.clearMarksBtn.addEventListener("click", () => {
  void clearMarks();
});
els.openTracker.addEventListener("click", openTrackerPage);
els.openAnswers.addEventListener("click", openAnswersPage);
els.rememberAnswersBtn.addEventListener("click", () => {
  void rememberCurrentPageAnswers();
});
els.captureCandidate.addEventListener("change", () => {
  const candidate = capturedJobCandidates[Number(els.captureCandidate.value)];
  if (candidate) {
    applyCapturedCandidate(candidate);
  }
});
els.applicationCaptureForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveCurrentApplication();
});
els.reloadExtension.addEventListener("click", () => chrome.runtime.reload());
els.enableAgentLink.addEventListener("click", () => void enableAgentLinkFromPopup());
els.importStagedProfile.addEventListener("click", () => void importStagedProfileFromPopup());
initialize();
void loadAgentPanel();

let stagedProfileFromBridge = null;

async function loadAgentPanel() {
  let settings = null;
  try {
    settings = await sendRuntimeMessage({ type: "OJAF_GET_SETTINGS" });
  } catch {
    els.agentHint.textContent = "无法读取扩展设置。";
    return;
  }
  if (!settings?.agentConfigured) {
    els.agentState.textContent = "未配对";
    els.agentHint.textContent = "在设置页“本地 Agent”区域输入 Bridge 配对码后，Claude Code / Codex 才能读取表单。";
    return;
  }
  let status = null;
  try {
    status = await sendRuntimeMessage({ type: "OJAF_AGENT_LINK_STATUS" });
  } catch {
    els.agentState.textContent = "需重新加载";
    els.agentHint.textContent = "扩展后台还是旧版本：请点上方“重新加载扩展”（或在 edge://extensions 重新加载）。";
    els.updateBanner.hidden = false;
    if (!els.updateText.textContent) els.updateText.textContent = "扩展文件已更新，重新加载后生效（不会清除资料）。";
    return;
  }
  els.agentState.textContent = status.connected ? "已连接" : status.enabled ? "等待 Bridge" : "未开启读表";
  els.agentHint.textContent = status.connected
    ? `Claude Code / Codex 可以读取当前网申表单${status.includeValues ? "（含已填内容，证件号等打码）" : ""}；方案要你在审阅页确认后才写入。`
    : status.enabled
      ? `已开启，正在连接 Bridge${status.lastError ? `：${status.lastError}` : "（Bridge 启动后 30 秒内自动连上）"}。`
      : "开启后，Agent 可以主动读取你打开的网申页并提交填写方案。";
  els.enableAgentLink.hidden = Boolean(status.enabled && status.canReadAllSites);
  try {
    const staged = await sendRuntimeMessage({ type: "OJAF_AGENT_STAGED_PROFILE" });
    if (staged?.staged && staged.package?.profileV2) {
      stagedProfileFromBridge = staged;
      els.importStagedProfile.hidden = false;
      els.importStagedProfile.textContent = `导入 Agent 准备的资料底稿（${new Date(staged.stagedAt).toLocaleDateString()}）`;
      els.importStagedProfile.title = staged.note || "";
    }
  } catch {
    // Bridge 未运行时不显示导入入口。
  }
}

async function enableAgentLinkFromPopup() {
  els.enableAgentLink.disabled = true;
  try {
    const granted = await chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] });
    if (!granted) {
      els.agentHint.textContent = "没有授予网站访问权限，Agent 无法读取表单。";
      return;
    }
    const status = await sendRuntimeMessage({ type: "OJAF_SAVE_AGENT_LINK", payload: { enabled: true, includeValues: true } });
    els.agentHint.textContent = status.connected ? "已开启并连上 Bridge。" : "已开启，正在连接 Bridge...";
    await loadAgentPanel();
  } catch (error) {
    els.agentHint.textContent = `开启失败：${error.message}`;
  } finally {
    els.enableAgentLink.disabled = false;
  }
}

async function importStagedProfileFromPopup() {
  const staged = stagedProfileFromBridge;
  if (!staged?.package?.profileV2) return;
  const summary = staged.summary || {};
  const confirmed = window.confirm(
    `导入 Agent 准备的资料底稿？\n\n${staged.note || ""}\n共 ${summary.sectionCount || 0} 个分区、${summary.itemCount || 0} 条经历、${summary.valueCount || 0} 个字段。\n\n当前资料会先备份在扩展里，可在设置页恢复。`
  );
  if (!confirmed) return;
  els.importStagedProfile.disabled = true;
  try {
    const current = await sendRuntimeMessage({ type: "OJAF_GET_SETTINGS" });
    await chrome.storage.local.set({ profileV2Backup: { savedAt: new Date().toISOString(), profileV2: current.profileV2 } });
    const extra = staged.package.form2offerSettings || {};
    const payload = { profileV2: staged.package.profileV2 };
    if (extra.candidateProfile) payload.candidateProfile = extra.candidateProfile;
    if (Array.isArray(extra.resumeVersions)) payload.resumeVersions = extra.resumeVersions;
    await sendRuntimeMessage({ type: "OJAF_SAVE_SETTINGS", payload });
    await sendRuntimeMessage({ type: "OJAF_AGENT_CLEAR_STAGED_PROFILE" }).catch(() => undefined);
    els.importStagedProfile.hidden = true;
    els.agentHint.textContent = "资料底稿已导入。网页上重新点“开始填写”即可使用新资料。";
  } catch (error) {
    els.agentHint.textContent = `导入失败：${error.message}`;
  } finally {
    els.importStagedProfile.disabled = false;
  }
}

async function initialize() {
  setStatus("点击开始填写后，右下角会实时显示当前是本地规则还是 AI；AI 不可用也能继续用本地规则填写。");
  populateCaptureStatuses();
  els.captureAppliedAt.value = toLocalDateTimeInput(new Date());
  await Promise.allSettled([syncRuntimeState(), loadCurrentJobPageInfo(), loadPageInsight(), checkForExtensionUpdate()]);
}

// 解包安装时，磁盘上的 manifest 会先于运行中的扩展更新；版本不同就提示重载。
async function checkForExtensionUpdate() {
  const running = chrome.runtime.getManifest().version;
  const response = await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" });
  const onDisk = (await response.json())?.version || running;
  if (onDisk !== running) {
    els.updateText.textContent = `扩展文件已更新到 ${onDisk}，当前运行的是 ${running}。重新加载后生效（不会清除资料）。`;
    els.updateBanner.hidden = false;
  }
}

async function loadPageInsight() {
  let source = null;
  try {
    source = (await sendToActiveTab({ type: "OJAF_GET_PAGE_INSIGHT_SOURCE" }))?.data || null;
  } catch {
    els.insightSummary.textContent = "当前页面无法读取（浏览器内置页或未授权页面）。";
    return;
  }
  renderPlatform(source);
  const job = source?.job || {};
  if (!job.title && !job.description) {
    els.insightSummary.textContent = "这一页没有找到岗位描述；打开职位详情页可查看岗位类型和门槛。";
  } else {
    try {
      renderInsight(await sendRuntimeMessage({ type: "OJAF_JOB_INSIGHT", payload: job }), job);
    } catch (error) {
      els.insightSummary.textContent = `岗位速读失败：${error.message}`;
    }
  }
  await renderAppliedCheck(job, source?.hostname || "");
}

function renderPlatform(source) {
  const platform = source?.platform;
  els.insightPlatform.textContent = platform ? platform.name : "";
  const tips = (source?.tips || []).length ? source.tips : [];
  els.insightTips.replaceChildren(...tips.map((tip) => {
    const item = document.createElement("li");
    item.textContent = tip;
    return item;
  }));
  els.insightTipsBox.hidden = tips.length === 0;
  if (platform?.parse?.overwrites === "high") {
    els.insightTipsBox.open = true;
  }
}

function renderInsight(result, job) {
  const analysis = result?.analysis || {};
  const assessment = result?.assessment || { verdict: "unknown", items: [] };
  const family = analysis.primaryFamily?.label || "未识别";
  els.insightSummary.textContent = `${job.title ? `${job.title}：` : ""}${family}。${VERDICT_TEXT[assessment.verdict] || ""}`;
  els.insightItems.replaceChildren(...(assessment.items || []).slice(0, 8).map((item) => {
    const li = document.createElement("li");
    li.className = item.status;
    li.textContent = item.text;
    return li;
  }));
  if (result?.recommendedResume) {
    els.insightResume.textContent = `建议简历：${result.recommendedResume.id} ${result.recommendedResume.label}（${result.recommendedResume.reason}）`;
    els.insightResume.hidden = false;
  }
}

async function renderAppliedCheck(job, hostname) {
  if (!job.company && !hostname) return;
  let settings = null;
  try {
    settings = await sendRuntimeMessage({ type: "OJAF_GET_SETTINGS" });
  } catch {
    return;
  }
  if (!settings?.agentConfigured) return;
  try {
    const result = await sendRuntimeMessage({ type: "OJAF_AGENT_CHECK_APPLIED", payload: { company: job.company, role: job.title, hostname } });
    if (result?.error && !(result.matches || []).length) {
      return;
    }
    const top = (result?.matches || [])[0];
    if (!top) {
      els.insightApplied.textContent = `投递记录：没有查到${job.company ? `“${job.company}”` : "本站"}的记录。`;
      els.insightApplied.classList.remove("warn");
    } else {
      const statusText = { submitted: "已投递", offer: "已获 offer", submit_unknown: "提交结果未知", in_progress: "填写中", needs_user: "待本人处理", skipped: "暂不投", withdrawn: "已放弃", not_applied: "确认未投" }[top.status] || top.status;
      els.insightApplied.textContent = `投递记录：${top.company}${top.role ? ` · ${top.role}` : ""} —— ${statusText}${result.blocking ? "，同公司默认不再投" : ""}`;
      els.insightApplied.classList.toggle("warn", Boolean(result.blocking));
    }
    els.insightApplied.hidden = false;
  } catch {
    // Bridge 未运行时不打扰；查重是附加信息。
  }
}

async function loadCurrentJobPageInfo() {
  setCaptureFeedback("正在识别当前页面...");
  try {
    const response = await sendToActiveTab({ type: "OJAF_GET_JOB_PAGE_INFO" });
    capturedJobPageInfo = response?.data || {};
    capturedJobCandidates = Array.isArray(capturedJobPageInfo.candidates)
      ? capturedJobPageInfo.candidates
      : [];
    renderCapturedCandidates();

    if (capturedJobCandidates.length > 0) {
      applyCapturedCandidate(capturedJobCandidates[0]);
      setCaptureFeedback(
        capturedJobCandidates.length > 1
          ? `识别到 ${capturedJobCandidates.length} 条投递记录，请选择并核对后保存。`
          : "已从投递记录卡片识别公司、职位、时间和状态，请核对后保存。",
        "success"
      );
      return;
    }

    applyCapturedCandidate(capturedJobPageInfo);

    if (capturedJobPageInfo.companyName && capturedJobPageInfo.jobTitle) {
      const confidence = capturedJobPageInfo.confidence || {};
      const isReliable = Number(confidence.companyName || 0) >= 0.85 && Number(confidence.jobTitle || 0) >= 0.85;
      setCaptureFeedback(
        isReliable ? "已从官方职位数据识别公司和职位，请核对后记录。" : "已识别公司和职位，但证据有限，请核对后记录。",
        isReliable ? "success" : ""
      );
    } else if (capturedJobPageInfo.companyName || capturedJobPageInfo.jobTitle) {
      setCaptureFeedback("已识别部分信息，请补充缺失项后记录。", "");
    } else {
      setCaptureFeedback("未能可靠识别公司和职位，可手动填写后记录。", "");
    }
  } catch {
    capturedJobPageInfo = null;
    capturedJobCandidates = [];
    renderCapturedCandidates();
    setCaptureFeedback("当前页面无法自动识别，可手动填写后记录。", "");
  }
}

function renderCapturedCandidates() {
  els.captureCandidate.replaceChildren();
  capturedJobCandidates.forEach((candidate, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = [
      candidate.companyName || "公司待补充",
      candidate.jobTitle || "职位待补充",
      formatCandidateDate(candidate.appliedAt)
    ].filter(Boolean).join(" / ");
    els.captureCandidate.appendChild(option);
  });
  els.captureCandidateField.hidden = capturedJobCandidates.length <= 1;
}

function applyCapturedCandidate(candidate = {}) {
  const base = capturedJobPageInfo || {};
  capturedJobPageInfo = {
    ...base,
    ...candidate,
    companyName: candidate.companyName || base.companyName || "",
    jobTitle: candidate.jobTitle || base.jobTitle || "",
    sourceUrl: candidate.sourceUrl || base.sourceUrl || "",
    sourceSite: candidate.sourceSite || base.sourceSite || "",
    statusUrl: candidate.statusUrl || base.statusUrl || base.sourceUrl || ""
  };
  els.captureCompanyName.value = capturedJobPageInfo.companyName;
  els.captureJobTitle.value = capturedJobPageInfo.jobTitle;
  els.captureChannel.value = candidate.channel
    || base.channel
    || trackerApi?.inferApplicationChannel?.(capturedJobPageInfo.sourceUrl, capturedJobPageInfo.sourceSite)
    || "";
  if (candidate.appliedAt) {
    els.captureAppliedAt.value = toLocalDateTimeInput(new Date(candidate.appliedAt));
  }
  if (candidate.status && trackerApi?.JOB_APPLICATION_STATUSES?.includes(candidate.status)) {
    els.captureStatus.value = candidate.status;
  }
  if (candidate.notes) {
    els.captureNotes.value = candidate.notes;
  }
}

function formatCandidateDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

async function saveCurrentApplication() {
  if (!els.applicationCaptureForm.reportValidity()) {
    return;
  }

  els.saveApplication.disabled = true;
  els.saveApplication.textContent = "保存中...";
  try {
    const result = await sendRuntimeMessage({
      type: "OJAF_SAVE_JOB_APPLICATION",
      payload: {
        application: {
          companyName: els.captureCompanyName.value,
          jobTitle: els.captureJobTitle.value,
          appliedAt: new Date(els.captureAppliedAt.value).toISOString(),
          channel: els.captureChannel.value,
          statusUrl: capturedJobPageInfo?.statusUrl || capturedJobPageInfo?.sourceUrl || "",
          status: els.captureStatus.value,
          notes: els.captureNotes.value,
          sourceUrl: capturedJobPageInfo?.sourceUrl || "",
          sourceSite: capturedJobPageInfo?.sourceSite || ""
        }
      }
    });

    if (result.duplicate) {
      setCaptureFeedback("今天已记录过相同公司、职位和页面，未重复添加。", "");
    } else {
      setCaptureFeedback("投递记录已保存到本机。", "success");
    }
  } catch (error) {
    setCaptureFeedback(`保存失败：${error.message}`, "error");
  } finally {
    els.saveApplication.disabled = false;
    els.saveApplication.textContent = "记录本次投递";
  }
}

function populateCaptureStatuses() {
  const statuses = Array.isArray(trackerApi?.JOB_APPLICATION_STATUSES)
    ? trackerApi.JOB_APPLICATION_STATUSES
    : ["待投递", "已投递", "笔试", "面试", "Offer", "已拒绝", "已撤回"];
  els.captureStatus.replaceChildren();
  for (const status of statuses) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    option.selected = status === "已投递";
    els.captureStatus.appendChild(option);
  }
}

function openTrackerPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/tracker.html") });
}

function openAnswersPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/answers.html") });
}

async function rememberCurrentPageAnswers() {
  els.rememberAnswersBtn.disabled = true;
  els.rememberAnswersBtn.textContent = "正在检查本页...";
  try {
    const response = await sendToActiveTab({ type: "OJAF_COLLECT_OPEN_ANSWERS" });
    const entries = Array.isArray(response?.data?.entries) ? response.data.entries : [];
    if (entries.length === 0) {
      setStatus("本页没有找到已填写且可安全记忆的开放题；隐私字段和声明题不会保存。", false);
      return;
    }
    const preview = entries.slice(0, 4).map((entry, index) => `${index + 1}. ${entry.question}`).join("\n");
    const remaining = entries.length > 4 ? `\n另有 ${entries.length - 4} 题` : "";
    if (!window.confirm(`将以下 ${entries.length} 道问答保存在本机：\n\n${preview}${remaining}\n\n以后仅在题目精确匹配时复用。是否继续？`)) {
      setStatus("已取消保存，本页内容没有写入问答库。", false);
      return;
    }
    const result = await sendRuntimeMessage({
      type: "OJAF_SAVE_ANSWER_LIBRARY",
      payload: { entries }
    });
    setStatus(`问答库已更新：新增 ${result.createdCount || 0} 题，更新 ${result.updatedCount || 0} 题，未变化 ${result.skippedCount || 0} 题。`);
  } catch (error) {
    setStatus(`保存问答失败：${error.message}`, true);
  } finally {
    els.rememberAnswersBtn.disabled = false;
    els.rememberAnswersBtn.textContent = "记住本页已填写问答";
  }
}

function setCaptureFeedback(message, state = "") {
  els.captureFeedback.textContent = message;
  els.captureFeedback.classList.toggle("success", state === "success");
  els.captureFeedback.classList.toggle("error", state === "error");
}

function toLocalDateTimeInput(date) {
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

async function syncRuntimeState(options = {}) {
  try {
    const response = await sendToActiveTab({ type: "OJAF_GET_RUNTIME_STATE" });
    applyRuntimeState(response?.data || {}, options);
  } catch {
    els.startAutofillBtn.disabled = false;
    els.startAutofillBtn.textContent = DEFAULT_START_LABEL;
  }
}

function applyRuntimeState(state = {}, options = {}) {
  const busy = Boolean(state.autofillInProgress);
  els.startAutofillBtn.disabled = busy;
  els.startAutofillBtn.textContent = busy ? "扫描中..." : DEFAULT_START_LABEL;

  if (options.updateStatus === false) {
    return;
  }

  if (busy) {
    const progress = state.autofillProgress || {};
    const stageLabel = progress.stepLabel || progress.stage || "处理当前页面";
    const stage = /^正在/.test(stageLabel) ? stageLabel : `正在${stageLabel}`;
    const elapsed = formatElapsedTime(progress.stageStartedAt);
    const aiNote = formatRuntimeAiNote(state.autofillAi || {}, elapsed);
    setStatus(`当前${stage}，请勿重复点击。页面右下角会显示进度。${aiNote}`);
    return;
  }

  if (state.autofillSummary) {
    const summary = state.autofillSummary;
    setStatus(`上次填写：已填写 ${summary.filled || 0} 项，待处理 ${getPendingCount(summary)} 项。${formatAiCompletionNote(summary.aiUsage || state.autofillAi || {})}`);
  }
}

async function showProfilePanel() {
  try {
    await sendToActiveTab({ type: "OJAF_SHOW_PROFILE_PANEL" });
    setStatus("已打开资料面板。");
    await syncRuntimeState({ updateStatus: false });
  } catch (error) {
    setStatus(`打开失败：${error.message}`, true);
  }
}

async function startAutofill() {
  try {
    els.startAutofillBtn.disabled = true;
    els.startAutofillBtn.textContent = "扫描中...";
    setStatus("正在开始填写；右下角会显示当前是本地规则还是 AI。");
    const response = await sendToActiveTab({ type: "OJAF_START_AUTOFILL" });
    const data = response?.data || {};
    if (data.ok) {
      if (data.filled != null) {
        setStatus(`已完成一键填写：已填写 ${data.filled || 0} 项，待处理 ${getPendingCount(data)} 项。${formatAiCompletionNote(data.aiUsage || {})}`);
      } else {
        setStatus("已完成扫描处理。页面上的橙色标记需要手动处理，也可以打开资料面板查看和复制资料。");
      }
    } else if (data.reason === "cancelled") {
      setStatus("已取消填写。");
    } else if (data.reason === "no candidates") {
      setStatus(`没有找到可自动填写的字段。橙色标记需要手动处理，也可以打开资料面板查看和复制资料。${formatAiCompletionNote(data.aiUsage || {})}`);
    } else if (data.reason === "busy") {
      setStatus("当前已有扫描任务在运行，请稍候。", true);
    } else if (data.reason) {
      setStatus(`开始填写未完成：${data.reason}`, true);
    } else {
      setStatus("已开始处理一键填写。");
    }
    await syncRuntimeState({ updateStatus: false });
  } catch (error) {
    setStatus(`开始填写失败：${error.message}`, true);
    await syncRuntimeState({ updateStatus: false });
  }
}

async function startAgentTask() {
  els.startAgentBtn.disabled = true;
  els.startAgentBtn.textContent = "正在创建任务...";
  try {
    const [tab] = await queryTabs({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("没有找到当前招聘网页。");
    const response = await sendToActiveTab({ type: "OJAF_GET_AGENT_SNAPSHOT" });
    const session = await sendRuntimeMessage({
      type: "OJAF_AGENT_CREATE_SESSION",
      payload: { tabId: tab.id, snapshot: response?.data || {} }
    });
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`src/agent-review.html?session=${encodeURIComponent(session.id)}`)
    });
    setStatus("本地 Agent 任务已创建。方案会在独立页面显示，确认前不会修改招聘网页。");
  } catch (error) {
    const suffix = /配对|fetch|Failed|Bridge/i.test(error.message)
      ? " 请先在设置页启动并配对 Local Bridge。"
      : "";
    setStatus(`创建本地 Agent 任务失败：${error.message}${suffix}`, true);
  } finally {
    els.startAgentBtn.disabled = false;
    els.startAgentBtn.textContent = "交给本地 Agent";
  }
}

async function clearMarks() {
  try {
    await sendToActiveTab({ type: "OJAF_CLEAR_MARKS" });
    setStatus("已清除颜色标记，不会修改表单内容。");
    await syncRuntimeState({ updateStatus: false });
  } catch (error) {
    setStatus(`清除失败：${error.message}`, true);
  }
}

function formatRuntimeAiNote(aiUsage = {}, elapsed = "") {
  const status = aiUsage.status || "";
  if (status === "trying") {
    return ` 正在用 AI 辅助识别字段，资料值不会发送${elapsed ? `，已等待 ${elapsed}` : ""}。`;
  }
  if (aiUsage.used && aiUsage.fallback) {
    return " AI 辅助识别了部分字段，其余已用本地规则继续。";
  }
  if (aiUsage.used) {
    return " AI 已辅助识别字段，具体填写仍在本机完成。";
  }
  if (aiUsage.fallback) {
    return " AI 不可用，已使用本地规则继续。";
  }
  if (status === "no-result" || aiUsage.attempted) {
    return " AI 没有提供可用建议，继续使用本地规则。";
  }
  return " 如果配置了 AI，会辅助识别字段；否则使用本地规则。";
}

function formatAiCompletionNote(aiUsage = {}) {
  if (aiUsage.used && aiUsage.fallback) {
    return "本次 AI 辅助识别了部分字段，其余使用本地规则完成。";
  }
  if (aiUsage.used) {
    return "本次 AI 辅助识别字段，具体填写在本机完成。";
  }
  if (aiUsage.fallback) {
    return "本次使用本地规则完成；AI 不可用。";
  }
  if (aiUsage.status === "no-result" || aiUsage.attempted) {
    return "本次 AI 没有提供可用建议，实际使用本地规则。";
  }
  return "本次使用本地规则。";
}

function getPendingCount(summary = {}) {
  return Number(summary.pending ?? Number(summary.skipped || 0) + Number(summary.failed || 0));
}

function formatElapsedTime(startedAt) {
  const start = Number(startedAt || 0);
  if (!start) {
    return "";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  if (seconds < 1) {
    return "";
  }
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

async function sendToActiveTab(message) {
  const [tab] = await queryTabs({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  await executeScript(tab.id, CONTENT_SCRIPT_FILES);

  try {
    return await sendTabMessage(tab.id, message);
  } catch (firstError) {
    try {
      await executeScript(tab.id, CONTENT_SCRIPT_FILES);
      return await sendTabMessage(tab.id, message);
    } catch {
      throw firstError;
    }
  }
}

function queryTabs(query) {
  return new Promise((resolve) => {
    chrome.tabs.query(query, resolve);
  });
}

function executeScript(tabId, files) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, files: Array.isArray(files) ? files : [files] }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve();
      }
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Tab message failed."));
        return;
      }
      resolve(response);
    });
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Runtime message failed."));
        return;
      }
      resolve(response.data);
    });
  });
}
