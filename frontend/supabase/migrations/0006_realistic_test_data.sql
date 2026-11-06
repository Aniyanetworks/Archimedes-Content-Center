-- "Load test data" now produces newsletters that read like real issues, so test sends and
-- previews can be judged properly. Practical content only: no statistics, guarantees or weather claims.

create function add_sample_edition(p_division division_t, p_industry text, p_week date, p_subject text, p_preview text, p_stories jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare e uuid; s jsonb; story uuid; pos int := 0;
begin
  insert into editions (division, industry, publication_week, subject, preview_text, status, central_approved_at, approved_snapshot)
  values (p_division, p_industry, p_week, p_subject, p_preview, 'approved', now(), '[]') returning id into e;
  for s in select * from jsonb_array_elements(p_stories) loop
    insert into content_items (division, industry, regions, headline, teaser, body, cta_label, status, approved_at)
    values (p_division, p_industry, jsonb_text_array(coalesce(s->'regions', '[]')), s->>'headline', coalesce(s->>'teaser', ''), coalesce(s->>'body', ''), s->>'cta_label', 'approved', now())
    returning id into story;
    insert into edition_items (edition_id, content_item_id, slot, position) values (e, story, s->>'slot', pos);
    pos := pos + 1;
  end loop;
end $$;

create or replace function seed_test_data() returns jsonb language plpgsql security definer set search_path = public as $$
declare week date := (date_trunc('week', now() at time zone 'UTC') + interval '7 days')::date;
begin
  perform require_role('admin');
  if not in_test_mode() then raise exception 'Test data can only be loaded in test mode.'; end if;
  if exists (select 1 from tenants) or exists (select 1 from editions) then raise exception 'Reset first: this project already has data.'; end if;
  perform add_test_tenant('equinox', 'Equinox Roofing', 'hsg', 'roofing', 'hsg_growth', 'protection_report', 'weekly', 'review', 'The Equinox Home Protection Report', '#14344f', '#d9822b', 0::smallint);
  perform add_test_tenant('summit', 'Summit Peak Roofing', 'hsg', 'roofing', 'hsg_growth', 'tips_insights', 'weekly', 'auto', 'Summit Peak Homeowner Tips', '#3b2f63', '#1d8a7a', 0::smallint);
  perform add_test_tenant('timber', 'Timber Ridge HVAC', 'hsg', 'hvac', 'hsg_freedom', 'seasonal_guide', 'weekly', 'auto', 'Timber Ridge Comfort Guide', '#22543d', '#c05621', 0::smallint);
  perform add_test_tenant('craft', 'Craft Mountain Brewery', 'hospitality', 'brewery', 'hospitality_pilot', 'premium_magazine', 'weekly', 'auto', 'The Craft Mountain Taproom', '#5b3a1e', '#b7791f', 0::smallint);

  -- Each tenant gets its own local note and a verified offer, so two roofers visibly differ.
  update brand_profiles b set local_note = v.note, offer_headline = v.offer, offer_body = v.offer_body, offer_cta_label = v.cta, offer_url = 'https://' || v.key || '.example.com/book', offer_approved = true
  from (values
    ('equinox', 'Our crews are booking fall roof assessments across the service area now, so earlier slots fill first.', 'Book your pre-winter roof check', 'Every assessment comes with a written report and photos of anything that needs attention.', 'Pick a time'),
    ('summit', 'We are adding Saturday appointments through the end of the month for homeowners who cannot take time off during the week.', 'Saturday roof assessments', 'Book a weekend visit and walk the findings with our project manager.', 'Choose a Saturday'),
    ('timber', 'Our technicians are scheduling heating tune-ups now. Booking before the first cold night means less waiting if something needs a part.', 'Heating tune-up visit', 'A full safety and efficiency check of your furnace, with a written summary of anything to watch.', 'Book a tune-up'),
    ('craft', 'Thank you to everyone who joined the neighborhood cleanup. The next one is on the community board by the bar.', 'Members-only tasting night', 'Mug Club members get an early pour of the winter seasonal and a vote on next year''s small-batch beer.', 'RSVP for members night')
  ) as v(key, note, offer, offer_body, cta)
  join tenants t on t.ghl_location_id = 'test-' || v.key
  where b.tenant_id = t.id;

  perform add_sample_edition('hsg', 'roofing', week, 'What to check on your roof after a storm', 'A ten-minute walk-around that can save you a costly repair later.', jsonb_build_array(
    jsonb_build_object('slot', 'hero', 'headline', 'What to check on your roof after a storm', 'cta_label', 'Schedule a roof assessment',
      'teaser', 'A ten-minute walk-around from the ground can catch small problems before they become leaks.',
      'body', 'After strong wind or hail, start with a slow walk around the house. Look for shingles that are missing, curled or lifted at the edges, and for dents in gutters, vents and flashing. Granules collecting at the bottom of downspouts can mean shingles have lost their protective surface.' || chr(10) || chr(10) ||
              'Inside, check ceilings and the attic for new water stains or a damp smell. Take dated photos of anything you find, because they help with insurance claims. Please do not climb onto a wet or damaged roof. If something looks wrong, a professional assessment is the safe next step.'),
    jsonb_build_object('slot', 'secondary', 'headline', 'Why clean gutters protect more than your roof', 'cta_label', 'Read the gutter checklist',
      'teaser', 'Blocked gutters push water under shingles and against your foundation. Clearing them in late spring and after the leaves fall keeps water moving away from the house.'),
    jsonb_build_object('slot', 'secondary', 'headline', 'Attic ventilation: the hidden factor in shingle life',
      'teaser', 'Trapped heat and moisture in the attic age shingles from underneath. Watch for frost on nails in winter and upstairs rooms that stay hot long after sunset.'),
    jsonb_build_object('slot', 'secondary', 'headline', 'Colorado homeowners: get ready for freeze-thaw season', 'regions', jsonb_build_array('US-CO'),
      'teaser', 'Water that gets under shingles expands when it freezes. A quick check of flashing and sealant around chimneys, vents and skylights keeps small gaps from growing.')
  ));
  perform add_sample_edition('hsg', 'hvac', week, 'Get your furnace ready before the first cold night', 'Five simple checks that keep your heat running all winter.', jsonb_build_array(
    jsonb_build_object('slot', 'hero', 'headline', 'Get your furnace ready before the first cold night', 'cta_label', 'Book a tune-up',
      'teaser', 'A few simple checks now help your system run smoothly all winter.',
      'body', 'Start by replacing the air filter, which is the single easiest thing you can do for airflow. Test the thermostat by raising it a few degrees and listening for the system to start.' || chr(10) || chr(10) ||
              'Clear anything stored around the furnace, check that vents in every room are open, and put fresh batteries in your carbon monoxide detectors. A professional tune-up then checks the burners, ignition and safety controls you cannot see.'),
    jsonb_build_object('slot', 'secondary', 'headline', 'What that new furnace noise might mean', 'cta_label', 'Ask a technician',
      'teaser', 'Rattles, squeals and booms each point to different causes. Here is when it is safe to wait and when to switch the system off and call us.'),
    jsonb_build_object('slot', 'secondary', 'headline', 'Humidity and comfort: the winter balance',
      'teaser', 'Dry winter air makes rooms feel colder than the thermostat says. A properly set humidifier can make your home feel warmer at the same temperature.')
  ));
  perform add_sample_edition('hospitality', 'brewery', week, 'New on tap: our autumn release lineup', 'Three new pours, trivia night returns and a members-only tasting.', jsonb_build_array(
    jsonb_build_object('slot', 'hero', 'headline', 'New on tap: our autumn release lineup', 'cta_label', 'See what is pouring',
      'teaser', 'Three new beers join the taps this month, from a toasty brown ale to a crisp fresh-hop lager.',
      'body', 'Our brewers have been working on this lineup since late summer. The brown ale leans on toasted malt and a little cocoa, the fresh-hop lager uses hops picked the same week we brewed it, and a small batch of pumpkin porter returns for a limited run.' || chr(10) || chr(10) ||
              'Ask for a tasting flight to try all three side by side. Our bar team is happy to walk you through what makes each one different.'),
    jsonb_build_object('slot', 'secondary', 'headline', 'Trivia night is back on Thursdays', 'cta_label', 'Reserve a table',
      'teaser', 'Teams of up to six, three rounds and a final question for the bragging rights. Food from our rotating trucks starts at 6.'),
    jsonb_build_object('slot', 'secondary', 'headline', 'Behind the bar: meet our new head brewer',
      'teaser', 'She started on our canning line and now leads the brewhouse. We asked what she is most excited to brew this winter.')
  ));
  perform write_audit('test.seeded', null, null, null);
  return jsonb_build_object('tenants', 4, 'editions', 3);
end $$;

revoke all on function add_sample_edition(division_t, text, date, text, text, jsonb) from public, anon, authenticated;
grant execute on function add_sample_edition(division_t, text, date, text, text, jsonb) to service_role;
