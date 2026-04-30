/**
 * Pass-through stub for managing context window.
 * TODO: Implement token-based truncation or summarization.
 */
module.exports = {
  manageContextWindow: async (sessionId, messages, maxAllowed = 10) => {
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
  }
};
