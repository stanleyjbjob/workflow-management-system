-- CreateEnum
CREATE TYPE "HolidayType" AS ENUM ('HOLIDAY', 'MAKEUP_WORKDAY');

-- CreateEnum
CREATE TYPE "HolidaySource" AS ENUM ('GOVERNMENT', 'COMPANY');

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HolidayType" NOT NULL DEFAULT 'HOLIDAY',
    "source" "HolidaySource" NOT NULL DEFAULT 'GOVERNMENT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE INDEX "Holiday_type_idx" ON "Holiday"("type");
