const STORAGE_KEY = "xu-qiu-qiao-demo-v2";
const exampleQuestions = {
  registration: [
    { title: "报名人数上限", question: "报名人数要不要设置上限？达到上限后，用户会看到什么？", choices: ["最多 100 人", "不限制人数", "还没确定"] },
    { title: "报名取消规则", question: "报名后参与者可以自己取消吗？取消后要释放名额吗？", choices: ["可以取消并释放名额", "不允许取消", "还没确定"] },
    { title: "名单权限与导出", question: "谁能查看报名名单？需要导出成表格吗？", choices: ["负责人可查看并导出", "只在网页查看", "还没确定"] },
    { title: "签到流程", question: "现场打算怎么签到？扫码，还是由工作人员核对名单？", choices: ["参与者扫码", "工作人员核对", "还没确定"] },
  ],
  commerce: [
    { title: "用户与权限", question: "哪些人会使用这个系统？需要区分普通用户和管理员吗？", choices: ["顾客和管理员", "只有内部员工", "还没确定"] },
    { title: "下单与付款", question: "下单后需要在线支付吗？要支持哪些付款方式？", choices: ["在线付款", "货到付款", "还没确定"] },
    { title: "订单变化规则", question: "下单后可以取消或修改订单吗？什么情况下不允许？", choices: ["发货前可取消", "提交后不可取消", "还没确定"] },
    { title: "库存与缺货", question: "库存不足时，用户还可以下单吗？", choices: ["不允许下单", "支持预售", "还没确定"] },
  ],
  generic: [
    { title: "使用者与权限", question: "谁会使用这个产品？不同使用者能做的事一样吗？", choices: ["用户和管理员", "只有一种角色", "还没确定"] },
    { title: "主要任务", question: "用户打开产品后，最重要的一件事是什么？", choices: ["查询信息", "提交或管理记录", "还没确定"] },
    { title: "关键业务规则", question: "完成这件事时，有没有数量、时间或状态限制？", choices: ["有数量限制", "有时间限制", "还没确定"] },
    { title: "验收方式", question: "你会怎样判断这个功能已经做好了？有什么必须通过的例子？", choices: ["用测试案例检查", "由用户试用确认", "还没确定"] },
  ],
};

const initialState = () => ({
  step: 0,
  answers: [],
  requirements: [],
  messages: [],
  started: false,
  done: false,
  projectName: "新需求项目",
  changeLog: [],
});

let state = loadState();
let toastTimer;
let replyTimer;
let isThinking = false;
let aiConnected = false;

const $ = (selector) => document.querySelector(selector);
const chatMessages = $("#chatMessages");
const chatScroll = $("#chatScroll");
const answerInput = $("#answerInput");
const sendButton = $("#sendButton");
const finishButton = $("#finishButton");
const answerForm = $("#answerForm");

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.answers) && Array.isArray(saved.messages)) {
      return { ...initialState(), ...saved };
    }
  } catch (error) {
    console.warn("无法读取本地项目草稿", error);
  }
  return initialState();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("无法保存本地项目草稿", error);
    showToast("本地保存失败，请检查浏览器存储空间");
  }
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function addMessage(role, text, choices = []) {
  state.messages.push({ id: makeId(), role, text, choices });
  renderMessages();
  saveState();
}

function renderMessages() {
  chatMessages.innerHTML = state.messages.map((message) => {
    const user = message.role === "user";
    const avatar = user
      ? '<span class="message-avatar">林</span>'
      : '<span class="message-avatar"><svg viewBox="0 0 24 24"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/></svg></span>';
    const bubble = `<div class="bubble">${escapeHtml(message.text)}</div>`;
    const content = `<div>${bubble}<div class="chat-time">${user ? "你" : "需求小助手"} · 刚刚</div></div>`;
    const isLatestMessage = message.id === state.messages.at(-1)?.id;
    const choices = !user && isLatestMessage && !state.done && message.choices?.length
      ? `<div class="quick-replies">${message.choices.map((choice) => `<button class="quick-reply" type="button" data-answer="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`).join("")}</div>`
      : "";
    return `<article class="message ${user ? "user" : "assistant"}">${user ? content + avatar : avatar + content}</article>${choices}`;
  }).join("");

  chatMessages.querySelectorAll("[data-answer]").forEach((button) => {
    button.addEventListener("click", () => submitAnswer(button.dataset.answer));
  });
  chatScroll.scrollTop = chatScroll.scrollHeight;
  updateComposer();
}

