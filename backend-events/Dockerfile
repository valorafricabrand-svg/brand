FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=4001 \
    DB_PATH=/var/data/events.db \
    UPLOAD_DIR=/var/data/uploads/events

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

USER node

EXPOSE 4001

CMD ["npm", "start"]
