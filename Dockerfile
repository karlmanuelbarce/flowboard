FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY api/ ./api/

WORKDIR /app/api

RUN npx prisma generate

EXPOSE 3000

CMD ["npx", "nodemon", "--exec", "ts-node", "src/server.ts"]
