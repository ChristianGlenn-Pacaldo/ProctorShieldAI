-- Arena results are points, not percentage grades. A legitimate match can
-- exceed 999.99. Widen only result storage; preserve every existing score.
-- Deploy before the finalizer application. Do not wait indefinitely for DDL
-- locks; abort and retry in a controlled write window if the table is busy.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE "student_quizzes" ALTER COLUMN "score" TYPE DECIMAL(20,2);
COMMIT;
