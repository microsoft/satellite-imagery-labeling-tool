FROM node:19

WORKDIR /satellite-imagery-labeling-tool

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install .

# Copy folders used in the web service
COPY src src
COPY docs docs

EXPOSE 1234
CMD ["npm", "start"]

