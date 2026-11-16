CREATE TABLE "signal_messages" (
  "seq" SERIAL PRIMARY KEY,
  "session_id" UUID NOT NULL REFERENCES "remote_sessions"("id") ON DELETE CASCADE,
  "sender" TEXT NOT NULL CHECK ("sender" IN ('admin','device')),
  "type" TEXT NOT NULL CHECK ("type" IN ('offer','answer','ice')),
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "signal_messages_session_id_seq_idx" ON "signal_messages"("session_id", "seq");
CREATE INDEX "signal_messages_created_at_idx" ON "signal_messages"("created_at");
CREATE TABLE "signal_peers" (
  "session_id" UUID NOT NULL REFERENCES "remote_sessions"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL CHECK ("role" IN ('admin','device')),
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("session_id", "role")
);
