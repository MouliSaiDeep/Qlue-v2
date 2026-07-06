/**
 * Tests for the SSM-backed configuration loader (migrated from Secrets
 * Manager as a cost fix).
 */
const { mockClient } = require('aws-sdk-client-mock');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { getSecret, getBedrockConfig } = require('../../../src/lib/secrets');

const ssmMock = mockClient(SSMClient);

describe('secrets lib (SSM Parameter Store)', () => {
  beforeEach(() => {
    ssmMock.reset();
    delete process.env.MOCK_BEDROCK_CONFIG;
  });

  it('fetches, decrypts and JSON-parses a parameter', async () => {
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: { Value: JSON.stringify({ modelId: 'test-model' }) }
    });

    const value = await getSecret('/qlue/test-json');
    expect(value).toEqual({ modelId: 'test-model' });
    expect(ssmMock.call(0).args[0].input).toEqual({
      Name: '/qlue/test-json',
      WithDecryption: true
    });
  });

  it('normalizes legacy secret-style names to SSM paths', async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: 'plain-string' } });

    const value = await getSecret('qlue/legacy-name');
    expect(value).toBe('plain-string');
    expect(ssmMock.call(0).args[0].input.Name).toBe('/qlue/legacy-name');
  });

  it('caches values across calls within the container', async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: 'cached' } });

    await getSecret('/qlue/cache-test');
    await getSecret('/qlue/cache-test');
    expect(ssmMock.calls()).toHaveLength(1);
  });

  it('propagates ParameterNotFound errors like the old Secrets Manager path', async () => {
    const err = new Error('Parameter not found');
    err.name = 'ParameterNotFound';
    ssmMock.on(GetParameterCommand).rejects(err);

    await expect(getSecret('/qlue/missing')).rejects.toThrow('Parameter not found');
  });

  it('honours MOCK_ env overrides without calling SSM', async () => {
    process.env.MOCK_BEDROCK_CONFIG = '{"modelId":"mock"}';
    const value = await getBedrockConfig();
    expect(value).toBe('{"modelId":"mock"}');
    expect(ssmMock.calls()).toHaveLength(0);
  });
});
