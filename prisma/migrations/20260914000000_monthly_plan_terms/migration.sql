-- Align persisted subscription copy with the implemented product terms.
-- Existing subscriptions retain their current end_date; new payments add 30 days.
UPDATE "subscription_plans"
SET
  "plan_name" = 'Free',
  "yearly_price" = 0,
  "duration_days" = NULL,
  "features" = '5 lifetime manual quizzes, Up to 20 students per quiz, Basic proctoring, Email support'
WHERE "yearly_price" = 0 OR LOWER("plan_name") = 'free';

UPDATE "subscription_plans"
SET
  "plan_name" = 'Premium Monthly',
  "yearly_price" = 500,
  "duration_days" = 30,
  "features" = 'Unlimited quizzes, Up to 100 students per quiz, Full AI analysis, Live monitoring, Evidence replay, Priority support'
WHERE "yearly_price" > 0 OR LOWER("plan_name") LIKE '%premium%' OR LOWER("plan_name") LIKE '%pro%';
