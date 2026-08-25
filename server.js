// 山海问道 · 无隅《道德经》知识问答 后端
// 零依赖 Node 服务：托管前端静态文件 + /api/chat（SSE 流式）
// 检索：本地 TF-IDF 向量（rag.js，无需网络/密钥）
// 生成：DeepSeek Chat（配置密钥后启用；支持 DeepSeek 官方 与 经 OpenRouter 路由，未配置则回退为「原文检索结果」演示）

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DAODEJING } from "./corpus/daodejing.js";
import { buildIndex, query as ragQuery } from "./rag.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 静态目录：部署包自带 ./public；本地开发时回退 ../shanhai_deploy
const PUBLIC_DIR = path.resolve(__dirname, "public");
const SIBLING_DIR = path.resolve(__dirname, "../shanhai_deploy");
const STATIC_DIR = fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : SIBLING_DIR;
const PORT = process.env.PORT || 3000;

// 轻量 .env 加载（不依赖 dotenv）
function loadEnv() {
  const p = path.join(__dirname, ".env");
  try {
    const txt = fs.readFileSync(p, "utf8");
    txt.split("\n").forEach((line) => {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    });
  } catch (e) {
    /* 无 .env 文件则忽略 */
  }
}
loadEnv();

// LLM 配置：优先 LLM_API_KEY，兼容 DEEPSEEK_API_KEY
// 密钥若为 OpenRouter 格式（sk-or-v1-），自动切换到 OpenRouter 端点调用 DeepSeek
const LLM_KEY = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || "";
const IS_OPENROUTER = /^sk-or-v1-/.test(LLM_KEY);
const LLM_BASE_URL =
  process.env.LLM_BASE_URL ||
  (IS_OPENROUTER
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.deepseek.com/chat/completions");
const LLM_MODEL =
  process.env.LLM_MODEL || (IS_OPENROUTER ? "deepseek/deepseek-chat" : "deepseek-chat");
const LLM_PROVIDER = IS_OPENROUTER ? "DeepSeek（经 OpenRouter 路由）" : "DeepSeek 官方";

// 构建检索索引
const index = buildIndex(DAODEJING.map((d) => ({ ...d })));

const SYSTEM_PROMPT = `你是国风网页游戏《山海问道》里的引路人"无隅"，一位温和、博雅的少女向导。
玩家（游客）正游览崂山，就《道德经》向你提问。请遵循以下规则：
1. 只能依据下方提供的《道德经》原文作答，严禁编造经文之外的句子或伪造章节。
2. 回答用简体中文，语气平和、有古意但不生硬；先引原文关键句，再用白话阐释其义。
3. 若游客的问题原文并未涉及，如实说明"此义经文未直接言及"，并给出精神相近、可参考的章节。
4. 紧扣玩家正在游览的关卡意境（若提供），把道家智慧与眼前的山水、人事结合起来讲，不要掉书袋。
5. 篇幅适中（80~200字），一次说清一个点，不必面面俱到。`;

function retrieve(q, topK = 4) {
  return ragQuery(index, DAODEJING, q, topK).map(
    (r) => `第${r.chapter}章·${r.title}：${r.text}`
  );
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(d || "{}"));
      } catch (e) {
        resolve({});
      }
    });
  });
}

function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const filePath = path.normalize(path.join(STATIC_DIR, rel));
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
}

function sseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

function sendSSE(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function chapterLabel(hit) {
  const m = hit.match(/^第\d+章·[^：]+/);
  return m ? m[0] : hit.slice(0, 16);
}

async function handleChat(req, res) {
  const { q = "", level = "" } = await readBody(req);
  const question = String(q).slice(0, 200);
  if (!question.trim()) {
    sseHeaders(res);
    sendSSE(res, { type: "token", text: "（你似乎没有输入问题）" });
    sendSSE(res, { type: "done" });
    res.end();
    return;
  }

  const hits = retrieve(question, 4);
  const context = hits.join("\n\n");

  // 未配置密钥：回退为「原文检索结果」演示，保证流程可跑可测
  if (!LLM_KEY) {
    sseHeaders(res);
    sendSSE(res, { type: "context", chapters: hits.map(chapterLabel) });
    const demo =
      (level ? `（你正行至：${level}）\n\n` : "") +
      "当前未配置大模型密钥，以下为《道德经》中与「" +
      question +
      "」最相关的原文（共 " +
      hits.length +
      " 章）。配置 DEEPSEEK_API_KEY 后，无隅便会据此为你娓娓道来：\n\n" +
      context;
    sendSSE(res, { type: "token", text: demo });
    sendSSE(res, { type: "done" });
    res.end();
    return;
  }

  // 已配置密钥：调用大模型，流式转发
  try {
    const userMsg =
      (level ? `游客当前所在：${level}\n` : "") +
      `游客问：${question}\n\n可参考的《道德经》原文：\n${context}`;
    const body = {
      model: LLM_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      stream: true,
      temperature: 0.7,
    };
    const headers = {
      Authorization: `Bearer ${LLM_KEY}`,
      "Content-Type": "application/json",
    };
    if (IS_OPENROUTER) {
      // HTTP 头不允许非 ASCII 字符，标题用英文
      headers["HTTP-Referer"] = "https://shanhai.local";
      headers["X-Title"] = "Shanhai Wendao - Wuyu";
    }
    const apiRes = await fetch(LLM_BASE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!apiRes.ok) {
      await apiRes.text().catch(() => "");
      sseHeaders(res);
      sendSSE(res, { type: "context", chapters: hits.map(chapterLabel) });
      sendSSE(res, {
        type: "token",
        text:
          `（无隅暂时联系不上大模型（接口 ${apiRes.status}），先为你奉上《道德经》中与此问最相关的原文——）\n\n` +
          context,
      });
      sendSSE(res, { type: "done" });
      res.end();
      return;
    }
    sseHeaders(res);
    sendSSE(res, { type: "context", chapters: hits.map(chapterLabel) });

    const reader = apiRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (t) sendSSE(res, { type: "token", text: t });
        } catch (e) {
          /* 跳过不完整分片 */
        }
      }
    }
    sendSSE(res, { type: "done" });
    res.end();
  } catch (e) {
    sseHeaders(res);
    sendSSE(res, { type: "context", chapters: hits.map(chapterLabel) });
    sendSSE(res, {
      type: "token",
      text:
        `（无隅暂时联系不上大模型（${String(e.message || e).slice(0, 80)}），先为你奉上《道德经》中与此问最相关的原文——）\n\n` +
        context,
    });
    sendSSE(res, { type: "done" });
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const p = u.pathname;
  if (p === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        llm: !!LLM_KEY,
        provider: LLM_KEY ? LLM_PROVIDER : "无",
        chapters: DAODEJING.length,
        note: LLM_KEY
          ? `${LLM_PROVIDER} 已启用`
          : "未配置密钥，/api/chat 回退为原文检索演示",
      })
    );
    return;
  }
  if (p === "/api/chat" && req.method === "POST") {
    return handleChat(req, res);
  }
  return serveStatic(p, res);
});

server.listen(PORT, () => {
  console.log(`山海问道·无隅后端已启动：http://localhost:${PORT}`);
  console.log(`LLM：${LLM_KEY ? LLM_PROVIDER + " 已启用" : "未配置（回退原文检索演示）"}`);
  console.log(`《道德经》章节数：${DAODEJING.length}`);
});
