FROM node:22-slim AS build

WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=development
ENV DATABASE_URL=postgresql://localhost/readmate

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
COPY scripts/patch-expo-modules-jsi-xcode27.cjs scripts/patch-expo-modules-jsi-xcode27.cjs

RUN npm ci --workspace apps/api

COPY apps/api apps/api
COPY apps/mobile/public/challenge-feed.xml apps/mobile/public/challenge-feed.xml

RUN npm run build -w apps/api

FROM build AS test

RUN npm run typecheck -w apps/api
RUN npm test -w apps/api

FROM build AS migration

CMD ["npm", "run", "prisma:deploy", "-w", "apps/api"]

FROM build AS production-dependencies

RUN npm prune --omit=dev --omit=peer --workspace apps/api

FROM node:22-slim AS nano-twi-model

ARG NANO_TWI_BUNDLE_URL=https://github.com/michsethowusu/nano-twi/releases/download/v1.0/nano-twi-sherpa-onnx.zip
ARG NANO_TWI_BUNDLE_SHA256=ba2372d44c2eebd3dc6bb8f9654f1c7693e2223eee4457a859824b70983d9982

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/* \
  && curl -L --fail --retry 3 --output /tmp/nano-twi.zip "${NANO_TWI_BUNDLE_URL}" \
  && echo "${NANO_TWI_BUNDLE_SHA256}  /tmp/nano-twi.zip" | sha256sum -c - \
  && unzip -q /tmp/nano-twi.zip -d /opt/readmate \
  && rm /tmp/nano-twi.zip /opt/readmate/nano-twi/twi_ep045_steps2.onnx

FROM node:22-slim AS runtime

WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080
ENV NANO_TWI_MODEL_DIR=/opt/readmate/nano-twi
ENV NANO_TWI_NUM_THREADS=1
ENV LD_LIBRARY_PATH=/app/node_modules/sherpa-onnx-linux-x64

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY --from=production-dependencies /app/node_modules node_modules
COPY --from=production-dependencies /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=nano-twi-model /opt/readmate/nano-twi /opt/readmate/nano-twi

EXPOSE 8080

CMD ["node", "apps/api/dist/server.js"]
