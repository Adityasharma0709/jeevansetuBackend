import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateBeneficiaryDto } from './dto/create-beneficiary.dto';
import { CreateReportDto } from './dto/create-report.dto';

@Injectable()
export class OutreachService {
  constructor(private prisma:PrismaService){}
async createBeneficiary(dto: CreateBeneficiaryDto, user: any) {

  // 1. Check outreach assignment
  const assigned = await this.prisma.userProjectLocation.findFirst({
    where: {
      userId: user.userId,
      projectId: dto.projectId,
      locationId: dto.locationId
    }
  });

  if (!assigned) {
    throw new ForbiddenException(
      'You are not assigned to this project/location'
    );
  }

  // 2. Get project code
  const project = await this.prisma.project.findUnique({
    where: { id: dto.projectId }
  });

  if (!project) {
    throw new NotFoundException('Project not found');
  }

  // 3. Count existing beneficiaries in project
  const count = await this.prisma.beneficiary.count({
    where: { projectId: dto.projectId }
  });

  // 4. Generate UID
  const next = count + 1;
  const padded = String(next).padStart(6, '0');

  const uid = `${project.projectCode}${padded}`;

  // 5. Create beneficiary
  return this.prisma.beneficiary.create({
    data: {
      uid,
      projectId: dto.projectId,
      locationId: dto.locationId,
      createdById: user.userId,

      mobileNumber: dto.mobileNumber,
      name: dto.name,
      gender: dto.gender,
      guardianName: dto.guardianName,
      dateOfBirth: new Date(dto.dateOfBirth),

      maritalStatus: dto.maritalStatus,
      dateOfMarriage: dto.dateOfMarriage,
      womanAgeAtMarriage: dto.womanAgeAtMarriage,
      husbandAgeAtMarriage: dto.husbandAgeAtMarriage,

      qualification: dto.qualification,
      religion: dto.religion,
      caste: dto.caste,

      monthlyIncome: dto.monthlyIncome,
      economicStatus: dto.economicStatus,
      primaryIncomeSource: dto.primaryIncomeSource,
      employmentStatus: dto.employmentStatus
    }
  });
}

  async raiseRequest(dto, user) {
    return this.prisma.approvalRequest.create({
      data: {
        requestType: dto.type,
        payload: dto.data,
        requestedById: user.userId
      }
    });
  }

  async requestBeneficiaryUpdate(id: number, dto, user) {

  // check beneficiary exists
  const ben = await this.prisma.beneficiary.findUnique({
    where: { id }
  });

  if (!ben) throw new NotFoundException('Beneficiary not found');

  // store request
  return this.prisma.approvalRequest.create({
    data: {
      requestType: 'UPDATE_BENEFICIARY',
      payload: {
        beneficiaryId: id,
        changes: dto
      },
      requestedById: user.userId
    }
  });
}


//report
async submitReport(dto: CreateReportDto, user: any) {

  // 1. Validate beneficiary
  const ben = await this.prisma.beneficiary.findUnique({
    where: { id: dto.beneficiaryId }
  });
  if (!ben) throw new NotFoundException('Beneficiary not found');

  // 2. Validate activity
  const activity = await this.prisma.activity.findUnique({
    where: { id: dto.activityId }
  });
  if (!activity) throw new NotFoundException('Activity not found');

  // 3. Validate session
  const session = await this.prisma.session.findUnique({
    where: { id: dto.sessionId }
  });
  if (!session) throw new NotFoundException('Session not found');

  // 4. Prevent duplicate report
  const exists = await this.prisma.activityReport.findFirst({
    where: {
      beneficiaryId: dto.beneficiaryId,
      activityId: dto.activityId,
      sessionId: dto.sessionId
    }
  });

  if (exists) {
    throw new ConflictException('Report already submitted');
  }

  // 5. Save report
  return this.prisma.activityReport.create({
    data: {
      beneficiaryId: dto.beneficiaryId,
      activityId: dto.activityId,
      sessionId: dto.sessionId,
      reportedById: user.userId,
      reportData: dto.reportData
    }
  });
}

}
