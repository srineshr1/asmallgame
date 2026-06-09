# Container image for the Small Games server.
# Works on Fly.io, Railway, Google Cloud Run, AWS App Runner, a VPS, etc.
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching).
COPY package.json ./
RUN npm install --omit=dev

# Copy the rest of the app (server, game logic, public assets, cards).
COPY . .

# The platform terminates TLS and sets PORT; we serve plain HTTP behind it.
ENV DISABLE_HTTPS=1
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
