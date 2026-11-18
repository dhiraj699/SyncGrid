FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
COPY backend/package*.json ./backend/

RUN npm install --workspace=backend --omit=dev

COPY backend ./backend

EXPOSE 4000
CMD ["npm", "run", "start", "-w", "backend"]

