#!/bin/sh
set -e

echo "Building...";
echo;

BASE_DIR="$(cd "$(dirname "$0")/.."; pwd)";
rm "$BASE_DIR/package.tgz" 2>/dev/null || true;
rm -rf "$BASE_DIR/build" 2>/dev/null || true;

cd "$BASE_DIR";
npx rollup --config rollup.config.mjs;
npx rollup --config rollup-dts.config.mjs;
cd - >/dev/null;

rm -rf "$BASE_DIR/build/types";
cp "$BASE_DIR/README.md" "$BASE_DIR/LICENSE" "$BASE_DIR/build";
grep -v '"private":' < "$BASE_DIR/package.json" > "$BASE_DIR/build/package.json";

cd "$BASE_DIR/build";
npm pack;
cd - >/dev/null;

mv "$BASE_DIR/build/shared-reducer-"*.tgz "$BASE_DIR/package.tgz";
rm -rf "$BASE_DIR/build";

echo;
echo "Build complete";
echo;
