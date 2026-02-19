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
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 5252
CMD ["nginx", "-g", "daemon off;"]
