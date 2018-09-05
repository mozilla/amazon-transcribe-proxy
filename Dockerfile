FROM node:8

COPY --chown=node:node app /app

USER node
WORKDIR /app
RUN npm install --production

ENTRYPOINT ["node", "index.js"]
