# ---- Base image ----
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
# If you use pnpm/yarn, adjust this accordingly
RUN npm ci

# Copy the rest of the source code
COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma
COPY prisma.config.ts ./

# If you use Prisma (you do, from schema.prisma):
RUN npx prisma generate

# Build TypeScript -> JavaScript
RUN npx tsc

# Expose the port your Express app listens on
EXPOSE 3000

# Default environment
ENV NODE_ENV=production

# Start the server (same as you do locally after build)
CMD ["node", "dist/server.js"]
