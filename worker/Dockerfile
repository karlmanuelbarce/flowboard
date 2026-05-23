FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY src/ ./src/
COPY tsconfig.json ./

CMD ["npx", "ts-node", "src/index.ts"]
