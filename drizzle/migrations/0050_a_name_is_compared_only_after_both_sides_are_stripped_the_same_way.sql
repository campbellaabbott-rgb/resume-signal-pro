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
  v := translate(v,
    'ÀÁÂÃÄÅĀĂĄàáâãäåāăąÇĆĈĊČçćĉċčÐĎĐďđÈÉÊËĒĔĖĘĚèéêëēĕėęěĜĞĠĢĝğġģĤĦĥħÌÍÎÏĨĪĬĮİìíîïĩīĭįıĴĵĶķĹĻĽĿŁĺļľŀłÑŃŅŇñńņňÒÓÔÕÖØŌŎŐòóôõöøōŏőŔŖŘŕŗřŚŜŞŠśŝşšŢŤŦţťŧÙÚÛÜŨŪŬŮŰŲùúûüũūŭůűųŴŵÝŸŶýÿŷŹŻŽźżž',
    'AAAAAAAAAaaaaaaaaaCCCCCcccccDDDddEEEEEEEEEeeeeeeeeeGGGGggggHHhhIIIIIIIIIiiiiiiiiiJjKkLLLLLlllllNNNNnnnnOOOOOOOOOoooooooooRRRrrrSSSSssssTTTtttUUUUUUUUUUuuuuuuuuuuWwYYYyyyZZZzzz');
  v := replace(replace(replace(replace(replace(replace(v, 'Æ', 'AE'), 'æ', 'ae'), 'Œ', 'OE'), 'œ', 'oe'), 'ß', 'ss'), 'Þ', 'TH');
  v := lower(v);
  v := regexp_replace(v, '/[a-z]{2,4}/?$', '');
  v := replace(v, '&', ' and ');
  v := regexp_replace(v, '[^a-z0-9 ]+', ' ', 'g');
  v_tokens := regexp_split_to_array(btrim(regexp_replace(v, '\s+', ' ', 'g')), ' ');
  IF v_tokens IS NULL OR array_length(v_tokens, 1) IS NULL OR v_tokens = ARRAY[''] THEN
    RETURN '';
  END IF;
  WHILE array_length(v_tokens, 1) >= 1 AND v_tokens[array_length(v_tokens, 1)] = ANY (v_suffix) LOOP
    v_tokens := v_tokens[1 : array_length(v_tokens, 1) - 1];
  END LOOP;
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

GRANT EXECUTE ON FUNCTION public.layoff_norm(text) TO anon, authenticated, service_role;

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