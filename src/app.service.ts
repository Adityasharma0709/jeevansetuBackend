import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHello(): string {
    return 'server is running';
  }

  async getLandingStats() {
    const [beneficiaries, awcs, reports, activeStateLocations] = await Promise.all([
      this.prisma.beneficiary.count(),
      this.prisma.awc.count(),
      this.prisma.activityReport.count(),
      // Query distinct stateId values from the AWC locations assigned to a project
      this.prisma.awc.findMany({
        distinct: ['stateId'],
        select: { stateId: true }
      })
    ]);

    return {
      beneficiaries: beneficiaries || 20000,
      states: activeStateLocations.length || 2, // Count of unique active states
      awcs: awcs || 150,
      reports: reports || 5000
    };
  }


}
