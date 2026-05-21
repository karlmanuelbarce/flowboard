FROM node:20-alpine

WORKDIR /app/api

COPY package*.json ./
RUN npm install

COPY api/ ./

RUN npx prisma generate

EXPOSE 3000

CMD ["npx", "nodemon", "--exec", "ts-node", "src/server.ts"]
