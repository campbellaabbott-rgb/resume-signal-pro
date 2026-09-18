-- A NAME IS COMPARED ONLY AFTER BOTH SIDES ARE STRIPPED THE SAME WAY.
--
-- The STRICT normaliser the matcher compares on, as one SQL function so the
-- filer side (layoff_filings_upsert) and the board side
-- (layoff_board_names_mirror) cannot drift: ported from lane 3's match2.py
-- with the trailing-'and' rule the spec adds (28 SEC titles end in "& CO" or
-- "& COMPANY"; without it Wells Fargo, Levi Strauss, Becton Dickinson,
-- Organon and Moelis never match).
--
-- Steps, in this order: fold accented Latin letters to ASCII and lowercase;
-- drop the SEC's trailing "/DE/"-style state tag (that shape only; a slash
-- inside a name stays a name); "&" becomes " and ";
-- everything that is not a letter, digit or space becomes a space; pop
-- TRAILING tokens while the last one is a corporate suffix (inc,
-- incorporated, corp, corporation, llc, ltd, limited, plc, co, company, lp,
-- llp, sa, nv, ag, se, the, and); drop a leading "the"; collapse whitespace.
--
-- WHAT IT NEVER STRIPS, on purpose: group, holdings, international, usa,
-- north america, america, numerals. The loose set lifted the SEC hit count
-- from 803 to 957 and manufactured Fuse <-> FUSE GROUP HOLDING, Kaya <->
-- Kaya Holdings, "motors" off International Motors, "wood" off Wood Group
-- USA and "compass" off Compass Group USA. A name that survives this
-- function with one token is not an employer the matcher may join on its
-- own; that rule lives in layoff_matches_rebuild.
--
-- The WARN-only pre-pass (drop parentheticals, split at dba / d/b/a / aka,
-- strip "UPDATE n" / "Amended" / "Correction to" / "Revised" prefixes and
-- "- Rescinded" / "- Amended" suffixes, the Florida street address, the
-- Texas parenthetical site) is source-specific and runs in the poller before
-- the string reaches here; the upsert takes that pre-passed string in
-- filer_for_norm and always normalises in SQL.

SET LOCAL statement_timeout = '1min';

