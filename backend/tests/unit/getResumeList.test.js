const { getResumesByUserId } = require('../../src/models/resume');
const { handler } = require('../../src/handlers/resume/getResumeList');

jest.mock('../../src/models/resume');

describe('getResumeList handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 if userId is missing', async () => {
    const event = {
      requestContext: { authorizer: {} }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
  });

  it('should return 200 with a list of resumes', async () => {
    const event = {
      requestContext: { authorizer: { uid: 'test-user-id' } }
    };

    const mockResumes = [
      {
        resumeId: 'res-1',
        fileName: 'resume.pdf',
        fileSize: 1024,
        status: 'PARSED',
        uploadedAt: 1625097600000,
        isActive: true
      }
    ];

    getResumesByUserId.mockResolvedValue(mockResumes);

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.resumes.length).toBe(1);
    expect(body.data.resumes[0].resumeId).toBe('res-1');
  });

  it('should return 500 on error', async () => {
    const event = {
      requestContext: { authorizer: { uid: 'test-user-id' } }
    };

    getResumesByUserId.mockRejectedValue(new Error('DB error'));

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
  });
});
