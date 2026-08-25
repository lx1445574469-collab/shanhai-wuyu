# 山海问道 · 无隅《道德经》知识问答（后端）

让游戏里的引路人「无隅」基于《道德经》原文，回答游客的提问。纯本地向量检索 + DeepSeek 生成，零第三方依赖。

## 架构

```
手机/电脑浏览器(山海问道H5)
   │  fetch POST /api/chat  （SSE 流式，前端不带任何密钥）
   ▼
Node 后端 server.js  （零依赖，内置 http/fetch）
   ├─ 检索：rag.js 本地 TF-IDF 向量（字 unigram + 二字 bigram），余弦相似度取 top-4
   └─ 生成：DeepSeek Chat（配置 DEEPSEEK_API_KEY 后启用；未配置则回退为「原文检索结果」演示）
   ▼
静态托管 shanhai_deploy/（前端 H5）
```

- **为什么必须加后端**：网页前端不能直连大模型 API（密钥会暴露），所以由后端代理。
- **向量化用的是啥**：每个章节/问题表示为「字 unigram + 二字 bigram」的 TF-IDF 稀疏向量，余弦相似度排序。这是真·向量检索，且**完全离线、无需网络或 embedding 服务**。《道德经》仅 81 章，体量极小，足够。
- **想升级为稠密语义向量**：把 `rag.js` 里的向量换成 embedding 模型（如 DeepSeek/OpenAI 的 embedding，或本地 `transformers.js` 模型）输出即可，检索接口不变。

## 运行

```bash
cd shanhai_ai
cp .env.example .env          # 填入 DEEPSEEK_API_KEY
node server.js                # 或 npm start
```

启动后访问 `http://localhost:3000` 即为带 AI 问答的完整游戏。

## 配置

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | LLM 密钥。支持 DeepSeek 官方 Key（`sk-` 开头，https://platform.deepseek.com/）或 OpenRouter Key（`sk-or-v1-` 开头，https://openrouter.ai/，自动经 OpenRouter 路由调用 DeepSeek）。**不配置也能跑**，只是问答回退为原文检索演示。 |
| `LLM_API_KEY` | 同上别名（优先于 `DEEPSEEK_API_KEY`）。 |
| `LLM_BASE_URL` | 可选，显式覆盖推理端点。 |
| `LLM_MODEL` | 可选，显式覆盖模型名（默认 DeepSeek 官方为 `deepseek-chat`，OpenRouter 路由为 `deepseek/deepseek-chat`）。 |
| `PORT` | 服务端口，默认 3000。 |

> 健壮性：密钥未配置、额度耗尽或调用失败时，`/api/chat` 会自动降级为「原文检索」回答（附相关章节），游戏不中断。

## 接口

- `GET /api/health` → `{ ok, llm, chapters, note }`
- `POST /api/chat`（SSE）  
  请求体：`{ "q": "什么是真正的强大？", "level": "第8关 · 太清宫·问强" }`  
  响应流：`data: {"type":"context","chapters":[...]}` 然后若干 `data: {"type":"token","text":"..."}` 最后 `data: {"type":"done"}`

## 前端怎么接

游戏「六个板块」里的 **「问无隅」**（原「对读模式」）面板即对话入口：输入问题 → 调 `/api/chat` → 无隅气泡逐字流式显示，并标注引用了哪些章节。
前端代码在 `shanhai/game.js` 的 `renderWuyuChat()`。

## 关于《道德经》语料

`corpus/daodejing.js` 内置的是**王弼本通行版校勘参考文本**，用于跑通流程。
**生产/正式对外前，请替换为权威校勘本**（如中华书局《老子道德经注校释》或你认可的版本），直接覆盖该文件即可，检索与接口无需改动。

## 部署说明

- 当前 CloudStudio 静态托管**只托管前端、不运行 Node 服务**，因此线上链接默认走「未配置密钥」演示态（问答会回退为原文检索）。
- 要让线上也有 AI 对话，需把本目录部署到任意能跑 Node 的主机（如云服务器、Railway、Render、腾讯云函数等），并用环境变量注入 `DEEPSEEK_API_KEY`。
