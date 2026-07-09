#!/usr/bin/env bash
# =============================================================================
# ONE-TIME SETUP: lets GitHub Actions deploy to AWS without stored keys (OIDC).
#
# Easiest way to run this: AWS Console -> CloudShell icon (top bar) -> paste:
#   bash <(curl -s https://raw.githubusercontent.com/MouliSaiDeep/Qlue-v2/main/.github/setup-aws-oidc.sh)
# or copy this file's contents into CloudShell and run it.
#
# After it finishes, copy the printed AWS_ACCOUNT_ID value into:
#   GitHub repo -> Settings -> Secrets and variables -> Actions ->
#   New repository secret -> Name: AWS_ACCOUNT_ID
# =============================================================================
set -euo pipefail

REPO="MouliSaiDeep/Qlue-v2"
ROLE_NAME="github-actions-deploy-role"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account: $ACCOUNT_ID"

# 1. GitHub OIDC identity provider (idempotent)
PROVIDER_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" >/dev/null 2>&1; then
  echo "OIDC provider already exists."
else
  aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" >/dev/null
  echo "OIDC provider created."
fi

# 2. Role trusted ONLY by this repository's workflows
cat > /tmp/trust.json << TRUST
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "${PROVIDER_ARN}" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike":   { "token.actions.githubusercontent.com:sub": "repo:${REPO}:*" }
    }
  }]
}
TRUST

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document file:///tmp/trust.json
  echo "Role exists; trust policy refreshed."
else
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document file:///tmp/trust.json \
    --description "GitHub Actions deploy role for ${REPO}" >/dev/null
  echo "Role created."
fi

# 3. Permissions. AdministratorAccess is the simple choice for a solo project;
# the trust policy above already restricts WHO can assume it to this repo only.
# For tighter scoping later, replace with a policy limited to CloudFormation,
# Lambda, API Gateway, DynamoDB, S3, SQS, SNS, SSM, Logs, Events, and IAM
# role management for qlue-* resources.
aws iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
echo "Policy attached."

echo ""
echo "======================================================================"
echo "DONE. Now add this GitHub secret (Settings -> Secrets -> Actions):"
echo "  Name:  AWS_ACCOUNT_ID"
echo "  Value: ${ACCOUNT_ID}"
echo "======================================================================"
