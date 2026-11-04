-- Foody: persönliche Daten je Login trennen. Geteilt bleiben: recipes, foods, imports, shopping, settings, plan (Kochplan).
-- Persönlich (nur der Besitzer liest/schreibt): profiles/pX, weights/pX, health/pX, favorites/pX, days/pX__datum.
create table if not exists public.owners (email text primary key, pid text not null check (pid in ('p1','p2')));
alter table public.owners enable row level security;
drop policy if exists owners_lesen on public.owners;
create policy owners_lesen on public.owners for select to authenticated using (true);
insert into public.owners (email, pid) values ('thomas.streitferdt@outlook.com', 'p1'), ('carolin@waldhier.com', 'p2') on conflict (email) do update set pid = excluded.pid;

create or replace function public.my_pid() returns text language sql stable security definer set search_path = public as
$$ select pid from public.owners where lower(email) = lower(auth.jwt() ->> 'email') $$;
create or replace function public.doc_owner(p text) returns text language sql immutable as
$$ select coalesce((regexp_match(p, '^(?:profiles|weights|health|favorites)/(p[12])$'))[1], (regexp_match(p, '^days/(p[12])__'))[1]) $$;

drop policy if exists docs_angemeldet on public.docs;
drop policy if exists docs_eigene_daten on public.docs;
create policy docs_eigene_daten on public.docs for all to authenticated
  using (public.doc_owner(path) is null or public.doc_owner(path) = public.my_pid())
  with check (public.doc_owner(path) is null or public.doc_owner(path) = public.my_pid());

-- Kochplan aus bestehenden Tagen übernehmen (nur Rezept, Portionen, Status; keine Verzehrdaten)
insert into public.docs (path, coll, data)
select 'plan/' || dt, 'plan', jsonb_build_object('meals', jsonb_object_agg(mid, entry))
from (
  select split_part(d.path, '__', 2) as dt, m.key as mid,
    jsonb_build_object('pid', split_part(substr(d.path, 6), '__', 1), 'who', coalesce(pr.data ->> 'name', ''), 'slot', m.value ->> 'slot',
      'recipeId', m.value ->> 'recipeId', 'title', coalesce(m.value ->> 'title', ''),
      'servings', case when coalesce((m.value ->> 'servings')::numeric, 0) > 0 then (m.value ->> 'servings')::numeric else 4 end, 'status', m.value ->> 'status') as entry
  from public.docs d
  cross join lateral jsonb_each(coalesce(d.data -> 'meals', '{}'::jsonb)) m
  left join public.docs pr on pr.path = 'profiles/' || split_part(substr(d.path, 6), '__', 1)
  where d.path like 'days/%' and jsonb_typeof(m.value) = 'object' and m.value ->> 'recipeId' is not null
) x group by dt
on conflict (path) do update set data = excluded.data;
