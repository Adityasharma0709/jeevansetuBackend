import { Test, TestingModule } from '@nestjs/testing';
import { OutreachService } from './outreach.service';

describe('OutreachService', () => {
  let service: OutreachService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OutreachService],
    }).compile();

    service = module.get<OutreachService>(OutreachService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
