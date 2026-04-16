FROM node:20-alpine

WORKDIR /app

# Install root deps
COPY package*.json ./
RUN npm install

# Install client deps
COPY client/package*.json ./client/
RUN npm install --prefix client

# Copy all source
COPY . .

# Build React frontend
RUN npm run build

# Remove dev deps
RUN npm prune --production

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "server/index.js"]
