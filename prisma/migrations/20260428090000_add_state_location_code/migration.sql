-- Ensure tables exist in migration history (shadow DB starts empty)
CREATE TABLE IF NOT EXISTS "State" (
  "id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "State_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "District" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "stateId" INTEGER NOT NULL,
  CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "District"
    ADD CONSTRAINT "District_stateId_fkey"
    FOREIGN KEY ("stateId") REFERENCES "State"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add locationCode to State (idempotent for existing DBs)
ALTER TABLE "State" ADD COLUMN IF NOT EXISTS "locationCode" VARCHAR(8);

-- Enforce uniqueness when provided
CREATE UNIQUE INDEX IF NOT EXISTS "State_locationCode_key" ON "State"("locationCode");
