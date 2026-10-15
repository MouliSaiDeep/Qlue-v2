jest.mock('../../src/lib/bedrock', () => ({invokeModel: jest.fn()}));
const {invokeModel} = require('../../src/lib/bedrock');
const {handler} = require('../../src/handlers/interview/generateQuestion');

test.each(['HR','RESUME','JD','WEBSITE','INTRO'])(
  '%s prompt distinguishes recognition trouble from off-topic behavior', async moduleType => {
    invokeModel.mockResolvedValue({content:[{text:'Please repeat your answer to the question.'}]});
    const response = await handler({body:{moduleType,turnIndex:1,conversationHistory:[
      {speaker:'USER',text:'The microphone is not taking my response correctly',turnIndex:0}
    ]}});
    expect(response.statusCode).toBe(200);
    const prompt = invokeModel.mock.calls.at(-1)[1].messages[0].content[0].text;
    expect(prompt).toContain('<speech_recognition_context>');
    expect(prompt).toContain('are NOT off-topic behavior');
    expect(prompt).toContain('repeat or clarify their answer to the current question');
  }
);
