FROM node:24-alpine

WORKDIR /app

# Dependências primeiro: enquanto o package-lock não mudar, o Docker reaproveita esta camada.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000
CMD ["node", "--import", "tsx", "src/server.ts"]
