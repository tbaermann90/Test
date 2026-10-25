#!/bin/sh
# Baut download/Holz-Bauplaner.exe aus der Web-App im Ordner bauplaner/.
set -e
cd "$(dirname "$0")"
rm -rf web && cp -r ../bauplaner web && rm -f web/README.md
mkdir -p ../download
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o ../download/Holz-Bauplaner.exe .
rm -rf web
echo "Fertig: download/Holz-Bauplaner.exe"
