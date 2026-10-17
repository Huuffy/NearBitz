FROM node:20-alpine AS base

# System deps for native modules (pg uses node-gyp on some platforms)
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./

# ── Dev stage (includes nodemon, hot-reload via volume mount) ─────────────────
FROM base AS dev
RUN npm install
RUN mkdir -p uploads
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ── Production stage (lean, no devDependencies) ───────────────────────────────
FROM base AS production
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p uploads
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "server.js"]
