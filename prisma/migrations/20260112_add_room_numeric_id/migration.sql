-- Migration: Add numericId to Room table
-- This adds a unique sequential ID for rooms starting from 100200300

-- Step 1: Create a sequence for room numericId starting from 100200300
CREATE SEQUENCE IF NOT EXISTS "Room_numericId_seq" START WITH 100200300;

-- Step 2: Add numericId column to Room table
ALTER TABLE "Room" ADD COLUMN "numericId" INTEGER;

-- Step 3: Populate existing rooms with sequential IDs (if any exist)
DO $$
DECLARE
    room_record RECORD;
    next_id INTEGER;
BEGIN
    FOR room_record IN SELECT id FROM "Room" ORDER BY "createdAt" ASC LOOP
        SELECT nextval('"Room_numericId_seq"') INTO next_id;
        UPDATE "Room" SET "numericId" = next_id WHERE id = room_record.id;
    END LOOP;
END $$;

-- Step 4: Make numericId NOT NULL and UNIQUE after populating
ALTER TABLE "Room" ALTER COLUMN "numericId" SET NOT NULL;

-- Step 5: Add unique constraint
ALTER TABLE "Room" ADD CONSTRAINT "Room_numericId_key" UNIQUE ("numericId");

-- Step 6: Set default value to use sequence for new rooms
ALTER TABLE "Room" ALTER COLUMN "numericId" SET DEFAULT nextval('"Room_numericId_seq"');

-- Step 7: Create index for faster lookups
CREATE INDEX IF NOT EXISTS "Room_numericId_idx" ON "Room"("numericId");
