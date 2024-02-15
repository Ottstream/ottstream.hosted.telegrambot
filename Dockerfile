# Use an official Node runtime as a parent image
FROM node:20

# Create app directory
RUN mkdir -p /usr/src/node-app && chown -R node:node /usr/src/node-app

# Set the working directory
WORKDIR /usr/src/node-app

# Copy package.json and package-lock.json
COPY package.json ./

# Copy package.json and package-lock.json
COPY .yarnrc ./
# Copy package.json and package-lock.json
COPY .npmrc ./

RUN npm config set registry https://npm.ottstream.net/

# Install app dependencies
RUN npm i
# Install PM2 globally
RUN npm i pm2 -g

# RUN yarn config list
# Switch to the node user
USER node
# Bundle app source inside Docker image
COPY --chown=node:node . .

# Expose the app port
EXPOSE 3000

# Start the app with PM2 using the ecosystem file
CMD ["./node_modules/pm2/bin/pm2-runtime", "ecosystem.config.json"]