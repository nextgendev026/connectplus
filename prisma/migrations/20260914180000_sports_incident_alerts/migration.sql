-- Broaden the default sports alert set with the per-incident events (goal, red
-- card, substitution) the notification pipeline can now detect from the
-- provider's play-by-play.
--
-- Default-only on purpose: it changes what a NEW subscription receives, and
-- touches no existing row. Readers who already starred a fixture keep exactly the
-- alerts they chose — silently opting someone into more notifications because we
-- shipped a feature would be the wrong direction to surprise a person in.

ALTER TABLE "SportsMatchReminder"
  ALTER COLUMN "events" SET DEFAULT 'KICKOFF,LIVE,GOAL,RED_CARD,SUB,FINAL,PICK_SETTLED';
