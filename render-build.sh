#!/usr/bin/env bash
# Exit on error
set -o errexit

# Install dependencies
echo "Installing dependencies..."
npm install

# Build the application (if needed)
echo "Building the application..."
npm run build

echo "Build script completed successfully!"
