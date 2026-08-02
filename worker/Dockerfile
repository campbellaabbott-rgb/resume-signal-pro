# Playwright's own image ships Chromium plus every system library it needs.
# Building from node:slim means chasing font and codec packages by hand.
#
# VERSION DRIFT IS THE TRAP HERE, and it had already bitten this file. The image
# is pinned at v1.47.0 while package.json asks for ^1.62.1, so `npm install`
# pulls a Playwright whose expected browser build id does not exist in the
# image. That fails at RUNTIME, not build time — "Executable doesn't exist at
# /ms-playwright/chromium-XXXX" — after a green deploy, on the first real
# application. The worst possible place to find it.
#
# Rather than pin two things and hope they stay in step, the image supplies only
# the system libraries and the browser is installed to match whatever Playwright
# npm actually resolved. That cannot drift.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm install -D typescript @types/node

# The browser matching the INSTALLED Playwright, not the one baked into the tag.
# Chromium only — no vendor this worker drives needs Firefox or WebKit, and each
# extra engine is ~150MB of image for nothing.
RUN npx playwright install chromium

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Not root. This process loads arbitrary employer pages in a browser; if one of
# them finds a Chromium bug, it should not find it as root.
USER pwuser
CMD ["node", "dist/index.js"]