function updateComposer() {
  const ready = state.started && !isThinking;
  answerInput.disabled = !ready;
  sendButton.disabled = !ready;
  finishButton.disabled = !ready || state.answers.length === 0;
  answerInput.placeholder = ready
    ? "描述需求、补充细节，或告诉我哪里需要修改…"
    : "正在整理…";
}

function startConversation() {
  if (state.started) return;
  state.started = true;
  addMessage("assistant", "你好，我是需求小助手。先用自己的话描述你想做什么，也可以补充目标用户、关键功能或你担心的规则。我会根据你的项目继续追问，不确定的内容会留在待确认清单里。", ["我想做一个活动报名网站", "我想做一个电商下单系统"]);
}

function projectQuestionSet(story) {
  if (/报名|活动|签到|参与者|名额/.test(story)) return exampleQuestions.registration;
  if (/电商|商品|订单|购物|支付|下单/.test(story)) return exampleQuestions.commerce;
  return exampleQuestions.generic;
}

function currentFallbackQuestion() {
  return projectQuestionSet(state.answers[0] || "")[state.step - 1];
}

function fallbackResponse(answer, finishRequested) {
  const response = {
    reply: "我先把这部分整理进草稿。你可以继续补充细节，或修改前面的内容。",
    choices: [],
    requirements: [...state.requirements],
    done: false,
  };

  if (finishRequested) {
    response.done = true;
    response.reply = "需求草稿已整理。右侧列出了目前明确的范围和验收草稿；标为“待补充”的条目还需要你和客户讨论确认。你也可以继续输入修改意见，或者导出文档。";
    return response;
  }

  if (state.step === 1) {
    state.projectName = /报名|活动|签到/.test(answer)
      ? "活动报名网站"
      : /电商|订单|购物|下单/.test(answer)
        ? "电商下单系统"
        : answer.trim().slice(0, 18) || "新需求项目";
    response.requirements = [{
      id: "project-goal",
      title: "项目目标",
      detail: answer,
      acceptance: "待补充：请明确用户要完成的核心任务，以及可观察的成功结果。",
      status: "待补充",
    }];
    const next = projectQuestionSet(answer)[0];
    response.reply = `我理解这个项目的目标是“${answer}”。先确认一个关键点：${next.question}`;
    response.choices = next.choices;
    return response;
  }

  const set = projectQuestionSet(state.answers[0] || "");
  const answeredQuestion = set[state.step - 2];
  if (answeredQuestion) {
    const item = {
      id: `item-${state.step - 1}`,
      title: answeredQuestion.title,
      detail: answer,
      acceptance: /还没确定|不确定|待定/.test(answer)
        ? "待补充：确认业务规则后，补充一条可验证的验收条件。"
        : `系统按“${answer}”执行。验收时使用该规则设计通过和不通过的测试案例。`,
      status: /还没确定|不确定|待定/.test(answer) ? "待补充" : "待确认",
    };
    const existingIndex = response.requirements.findIndex((requirement) => requirement.id === item.id);
    if (existingIndex >= 0) response.requirements[existingIndex] = item;
    else response.requirements.push(item);
    response.reply = `已记下“${answeredQuestion.title}”：${answer}。`;
  } else {
    response.requirements.push({
      id: `note-${state.step}`,
      title: "补充说明",
      detail: answer,
      acceptance: "待补充：和客户确认这条说明是否属于本期交付范围。",
      status: "待补充",
    });
    response.reply = "已将这条补充记入需求草稿，验收条件还需要进一步明确。";
  }

  const next = set[state.step - 1];
  if (next && !finishRequested) {
    response.reply += `\n\n${next.question}`;
    response.choices = next.choices;
  }
  return response;
}

