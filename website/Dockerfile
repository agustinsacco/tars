# Stage 1: Build the Astro site
FROM node:22-alpine AS builder
WORKDIR /app

# Copy package files (from the website directory)
COPY package*.json ./
RUN npm install

# Copy source
COPY . .
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# Custom Nginx config to handle SPA routing if needed (though Starlight is SSG)
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
