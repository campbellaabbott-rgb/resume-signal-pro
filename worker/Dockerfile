# Playwright's own image ships Chromium plus every system library it needs.
# Building from node:slim means chasing font and codec packages by hand.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm install -D typescript @types/node
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Not root. This process loads arbitrary employer pages in a browser; if one of
# them finds a Chromium bug, it should not find it as root.
USER pwuser
CMD ["node", "dist/index.js"]
