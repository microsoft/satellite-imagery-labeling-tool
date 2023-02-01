# Developer's Guide

## Local Development
This project uses [Parcel](https://parceljs.org/) to run development servers and build packages for [a web app](https://parceljs.org/getting-started/webapp/). The following instructions detail how to use Parcel with npm for this project.

### Dependencies
For development on the Spatial Labeling tool, install [Node.js](https://nodejs.org/en/) and the [Node Package Manager (npm)](https://docs.npmjs.com/) by following the [installation instructions in the npm Docs](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm).

### Installation
From the root of this repository, run `npm install` from the console.

### Development Server
You can start a development server at localhost:1234 by running `npm start`.

### Bundle for Web Server
To bundle and optimize code for production, run `npm run build`, which packages optimized code for a web server, creating the files in a `dist` folder.

### Cleaning
If you change the Parcel or Node configurations, you may want to clean up artifacts by running `npm run clean` to remove the `dist` and `.parcel-cache` folders.

## Containerization
If you would like to use Docker containers and images to run this application, you should install either [Docker Desktop](https://docs.docker.com/desktop/) or [Docker Engine](https://docs.docker.com/engine/) to get the Docker Command Line Interface.

### Build Image

### Run Container