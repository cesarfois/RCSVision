# Step 1: Build the React frontend
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Inject environment variables during Vite build process
ARG VITE_DOCUWARE_WORKFLOW_API_KEY
ARG VITE_DOCUWARE_WORKFLOW_URL
ARG VITE_DOCUWARE_ADMIN_API_KEY
ARG VITE_DOCUWARE_ADMIN_URL
RUN npm run build

# Step 2: Production image with Node/Express proxy and static server
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY proxy-server.js ./
COPY --from=builder /app/dist ./dist

# Expose port 3001 (default for proxy-server.js)
EXPOSE 3001

# Start the proxy server
CMD ["node", "proxy-server.js"]
