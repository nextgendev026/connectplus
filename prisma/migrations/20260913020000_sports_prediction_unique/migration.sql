-- One pick per (fixture, market, model).
--
-- The analyser can be triggered concurrently (the livescore route self-heals a
-- cold cache while the tips board and the Inngest sweep are already running), so
-- the previous read-then-create check could produce duplicate rows for the same
-- fixture and market — which double-counted the accuracy record and printed the
-- same tip twice. Collapse the duplicates first, keeping the settled row when
-- one exists, then lock the invariant in with a unique index.

DELETE FROM "SportsPrediction" AS a
USING "SportsPrediction" AS b
WHERE a."matchId" = b."matchId"
  AND a."market" = b."market"
  AND a."model" = b."model"
  AND (
    (b."status" <> 'PENDING' AND a."status" = 'PENDING')
    OR (
      b."status" = a."status"
      AND (
        b."updatedAt" > a."updatedAt"
        OR (b."updatedAt" = a."updatedAt" AND b."id" > a."id")
      )
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS "SportsPrediction_matchId_market_model_key"
  ON "SportsPrediction"("matchId", "market", "model");
