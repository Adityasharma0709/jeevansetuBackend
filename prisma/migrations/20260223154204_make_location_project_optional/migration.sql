-- DropForeignKey
ALTER TABLE "Location" DROP CONSTRAINT "Location_projectId_fkey";

-- AlterTable
ALTER TABLE "Location" ALTER COLUMN "projectId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
