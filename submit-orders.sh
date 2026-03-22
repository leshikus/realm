#!/usr/bin/env bash
# Submit orders for the current turn and open a PR to trigger CI.
# Usage: ./submit-orders.sh [userid]
set -euo pipefail

USERID="${1:-leshikus}"
TURN=$(jq -r '.turn' "world/$USERID/turn.json")
TURN_PAD=$(printf "%04d" "$TURN")
ORDERS_FILE="world/$USERID/orders/turn.json"
BRANCH="orders/$USERID/turn-$TURN_PAD"

if [ ! -f "$ORDERS_FILE" ]; then
  echo "Error: orders file not found: $ORDERS_FILE" >&2
  exit 1
fi

echo "Submitting $ORDERS_FILE as branch $BRANCH..."

#git checkout -b "$BRANCH"
#git add "$ORDERS_FILE"
#git commit -m "Orders: $USERID turn $TURN" --author="Alexei Fedotov <alexei.fedotov@gmail.com>"
#git push -f -u origin "$BRANCH"
gh pr create \
  --title "Orders: $USERID turn $TURN" \
  --body "Automated turn submission for \`$USERID\` turn $TURN." \
  --base main
