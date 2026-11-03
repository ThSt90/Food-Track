-- 1) Tabelle für alle Dokumente der App
create table if not exists public.docs (
  path text primary key,
  coll text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists docs_coll_idx on public.docs (coll);

-- 2) Zugriff nur für angemeldete Personen (Thomas und Caro)
alter table public.docs enable row level security;
drop policy if exists "docs_angemeldet" on public.docs;
create policy "docs_angemeldet" on public.docs for all to authenticated using (true) with check (true);

-- 3) Bilder: öffentlicher Bucket "images" (Dateinamen sind zufällig), Hochladen nur angemeldet
insert into storage.buckets (id, name, public) values ('images', 'images', true) on conflict (id) do nothing;
drop policy if exists "images_schreiben" on storage.objects;
create policy "images_schreiben" on storage.objects for all to authenticated using (bucket_id = 'images') with check (bucket_id = 'images');
