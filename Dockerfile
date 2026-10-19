# base：共用的 Node 版本與依賴清單
FROM node:22.14.0 AS base
WORKDIR /usr/backend
COPY package.json package-lock.json ./

# dev：含 devDependencies（nodemon），原始碼由 compose bind mount
FROM base AS dev
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# prod：只裝 production 依賴
FROM base AS prod
ENV NODE_ENV=production
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
