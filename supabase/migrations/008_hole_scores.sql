-- Add hole-by-hole scoring data to player_scores.
-- Stored as JSONB: { r1: [{h, s, r},...], r2: [...], r3: null, r4: null }
-- h = hole number (1-18), s = raw strokes, r = relative to par (-2,-1,0,1,2,...)

ALTER TABLE player_scores ADD COLUMN IF NOT EXISTS hole_scores jsonb;
