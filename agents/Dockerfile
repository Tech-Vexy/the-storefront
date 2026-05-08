FROM node:20-alpine

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy dependency configuration
COPY package.json pnpm-lock.yaml* ./

# Install all dependencies (including tsx and concurrently to run TS directly)
RUN pnpm install

# Copy the rest of the application files
COPY . .

# Expose default port (dynamically overridden by cloud environments)
EXPOSE 8080

# Run the complete swarm concurrently in production mode
CMD ["pnpm", "dev:full"]
