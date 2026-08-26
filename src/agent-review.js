const params = new URLSearchParams(location.search);
const sessionId = params.get("session") || "";
const els = {
  stage: document.getElementById("stage"), summary: document.getElementById("summary"),
  warnings: document.getElementById("warnings"), planCard: document.getElementById("planCard"),
  items: document.getElementById("items"), selectAll: document.getElementById("selectAll"),
  applyBtn: document.getElementById("applyBtn"), cancelBtn: document.getElementById("cancelBtn"),
  applyFeedback: document.getElementById("applyFeedback")
};
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
    if (currentSession.state === "review_ready") {
      previews = (await send({ type: "OJAF_AGENT_PLAN_PREVIEWS", payload: { sessionId } })).previews || {};
      renderPlan(currentSession.plan);
      return;
    }
    if (!["failed", "cancelled", "expired"].includes(currentSession.state)) pollTimer = setTimeout(poll, 1500);
  } catch (error) { setStage(`读取任务失败：${error.message}`, true); }
}

function renderState(session) {
  const labels = { queued: "等待 Codex", running: "Agent 正在读取已授权资料并生成方案", awaiting_agent: "等待 MCP Agent 领取任务", review_ready: "方案已生成，请逐项核对", failed: "任务失败", cancelled: "任务已取消", expired: "任务已过期" };
  setStage(labels[session.state] || session.state, session.state === "failed");
  els.summary.textContent = session.error || `已扫描 ${session.fieldCount || 0} 个字段。`;
}

function renderPlan(plan = {}) {
  els.planCard.hidden = false;
  els.summary.textContent = plan.summary || `Agent 提供了 ${(plan.items || []).length} 条普通字段建议。`;
  els.warnings.replaceChildren(...(plan.warnings || []).map((warning) => make("p", `提醒：${warning}`)));
  els.items.replaceChildren();
  for (const item of plan.items || []) {
    const box = document.createElement("input"); box.type = "checkbox"; box.checked = true; box.dataset.agentField = item.fieldId;
    const body = document.createElement("div");
    body.append(make("div", item.fieldId, "item-title"));
    body.append(make("div", previews[item.fieldId] || item.value || `读取本机资料：${item.sourcePath}`, "value"));
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
  els.applyBtn.disabled = true; feedback("正在回到原招聘网页填写所选普通字段...");
  try {
    const result = await send({ type: "OJAF_APPLY_AGENT_PLAN", payload: { sessionId, fieldIds } });
    feedback(`已填写 ${result.filled || 0} 项，待处理 ${Number(result.failed || 0) + Number(result.skipped || 0)} 项。最终提交仍需你手动完成。`, false, true);
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
