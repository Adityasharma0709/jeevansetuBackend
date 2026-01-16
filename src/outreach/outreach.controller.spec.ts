import { Test, TestingModule } from '@nestjs/testing';
import { OutreachController } from './outreach.controller';
import { OutreachService } from './outreach.service';

describe('OutreachController', () => {
  let controller: OutreachController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OutreachController],
      providers: [OutreachService],
    }).compile();

    controller = module.get<OutreachController>(OutreachController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
