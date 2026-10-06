const params = new URLSearchParams(location.search);
const sessionId = params.get("session") || "";
const els = {
  stage: document.getElementById("stage"), summary: document.getElementById("summary"),
  warnings: document.getElementById("warnings"), planCard: document.getElementById("planCard"),
  items: document.getElementById("items"), selectAll: document.getElementById("selectAll"),
  applyBtn: document.getElementById("applyBtn"), cancelBtn: document.getElementById("cancelBtn"),
  applyFeedback: document.getElementById("applyFeedback"), rememberAnswers: document.getElementById("rememberAnswers"),
  contextCard: document.getElementById("contextCard"), appliedLine: document.getElementById("appliedLine"),
  insightLine: document.getElementById("insightLine"), insightItems: document.getElementById("insightItems"),
  resumeLine: document.getElementById("resumeLine"), tipsBox: document.getElementById("tipsBox"),
  tipsTitle: document.getElementById("tipsTitle"), tipsList: document.getElementById("tipsList")
};
const VERDICT_TEXT = { ok: "未发现不满足的硬门槛", risk: "有需要留意的要求", block: "有硬门槛不满足", unknown: "未设置本人门槛，无法判断" };
const STATUS_TEXT = { submitted: "已投递", offer: "已获 offer", submit_unknown: "提交结果未知", in_progress: "填写中", needs_user: "待本人处理", skipped: "暂不投", withdrawn: "已放弃", not_applied: "确认未投" };
let currentSession = null;
let previews = {};
let pollTimer = null;

els.selectAll.addEventListener("change", () => {
  document.querySelectorAll("[data-agent-field]").forEach((box) => { box.checked = els.selectAll.checked; });
});
els.applyBtn.addEventListener("click", () => void applySelected());
els.cancelBtn.addEventListener("click", () => void cancelSession());
void poll();

async function poll() {
  clearTimeout(pollTimer);
  if (!sessionId) return setStage("缺少任务 ID。", true);
  try {
    currentSession = await send({ type: "OJAF_AGENT_GET_SESSION", payload: { sessionId } });
    renderState(currentSession);
    renderContext(currentSession.context);
    if (currentSession.state === "review_ready") {
      previews = (await send({ type: "OJAF_AGENT_PLAN_PREVIEWS", payload: { sessionId } })).previews || {};
      renderPlan(currentSession.plan);
      return;
    }
    if (!["failed", "cancelled", "expired"].includes(currentSession.state)) pollTimer = setTimeout(poll, 1500);
  } catch (error) { setStage(`读取任务失败：${error.message}`, true); }
}

function renderState(session) {
  const labels = { queued: "等待 Codex", running: "Agent 正在读取已授权资料并生成方案", awaiting_agent: "等待 MCP Agent 领取任务（Claude Code / Codex 用 form2offer_wait_for_session 即可领取）", review_ready: "方案已生成，请逐项核对", failed: "任务失败", cancelled: "任务已取消", expired: "任务已过期" };
  setStage(labels[session.state] || session.state, session.state === "failed");
  els.summary.textContent = session.error || `已扫描 ${session.fieldCount || 0} 个字段。`;
}

function renderContext(context) {
  if (!context || els.contextCard.dataset.rendered) return;
  els.contextCard.dataset.rendered = "1";
  let visible = false;
  const applied = context.applied;
  if (applied && (applied.matches || []).length) {
    const top = applied.matches[0];
    els.appliedLine.textContent = `投递记录：${top.company}${top.role ? ` · ${top.role}` : ""} —— ${STATUS_TEXT[top.status] || top.status}${applied.blocking ? "。同公司默认不再投，确认要继续再填写。" : ""}`;
    els.appliedLine.classList.toggle("warn", Boolean(applied.blocking));
    els.appliedLine.hidden = false;
    visible = true;
  }
  const insight = context.insight;
  if (insight?.analysis) {
    const family = insight.analysis.primaryFamily?.label || "未识别";
    els.insightLine.textContent = `岗位类型：${family}。${VERDICT_TEXT[insight.assessment?.verdict] || ""}`;
    els.insightLine.classList.toggle("warn", insight.assessment?.verdict === "block");
    els.insightLine.hidden = false;
    els.insightItems.replaceChildren(...(insight.assessment?.items || []).filter((item) => item.status !== "ok").slice(0, 6).map((item) => make("li", item.text, item.status)));
    if (insight.recommendedResume) {
      els.resumeLine.textContent = `建议简历：${insight.recommendedResume.id} ${insight.recommendedResume.label}`;
      els.resumeLine.hidden = false;
    }
    visible = true;
  }
  const tips = context.tips || [];
  if (tips.length) {
    els.tipsTitle.textContent = `${context.platform?.name || "本站"}注意事项`;
    els.tipsList.replaceChildren(...tips.map((tip) => make("li", tip)));
    els.tipsBox.hidden = false;
    visible = true;
  }
  els.contextCard.hidden = !visible;
}

