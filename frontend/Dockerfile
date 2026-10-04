FROM node:20-alpine
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
# Keep devDependencies installed for container checks; scope production mode to build/start.
RUN NODE_ENV=production npm run build
CMD ["sh", "-c", "NODE_ENV=production npm start"]