async function fetchModelResponse() {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: state.messages.map(({ role, text }) => ({ role, content: text })) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "模型暂时不可用");
  return result;
}

function normalizeRequirements(incoming) {
  const previous = new Map(state.requirements.map((item) => [item.id, item]));
  return (Array.isArray(incoming) ? incoming : []).slice(0, 12).map((item, index) => {
    const id = String(item.id || `requirement-${index + 1}`);
    const old = previous.get(id);
    const detail = String(item.detail || "待补充");
    const unchanged = old && old.detail === detail && old.acceptance === item.acceptance;
    return {
      id,
      title: String(item.title || `需求 ${index + 1}`),
      detail,
      acceptance: String(item.acceptance || "待补充验收条件"),
      status: ["待补充", "待确认"].includes(item.status) ? item.status : "待确认",
      confirmed: unchanged && old.confirmed === true,
    };
  });
}

async function submitAnswer(value, { finish = false } = {}) {
  const answer = String(value || "").trim();
  if (!answer || !state.started || state.done || isThinking) return;
  addMessage("user", answer);
  state.answers.push(answer);
  state.step += 1;
  state.done = false;
  isThinking = true;
  answerInput.value = "";
  renderRequirements();
  showTyping();
  saveState();

  try {
    const response = aiConnected ? await fetchModelResponse() : fallbackResponse(answer, finish);
    state.requirements = normalizeRequirements(response.requirements);
    state.done = Boolean(response.done);
    state.projectName = response.projectName || state.projectName;
    addMessage("assistant", response.reply, response.choices);
    state.changeLog.push({ at: new Date().toISOString(), action: finish ? "整理需求草稿" : "更新需求草稿" });
    renderRequirements();
    saveState();
  } catch (error) {
    console.error(error);
    aiConnected = false;
    updateAiMode(error.message);
    const response = fallbackResponse(answer, finish);
    state.requirements = normalizeRequirements(response.requirements);
    state.done = Boolean(response.done);
    addMessage("assistant", `模型连接失败，已切换到本地演示逻辑。${error.message}\n\n${response.reply}`, response.choices);
    renderRequirements();
    saveState();
  } finally {
    isThinking = false;
    hideTyping();
    updateComposer();
  }
}

function updateAiMode(errorMessage = "") {
  const mode = $("#aiMode");
  mode.classList.toggle("connected", aiConnected);
  mode.classList.toggle("local", !aiConnected);
  mode.innerHTML = `<i></i> ${aiConnected ? "AI 模型已连接" : "本地演示逻辑"}`;
  mode.title = errorMessage || (aiConnected ? "回复将通过本地后端请求已配置的模型" : "配置 .env 后可启用真实模型对话");
}

async function checkModelConnection() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const health = await response.json();
    aiConnected = Boolean(response.ok && health.configured);
  } catch {
    aiConnected = false;
  }
  updateAiMode();
}

