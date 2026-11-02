FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4300 DESK_DB=/app/data/desk.sqlite PROVIDER_DB=/app/data/provider.sqlite
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts/docker ./scripts/docker
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 4300
VOLUME ["/app/data"]
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:4300/ >/dev/null || exit 1
CMD ["node", "--no-warnings", "scripts/docker/start-stack.mjs"]
