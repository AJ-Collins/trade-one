FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY server.ts ./
RUN npx tsc server.ts --target ES2020 --module commonjs --esModuleInterop true --skipLibCheck true
EXPOSE 3099
CMD ["node", "server.js"]