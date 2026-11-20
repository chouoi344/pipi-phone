FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json server.cjs LICENSE LICENSE-MIT.txt THIRD_PARTY_NOTICES.md ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8000 DATA_DIR=/app/data
EXPOSE 8000
CMD ["node", "server.cjs"]
