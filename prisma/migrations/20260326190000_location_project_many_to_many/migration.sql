-- CreateTable
CREATE TABLE "_LocationToProject" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_LocationToProject_AB_unique" ON "_LocationToProject"("A", "B");

-- CreateIndex
CREATE INDEX "_LocationToProject_B_index" ON "_LocationToProject"("B");

-- AddForeignKey
ALTER TABLE "_LocationToProject" ADD CONSTRAINT "_LocationToProject_A_fkey" FOREIGN KEY ("A") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LocationToProject" ADD CONSTRAINT "_LocationToProject_B_fkey" FOREIGN KEY ("B") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing 1:N data into the new M:N join table
INSERT INTO "_LocationToProject" ("A", "B")
SELECT "id", "projectId"
FROM "Location"
WHERE "projectId" IS NOT NULL;

-- Also ensure project-location links exist for any existing assignments
INSERT INTO "_LocationToProject" ("A", "B")
SELECT DISTINCT "locationId", "projectId"
FROM "UserProjectLocation"
ON CONFLICT DO NOTHING;

-- DropForeignKey
ALTER TABLE "Location" DROP CONSTRAINT "Location_projectId_fkey";

-- DropIndex
DROP INDEX "Location_projectId_locationCode_key";

-- AlterTable
ALTER TABLE "Location" DROP COLUMN "projectId";
