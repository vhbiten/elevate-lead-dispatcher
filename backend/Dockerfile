FROM node:24-alpine

WORKDIR /app

# Dependências primeiro: enquanto o package-lock não mudar, o Docker reaproveita esta camada.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate

EXPOSE 3000
# Aplica as migrations pendentes, roda o seed e sobe a API. O exec faz o Node assumir o processo e receber o sinal de parada.
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && exec node --import tsx src/server.ts"]
