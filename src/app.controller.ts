import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller('')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('test')
  test() {
    return this.appService.getHello();
  }

  @Get('landing/stats')
  async getLandingStats() {
    return this.appService.getLandingStats();
  }
}
