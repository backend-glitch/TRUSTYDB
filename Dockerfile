# The Oracle Node.js driver runs in Thin mode by default, so no Oracle Instant
# Client is needed in this image.
FROM node:22-bookworm-slim

WORKDIR /app

# Install production dependencies before copying application files so this
# layer is reused unless the dependency manifest changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY frontend ./frontend
COPY TRUSTYDB_SOURCE_A_CORRECTED.csv ./
COPY TRUSTYDB_SOURCE_B_CORRECTED.csv ./
COPY TRUSTYDB_SOURCE_C_CORRECTED.csv ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# The application only reads its packaged CSV files, so it can run as the
# unprivileged Node user.
USER node

CMD ["npm", "start"]
