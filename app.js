const STORAGE_KEY = "xu-qiu-qiao-demo-v1";

const questions = [
  {
    title: "报名人数上限",
    question: "了解。先把报名规则说清楚：活动最多接受多少人报名？达到上限后，页面需要提示名额已满吗？",
    choices: ["最多 100 人", "不限人数", "还没确定"],
    acceptance: (answer) => answer.includes("100")
      ? "第 101 位用户提交报名时，系统提示名额已满，且不创建报名记录。"
      : answer.includes("不限")
        ? "报名页面不限制报名人数，用户提交后可看到报名成功提示。"
        : "报名人数上限保持待确认；确认前不将名额限制视为已交付。",
  },
  {
    title: "报名取消规则",
    question: "报名提交后，参与者可以自己取消吗？如果可以，取消后要释放一个名额吗？",
    choices: ["可以取消并释放名额", "不允许取消", "还没确定"],
    acceptance: (answer) => answer.includes("可以")
      ? "报名者取消报名后，名单中移除该报名，剩余名额同步增加。"
      : answer.includes("不允许")
        ? "报名者无法自行取消报名，页面说明取消方式或联系负责人。"
        : "取消与名额释放规则保持待确认。",
  },
  {
    title: "名单查看与导出",
    question: "报名名单需要由谁查看？需要导出成 Excel 或 CSV 吗？",
    choices: ["负责人可查看并导出", "只在网页查看", "还没确定"],
    acceptance: (answer) => answer.includes("导出")
      ? "活动负责人可查看完整报名名单，并导出含报名信息的表格文件。"
      : answer.includes("网页")
        ? "活动负责人可在网页查看报名名单，不提供文件导出。"
        : "名单查看权限与导出方式保持待确认。",
  },
  {
    title: "签到方式",
    question: "最后确认一下签到：参与者现场扫码签到，还是由工作人员核对名单？",
    choices: ["参与者扫码签到", "工作人员核对名单", "暂不确定"],
    acceptance: (answer) => answer.includes("扫码")
      ? "参与者扫描签到二维码后，系统记录签到状态与时间；重复扫码会提示已签到。"
      : answer.includes("工作人员")
        ? "工作人员可按报名名单查找参与者并标记签到状态。"
        : "签到流程保持待确认；不把任何签到方式写入交付范围。",
  },
];

const initialState = () => ({
  step: 0,
  answers: [],
  confirmed: [],
  extraRequirements: [],
  messages: [],
  started: false,
});

let state = loadState();
let toastTimer;
let replyTimer;
let isThinking = false;

const $ = (selector) => document.querySelector(selector);
const chatMessages = $("#chatMessages");
const chatScroll = $("#chatScroll");
const answerInput = $("#answerInput");
const sendButton = $("#sendButton");
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
    const choices = !user && isLatestMessage && state.step < questions.length && message.choices?.length
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
  const ready = state.started && state.step < questions.length && !isThinking;
  answerInput.disabled = !ready;
  sendButton.disabled = !ready;
  answerInput.placeholder = ready ? "回答问题，或补充你的想法…" : "需求梳理已完成，可以确认清单或导出文档";
}

function startConversation() {
  if (state.started) return;
  state.started = true;
  addMessage("assistant", "你好，我是需求小助手。我们先从一个想法开始：\n\n“想做个活动报名网站，能报名、能签到就行。”\n\n我会把不清楚的地方逐项问出来。你可以选一个快速回答，也可以自己输入。", questions[0].choices);
  renderRequirements();
}

function submitAnswer(value) {
  const answer = String(value || "").trim();
  if (!answer || !state.started || state.step >= questions.length) return;
  const currentQuestion = questions[state.step];
  addMessage("user", answer);
  state.answers[state.step] = answer;
  state.step += 1;
  state.confirmed[state.step - 1] = false;
  isThinking = true;
  answerInput.value = "";
  updateProgress();
  renderRequirements();
  showTyping();

  replyTimer = window.setTimeout(() => {
    hideTyping();
    isThinking = false;
    if (state.step < questions.length) {
      const next = questions[state.step];
      addMessage("assistant", `收到，我先记为草稿。\n\n${next.question}`, next.choices);
    } else {
      addMessage("assistant", "好的，四个关键点都整理好了。我把你的回答放进右侧需求清单，并生成了对应的验收草稿。\n\n你可以逐项确认；如果有不准确的地方，也可以重新开始再梳理。记得和客户一起核对，尤其是标为「待确认」的内容。", []);
      showToast("需求草稿已生成，记得与客户共同确认");
    }
    renderRequirements();
    saveState();
  }, 480);
  saveState();
}

function showTyping() { $("#typingIndicator").classList.remove("hidden"); chatScroll.scrollTop = chatScroll.scrollHeight; }
function hideTyping() { $("#typingIndicator").classList.add("hidden"); }

function getRequirementData() {
  return questions.map((question, index) => ({
    id: `question-${index}`,
    title: question.title,
    answer: state.answers[index],
    pending: !state.answers[index] || /还没确定|暂不确定/.test(state.answers[index]),
    confirmed: Boolean(state.confirmed[index]),
    acceptance: state.answers[index] ? question.acceptance(state.answers[index]) : "等待补充信息后生成验收标准。",
  })).concat(state.extraRequirements.map((item) => ({ ...item, pending: true, confirmed: false })));
}

