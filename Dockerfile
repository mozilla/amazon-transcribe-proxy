FROM node:8

RUN echo "deb http://deb.debian.org/debian jessie-backports main" >> /etc/apt/sources.list && \
    apt update && \
    apt dist-upgrade -y && \
    apt install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY --chown=node:node app /app

USER node
WORKDIR /app
RUN npm install --production

ENTRYPOINT ["node", "index.js"]
