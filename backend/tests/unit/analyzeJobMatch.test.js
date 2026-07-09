/**
 * Tests for the JD module's job-match analysis handler.
 */
const { handler } = require('../../src/handlers/jd/analyzeJobMatch');
const { fetchAndCleanContent } = require('../../src/lib/scraper');
const { invokeModel } = require('../../src/lib/bedrock');
const { getResumeById } = require('../../src/models/resume');
const { saveJdAnalysis } = require('../../src/models/user');

jest.mock('../../src/lib/scraper');
jest.mock('../../src/lib/bedrock');
jest.mock('../../src/models/resume');
jest.mock('../../src/models/user');

const authedEvent = (body) => ({
  requestContext: { authorizer: { uid: 'user-1' } },
  body: JSON.stringify(body)
});

const llmReply = (obj) => ({ content: [{ text: JSON.stringify(obj) }] });

describe('analyzeJobMatch handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getResumeById.mockResolvedValue({
      resumeId: 'r1', userId: 'user-1',
      parsedData: { name: 'Dev', skills: ['Node.js', 'AWS'] }
    });
    fetchAndCleanContent.mockResolvedValue({ content: 'Backend Engineer role requiring Node.js and AWS Lambda experience.' });
    saveJdAnalysis.mockResolvedValue({});
  });

  it('returns an eligible match and persists the analysis', async () => {
    invokeModel.mockResolvedValue(llmReply({
      isJobPosting: true, matchScore: 78, roleTitle: 'Backend Engineer',
      matchedSkills: ['Node.js', 'AWS'], missingSkills: ['Kubernetes'],
      verdict: 'Strong fit.', jdSummary: 'Backend Engineer building serverless APIs.'
    }));

    const res = await handler(authedEvent({ jobUrl: 'https://jobs.example.com/123', resumeId: 'r1' }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.data.analyzed).toBe(true);
    expect(body.data.matchScore).toBe(78);
    expect(body.data.eligible).toBe(true);
    expect(saveJdAnalysis).toHaveBeenCalledWith('user-1', expect.objectContaining({
      matchScore: 78,
      jdSummary: expect.stringContaining('Backend Engineer')
    }));
  });

  it('marks scores below the threshold as not eligible', async () => {
    invokeModel.mockResolvedValue(llmReply({
      isJobPosting: true, matchScore: 42, roleTitle: 'ML Engineer',
      matchedSkills: [], missingSkills: ['PyTorch'], verdict: 'Weak fit.', jdSummary: 'ML role.'
    }));

    const body = JSON.parse((await handler(authedEvent({ jobUrl: 'https://x.com/j', resumeId: 'r1' }))).body);
    expect(body.data.eligible).toBe(false);
    expect(body.data.matchScore).toBe(42);
  });

  it('rejects links that are not job postings', async () => {
    invokeModel.mockResolvedValue(llmReply({ isJobPosting: false, matchScore: 0 }));
    const body = JSON.parse((await handler(authedEvent({ jobUrl: 'https://x.com/blog', resumeId: 'r1' }))).body);
    expect(body.data.analyzed).toBe(false);
    expect(saveJdAnalysis).not.toHaveBeenCalled();
  });

  it("blocks another user's resume", async () => {
    getResumeById.mockResolvedValue({ resumeId: 'r1', userId: 'someone-else', parsedData: {} });
    const res = await handler(authedEvent({ jobUrl: 'https://x.com/j', resumeId: 'r1' }));
    expect(res.statusCode).toBe(403);
  });

  it('handles scraper failures gracefully', async () => {
    fetchAndCleanContent.mockRejectedValue(new Error('blocked'));
    const body = JSON.parse((await handler(authedEvent({ jobUrl: 'https://x.com/j', resumeId: 'r1' }))).body);
    expect(body.data.analyzed).toBe(false);
    expect(body.data.reason).toContain('Could not read');
  });

  it('requires jobUrl and resumeId', async () => {
    const res = await handler(authedEvent({ jobUrl: 'https://x.com/j' }));
    expect(res.statusCode).toBe(400);
  });
});

describe('JD prompt and scoring integration', () => {
  const { buildJdPrompt } = require('../../src/handlers/interview/generateQuestion');

  it('embeds the JD and resume into the opening prompt', () => {
    const p = buildJdPrompt({ name: 'Dev', skills: ['Node.js'] }, 'Backend Engineer at Acme', 0, []);
    expect(p).toContain('Backend Engineer at Acme');
    expect(p).toContain('[Greeting] || [Question]');
  });

  it('probes gaps on follow-up turns', () => {
    const p = buildJdPrompt('summary', 'JD text', 2, [{ speaker: 'AI', text: 'Q' }, { speaker: 'USER', text: 'A' }]);
    expect(p).toContain('resume and job description differ');
    expect(p).toContain('[Acknowledgment] || [Question]');
  });
});