CREATE OR REPLACE FUNCTION public.layoff_norm(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  v text := p_raw;
  v_tokens text[];
  v_suffix CONSTANT text[] := ARRAY['inc', 'incorporated', 'corp', 'corporation', 'llc', 'ltd', 'limited', 'plc',
                                    'co', 'company', 'lp', 'llp', 'sa', 'nv', 'ag', 'se', 'the', 'and'];
BEGIN
  -- Accented Latin letters to their base letter (both cases), then the few
  -- ligatures that are two letters, then lowercase. Done by table rather than
  -- by an extension so the same function runs unchanged in the pglite harness
  -- and in production, where extensions live in another schema.
  v := translate(v,
    'ÀÁÂÃÄÅĀĂĄàáâãäåāăąÇĆĈĊČçćĉċčÐĎĐďđÈÉÊËĒĔĖĘĚèéêëēĕėęěĜĞĠĢĝğġģĤĦĥħÌÍÎÏĨĪĬĮİìíîïĩīĭįıĴĵĶķĹĻĽĿŁĺļľŀłÑŃŅŇñńņňÒÓÔÕÖØŌŎŐòóôõöøōŏőŔŖŘŕŗřŚŜŞŠśŝşšŢŤŦţťŧÙÚÛÜŨŪŬŮŰŲùúûüũūŭůűųŴŵÝŸŶýÿŷŹŻŽźżž',
    'AAAAAAAAAaaaaaaaaaCCCCCcccccDDDddEEEEEEEEEeeeeeeeeeGGGGggggHHhhIIIIIIIIIiiiiiiiiiJjKkLLLLLlllllNNNNnnnnOOOOOOOOOoooooooooRRRrrrSSSSssssTTTtttUUUUUUUUUUuuuuuuuuuuWwYYYyyyZZZzzz');
  v := replace(replace(replace(replace(replace(replace(v, 'Æ', 'AE'), 'æ', 'ae'), 'Œ', 'OE'), 'œ', 'oe'), 'ß', 'ss'), 'Þ', 'TH');
  v := lower(v);
  -- SEC's trailing state tag -- "/de/", "/new/", "/adr/", "/pa/": a slash,
  -- two to four letters, an optional closing slash, at the very end -- after
  -- lowercasing and before the punctuation pass. ONLY that shape: a slash
  -- inside a name ("Trifecta JLS, Inc./Plank", "Turn/River", "Williams
  -- Plumbing / Williams Civil Construction") is a name, and cutting it would compare a prefix,
  -- which is the match the matcher forbids.
  v := regexp_replace(v, '/[a-z]{2,4}/?$', '');
  v := replace(v, '&', ' and ');
  v := regexp_replace(v, '[^a-z0-9 ]+', ' ', 'g');
  v_tokens := regexp_split_to_array(btrim(regexp_replace(v, '\s+', ' ', 'g')), ' ');
  IF v_tokens IS NULL OR array_length(v_tokens, 1) IS NULL OR v_tokens = ARRAY[''] THEN
    RETURN '';
  END IF;
  -- Pop trailing corporate suffixes one at a time ("Wells Fargo & Company"
  -- ends "and", "company": both go).
  WHILE array_length(v_tokens, 1) >= 1 AND v_tokens[array_length(v_tokens, 1)] = ANY (v_suffix) LOOP
    v_tokens := v_tokens[1 : array_length(v_tokens, 1) - 1];
  END LOOP;
  -- Drop a leading "the" ("The Trade Desk" -> "trade desk").
  WHILE array_length(v_tokens, 1) >= 1 AND v_tokens[1] = 'the' LOOP
    v_tokens := v_tokens[2 : array_length(v_tokens, 1)];
  END LOOP;
  IF array_length(v_tokens, 1) IS NULL THEN
    RETURN '';
  END IF;
  RETURN array_to_string(v_tokens, ' ');
END;
$$;

COMMENT ON FUNCTION public.layoff_norm(text) IS
  'The STRICT employer-name normaliser both sides of the layoff matcher are compared on: accents '
  'folded, lowercase, the SEC state tag dropped, & to and, punctuation to space, trailing corporate '
  'suffixes popped (inc corp llc ltd plc co company lp llp sa nv ag se the and), a leading the '
  'dropped, whitespace collapsed. Never strips group, holdings, international, usa, america or '
  'numerals. Returns the empty string for a name that was nothing but suffixes.';

-- Pure and harmless: anyone may call it, and the poller and deploy script
-- need it through the service client only.
GRANT EXECUTE ON FUNCTION public.layoff_norm(text) TO anon, authenticated, service_role;

-- Self-check: the examples the spec and lane 3 name, executed rather than read.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('WELLS FARGO & COMPANY/DE/', 'wells fargo'),
      ('The Trade Desk, Inc.', 'trade desk'),
      ('Levi Strauss & Co', 'levi strauss'),
      ('Estée Lauder Companies Inc', 'estee lauder companies'),
      ('Wood Group USA', 'wood group usa'),
      ('International Motors, LLC', 'international motors'),
      ('Compass Group USA', 'compass group usa'),
      ('FUSE GROUP HOLDING INC', 'fuse group holding'),
      ('Block, Inc.', 'block'),
      ('Emerson', 'emerson'),
      ('Wise Company LLC', 'wise'),
      ('The Mosaic Company', 'mosaic'),
      ('Cambium Networks Corp', 'cambium networks'),
      ('KEURIG DR PEPPER INC/DE', 'keurig dr pepper'),
      ('Trifecta JLS, Inc./Plank', 'trifecta jls inc plank'),
      ('Turn/River', 'turn river'),
      ('Williams Plumbing / Williams Civil Construction', 'williams plumbing williams civil construction'),
      ('Bungie, Inc/Sony Interactive Entertainment', 'bungie inc sony interactive entertainment'),
      ('Inc.', ''),
      ('', '')
    ) AS v(raw, want)
  LOOP
    IF public.layoff_norm(r.raw) IS DISTINCT FROM r.want THEN
      RAISE EXCEPTION 'layoff_norm(%) = % but the port expects %', r.raw, public.layoff_norm(r.raw), r.want;
    END IF;
  END LOOP;
END $$;
