FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM dependencies AS tests
COPY --chown=node:node . .
USER node
CMD ["node", "--test", "tests/*.test.cjs"]

FROM dependencies AS runtime
COPY --chown=node:node server.cjs LICENSE LICENSE-MIT.txt THIRD_PARTY_NOTICES.md ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8000 DATA_DIR=/app/data
EXPOSE 8000
CMD ["node", "server.cjs"]
