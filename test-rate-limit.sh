#!/bin/bash
# Sends 101 POST /auth/login requests and prints the status of the last one.
URL="http://localhost:3000/auth/login"
BODY='{"email":"test@example.com","password":"wrongpassword"}'

echo "Sending 101 requests to $URL..."

for i in $(seq 1 101); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$URL" \
    -H "Content-Type: application/json" \
    -d "$BODY")
  if [ "$i" -eq 101 ]; then
    echo "Request 101 → HTTP $STATUS (expected 429)"
  fi
done
