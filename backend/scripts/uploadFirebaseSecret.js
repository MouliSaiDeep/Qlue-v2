const { SecretsManagerClient, PutSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const fs = require("fs");
const path = require("path");

const client = new SecretsManagerClient({ region: "us-east-1" });

async function uploadSecret() {
    const filePath = path.resolve(__dirname, "serverAccountKey.json");
    const secretValue = fs.readFileSync(filePath, "utf8");
    
    // We'll find the secret by its prefix since the full ID might vary slightly
    const secretId = "FirebaseServiceAccountSecre-LCvqRCA8uUxB";

    try {
        const command = new PutSecretValueCommand({
            SecretId: secretId,
            SecretString: secretValue
        });
        await client.send(command);
        console.log("Successfully uploaded Firebase Service Account Secret!");
    } catch (err) {
        console.error("Failed to upload secret:", err);
        process.exit(1);
    }
}

uploadSecret();
