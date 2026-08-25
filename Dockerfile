# Hugging Face Spaces / 任意 Docker 主机通用
FROM node:20-alpine
WORKDIR /app
COPY . .
# HF Spaces Docker 默认要求监听 7860（平台会注入 PORT，此处为兜底）
ENV PORT=7860
EXPOSE 7860
CMD ["node", "server.js"]
