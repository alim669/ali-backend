-- Fix Room numericId sequence to start from 100200300

-- Reset the sequence to start from 100200300
ALTER SEQUENCE "Room_numericId_seq" RESTART WITH 100200300;
