const { cleanAIResponse } = require('../../src/handlers/interview/generateQuestion');

describe('cleanAIResponse', () => {
  test('should return an empty string for null, undefined, or empty input', () => {
    expect(cleanAIResponse(null)).toBe('');
    expect(cleanAIResponse(undefined)).toBe('');
    expect(cleanAIResponse('')).toBe('');
    expect(cleanAIResponse('   ')).toBe('');
  });

  test('should parse JSON and extract question, response, text, or message keys', () => {
    expect(cleanAIResponse('{"question": "What is your name?"}')).toBe('What is your name?');
    expect(cleanAIResponse('{"response": "I am Emma."}')).toBe('I am Emma.');
    expect(cleanAIResponse('{"text": "How can I help?"}')).toBe('How can I help?');
    expect(cleanAIResponse('{"message": "Hello!"}')).toBe('Hello!');
  });

  test('should prioritize keys in order: question, response, text, message', () => {
    const json = JSON.stringify({
      message: 'msg',
      text: 'txt',
      response: 'res',
      question: 'q'
    });
    expect(cleanAIResponse(json)).toBe('q');
  });

  test('should return the original string if it is not valid JSON', () => {
    const input = 'This is not JSON';
    expect(cleanAIResponse(input)).toBe(input);
  });

  test('should remove common prefixes case-insensitively', () => {
    expect(cleanAIResponse('Emma: Hello')).toBe('Hello');
    expect(cleanAIResponse('emma:   Hello')).toBe('Hello');
    expect(cleanAIResponse('Interviewer: How are you?')).toBe('How are you?');
    expect(cleanAIResponse('AI: Welcome')).toBe('Welcome');
    expect(cleanAIResponse('Question: What is React?')).toBe('What is React?');
    expect(cleanAIResponse('Response: It is a library.')).toBe('It is a library.');
  });

  test('should remove markdown bold prefixes', () => {
    expect(cleanAIResponse('**Emma**: Hello')).toBe('Hello');
    expect(cleanAIResponse('**AI**: Testing')).toBe('Testing');
    expect(cleanAIResponse('**Interviewer**: One more thing')).toBe('One more thing');
  });

  test('should remove leading and trailing quotes', () => {
    expect(cleanAIResponse('"Hello"')).toBe('Hello');
    expect(cleanAIResponse("'How are you?'")).toBe('How are you?');
  });

  test('should remove content inside parentheses, brackets, and braces', () => {
    expect(cleanAIResponse('Hello (stage direction)')).toBe('Hello');
    expect(cleanAIResponse('[instruction] Hello')).toBe('Hello');
    expect(cleanAIResponse('Hello {metadata}')).toBe('Hello');
    expect(cleanAIResponse('Hi (there) [buddy] {how are you}')).toBe('Hi');
  });

  test('should normalize multiple spaces into a single space', () => {
    expect(cleanAIResponse('  Hello    world!  How    is   it going?  ')).toBe('Hello world! How is it going?');
  });

  test('should handle complex combined cases', () => {
    const rawInput = '  AI:  "Hello! (smiles) [greeting] {v1.0}"  ';
    // 1. trim: 'AI:  "Hello! (smiles) [greeting] {v1.0}"'
    // 2. remove AI: prefix: '"Hello! (smiles) [greeting] {v1.0}"'
    // 3. remove quotes: 'Hello! (smiles) [greeting] {v1.0}'
    // 4. remove brackets/parentheses: 'Hello!   '
    // 5. normalize spaces and trim: 'Hello!'
    expect(cleanAIResponse(rawInput)).toBe('Hello!');
  });
});
