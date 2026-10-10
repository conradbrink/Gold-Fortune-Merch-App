-- Rollback of 20261010220000_contract_last_part_period_by_days: the inverse
-- replacements.

do $$
declare
  r record;
  def text;
  cur text := '';
  n int;
begin
  for r in
    select * from (values
      ('contract_next_period(uuid)',
       $a$      period_start := s;
      period_end := e;
      invoice_on := public.contract_invoice_date(s, e, c.billing, c.invoice_day);$a$,
       $b$      period_start := s;
      period_end := case when c.ends_on is not null and c.ends_on < e then c.ends_on else e end;
      invoice_on := public.contract_invoice_date(s, period_end, c.billing, c.invoice_day);$b$),
      ('contract_issue_period(uuid,date,date,date)',
       $a$  v_id uuid;
begin$a$,
       $b$  v_id uuid;
  v_full_end date;
  v_share numeric := 1;
  v_days text := '';
begin$b$),
      ('contract_issue_period(uuid,date,date,date)',
       $a$  select * into s from public.stores where id = c.store_id;$a$,
       $b$  select * into s from public.stores where id = c.store_id;
  v_full_end := public.contract_period_end(p_start, c.period);
  if p_end < v_full_end then
    v_share := (p_end - p_start + 1)::numeric / (v_full_end - p_start + 1);
    v_days := format(' (%s of %s days)', p_end - p_start + 1, v_full_end - p_start + 1);
  end if;$b$),
      ('contract_issue_period(uuid,date,date,date)',
       $a$'description', l.description, 'qty', l.qty, 'unit_price', l.unit_price,$a$,
       $b$'description', l.description || v_days, 'qty', l.qty, 'unit_price', round(l.unit_price * v_share, 2),$b$)
    ) v(fn, new_text, old_text)
  loop
    if r.fn <> cur then
      if cur <> '' then execute def; end if;
      cur := r.fn;
      def := pg_get_functiondef(('public.' || r.fn)::regprocedure);
    end if;
    n := (length(def) - length(replace(def, r.old_text, ''))) / length(r.old_text);
    if n <> 1 then
      raise exception '%: expected 1 of the anchor, found %', r.fn, n;
    end if;
    def := replace(def, r.old_text, r.new_text);
  end loop;
  execute def;
end;
$$;
