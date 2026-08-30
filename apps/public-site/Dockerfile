FROM node:22-slim

WORKDIR /app

COPY server.mjs icon.png ./

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.mjs"]
