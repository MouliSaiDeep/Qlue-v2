const fs = require('fs');
const path = require('path');

const templatePath = path.join(__dirname, 'template.yaml');
let content = fs.readFileSync(templatePath, 'utf8');

// 1. Add Architectures: [arm64] to Globals.Function
content = content.replace(
    '  Function:\n    Runtime: nodejs20.x',
    '  Function:\n    Runtime: nodejs20.x\n    Architectures:\n      - arm64'
);

// 2. Add Outputs at the end
if (!content.includes('Outputs:')) {
    content += `\nOutputs:
  RestApiUrl:
    Description: "API Gateway endpoint URL for Prod stage"
    Value: !Sub "https://\${RestApi}.execute-api.\${AWS::Region}.amazonaws.com/prod/"
  WebSocketUrl:
    Description: "WebSocket endpoint URL for Prod stage"
    Value: !Sub "wss://\${WebSocketApi}.execute-api.\${AWS::Region}.amazonaws.com/prod"
`;
}

// 3. Fix CodeUri and Handler for all functions
// e.g.
// Handler: handlers/auth/validateToken.handler
// CodeUri: src/
// should become:
// Handler: validateToken.handler
// CodeUri: src/handlers/auth/

const regex = /Handler:\s*(handlers\/[^/]+\/)([^.]+)\.handler\n\s*CodeUri:\s*src\//g;
content = content.replace(regex, (match, dir, file) => {
    return `Handler: ${file}.handler\n      CodeUri: src/${dir}`;
});

// There might be some handlers that are not matched if they don't match exactly.
// Let's also handle SendTextHandlerFunction which has CodeUri: src/ and Handler: handlers/websocket/sendTextHandler.handler
// The regex above `handlers\/[^/]+\/` captures `handlers/websocket/`.

fs.writeFileSync(templatePath, content);
console.log('Done modifying template.yaml');
