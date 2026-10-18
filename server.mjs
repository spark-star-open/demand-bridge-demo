import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT || 8000);
const publicFiles = new Set(["index.html", "styles.css", "app.js"]);

async function loadLocalEnv() {
  try {
    const source = await readFile(resolve(root, ".env"), "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(data));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64_000) throw new Error("请求内容过大，请缩短需求描述后重试。");
  }
  return JSON.parse(body || "{}");
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

await loadLocalEnv();

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, {
      configured: Boolean(process.env.AI_API_KEY),
      model: process.env.AI_MODEL || "",
    });
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    if (!process.env.AI_API_KEY) {
      return sendJson(response, 503, { error: "尚未配置模型 API。请在本地 .env 中填写 AI_API_KEY。" });
    }

    try {
      const payload = await readBody(request);
      const messages = Array.isArray(payload.messages)
        ? payload.messages.slice(-24).filter((message) => ["user", "assistant"].includes(message.role))
        : [];
      if (!messages.length || messages.at(-1).role !== "user") {
        return sendJson(response, 400, { error: "请先输入一条需求描述。" });
      }

      const baseUrl = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
      const upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.AI_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.AI_MODEL || "gpt-4o-mini",
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            ...messages.map(({ role, content }) => ({ role, content: String(content).slice(0, 6000) })),
          ],
        }),
        signal: AbortSignal.timeout(45_000),
      });

      const result = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        const message = result.error?.message || `模型服务返回 HTTP ${upstream.status}`;
        return sendJson(response, 502, { error: message });
      }

      const content = result.choices?.[0]?.message?.content;
      if (!content) return sendJson(response, 502, { error: "模型没有返回可读取的内容。" });
      let answer;
      try {
        answer = JSON.parse(content);
      } catch {
        return sendJson(response, 502, { error: "模型返回格式不正确，请重试。" });
      }
      return sendJson(response, 200, normalizeAnswer(answer));
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : 502;
      return sendJson(response, status, { error: error.message || "连接模型失败，请检查本地配置和网络。" });
    }
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return sendJson(response, 405, { error: "不支持的请求方式。" });
  }

  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = resolve(root, `.${pathname}`);
  const relativePath = relative(root, file);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.split(sep).some((part) => part.startsWith(".")) ||
    !publicFiles.has(relativePath)
  ) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    await access(file);
    response.writeHead(200, { "content-type": contentTypes[extname(file)] || "application/octet-stream" });
    if (request.method === "HEAD") return response.end();
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`需求桥运行中：http://127.0.0.1:${port}`);
  console.log(process.env.AI_API_KEY ? `模型已配置：${process.env.AI_MODEL || "gpt-4o-mini"}` : "本地演示逻辑：请配置 .env 启用真实模型");
});

const systemPrompt = `你是“需求桥”的产品需求分析师，必须用中文和用户协作，把口语想法变成可确认、可验收的开发需求。

每轮先理解整个对话，再做这些事：
1. 维护一份累计的 requirements 数组；每项包含 id（稳定的简短英文标识）、title、detail、acceptance、status。status 只能是 "待确认"、"已确认" 或 "待补充"。用户没有明确说已确认时，一律保持待确认。
2. 发现关键歧义时，每轮只追问一个最影响范围的问题。根据项目和已经收到的回答选择问题；不要机械重复问已回答内容，不要只套固定的报名网站问题。
3. 追问可以覆盖用户角色、主流程、业务规则、边界情况、权限、数据和验收方式。只问与当前项目相关的问题，避免一次塞入过多问题。
4. acceptance 写成可观察、可验证的检查条件；信息不足时写“待补充：……”并保持待确认，不要编造。
5. 用户提出修改时更新对应需求；同时在 reply 简要说明修改了什么。如果用户指出冲突，保留双方说法并追问，不要擅自选一个。
6. 只有当用户明确要求“整理/总结/生成需求文档”时，将 done 设为 true；此时列出已明确需求、待确认项和验收草稿。不要承诺工期或费用。

你必须只返回 JSON 对象，格式为：
{"reply":"给用户看的简短回复和一个追问（若需要）","choices":["可选的简短回答A","可选的简短回答B"],"requirements":[{"id":"stable-id","title":"需求名称","detail":"目前达成的描述","acceptance":"可验证的验收条件","status":"待确认"}],"done":false}
如果不需要快捷回答，choices 返回空数组。保留已有需求并按对话增量更新，最多 12 项。`; 

function normalizeAnswer(answer) {
  const requirements = Array.isArray(answer.requirements)
    ? answer.requirements.slice(0, 12).map((item, index) => ({
      id: String(item.id || `requirement-${index + 1}`).slice(0, 80),
      title: String(item.title || `需求 ${index + 1}`).slice(0, 100),
      detail: String(item.detail || "待补充").slice(0, 1000),
      acceptance: String(item.acceptance || "待补充验收条件").slice(0, 1000),
      status: ["已确认", "待补充"].includes(item.status) ? item.status : "待确认",
    }))
    : [];
  return {
    reply: String(answer.reply || "我已更新需求草稿。还有哪一项需要补充？").slice(0, 3000),
    choices: Array.isArray(answer.choices) ? answer.choices.slice(0, 4).map((value) => String(value).slice(0, 80)) : [],
    requirements,
    done: Boolean(answer.done),
  };
}
