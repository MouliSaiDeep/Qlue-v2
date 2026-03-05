const AWS = require('aws-sdk');

const bedrock = new AWS.BedrockRuntime({
    region: 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

module.exports = bedrock;
