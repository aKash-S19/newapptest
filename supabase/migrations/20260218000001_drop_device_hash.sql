-- Remove device_hash column (device-based auth removed)
alter table public.users drop column if exists device_hash;