function renderRequirements() {
  const items = getRequirementData();
  $("#requirementsList").innerHTML = items.map((item) => {
    const badge = item.pending ? "待确认" : item.confirmed ? "已确认" : "待确认";
    const answerLine = item.answer ? `回答：${item.answer}` : "等待回答";
    return `<article class="requirement-card ${item.confirmed ? "confirmed" : ""}"><button class="requirement-check" type="button" data-confirm="${escapeHtml(item.id)}" aria-label="${item.confirmed ? "取消确认" : "确认此需求"}" title="${item.confirmed ? "取消确认" : "确认此需求"}">${item.confirmed ? "✓" : ""}</button><div class="requirement-content"><div class="requirement-title"><strong>${escapeHtml(item.title)}</strong> · ${escapeHtml(item.answer || "尚未补充")}</div><div class="requirement-source">${escapeHtml(answerLine)}</div></div><span class="status-badge">${badge}</span></article>`;
  }).join("");

  $("#requirementsList").querySelectorAll("[data-confirm]").forEach((button) => {
    button.addEventListener("click", () => toggleConfirmation(button.dataset.confirm));
  });

  const acceptance = items.filter((item) => item.answer).map((item) => item.acceptance);
  $("#checkCount").textContent = `${acceptance.length} 项`;
  $("#acceptanceList").innerHTML = acceptance.length
    ? acceptance.map((text) => `<div class="acceptance-item"><span class="acceptance-box"></span><span>${escapeHtml(text)}</span></div>`).join("")
    : '<div class="empty-checks"><span class="empty-check-icon">✓</span><p>回答澄清问题后，验收检查项会在这里生成</p></div>';

  const hasAnyAnswer = state.answers.some(Boolean);
  const unresolved = items.some((item) => item.pending);
  const allConfirmed = questions.every((_, index) => state.confirmed[index]);
  $("#docStatus").textContent = !hasAnyAnswer
    ? "草稿 · 等待补充信息"
    : allConfirmed
      ? "已确认 · 可导出"
      : unresolved
        ? "草稿 · 部分内容待确认"
        : "草稿 · 等待双方确认";
  updateProgress();
}

function toggleConfirmation(id) {
  if (id.startsWith("extra-")) {
    showToast("新增需求需要先通过访谈补充验收规则");
    return;
  }
  const index = Number(id.slice("question-".length));
  if (!state.answers[index]) {
    showToast("先回答这个问题，再确认需求");
    return;
  }
  if (/还没确定|暂不确定/.test(state.answers[index])) {
    showToast("这个项目点仍待确认，不能标记为已确认");
    return;
  }
  state.confirmed[index] = !state.confirmed[index];
  saveState();
  renderRequirements();
  if (state.confirmed[index]) showToast("已标记为双方确认项");
}

function updateProgress() {
  const confirmed = questions.filter((_, index) => state.confirmed[index]).length;
  const percent = Math.round((confirmed / questions.length) * 100);
  $("#progressCount").textContent = `${confirmed} / ${questions.length} 项已确认`;
  $("#progressPercent").textContent = `${percent}%`;
  $("#progressBar").style.width = `${percent}%`;
  $("#progressText").textContent = confirmed === questions.length
    ? "需求清单已全部确认，可以导出交付草稿"
    : confirmed > 0
      ? `还有 ${questions.length - confirmed} 项待双方确认`
      : "先回答几个问题，让需求更完整";
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function exportMarkdown() {
  const items = getRequirementData();
  const lines = [
    "# 活动报名网站 · 需求确认草稿",
    "",
    `> 导出时间：${new Date().toLocaleString("zh-CN")}　|　由需求桥生成，请与客户共同确认。`,
    "",
    "## 需求清单",
    "",
    ...items.flatMap((item) => [
      `- [${item.confirmed ? "x" : " "}] **${item.title}**：${item.answer || "待补充"}（${item.pending ? "待确认" : item.confirmed ? "双方已确认" : "等待双方确认"}）`,
      `  - 验收草稿：${item.acceptance}`,
    ]),
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
  link.download = "需求桥-活动报名网站-需求草稿.md";
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
  showToast("已重新开始需求梳理");
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
$("#exportButton").addEventListener("click", exportMarkdown);
$("#resetButton").addEventListener("click", resetProject);
$("#newProject").addEventListener("click", resetProject);
$("#activeProject").addEventListener("click", () => showToast("当前演示项目：活动报名网站"));
$("#addRequirement").addEventListener("click", () => {
  const title = window.prompt("想补充哪一项需求？");
  if (!title?.trim()) return;
  state.extraRequirements.push({ id: `extra-${makeId()}`, title: title.trim(), answer: "新需求 · 等待双方讨论", acceptance: "请补充可观察、可验证的验收条件。" });
  saveState();
  renderRequirements();
  showToast("已添加到草稿；请补充并与客户确认");
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
  showToast("协作邀请暂不可用，正式版本中开放");
});

renderMessages();
renderRequirements();
if (!state.started) startConversation();
else renderRequirements();
