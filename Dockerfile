FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM dependencies AS tests
COPY --chown=node:node . .
USER node
CMD ["node", "--test", "tests/*.test.cjs"]

FROM caddy:2.11.9-alpine AS gateway

FROM dependencies AS install-bundle
COPY --from=gateway /usr/bin/caddy /tmp/caddy
# The unprivileged gateway uses its own network namespace for low ports.
# Install a plain executable without Alpine's file capabilities.
RUN install -m 0755 /tmp/caddy /usr/local/bin/caddy && /usr/local/bin/caddy version
WORKDIR /opt/pipi-install
COPY compose.yaml compose.https.yaml compose.updates.yaml package.json ./
COPY deploy/Caddyfile deploy/bundled-gateway.yaml deploy/
COPY scripts/install-https.py scripts/compose-updater.cjs scripts/
COPY lib/updates.cjs lib/
RUN grep -Fxq '    build: .' compose.yaml && \
    sed -i 's|^    build: \.$|    image: ${PIPI_INSTALL_IMAGE:?Missing installed image digest}|' compose.yaml && \
    grep -Fxq '    image: caddy:2.11.9-alpine' compose.https.yaml && \
    sed -i 's|^    image: caddy:2.11.9-alpine$|    extends: {file: deploy/bundled-gateway.yaml, service: gateway}|' compose.https.yaml

FROM dependencies AS runtime
COPY --from=install-bundle /usr/local/bin/caddy /usr/bin/caddy
COPY --from=install-bundle /opt/pipi-install /opt/pipi-install
COPY --chown=node:node server.cjs LICENSE LICENSE-MIT.txt THIRD_PARTY_NOTICES.md ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
RUN install -d /etc/caddy && install -d -o node -g node /app/data /data /data/caddy
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8000 DATA_DIR=/app/data
EXPOSE 8000
CMD ["node", "server.cjs"]