function showTyping() {
  $("#typingIndicator").classList.remove("hidden");
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

function hideTyping() { $("#typingIndicator").classList.add("hidden"); }

function renderRequirements() {
  const items = state.requirements;
  $("#requirementsList").innerHTML = items.length
    ? items.map((item) => {
      const confirmed = item.confirmed && item.status !== "待补充";
      const badge = item.status === "待补充" ? "待补充" : confirmed ? "已确认" : "待确认";
      return `<article class="requirement-card ${confirmed ? "confirmed" : ""}"><button class="requirement-check" type="button" data-confirm="${escapeHtml(item.id)}" aria-label="${confirmed ? "取消确认" : "确认此需求"}" title="${confirmed ? "取消确认" : "确认此需求"}">${confirmed ? "✓" : ""}</button><div class="requirement-content"><div class="requirement-title"><strong>${escapeHtml(item.title)}</strong></div><div class="requirement-detail">${escapeHtml(item.detail)}</div><div class="requirement-source">验收：${escapeHtml(item.acceptance)}</div></div><span class="status-badge ${item.status === "待补充" ? "pending" : ""}">${badge}</span><div class="requirement-actions"><button type="button" data-edit="${escapeHtml(item.id)}" aria-label="编辑 ${escapeHtml(item.title)}" title="编辑">✎</button><button type="button" data-delete="${escapeHtml(item.id)}" aria-label="删除 ${escapeHtml(item.title)}" title="删除">×</button></div></article>`;
    }).join("")
    : '<div class="empty-checks"><span class="empty-check-icon">✳</span><p>描述项目想法后，需求和验收标准会在这里逐步形成</p></div>';

  $("#requirementsList").querySelectorAll("[data-confirm]").forEach((button) => {
    button.addEventListener("click", () => toggleConfirmation(button.dataset.confirm));
  });
  $("#requirementsList").querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => editRequirement(button.dataset.edit));
  });
  $("#requirementsList").querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteRequirement(button.dataset.delete));
  });

  const acceptance = items.filter((item) => item.acceptance).map((item) => item.acceptance);
  $("#checkCount").textContent = `${acceptance.length} 项`;
  $("#acceptanceList").innerHTML = acceptance.length
    ? acceptance.map((text) => `<div class="acceptance-item"><span class="acceptance-box"></span><span>${escapeHtml(text)}</span></div>`).join("")
    : '<div class="empty-checks"><span class="empty-check-icon">✓</span><p>补充需求后，验收条件会在这里生成</p></div>';

  const unresolved = items.some((item) => !item.confirmed || item.status === "待补充");
  const confirmed = items.filter((item) => item.confirmed && item.status !== "待补充").length;
  $("#docStatus").textContent = !items.length
    ? "草稿 · 等待需求描述"
    : unresolved
      ? "草稿 · 有待确认内容"
      : "已确认 · 可导出";
  $("#projectTitle").textContent = state.projectName;
  $("#activeProjectName").textContent = state.projectName;
  $("#progressCount").textContent = `${confirmed} / ${items.length} 项已确认`;
  const percent = items.length ? Math.round((confirmed / items.length) * 100) : 0;
  $("#progressPercent").textContent = `${percent}%`;
  $("#progressBar").style.width = `${percent}%`;
  $("#progressText").textContent = !items.length
    ? "先描述项目想法，AI 会针对你的场景提问"
    : !unresolved
      ? "需求清单已全部确认，可以导出交付草稿"
      : `还有 ${items.length - confirmed} 项待双方确认`;
}

function toggleConfirmation(id) {
  const item = state.requirements.find((requirement) => requirement.id === id);
  if (!item) return;
  if (item.status === "待补充") {
    showToast("验收条件还不完整，请先补充后再确认");
    return;
  }
  item.confirmed = !item.confirmed;
  item.status = item.confirmed ? "已确认" : "待确认";
  state.changeLog.push({ at: new Date().toISOString(), action: `${item.confirmed ? "确认" : "取消确认"}：${item.title}` });
  saveState();
  renderRequirements();
  showToast(item.confirmed ? "已标记为双方确认项" : "已取消确认状态");
}

function editRequirement(id) {
  const item = state.requirements.find((requirement) => requirement.id === id);
  if (!item) return;
  const detail = window.prompt("修改需求描述", item.detail);
  if (detail === null) return;
  const acceptance = window.prompt("修改验收条件", item.acceptance);
  if (acceptance === null) return;
  item.detail = detail.trim() || "待补充";
  item.acceptance = acceptance.trim() || "待补充验收条件";
  item.status = acceptance.trim() ? "待确认" : "待补充";
  item.confirmed = false;
  state.changeLog.push({ at: new Date().toISOString(), action: `修改：${item.title}` });
  addMessage("assistant", `我已更新“${item.title}”，并取消此前的确认状态。改过的内容需要双方重新确认。`);
  renderRequirements();
  showToast("已更新需求草稿");
}

