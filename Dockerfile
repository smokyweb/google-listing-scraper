FROM node:20-alpine

WORKDIR /app

# Install root deps (force include devDependencies for build)
COPY package*.json ./
RUN npm install --include=dev

# Install client deps (force include devDependencies for vite build)
COPY client/package*.json ./client/
RUN npm install --prefix client --include=dev

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