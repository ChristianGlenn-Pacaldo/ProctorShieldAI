-- Update existing Free-plan descriptions without resetting usage or touching
-- paid prices, subscriptions, quiz records, or historical activity logs.
UPDATE "subscription_plans"
SET "features" = REPLACE("features", '5 lifetime manual quizzes', '5 manual quizzes per calendar month (resets on the 1st, UTC+8)')
WHERE "yearly_price" = 0
  AND "features" LIKE '%5 lifetime manual quizzes%';
