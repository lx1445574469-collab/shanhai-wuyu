# 山海问道 · 无隅 AI 后端 线上部署指南

这个文件夹是**自包含部署包**：`server.js`（API + 托管）+ `public/`（完整游戏前端）。
部署到任意能跑 Node 的主机后，访问该主机的网址 = 完整游戏 + 真 AI 问答（密钥已配好的前提下）。

**打包内容不含 `.env`（密钥），部署后需在平台面板里单独配置。**

---

## 方案 A：Render（推荐，免费档）

> Render 免费档：750 小时/月，够单个服务全天候跑；闲置 15 分钟会休眠，首次访问需等约 30~60 秒唤醒。

### 步骤

1. **把本文件夹传到 GitHub 仓库**（网页上传即可，不用装 git）：
   - 登录 github.com → 右上角 `+` → **New repository** → 名称如 `shanhai-wuyu` → Public → Create
   - 进入空仓库页 → 点 **uploading an existing file** 链接 → 把本文件夹内**所有文件**（含 `public/`、`corpus/` 子文件夹）拖进去 → Commit changes
   - 注意：GitHub 网页上传会保留子文件夹结构，确认 `public/index.html`、`corpus/daodejing.js` 路径正确

2. **在 Render 创建服务**：
   - 登录 render.com（可用 GitHub 账号直接登录）
   - Dashboard → **New** → **Blueprint**（选你的 `shanhai-wuyu` 仓库，会自动读取 `render.yaml`）
   - 若不走 Blueprint，也可以 **New → Web Service**，手动配置：
     - Runtime: `Node`
     - Build Command: `npm install`
     - Start Command: `node server.js`
     - Instance Type: `Free`
   - **Environment Variables** 里添加：
     - Key: `DEEPSEEK_API_KEY`　Value: 你的 `sk-...` 密钥

3. **部署完成**：Render 会给一个 `https://shanhai-wuyu.onrender.com` 形式的网址。
   验证：浏览器打开 `该网址/api/health`，应返回 `{"ok":true,"llm":true,"provider":"DeepSeek 官方","chapters":81}`。
   再打开游戏，点无隅立绘提问，即真 AI 流式回答。

---

## 方案 B：Hugging Face Spaces（Docker，免 GitHub）

> 适合不想用 GitHub 的情况；免费、常驻不休眠。

1. 登录 huggingface.co → 右上角头像 → **New Space**
   - Space name: 如 `shanhai-wuyu`；SDK 选 **Docker** → Blank 模板 → Public
2. 进入 Space → **Files** 标签 → **Add file → Upload files**
   - 把本文件夹所有文件拖入（含 `Dockerfile`、`public/`、`corpus/`），Commit
3. **Settings** → **Variables and secrets** → 新增 Secret：
   - Name: `DEEPSEEK_API_KEY`　Value: 你的 `sk-...` 密钥
4. Space 会自动构建，几分钟后访问 `https://<用户名>-shanhai-wuyu.hf.space`
   - 同样先开 `/api/health` 验证 `llm:true`

---

## 常见问题

| 问题 | 说明 |
|---|---|
| 打开后 /api/chat 说"未配置大模型密钥" | 平台环境变量没配好或没重启服务；在面板改完 env 后 Render 会自动重新部署 |
| 首次访问很慢 | Render 免费档冷启动，等半分钟再刷新 |
| 想换模型 | 环境变量加 `LLM_MODEL`（如 `deepseek-reasoner`）即可覆盖 |
| 旧 CloudStudio 链接 | 仍是纯静态、无 AI。把新地址发给别人即可，两者互不影响 |

## 本地试跑（部署前自测）

```bash
cd shanhai_ai_deploy
# 不配密钥也能跑（问答为原文检索演示）
node server.js
# 打开 http://localhost:3000/api/health
```
