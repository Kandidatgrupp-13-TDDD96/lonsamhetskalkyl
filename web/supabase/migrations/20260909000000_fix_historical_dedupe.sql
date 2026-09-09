-- Rättar dedupliceringen av Historical_shipment efter historisk CSV-import.
--
-- Syftet med steget är oförändrat: tabellen ska hålla det SENASTE kända priset
-- per kund, viktklass och taxepunktspar, så att trappstegsmodellens steg 1
-- räknar på ett aktuellt kilopris i stället för ett snitt över gammal historik.
--
-- Den tidigare versionen gick aldrig att köra klart. Tre fel rättas här:
--
--   1. Den scopade grenen joinade med IS NOT DISTINCT FROM. Det är en
--      DistinctExpr, inte en hashbar likhetsoperator, så planeraren tvingades
--      till en nested loop mellan hela tabellen och varje berörd nyckelgrupp.
--      Med en månadsfil blev det tiotals miljarder jämförelser. Grenen tas bort
--      helt: att ranka hela tabellen en gång är både snabbare och idempotent.
--
--   2. SET LOCAL statement_timeout inne i funktionen hade ingen effekt.
--      PostgreSQL armerar timeout-timern när det yttre anropet startar och
--      omarmerar den inte av en GUC-ändring mitt i satsen. Raden tas bort och
--      rollens timeout höjs i stället, längst ned i den här filen.
--
--   3. Grupperingen skedde på customer_name rakt av, medan steg_1 matchar på
--      UPPER(customer_name). Två stavningar av samma kund överlevde därför som
--      två rader. Grupperingen sker nu också på UPPER(customer_name).
--
-- Dessutom rensas rader som inte kan ge ett kilopris: negativa (makuleringar)
-- och nollade. Importen filtrerar bort dem redan vid inläsningen, men rensningen
-- ligger kvar här för att ta hand om det som redan finns i tabellen.

create or replace function public.dedupe_historical_shipment_after_import(
  in_source_file_name text default null
)
returns integer
language plpgsql
as $function$
declare
  removed_non_positive integer := 0;
  removed_duplicates   integer := 0;
begin
  -- in_source_file_name behålls för bakåtkompatibilitet med anropet i
  -- app/api/import-historical/route.ts, men används inte längre. Att scopa
  -- körningen till en enskild fil var dyrare än att gå igenom hela tabellen,
  -- eftersom originalraden som ska ersättas per definition kommer från en
  -- tidigare import och ändå måste sökas i hela tabellen.

  -- Historiken används för att räkna fram kundnetto / vikt. Varken en negativ
  -- eller en nollad rad kan ge ett sådant pris, och en rad med vikt 0 skulle ge
  -- division med noll i steg 1 och slå ut hela kombinationen.
  delete from public."Historical_shipment"
   where weight <= 0
      or net_customer_freight <= 0;
  get diagnostics removed_non_positive = row_count;

  -- Behåll den senaste raden per kund, viktklass och taxepunktspar.
  -- Sorteringsordningen är medvetet oförändrad: leveransdatum först,
  -- avräkningsdatum som andrahandskriterium.
  with ranked as (
    select hs.avbgsp_id,
           row_number() over (
             partition by upper(hs.customer_name),
                          hs.weight_class,
                          hs.sender_taxep,
                          hs.receiver_taxep
             order by hs.date_completed desc,
                      hs.upload_date    desc,
                      hs.imported_at    desc,
                      hs.avbgsp_id      desc
           ) as rn
      from public."Historical_shipment" hs
  )
  delete from public."Historical_shipment" d
   using ranked r
   where d.avbgsp_id = r.avbgsp_id
     and r.rn > 1;
  get diagnostics removed_duplicates = row_count;

  return removed_non_positive + removed_duplicates;
end;
$function$;

comment on function public.dedupe_historical_shipment_after_import(text) is
  'Behåller senaste priset per kund, viktklass och taxepunktspar. Rensar även '
  'makuleringar och nollade rader. Argumentet ignoreras och finns kvar för '
  'bakåtkompatibilitet.';

-- Täckande index som exakt matchar fönstrets PARTITION BY + ORDER BY ovan, så
-- att rankningen kan göras med en indexscan utan sortering. De fyra ledande
-- kolumnerna är samtidigt precis vad steg_1 filtrerar på, så uppslaget i
-- trappstegsmodellen får också ett index att gå på.
create index if not exists historical_shipment_price_key_idx
  on public."Historical_shipment" (
    upper(customer_name),
    weight_class,
    sender_taxep,
    receiver_taxep,
    date_completed desc,
    upload_date    desc,
    imported_at    desc,
    avbgsp_id      desc
  );

-- get_office_for_taxep söker på taxepunktspostnummer, som bara är främmande
-- nyckel. PostgreSQL indexerar inte den refererande sidan automatiskt, så
-- zz_set_office_relation-triggern gjorde en full genomsökning per importerad rad.
create index if not exists tax_point_lookup_taxepunktspostnummer_idx
  on public.tax_point_lookup (taxepunktspostnummer);

-- calculation_medelse saknar både primärnyckel och index. get_medel_se anropas
-- av 03_trg_set_forh_se_radvis en gång per importerad rad.
create index if not exists calculation_medelse_vkl_km_idx
  on public.calculation_medelse (vklfgrv, km_bucket desc);

-- Dedupliceringen anropas som RPC av service_role. Standardtimeouten för
-- API-rollerna är 8 sekunder, vilket inte räcker för en genomgång av hela
-- tabellen ens med indexet ovan.
alter role service_role set statement_timeout = '120s';
notify pgrst, 'reload config';
