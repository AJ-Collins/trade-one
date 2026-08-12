FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json ./
COPY tsconfig.prisma.json ./
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate  # ← CHANGE THIS
COPY src ./src
COPY public ./public
RUN npm run build
RUN npx tsc -p tsconfig.prisma.json
RUN npm prune --omit=dev
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist/prisma.config.js ./
COPY package.json ./
RUN mkdir -p uploads/kyc
EXPOSE 5000
CMD ["node", "dist/server.js"]