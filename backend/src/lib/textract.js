const { TextractClient } = require("@aws-sdk/client-textract");
const { NodeHttpHandler } = require("@smithy/node-http-handler");

const textract = new TextractClient({
    region: process.env.AWS_REGION || 'us-east-1',
    maxAttempts: 3,
    requestHandler: new NodeHttpHandler({
        connectionTimeout: 5000,
        requestTimeout: 30000
    })
});

module.exports = textract;
