-- Public courier directory; all writes go through administrator-only RPCs.
create table if not exists public.courier_contacts (
  id uuid primary key default gen_random_uuid(),
  seed_key text unique,
  name text not null check (length(btrim(name)) between 2 and 120),
  area_label text not null check (length(btrim(area_label)) between 2 and 160),
  regions text[] not null check (
    cardinality(regions) > 0 and regions <@ array['seoul','gyeonggi','incheon','other']::text[]
  ),
  description text not null check (length(btrim(description)) between 2 and 1000),
  phone text not null check (phone ~ '^01[0-9]{8,9}$'),
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.courier_contacts enable row level security;
revoke all on public.courier_contacts from public, anon, authenticated;
grant select on public.courier_contacts to anon, authenticated;

create policy courier_contacts_public_select on public.courier_contacts
  for select to anon, authenticated using (published);
create policy courier_contacts_admin_select on public.courier_contacts
  for select to authenticated using (public.is_admin());

-- Preserve the nine contacts already displayed on the courier page and add
-- the six supplied for this update. Running the seed again never overwrites
-- edits made by an administrator.
insert into public.courier_contacts (seed_key, name, area_label, regions, description, phone) values
('legacy-rozen-gwacheon', '로젠택배', '과천 · 안양', array['gyeonggi'], '과천·안양 지역 집하. 1개부터 집하 가능하다고 안내받았어요.', '01083525257'),
('legacy-rozen-ansan', '로젠택배 (북·동안산지점)', '안산 · 화성 일부', array['gyeonggi'], '안산시 상록구 전지역, 화성 세솔동·비봉면·팔탄면 일부 지역. 최소 수량은 없으며 자세한 조건은 각 기사님과 협의해 주세요.', '01092459866'),
('legacy-hwang', '택배 집하 상담 · 황호성 소장', '영등포 · 중구 · 종로', array['seoul'], '영등포구·중구·종로구 택배 계약 및 픽업 상담. 동대문 사입도 도움을 드릴 수 있다고 안내받았어요. 택배사는 문의 시 확인해 주세요.', '01054037580'),
('legacy-lotte-incheon', '롯데택배', '인천 (영종도 제외)', array['incheon'], '영종도를 제외한 인천 지역. 물량과 관계없이 집하 가능하다고 안내받았어요.', '01079207517'),
('legacy-lotte-yongin', '롯데택배 용인상현대리점', '용인', array['gyeonggi'], '용인 지역 전체 협의 가능. 물량에 따라 인근 지역도 협의할 수 있다고 안내받았어요.', '01022425235'),
('legacy-lotte-guri', '롯데택배', '구리 · 남양주 · 하남 · 경기 광주', array['gyeonggi'], '구리·남양주·하남·경기도 광주 지역 집하 상담. 단가는 연락하여 협의해 주세요.', '01065511548'),
('legacy-rozen-siheung', '로젠택배', '시흥 · 거북섬', array['gyeonggi'], '시흥시 공단과 거북섬 지역 집하 상담. 소량도 집하 시간 협의 후 가능하다고 안내받았어요.', '01084673840'),
('legacy-lotte-pyeongtaek', '롯데택배', '평택 전 지역', array['gyeonggi'], '평택 전 지역 픽업 상담. 안중·청북·현덕·포승·오성은 최소 수량 없이 가능하고, 그 밖의 지역은 협의가 필요해요. 픽업 전문으로 일정하게 가능하다고 안내받았어요.', '01045543383'),
('legacy-post', '우체국택배', '하남 · 남양주 · 서울 일부 · 성남 위례', array['gyeonggi','seoul'], '경기 하남·남양주, 서울 강동구·송파구, 성남 위례 지역 픽업 상담이 가능하다고 안내받았어요. 물량과 일정은 직접 문의해 주세요.', '01058261189'),
('new-cj-gasan', 'CJ대한통운 가산동 영업팀', '서울 금천구 가산동 전 지역', array['seoul'], '월 물량 제한 없이 상담 가능. 극소 2,990원 안내를 받았으며 실제 계약 요금과 적용 조건은 직접 확인해 주세요.', '01045942951'),
('new-hanjin-northwest', '한진택배', '파주 · 고양 · 마포 · 영등포 · 김포', array['seoul','gyeonggi'], '해당 지역 집하 상담. 수량과 관계없이 문의 가능하다고 안내받았어요.', '01058119878'),
('new-cj-yeongsun', 'CJ대한통운 영순대리점 · 심정호 소장', '성수동 · 강남구', array['seoul'], '성수동·강남구 집하 전문 대리점. CJ 코드 8830. 신규 셀러 계약 상담 가능하다고 안내받았어요.', '01026844181'),
('new-lotte-gwangmyeong', '롯데택배 광명', '경기 광명', array['gyeonggi'], '광명 지역 집하 상담. 물량과 계약 조건은 직접 확인해 주세요.', '01082538892'),
('new-cj-anseong', 'CJ대한통운', '경기 안성시 전 지역', array['gyeonggi'], '안성시 전 지역 집하 상담. 물량과 계약 조건은 직접 확인해 주세요.', '01029953131'),
('new-rozen-eunpyeong', '로젠택배 · 김태권 소장', '은평구 · 북가좌동 · 향동', array['seoul','gyeonggi'], '서울 은평구 전역, 서대문구 북가좌동, 고양시 향동 집하 상담. 동선과 시간을 조율하면 소량도 계약 가능하다고 안내받았어요.', '01085198384')
on conflict (seed_key) do nothing;

create or replace function public.save_courier_contact(
  p_id uuid, p_name text, p_area_label text, p_regions text[],
  p_description text, p_phone text, p_published boolean
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_id is not null and not exists (select 1 from public.courier_contacts where id = p_id) then
    raise exception 'COURIER_NOT_FOUND';
  end if;
  -- Column constraints also validate inputs; trim before storing.
  if p_id is null then
    insert into public.courier_contacts (name, area_label, regions, description, phone, published)
    values (btrim(p_name), btrim(p_area_label), p_regions, btrim(p_description), p_phone, p_published)
    returning id into v_id;
  else
    update public.courier_contacts
    set name = btrim(p_name), area_label = btrim(p_area_label), regions = p_regions,
        description = btrim(p_description), phone = p_phone,
        published = p_published, updated_at = now()
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_courier_contact(uuid,text,text,text[],text,text,boolean) from public, anon;
grant execute on function public.save_courier_contact(uuid,text,text,text[],text,text,boolean) to authenticated;

create or replace function public.delete_courier_contact(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  delete from public.courier_contacts where id = p_id;
  if not found then raise exception 'COURIER_NOT_FOUND'; end if;
end;
$$;
revoke all on function public.delete_courier_contact(uuid) from public, anon;
grant execute on function public.delete_courier_contact(uuid) to authenticated;
