-- AlterTable
ALTER TABLE "User" ADD COLUMN     "usercode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_usercode_key" ON "User"("usercode");