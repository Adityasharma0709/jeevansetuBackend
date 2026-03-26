-- AlterTable
ALTER TABLE "_LocationToProject" ADD CONSTRAINT "_LocationToProject_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_LocationToProject_AB_unique";
