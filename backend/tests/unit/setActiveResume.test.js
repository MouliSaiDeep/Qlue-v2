const { getResumeById, getResumesByUserId } = require('../../src/models/resume');
const { setActiveResumeId } = require('../../src/models/user');
const { update } = require('../../src/lib/dynamodb');
const { handler } = require('../../src/handlers/resume/setActiveResume');

jest.mock('../../src/models/resume');
jest.mock('../../src/models/user');
jest.mock('../../src/lib/dynamodb');

describe('setActiveResume handler', () => {
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

  it('should return 400 if resumeId is missing in body', async () => {
    const event = {
      requestContext: { authorizer: { uid: 'test-user-id' } },
      body: JSON.stringify({})
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
  });

  it('should return 404 if resume not found or not owned by user', async () => {
    const event = {
      requestContext: { authorizer: { uid: 'test-user-id' } },
      body: JSON.stringify({ resumeId: 'other-resume-id' })
    };

    getResumeById.mockResolvedValue(null);

    const result = await handler(event);

    expect(result.statusCode).toBe(404);
  });

  it('should return 200 and update active status on success', async () => {
    const event = {
      requestContext: { authorizer: { uid: 'test-user-id' } },
      body: JSON.stringify({ resumeId: 'test-resume-id' })
    };

    getResumeById.mockResolvedValue({
      resumeId: 'test-resume-id',
      userId: 'test-user-id'
    });

    getResumesByUserId.mockResolvedValue([
      { resumeId: 'test-resume-id', isActive: false },
      { resumeId: 'old-resume-id', isActive: true }
    ]);

    update.mockResolvedValue(true);
    setActiveResumeId.mockResolvedValue(true);

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(update).toHaveBeenCalledTimes(2);
    expect(setActiveResumeId).toHaveBeenCalledWith('test-user-id', 'test-resume-id');
  });

  it('should return 500 on error', async () => {
    const event = {
      requestContext: { authorizer: { uid: 'test-user-id' } },
      body: JSON.stringify({ resumeId: 'test-resume-id' })
    };

    getResumeById.mockRejectedValue(new Error('DB error'));

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
  });
});
