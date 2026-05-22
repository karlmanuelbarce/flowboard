FROM node:20-alpine

WORKDIR /app/api

COPY api/package*.json ./
RUN npm install

COPY api/ ./

RUN npx prisma generate

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npx nodemon --exec ts-node src/server.ts"]
