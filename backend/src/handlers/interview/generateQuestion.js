const { getSession } = require('../../models/session');
const { getResumeById } = require('../../models/resume');
const { getUserById } = require('../../models/user');
const { getTranscriptBySession } = require('../../models/transcript');
const { invokeModel, buildResumeQuestionPrompt, buildHRQuestionPrompt, buildWebsiteTeachPrompt } = require('../../lib/bedrock');
const { success, internalError } = require('../../lib/response');

/**
 * AWS Lambda Handler: POST /interview/question
 * Generates the next AI question based on context.
 */
exports.handler = async (event) => {
    try {
        const { sessionId, moduleType, currentConceptId } = JSON.parse(event.body);
        
        const session = await getSession(sessionId);
        if (!session) {
            return internalError('Session not found');
        }

        const userId = session.userId;
        const turnCount = session.turnCount || 0;

        // 1. Fetch Conversation History (formatted for Bedrock)
        const transcripts = await getTranscriptBySession(sessionId);
        const history = transcripts.map(t => ({
            role: t.speaker === 'USER' ? 'user' : 'assistant',
            content: [{ text: t.text }]
        }));

        let aiResponse = "";

        // 2. Initial Greeting / Introduction (Turn 0)
        let onlyQuestion = "";
        let greeting = "";

        if (turnCount === 0) {
            switch (moduleType) {
                case 'RESUME':
                    greeting = "Hello! I've reviewed your technical profile. I'm excited to dive into your experience. ";
                    break;
                case 'WEBSITE':
                    greeting = "Hi there! I'm here to help you master the content from the website you provided. ";
                    break;
                case 'INTRO':
                    greeting = "Welcome! Let's perfect your elevator pitch and self-introduction. ";
                    break;
                case 'HR':
                default:
                    greeting = "Hi! I'm your interviewer today. We'll be focusing on behavioral and cultural fit questions. ";
                    break;
            }

            // Combine greeting with the first question
            if (moduleType === 'RESUME') {
                let resumeIdToUse = session.itemData?.resumeId;
                if (!resumeIdToUse) {
                    const user = await getUserById(userId);
                    resumeIdToUse = user.activeResumeId;
                }
                
                if (resumeIdToUse) {
                    const resume = await getResumeById(resumeIdToUse);
                    const parsedData = resume?.parsedData;
                    if (parsedData) {
                        const prompt = buildResumeQuestionPrompt(parsedData, history, turnCount);
                        const bedrockResult = await invokeModel(undefined, { 
                            system: prompt.system,
                            messages: prompt.messages 
                        });
                        if (bedrockResult.content?.[0]?.text) {
                            try {
                                const parsed = JSON.parse(bedrockResult.content[0].text);
                                onlyQuestion = (parsed.question || bedrockResult.content[0].text);
                            } catch (e) {
                                onlyQuestion = bedrockResult.content[0].text;
                            }
                        }
                    }
                }
            }
            
            if (!onlyQuestion) {
                // Fallback for turn 0 if specific logic above didn't fire
                if (moduleType === 'RESUME') onlyQuestion = "To start, can you give me a brief overview of your technical background?";
                else if (moduleType === 'WEBSITE') onlyQuestion = "Which concept should we start with?";
                else if (moduleType === 'INTRO') onlyQuestion = "Go ahead and introduce yourself as you would in a real interview.";
                else onlyQuestion = "Let's start. Can you tell me about the most challenging project you've ever worked on?";
            }
            aiResponse = greeting + onlyQuestion;
        } else {
            // 3. Regular Question Generation (Turn > 0)
            if (moduleType === 'RESUME') {
                // Priority: Session-specific resume > User's active resume
                let resumeIdToUse = session.itemData?.resumeId;
                
                if (!resumeIdToUse) {
                    const user = await getUserById(userId);
                    resumeIdToUse = user.activeResumeId;
                }
                
                if (!resumeIdToUse) {
                    onlyQuestion = "I haven't been able to load your technical profile. Let's start with a general introduction while I sync your data. Can you tell me a bit about your professional background?";
                } else {
                    const resume = await getResumeById(resumeIdToUse);
                    const parsedData = resume?.parsedData;
    
                    if (!parsedData) {
                        onlyQuestion = "I've found your resume but I'm still processing the technical details. To get started, what are the top three technologies in your current stack?";
                    } else {
                        // This is the core logic: Passing the FULL parsedData to Bedrock
                        const prompt = buildResumeQuestionPrompt(parsedData, history, turnCount);
                        
                        // Invoke Bedrock with Converse API
                        const bedrockResult = await invokeModel(undefined, { 
                            system: prompt.system,
                            messages: prompt.messages,
                            max_tokens: 500,
                            temperature: 0.7
                        });
    
                        // Extra layer of protection for response format
                        if (bedrockResult.content && bedrockResult.content[0]?.text) {
                            const rawContent = bedrockResult.content[0].text;
                            try {
                                // Bedrock might return raw JSON string as per system instructions
                                const parsed = JSON.parse(rawContent);
                                onlyQuestion = parsed.question || rawContent;
                            } catch (e) {
                                onlyQuestion = rawContent;
                            }
                        }

                        if (!onlyQuestion) {
                            onlyQuestion = "That's interesting. Can you elaborate more on the technical challenges you faced in your most recent project?";
                        }
                    }
                }
            } else if (moduleType === 'WEBSITE') {
                const websiteUrl = session.itemData?.websiteUrl;
                if (!websiteUrl) {
                    onlyQuestion = "To get started with tutoring, please provide a website URL you'd like to learn about.";
                } else {
                    const { scrapeWebsite } = require('../../lib/scraper');
                    const { getConceptsForWebsite } = require('../../models/conceptState');
                    
                    const content = await scrapeWebsite(websiteUrl);
                    const concepts = await getConceptsForWebsite(websiteUrl);
                    
                    // Use first concept if not specified
                    const targetConcept = currentConceptId || (concepts.length > 0 ? concepts[0] : "General Overview");
                    
                    const prompt = buildWebsiteTeachPrompt(targetConcept, content, history, false);
                    const bedrockResult = await invokeModel(undefined, prompt);
                    
                    if (bedrockResult.content?.[0]?.text) {
                        try {
                            const parsed = JSON.parse(bedrockResult.content[0].text);
                            onlyQuestion = parsed.response;
                        } catch (e) {
                            onlyQuestion = bedrockResult.content[0].text;
                        }
                    } else {
                        onlyQuestion = `Let's talk about ${targetConcept}. What do you know about it so far?`;
                    }
                }
            } else if (moduleType === 'INTRO') {
                // If it's a follow-up, might be responding to feedback
                onlyQuestion = "That was a good start. Would you like to try another version focusing more on your recent accomplishments, or shall we move to specific tips?";
            } else {
                // Default HR / Behavioral
                const prompt = buildHRQuestionPrompt("Professional Background", history);
                const bedrockResult = await invokeModel(undefined, { 
                    system: prompt.system,
                    messages: prompt.messages 
                });
                
                if (bedrockResult.content?.[0]?.text) {
                    try {
                        const parsed = JSON.parse(bedrockResult.content[0].text);
                        onlyQuestion = parsed.question || bedrockResult.content[0].text;
                    } catch (e) {
                        onlyQuestion = bedrockResult.content[0].text;
                    }
                } else {
                    onlyQuestion = "Tell me about a time you faced a difficult problem and how you solved it.";
                }
            }
            aiResponse = onlyQuestion; // No greeting for regular turns
        }

        return success({ 
            aiResponse, // Full voice string
            onlyQuestion, // Just the core question for UI cleanup
            state: session.currentState 
        });


    } catch (error) {
        console.error('Question Generation Error:', error);
        return internalError(error.message);
    }
};
