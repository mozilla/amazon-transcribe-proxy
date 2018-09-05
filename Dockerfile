FROM node:8

RUN npm install --save aws-sdk body-parser express

RUN mkdir -p /app/amazon-transcribe-proxy/
COPY * /app/amazon-transcribe-proxy/

# Set the default command
WORKDIR /app/amazon-transcribe-proxy
CMD node index.js
