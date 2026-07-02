# ── Build stage: install only production deps ────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# ── Final image ─────────────────────────────────────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js agent.js system-prompt.js ./

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "server.js"]