function fieldLabelOf(fieldId) {
  const field = (currentSession?.request?.scan?.fields || []).find((item) => item.fieldId === fieldId);
  return field?.label || field?.placeholder || fieldId;
}

function fieldLimitOf(fieldId) {
  const field = (currentSession?.request?.scan?.fields || []).find((item) => item.fieldId === fieldId);
  return Number(field?.maxLength) || 0;
}

function renderPlan(plan = {}) {
  els.planCard.hidden = false;
  els.summary.textContent = plan.summary || `Agent 提供了 ${(plan.items || []).length} 条普通字段建议。`;
  els.warnings.replaceChildren(...(plan.warnings || []).map((warning) => make("p", `提醒：${warning}`)));
  els.items.replaceChildren();
  for (const item of plan.items || []) {
    const box = document.createElement("input"); box.type = "checkbox"; box.checked = true; box.dataset.agentField = item.fieldId;
    const body = document.createElement("div");
    body.append(make("div", fieldLabelOf(item.fieldId), "item-title"));
    if (!item.sourcePath && item.value) {
      const editor = document.createElement("textarea");
      editor.className = "value-editor";
      editor.value = item.value;
      editor.dataset.agentValue = item.fieldId;
      const limit = fieldLimitOf(item.fieldId);
      const counter = make("div", "", "meta");
      const update = () => { counter.textContent = limit ? `${editor.value.length}/${limit} 字${editor.value.length > limit ? "（超出，请删减）" : ""}` : `${editor.value.length} 字`; };
      editor.addEventListener("input", update);
      update();
      body.append(editor, counter);
    } else {
      body.append(make("div", previews[item.fieldId] || item.value || `读取本机资料：${item.sourcePath}`, "value"));
    }
    body.append(make("div", `置信度 ${Math.round((item.confidence || 0) * 100)}% · ${item.reason || "未提供理由"}`, "meta"));
    const evidence = (item.evidence || []).map((entry) => [entry.source, entry.section, entry.excerpt].filter(Boolean).join(" / ")).join("\n");
    if (evidence) body.append(make("div", `依据：${evidence}`, "meta"));
    const row = document.createElement("label"); row.className = "item"; row.append(box, body); els.items.append(row);
  }
  els.applyBtn.disabled = !(plan.items || []).length;
}

async function applySelected() {
  const fieldIds = [...document.querySelectorAll("[data-agent-field]:checked")].map((box) => box.dataset.agentField);
  if (!fieldIds.length) return feedback("请至少选择一项。", true);
  const overrides = {};
  for (const editor of document.querySelectorAll("[data-agent-value]")) {
    if (fieldIds.includes(editor.dataset.agentValue)) overrides[editor.dataset.agentValue] = editor.value.trim();
  }
  els.applyBtn.disabled = true; feedback("正在回到原招聘网页填写所选普通字段...");
  try {
    const result = await send({ type: "OJAF_APPLY_AGENT_PLAN", payload: { sessionId, fieldIds, overrides } });
    let remembered = "";
    if (els.rememberAnswers.checked && Object.keys(overrides).length) {
      const entries = Object.entries(overrides).filter(([, answer]) => answer).map(([fieldId, answer]) => ({ question: fieldLabelOf(fieldId), answer }));
      const saved = await send({ type: "OJAF_SAVE_ANSWER_LIBRARY", payload: { entries } }).catch(() => null);
      if (saved) remembered = ` 问答库新增 ${saved.createdCount || 0} 题、更新 ${saved.updatedCount || 0} 题。`;
    }
    feedback(`已填写 ${result.filled || 0} 项，待处理 ${Number(result.failed || 0) + Number(result.skipped || 0)} 项。${remembered}最终提交仍需你手动完成。`, false, true);
  } catch (error) { feedback(`填写失败：${error.message}`, true); els.applyBtn.disabled = false; }
}

async function cancelSession() {
  els.cancelBtn.disabled = true;
  try { await send({ type: "OJAF_AGENT_CANCEL_SESSION", payload: { sessionId } }); renderState({ state: "cancelled", fieldCount: currentSession?.fieldCount }); }
  catch (error) { feedback(`取消失败：${error.message}`, true); els.cancelBtn.disabled = false; }
}

function make(tag, value, className = "") { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; }
function setStage(value, error = false) { els.stage.textContent = value; els.stage.classList.toggle("error", error); }
function feedback(value, error = false, success = false) { els.applyFeedback.textContent = value; els.applyFeedback.className = `feedback${error ? " error" : success ? " success" : ""}`; }
function send(message) { return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, (response) => { const error = chrome.runtime.lastError; if (error) return reject(new Error(error.message)); if (!response?.ok) return reject(new Error(response?.error || "扩展后台请求失败。")); resolve(response.data); })); }
