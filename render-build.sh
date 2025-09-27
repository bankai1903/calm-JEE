#!/usr/bin/env bash
# Exit on error
set -o errexit

# Install dependencies
echo "Installing dependencies..."
npm install

# Ensure webpack-cli is installed globally for the build process
echo "Installing webpack-cli globally..."
npm install -g webpack-cli

# Build the application
echo "Building the application..."
npm run build

echo "Build script completed successfully!"
