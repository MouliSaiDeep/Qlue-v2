const { fetchAndCleanContent } = require('../../lib/scraper');
const { invokeModel } = require('../../lib/bedrock');
const { success, error } = require('../../lib/response');

/**
 * Validates if the given URL contains educational/professional content.
 */
exports.handler = async (event) => {
    try {
        const { websiteUrl } = JSON.parse(event.body || '{}');
        if (!websiteUrl) return error('URL required', 400);

        // 1. Scrape content to verify it exists and is readable
        const { content } = await fetchAndCleanContent(websiteUrl);

        // 2. Use Bedrock to audit the nature of the content
        const prompt = [
            {
                role: 'system',
                content: `You are a content auditor. Analyze the following webpage text and determine if it contains educational or professional learning content (tutorial, documentation, academic info, technical blog). 
                Reject sites that are primarily shopping, news, social media, adult content, or pure entertainment.
                Format your output strictly as a JSON object: {"isEducational": boolean, "reason": "short explanation"}`
            },
            {
                role: 'user',
                content: content.substring(0, 4000)
            }
        ];

        const bedrockResult = await invokeModel(undefined, { messages: prompt });
        
        let analysis = { isEducational: false, reason: 'Failed to analyze' };
        if (bedrockResult.content && bedrockResult.content[0]?.text) {
            try {
                analysis = JSON.parse(bedrockResult.content[0].text);
            } catch (e) {
                // Handle non-JSON output if any
                analysis = { isEducational: bedrockResult.content[0].text.toLowerCase().includes('true'), reason: 'Parsed from text' };
            }
        }

        return success(analysis);
    } catch (err) {
        console.error('Validation Error:', err);
        // Map common scraper errors to user-friendly messages
        return success({ 
            isEducational: false, 
            reason: err.message || 'The website content could not be accessed or verified.' 
        });
    }
};
