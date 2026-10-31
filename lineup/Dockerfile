# Lineup – production image. Mount a persistent volume at /data (SQLite lives there).
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production TZ=America/Toronto DATABASE_PATH=/data/lineup.db PORT=3000
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "start"]
