const els = {
  clearAnswers: document.getElementById("clearAnswers"),
  search: document.getElementById("answerSearch"),
  count: document.getElementById("answerCount"),
  status: document.getElementById("pageStatus"),
  list: document.getElementById("answerList"),
  empty: document.getElementById("emptyState"),
  template: document.getElementById("answerTemplate")
};

let entries = [];

els.search.addEventListener("input", render);
els.clearAnswers.addEventListener("click", () => void clearAll());
void loadAnswers();

async function loadAnswers() {
  try {
    const result = await sendRuntimeMessage({ type: "OJAF_GET_ANSWER_LIBRARY" });
    entries = globalThis.Form2OfferAnswerLibrary.normalizeAnswerLibrary(result.entries);
    render();
  } catch (error) {
    setStatus(`读取问答库失败：${error.message}`, true);
  }
}

function render() {
  const query = String(els.search.value || "").trim().toLocaleLowerCase();
  const visible = entries.filter((entry) => !query || `${entry.question}\n${entry.answer}`.toLocaleLowerCase().includes(query));
  els.list.replaceChildren();
  visible.forEach((entry) => els.list.appendChild(createAnswerCard(entry)));
  els.count.textContent = query ? `显示 ${visible.length} / ${entries.length} 条` : `共 ${entries.length} 条`;
  els.empty.hidden = entries.length > 0;
  els.list.hidden = visible.length === 0;
  els.clearAnswers.disabled = entries.length === 0;
}

function createAnswerCard(entry) {
  const fragment = els.template.content.cloneNode(true);
  const card = fragment.querySelector(".answer-card");
  const question = fragment.querySelector(".question");
  const answer = fragment.querySelector(".answer");
  const updatedAt = fragment.querySelector(".updated-at");
  const save = fragment.querySelector(".save");
  const remove = fragment.querySelector(".delete");
  question.textContent = entry.question;
  answer.value = entry.answer;
  updatedAt.textContent = `最近更新：${formatDate(entry.updatedAt)}`;
  save.addEventListener("click", () => void saveEntry(entry, answer, save));
  remove.addEventListener("click", () => void deleteEntry(entry));
  card.dataset.answerId = entry.id;
  return fragment;
}

async function saveEntry(entry, answerElement, button) {
  const answer = String(answerElement.value || "").trim();
  if (!answer) {
    setStatus("答案不能为空。", true);
    answerElement.focus();
    return;
  }
  button.disabled = true;
  try {
    const result = await sendRuntimeMessage({
      type: "OJAF_SAVE_ANSWER_LIBRARY",
      payload: { entries: [{ ...entry, answer }] }
    });
    entries = globalThis.Form2OfferAnswerLibrary.normalizeAnswerLibrary(result.entries);
    setStatus("修改已保存在本机。", false);
    render();
  } catch (error) {
    setStatus(`保存失败：${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function deleteEntry(entry) {
  if (!window.confirm(`删除这条问答？\n\n${entry.question}`)) {
    return;
  }
  try {
    await sendRuntimeMessage({ type: "OJAF_DELETE_ANSWER_LIBRARY_ITEM", payload: { id: entry.id } });
    entries = entries.filter((item) => item.id !== entry.id);
    setStatus("已删除该问答。", false);
    render();
  } catch (error) {
    setStatus(`删除失败：${error.message}`, true);
  }
}

async function clearAll() {
  if (!window.confirm(`确认清空本机保存的 ${entries.length} 条问答？此操作无法撤销。`)) {
    return;
  }
  try {
    const result = await sendRuntimeMessage({ type: "OJAF_CLEAR_ANSWER_LIBRARY" });
    entries = [];
    setStatus(`已清空 ${result.clearedCount || 0} 条问答。`, false);
    render();
  } catch (error) {
    setStatus(`清空失败：${error.message}`, true);
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未知";
  }
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function setStatus(message, isError) {
  els.status.textContent = message;
  els.status.classList.toggle("error", Boolean(isError));
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else if (!response?.ok) {
        reject(new Error(response?.error || "Runtime message failed."));
      } else {
        resolve(response.data);
      }
    });
  });
}
