FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY services/api/package.json services/api/package.json
RUN npm install --omit=dev

COPY services/api services/api
COPY db db

WORKDIR /app/services/api
EXPOSE 8400
CMD ["npm", "run", "start"]
