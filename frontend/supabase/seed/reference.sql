-- Reference data. Run after the migrations and before seed/templates.sql's plan links are needed.
-- Items marked below are working assumptions awaiting Archimedes signoff (spec section 16).

insert into industries (key, division, label) values
  ('roofing', 'hsg', 'Roofing'),
  ('hvac', 'hsg', 'HVAC'),
  ('generators', 'hsg', 'Generators'),
  ('electrical', 'hsg', 'Electrical'),
  ('plumbing', 'hsg', 'Plumbing'),
  ('brewery', 'hospitality', 'Brewery')
on conflict (key) do nothing;

insert into master_templates (key, name, position) values
  ('protection_report', 'Homeowner Protection Report', 1),
  ('tips_insights', 'Tips & Insights', 2),
  ('seasonal_guide', 'Seasonal Guide', 3),
  ('improvement_savings', 'Improvement & Savings', 4),
  ('premium_magazine', 'Premium Magazine', 5)
on conflict (key) do nothing;

-- Hospitality terms are not specified yet, so the pilot plan stays test-only (signoff_pending).
insert into plan_entitlements (plan_key, division, label, default_cadence, allowed_cadences, signoff_pending) values
  ('hsg_essentials', 'hsg', 'HSG Essentials', 'biweekly', '{biweekly}', false),
  ('hsg_growth', 'hsg', 'HSG Growth', 'weekly', '{weekly,biweekly}', false),
  ('hsg_freedom', 'hsg', 'HSG Freedom', 'weekly', '{weekly,biweekly}', false),
  ('hospitality_pilot', 'hospitality', 'Hospitality (pilot, terms pending)', 'weekly', '{weekly,biweekly}', true)
on conflict (plan_key) do nothing;

-- The Essentials pair is a working choice pending signoff. Change it here, not in code.
insert into plan_templates (plan_key, template_key)
select 'hsg_essentials', key from master_templates where key in ('protection_report', 'tips_insights')
union all select 'hsg_growth', key from master_templates
union all select 'hsg_freedom', key from master_templates
union all select 'hospitality_pilot', key from master_templates
on conflict do nothing;
