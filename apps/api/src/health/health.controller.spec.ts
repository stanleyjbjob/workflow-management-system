import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('returns ok status', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('wfms-api');
    expect(typeof result.timestamp).toBe('string');
  });
});
