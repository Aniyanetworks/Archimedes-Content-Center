-- Picture uploads (story images, logos). Files go into a public "media" bucket so emails can show them;
-- only signed-in staff can add, replace or remove files. Pasting a link still works as before.
-- Supabase Storage only exists on Supabase itself, so this is skipped elsewhere (for example in tests).

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then return; end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('media', 'media', true, 5242880, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists media_staff_insert on storage.objects';
  execute 'drop policy if exists media_staff_update on storage.objects';
  execute 'drop policy if exists media_staff_delete on storage.objects';
  execute $p$create policy media_staff_insert on storage.objects for insert to authenticated with check (bucket_id = 'media' and public.is_staff())$p$;
  execute $p$create policy media_staff_update on storage.objects for update to authenticated using (bucket_id = 'media' and public.is_staff())$p$;
  execute $p$create policy media_staff_delete on storage.objects for delete to authenticated using (bucket_id = 'media' and public.is_staff())$p$;
end $$;
