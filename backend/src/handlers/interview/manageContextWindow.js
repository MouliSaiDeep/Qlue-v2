/**
 * Context window manager — keeps conversation within token limits.
 * BE-BUG #25 FIX: maxAllowed increased from 10 to 20 to match asyncWorker's MAX_CONTEXT_MESSAGES.
 * Added proper handler export for Lambda invocation compatibility.
 */
module.exports = {
  manageContextWindow: async (sessionId, messages, maxAllowed = 20) => {
    if (!messages || messages.length <= maxAllowed) return messages;
    
    // Keep the first message (system/context) and the most recent conversation turns
    const systemMessage = messages[0];
    const recentMessages = messages.slice(-(maxAllowed - 1));
    
    // Ensure the conversation starts with the correct role (alternating user/assistant)
    // If the first recent message has the same role as system, drop it
    if (recentMessages.length > 0 && recentMessages[0].role === systemMessage.role) {
      recentMessages.shift();
    }
    
    return [systemMessage, ...recentMessages];
  },

  // Lambda handler export for template.yaml compatibility
  handler: async (event) => {
    const { sessionId, messages, maxAllowed } = JSON.parse(event.body || '{}');
    const result = await module.exports.manageContextWindow(sessionId, messages, maxAllowed);
    return { statusCode: 200, body: JSON.stringify({ messages: result }) };
  }
};

