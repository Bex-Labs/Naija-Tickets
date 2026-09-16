-- Retire the previous fictional seed event without deleting any records.
-- The narrow organiser and event match avoids changing legitimate events.

update public.events as event
set
  status = 'cancelled',
  featured = false,
  published_at = null,
  updated_at = now()
from public.organisers as organiser
where event.organiser_id = organiser.id
  and event.slug = 'eko-sounds-live'
  and organiser.slug = 'palmwine-nights'
  and organiser.contact_email = 'demo-organiser@example.com';
