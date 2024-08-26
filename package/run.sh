#!/bin/sh
set -e

echo "Running package test...";
echo;

BASE_DIR="$(cd "$(dirname "$0")/.."; pwd)";
cp "$BASE_DIR/package.tgz" "$BASE_DIR/package/shared-reducer.tgz";

cd "$BASE_DIR/package";
rm -rf node_modules/shared-reducer || true;
npm install --audit=false;
rm shared-reducer.tgz || true;
npm test;
cd - >/dev/null;

echo;
echo "Package test complete";
echo;
