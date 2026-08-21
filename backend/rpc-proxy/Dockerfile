FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY server.ts ./
RUN npx tsc \
  --target ES2020 \
  --module commonjs \
  --esModuleInterop true \
  --skipLibCheck true \
  server.ts && \
  mv server.js server.cjs
EXPOSE 3099
CMD ["node", "server.cjs"]