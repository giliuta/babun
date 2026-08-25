-- day_extras finance fields
-- Adds optional payment_method + receipt_url so the day-finance modal can
-- record HOW a manual expense was paid (cash/card/transfer/other) and
-- attach a photo of the receipt. Both nullable; older rows stay valid.

alter table public.day_extras
  add column if not exists payment_method text,
  add column if not exists receipt_url    text;

comment on column public.day_extras.payment_method is
  'cash | card | transfer | other — kept as text to mirror appointments.payment_method without a CHECK so a future tenant-configurable payment_methods catalog can slot in.';
comment on column public.day_extras.receipt_url is
  'Storage path inside the private "receipts" bucket: <tenant_id>/<extra_id>/<file>.';
