FROM node:22-alpine

# The docker CLI lets the site start playground demo containers when the host's
# Docker socket is mounted (see docker-compose.yml). Without it, everything else works.
RUN apk add --no-cache docker-cli

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY site ./site
COPY shared ./shared
COPY admin ./admin
COPY bin ./bin
COPY seed ./seed
COPY examples ./examples

ENV HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    NODE_ENV=production

VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/index.js"]
