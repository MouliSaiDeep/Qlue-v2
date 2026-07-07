#!/usr/bin/env bash
# =============================================================================
# One-time migration: AWS Secrets Manager -> SSM Parameter Store (free tier)
#
# Why: Secrets Manager bills $0.40/secret/month even when idle. Qlue's four
# secrets cost ~$1.60/month + tax doing nothing. SSM standard-tier
# SecureString parameters (AWS-managed key) are free.
#
# Run this ONCE, BEFORE deploying the updated template:
#   cd backend && bash scripts/migrate-secrets-to-ssm.sh
#
# Then deploy:  sam deploy
# Then verify the app works, and only after that delete the old secrets by
# re-running this script with:  bash scripts/migrate-secrets-to-ssm.sh --delete-secrets
# =============================================================================
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
SECRETS=(
  "qlue/firebase-service-account"
  "qlue/bedrock-config"
  "qlue/scraper-api-key"
  "qlue/fcm-server-key"
)

if [[ "${1:-}" == "--delete-secrets" ]]; then
  echo "Deleting old Secrets Manager secrets (no recovery window)..."
  for name in "${SECRETS[@]}"; do
    aws secretsmanager delete-secret \
      --secret-id "$name" \
      --force-delete-without-recovery \
      --region "$REGION" >/dev/null \
      && echo "  deleted secret: $name" \
      || echo "  skip (not found): $name"
  done
  echo "Done. Idle Secrets Manager charges stop immediately."
  exit 0
fi

echo "Copying secret values into SSM Parameter Store (/qlue/*)..."
for name in "${SECRETS[@]}"; do
  value="$(aws secretsmanager get-secret-value \
    --secret-id "$name" \
    --query SecretString --output text \
    --region "$REGION" 2>/dev/null || true)"

  if [[ -z "$value" || "$value" == "None" ]]; then
    echo "  WARNING: secret '$name' not found or empty; skipping. Create the"
    echo "           parameter manually: aws ssm put-parameter --name '/$name' --type SecureString --value '...'"
    continue
  fi

  aws ssm put-parameter \
    --name "/$name" \
    --type SecureString \
    --value "$value" \
    --overwrite \
    --region "$REGION" >/dev/null
  echo "  created parameter: /$name"
done

echo ""
echo "Setting 14-day retention on Qlue Lambda log groups (default is 'never"
echo "expire', which accumulates storage charges forever)..."
aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/qlue" \
  --query 'logGroups[].logGroupName' --output text --region "$REGION" \
  | tr '\t' '\n' | while read -r lg; do
      [[ -z "$lg" ]] && continue
      aws logs put-retention-policy --log-group-name "$lg" --retention-in-days 14 --region "$REGION" \
        && echo "  14-day retention set: $lg"
    done

echo ""
echo "Migration complete. Next steps:"
echo "  1. sam deploy                      # roll out the updated template"
echo "  2. test the app end to end"
echo "  3. bash scripts/migrate-secrets-to-ssm.sh --delete-secrets"