function deleteRequirement(id) {
  const item = state.requirements.find((requirement) => requirement.id === id);
  if (!item || !window.confirm(`删除“${item.title}”？`)) return;
  state.requirements = state.requirements.filter((requirement) => requirement.id !== id);
  state.changeLog.push({ at: new Date().toISOString(), action: `删除：${item.title}` });
  saveState();
  renderRequirements();
  showToast("已从草稿中删除");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3000);
}

function exportMarkdown() {
  const items = state.requirements;
  const lines = [
    `# ${state.projectName} · 需求确认草稿`,
    "",
    `> 导出时间：${new Date().toLocaleString("zh-CN")}　|　由需求桥生成，请与客户共同确认。`,
    "",
    "## 需求清单",
    "",
    ...items.flatMap((item) => [
      `- [${item.confirmed ? "x" : " "}] **${item.title}**：${item.detail}（${item.status || "待确认"}）`,
      `  - 验收草稿：${item.acceptance}`,
    ]),
    "",
    "## 变更记录",
    "",
    ...(state.changeLog.length ? state.changeLog.map((entry) => `- ${new Date(entry.at).toLocaleString("zh-CN")}：${entry.action}`) : ["- 暂无变更记录。"]),
    "",
    "## 协作约定",
    "",
    "- AI 输出仅为草稿，需求范围与验收标准需由客户和开发者共同确认。",
    "- 未确认内容不视为已承诺的交付范围。",
    "- 变更发生时，请更新本清单并记录双方确认。",
    "",
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `需求桥-${state.projectName}-需求草稿.md`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("需求草稿已导出为 Markdown 文件");
}

function resetProject() {
  window.clearTimeout(replyTimer);
  isThinking = false;
  hideTyping();
  state = initialState();
  localStorage.removeItem(STORAGE_KEY);
  chatMessages.innerHTML = "";
  renderRequirements();
  startConversation();
  showToast("已开始一个新需求项目");
}

answerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAnswer(answerInput.value);
});
answerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    answerForm.requestSubmit();
  }
});
finishButton.addEventListener("click", () => submitAnswer("请把目前的信息整理成需求草稿，并列出还需要确认的问题。", { finish: true }));
$("#exportButton").addEventListener("click", exportMarkdown);
$("#resetButton").addEventListener("click", resetProject);
$("#newProject").addEventListener("click", resetProject);
$("#activeProject").addEventListener("click", () => showToast(`当前项目：${state.projectName}`));
$("#addRequirement").addEventListener("click", () => {
  const title = window.prompt("需求名称");
  if (!title?.trim()) return;
  const detail = window.prompt("需求描述");
  if (detail === null) return;
  const acceptance = window.prompt("验收条件（写清楚怎样才算完成）");
  if (acceptance === null) return;
  state.requirements.push({ id: makeId(), title: title.trim(), detail: detail.trim() || "待补充", acceptance: acceptance.trim() || "待补充验收条件", status: acceptance.trim() ? "待确认" : "待补充", confirmed: false });
  state.changeLog.push({ at: new Date().toISOString(), action: `新增：${title.trim()}` });
  saveState();
  renderRequirements();
  showToast("已添加到需求草稿");
});

const modalBackdrop = $("#modalBackdrop");
$("#shareButton").addEventListener("click", () => modalBackdrop.classList.remove("hidden"));
$("#modalClose").addEventListener("click", () => modalBackdrop.classList.add("hidden"));
modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) modalBackdrop.classList.add("hidden");
});
$("#inviteSend").addEventListener("click", () => {
  const input = $("#inviteEmail");
  if (input.value && !input.checkValidity()) {
    input.reportValidity();
    return;
  }
  modalBackdrop.classList.add("hidden");
  showToast("协作邀请功能尚未接入服务器");
});

renderMessages();
renderRequirements();
if (!state.started) startConversation();
checkModelConnection();
