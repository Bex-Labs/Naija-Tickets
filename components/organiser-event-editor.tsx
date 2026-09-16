'use client';

import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  MapPin,
  Plus,
  Send,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  OrganiserEvent,
  OrganiserTicketType,
} from '@/lib/organiser-types';
import { categories, cities } from '@/lib/events';

export type EventEditorValue = Omit<OrganiserEvent, 'id' | 'status' | 'reason'>;

type Props = {
  editing: boolean;
  value: EventEditorValue;
  notice: string;
  saving: boolean;
  onChange: (value: EventEditorValue) => void;
  onSave: (status: 'draft' | 'submitted') => void;
};

function key() {
  return crypto.randomUUID();
}

function move<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function ticketTemplate(): OrganiserTicketType {
  return {
    clientKey: key(),
    name: '',
    description: '',
    priceNaira: 0,
    quantityTotal: 100,
    quantitySold: 0,
    quantityReserved: 0,
    minPerOrder: 1,
    maxPerOrder: 6,
    salesStart: '',
    salesEnd: '',
    inclusions: [],
    active: true,
  };
}

function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof MapPin;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 sm:col-span-2">
      <span className="grid h-10 w-10 shrink-0 place-items-center bg-emerald-50 text-emerald-700">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="text-xl font-black">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function OrderButtons({
  label,
  index,
  length,
  onMove,
  onRemove,
  removeDisabled = false,
}: {
  label: string;
  index: number;
  length: number;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  removeDisabled?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-label={`Move ${label} up`}
        disabled={index === 0}
        onClick={() => onMove(-1)}
        className="grid h-11 w-11 place-items-center border border-[#241b3f]/10 text-slate-600 disabled:opacity-30"
      >
        <ArrowUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        disabled={index === length - 1}
        onClick={() => onMove(1)}
        className="grid h-11 w-11 place-items-center border border-[#241b3f]/10 text-slate-600 disabled:opacity-30"
      >
        <ArrowDown className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        disabled={removeDisabled}
        onClick={onRemove}
        className="grid h-11 w-11 place-items-center border border-red-200 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export function OrganiserEventEditor({
  editing,
  value,
  notice,
  saving,
  onChange,
  onSave,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const update = <K extends keyof EventEditorValue>(
    field: K,
    next: EventEditorValue[K],
  ) => onChange({ ...value, [field]: next });
  const save = (status: 'draft' | 'submitted') => {
    if (!formRef.current?.reportValidity()) return;
    onSave(status);
  };

  return (
    <div className="animate-rise max-w-5xl">
      <p className="eyebrow">{editing ? 'Edit event' : 'New event'}</p>
      <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">
        Build the public event page
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
        Everything entered here follows the event through review and appears on
        the public detail page after approval.
      </p>

      <form ref={formRef} onSubmit={(event) => event.preventDefault()}>
        <div className="mt-8 grid gap-5 border border-[#241b3f]/10 bg-white p-5 sm:grid-cols-2 sm:p-7">
          <SectionHeading
            icon={UserRound}
            title="Presenter and organiser"
            description="Set the public byline and the shared organiser profile guests will see."
          />
          <div>
            <label className="auth-label" htmlFor="organiserDisplayName">
              Organiser display name
            </label>
            <Input
              id="organiserDisplayName"
              required
              minLength={2}
              maxLength={120}
              value={value.organiserDisplayName}
              onChange={(event) =>
                update('organiserDisplayName', event.target.value)
              }
              className="auth-input"
            />
          </div>
          <div>
            <label className="auth-label" htmlFor="presenterLine">
              Presenter byline
            </label>
            <Input
              id="presenterLine"
              required
              minLength={2}
              maxLength={160}
              placeholder="Palmwine Nights Collective presents"
              value={value.presenterLine}
              onChange={(event) => update('presenterLine', event.target.value)}
              className="auth-input"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="auth-label" htmlFor="organiserAbout">
              About the organiser
            </label>
            <textarea
              id="organiserAbout"
              maxLength={1200}
              value={value.organiserAbout}
              onChange={(event) => update('organiserAbout', event.target.value)}
              className="min-h-28 w-full border border-[#241b3f]/10 bg-[#fffaf0] p-3 text-sm outline-none"
            />
            <p className="mt-2 text-right text-xs text-slate-400">
              {value.organiserAbout.length}/1200
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 border border-[#241b3f]/10 bg-white p-5 sm:grid-cols-2 sm:p-7">
          <SectionHeading
            icon={CalendarClock}
            title="Event basics"
            description="Add the title, category, start and end time, sales window and event story."
          />
          <div className="sm:col-span-2">
            <label className="auth-label" htmlFor="eventTitle">
              Event title
            </label>
            <Input
              id="eventTitle"
              required
              minLength={3}
              maxLength={160}
              value={value.title}
              onChange={(event) => update('title', event.target.value)}
              className="auth-input"
            />
          </div>
          <div>
            <label className="auth-label" htmlFor="eventCategory">
              Category
            </label>
            <select
              id="eventCategory"
              value={value.category}
              onChange={(event) => update('category', event.target.value)}
              className="filter-control h-12"
            >
              {categories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="auth-label" htmlFor="eventCity">
              City
            </label>
            <select
              id="eventCity"
              value={value.city}
              onChange={(event) => update('city', event.target.value)}
              className="filter-control h-12"
            >
              {cities.map((city) => (
                <option key={city}>{city}</option>
              ))}
            </select>
          </div>
          {[
            ['date', 'Start date', 'date'],
            ['time', 'Start time', 'time'],
            ['endDate', 'End date', 'date'],
            ['endTime', 'End time', 'time'],
          ].map(([field, label, type]) => (
            <div key={field}>
              <label className="auth-label" htmlFor={`event-${field}`}>
                {label}
              </label>
              <Input
                id={`event-${field}`}
                type={type}
                required
                value={value[field as 'date' | 'time' | 'endDate' | 'endTime']}
                onChange={(event) =>
                  update(
                    field as 'date' | 'time' | 'endDate' | 'endTime',
                    event.target.value,
                  )
                }
                className="auth-input"
              />
            </div>
          ))}
          <div>
            <label className="auth-label" htmlFor="timezoneLabel">
              Timezone label
            </label>
            <Input
              id="timezoneLabel"
              required
              minLength={2}
              maxLength={16}
              placeholder="WAT"
              value={value.timezoneLabel}
              onChange={(event) => update('timezoneLabel', event.target.value)}
              className="auth-input uppercase"
            />
          </div>
          <div className="hidden sm:block" aria-hidden="true" />
          <div>
            <label className="auth-label" htmlFor="eventSalesStart">
              Event sales start
            </label>
            <Input
              id="eventSalesStart"
              type="datetime-local"
              value={value.salesStart}
              onChange={(event) => update('salesStart', event.target.value)}
              className="auth-input"
            />
          </div>
          <div>
            <label className="auth-label" htmlFor="eventSalesEnd">
              Event sales end
            </label>
            <Input
              id="eventSalesEnd"
              type="datetime-local"
              value={value.salesEnd}
              onChange={(event) => update('salesEnd', event.target.value)}
              className="auth-input"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="auth-label" htmlFor="eventDescription">
              About this event
            </label>
            <textarea
              id="eventDescription"
              required
              minLength={20}
              maxLength={6000}
              value={value.description}
              onChange={(event) => update('description', event.target.value)}
              className="min-h-40 w-full border border-[#241b3f]/10 bg-[#fffaf0] p-3 text-sm outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="auth-label" htmlFor="eventImage">
              Event image URL
            </label>
            <Input
              id="eventImage"
              type="url"
              value={value.imageName}
              placeholder="https://example.com/event-photo.jpg"
              onChange={(event) => update('imageName', event.target.value)}
              className="auth-input"
            />
          </div>
        </div>

        <div className="mt-6 grid gap-5 border border-[#241b3f]/10 bg-white p-5 sm:grid-cols-2 sm:p-7">
          <SectionHeading
            icon={MapPin}
            title="Venue and directions"
            description="The venue name and full address appear separately on the public page."
          />
          <div>
            <label className="auth-label" htmlFor="eventVenue">
              Venue name
            </label>
            <Input
              id="eventVenue"
              required
              minLength={2}
              maxLength={160}
              value={value.venue}
              onChange={(event) => update('venue', event.target.value)}
              className="auth-input"
            />
          </div>
          <div>
            <label className="auth-label" htmlFor="eventAddress">
              Full street address
            </label>
            <Input
              id="eventAddress"
              required
              minLength={5}
              maxLength={300}
              value={value.address}
              onChange={(event) => update('address', event.target.value)}
              className="auth-input"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="auth-label" htmlFor="eventDirections">
              Directions or map URL
            </label>
            <Input
              id="eventDirections"
              type="url"
              value={value.directionsUrl}
              placeholder="https://maps.google.com/..."
              onChange={(event) => update('directionsUrl', event.target.value)}
              className="auth-input"
            />
          </div>
        </div>

        <div className="mt-6 border border-[#241b3f]/10 bg-white p-5 sm:p-7">
          <SectionHeading
            icon={ClipboardList}
            title="Schedule"
            description="Add, remove and reorder the timeline shown to guests."
          />
          <div className="mt-6 space-y-3">
            {value.schedule.map((item, index) => (
              <div
                key={item.clientKey || item.id || index}
                className="grid gap-3 border border-[#241b3f]/10 bg-[#fffaf0] p-4 sm:grid-cols-[9rem_1fr_auto] sm:items-end"
              >
                <div>
                  <label
                    className="auth-label"
                    htmlFor={`schedule-time-${index}`}
                  >
                    Time
                  </label>
                  <Input
                    id={`schedule-time-${index}`}
                    type="time"
                    required
                    value={item.time}
                    onChange={(event) => {
                      const next = [...value.schedule];
                      next[index] = { ...item, time: event.target.value };
                      update('schedule', next);
                    }}
                    className="auth-input"
                  />
                </div>
                <div>
                  <label
                    className="auth-label"
                    htmlFor={`schedule-title-${index}`}
                  >
                    Schedule item
                  </label>
                  <Input
                    id={`schedule-title-${index}`}
                    required
                    minLength={2}
                    maxLength={160}
                    value={item.title}
                    onChange={(event) => {
                      const next = [...value.schedule];
                      next[index] = { ...item, title: event.target.value };
                      update('schedule', next);
                    }}
                    className="auth-input"
                  />
                </div>
                <OrderButtons
                  label={`schedule row ${index + 1}`}
                  index={index}
                  length={value.schedule.length}
                  onMove={(direction) =>
                    update('schedule', move(value.schedule, index, direction))
                  }
                  onRemove={() =>
                    update(
                      'schedule',
                      value.schedule.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={value.schedule.length >= 30}
            onClick={() =>
              update('schedule', [
                ...value.schedule,
                { clientKey: key(), time: '', title: '' },
              ])
            }
            className="mt-4 min-h-11 border-[#241b3f]/15"
          >
            <Plus className="h-4 w-4" /> Add schedule row
          </Button>
        </div>

        <div className="mt-6 border border-[#241b3f]/10 bg-white p-5 sm:p-7">
          <SectionHeading
            icon={ClipboardList}
            title="Event policies"
            description="Keep guest expectations clear and order the most important policy first."
          />
          <div className="mt-6 space-y-3">
            {value.policies.map((policy, index) => (
              <div
                key={policy.clientKey || policy.id || index}
                className="grid gap-3 border border-[#241b3f]/10 bg-[#fffaf0] p-4 sm:grid-cols-[1fr_auto] sm:items-end"
              >
                <div>
                  <label className="auth-label" htmlFor={`policy-${index}`}>
                    Policy {index + 1}
                  </label>
                  <Input
                    id={`policy-${index}`}
                    required
                    minLength={3}
                    maxLength={500}
                    value={policy.text}
                    onChange={(event) => {
                      const next = [...value.policies];
                      next[index] = { ...policy, text: event.target.value };
                      update('policies', next);
                    }}
                    className="auth-input"
                  />
                </div>
                <OrderButtons
                  label={`policy ${index + 1}`}
                  index={index}
                  length={value.policies.length}
                  onMove={(direction) =>
                    update('policies', move(value.policies, index, direction))
                  }
                  onRemove={() =>
                    update(
                      'policies',
                      value.policies.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={value.policies.length >= 30}
            onClick={() =>
              update('policies', [
                ...value.policies,
                { clientKey: key(), text: '' },
              ])
            }
            className="mt-4 min-h-11 border-[#241b3f]/15"
          >
            <Plus className="h-4 w-4" /> Add policy
          </Button>
        </div>

        <div className="mt-6 border border-[#241b3f]/10 bg-white p-5 sm:p-7">
          <SectionHeading
            icon={CircleDollarSign}
            title="Ticket tiers and pricing"
            description="Prices are entered in NGN, converted to integer kobo on the server and used by public checkout. Enter 0 for a free ticket."
          />
          <div className="mt-6 space-y-5">
            {value.ticketTypes.map((ticket, index) => {
              const updateTicket = <K extends keyof OrganiserTicketType>(
                field: K,
                nextValue: OrganiserTicketType[K],
              ) => {
                const next = [...value.ticketTypes];
                next[index] = { ...ticket, [field]: nextValue };
                update('ticketTypes', next);
              };
              return (
                <fieldset
                  key={ticket.clientKey || ticket.id || index}
                  className="border border-[#241b3f]/10 bg-[#fffaf0] p-4 sm:p-5"
                >
                  <legend className="px-2 text-sm font-black">
                    Ticket tier {index + 1}
                  </legend>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <label className="inline-flex min-h-11 items-center gap-3 text-sm font-bold">
                      <input
                        type="checkbox"
                        checked={ticket.active}
                        onChange={(event) =>
                          updateTicket('active', event.target.checked)
                        }
                        className="h-5 w-5 accent-emerald-600"
                      />
                      Available for sale
                    </label>
                    <OrderButtons
                      label={`ticket tier ${index + 1}`}
                      index={index}
                      length={value.ticketTypes.length}
                      removeDisabled={value.ticketTypes.length === 1}
                      onMove={(direction) =>
                        update(
                          'ticketTypes',
                          move(value.ticketTypes, index, direction),
                        )
                      }
                      onRemove={() =>
                        update(
                          'ticketTypes',
                          value.ticketTypes.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="sm:col-span-2 lg:col-span-2">
                      <label
                        className="auth-label"
                        htmlFor={`ticket-name-${index}`}
                      >
                        Ticket name
                      </label>
                      <Input
                        id={`ticket-name-${index}`}
                        required
                        minLength={2}
                        maxLength={100}
                        value={ticket.name}
                        onChange={(event) =>
                          updateTicket('name', event.target.value)
                        }
                        className="auth-input"
                      />
                    </div>
                    <div>
                      <label
                        className="auth-label"
                        htmlFor={`ticket-price-${index}`}
                      >
                        Price (NGN)
                      </label>
                      <Input
                        id={`ticket-price-${index}`}
                        type="number"
                        min={0}
                        step="0.01"
                        required
                        value={ticket.priceNaira}
                        onChange={(event) =>
                          updateTicket('priceNaira', Number(event.target.value))
                        }
                        className="auth-input"
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        {ticket.priceNaira === 0
                          ? 'Free ticket'
                          : 'Charged in naira'}
                      </p>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label
                        className="auth-label"
                        htmlFor={`ticket-description-${index}`}
                      >
                        Ticket description
                      </label>
                      <Input
                        id={`ticket-description-${index}`}
                        maxLength={500}
                        value={ticket.description}
                        onChange={(event) =>
                          updateTicket('description', event.target.value)
                        }
                        className="auth-input"
                      />
                    </div>
                    <div>
                      <label
                        className="auth-label"
                        htmlFor={`ticket-capacity-${index}`}
                      >
                        Capacity
                      </label>
                      <Input
                        id={`ticket-capacity-${index}`}
                        type="number"
                        min={ticket.quantitySold + ticket.quantityReserved}
                        max={1000000}
                        step={1}
                        required
                        value={ticket.quantityTotal}
                        onChange={(event) =>
                          updateTicket(
                            'quantityTotal',
                            Number(event.target.value),
                          )
                        }
                        className="auth-input"
                      />
                      {(ticket.quantitySold > 0 ||
                        ticket.quantityReserved > 0) && (
                        <p className="mt-1 text-xs text-slate-500">
                          {ticket.quantitySold} sold, {ticket.quantityReserved}{' '}
                          reserved
                        </p>
                      )}
                    </div>
                    <div>
                      <label
                        className="auth-label"
                        htmlFor={`ticket-min-${index}`}
                      >
                        Minimum per order
                      </label>
                      <Input
                        id={`ticket-min-${index}`}
                        type="number"
                        min={1}
                        max={20}
                        step={1}
                        required
                        value={ticket.minPerOrder}
                        onChange={(event) =>
                          updateTicket(
                            'minPerOrder',
                            Number(event.target.value),
                          )
                        }
                        className="auth-input"
                      />
                    </div>
                    <div>
                      <label
                        className="auth-label"
                        htmlFor={`ticket-max-${index}`}
                      >
                        Maximum per order
                      </label>
                      <Input
                        id={`ticket-max-${index}`}
                        type="number"
                        min={ticket.minPerOrder}
                        max={20}
                        step={1}
                        required
                        value={ticket.maxPerOrder}
                        onChange={(event) =>
                          updateTicket(
                            'maxPerOrder',
                            Number(event.target.value),
                          )
                        }
                        className="auth-input"
                      />
                    </div>
                    <div>
                      <label
                        className="auth-label"
                        htmlFor={`ticket-sales-start-${index}`}
                      >
                        Sales start
                      </label>
                      <Input
                        id={`ticket-sales-start-${index}`}
                        type="datetime-local"
                        value={ticket.salesStart}
                        onChange={(event) =>
                          updateTicket('salesStart', event.target.value)
                        }
                        className="auth-input"
                      />
                    </div>
                    <div>
                      <label
                        className="auth-label"
                        htmlFor={`ticket-sales-end-${index}`}
                      >
                        Sales end
                      </label>
                      <Input
                        id={`ticket-sales-end-${index}`}
                        type="datetime-local"
                        value={ticket.salesEnd}
                        onChange={(event) =>
                          updateTicket('salesEnd', event.target.value)
                        }
                        className="auth-input"
                      />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label
                        className="auth-label"
                        htmlFor={`ticket-inclusions-${index}`}
                      >
                        Inclusions and benefits, one per line
                      </label>
                      <textarea
                        id={`ticket-inclusions-${index}`}
                        value={ticket.inclusions.join('\n')}
                        onChange={(event) =>
                          updateTicket(
                            'inclusions',
                            event.target.value.split('\n'),
                          )
                        }
                        className="min-h-24 w-full border border-[#241b3f]/10 bg-white p-3 text-sm outline-none"
                      />
                    </div>
                  </div>
                </fieldset>
              );
            })}
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={value.ticketTypes.length >= 20}
            onClick={() =>
              update('ticketTypes', [...value.ticketTypes, ticketTemplate()])
            }
            className="mt-4 min-h-11 border-[#241b3f]/15"
          >
            <Plus className="h-4 w-4" /> Add ticket tier
          </Button>
        </div>

        {notice && (
          <output className="mt-6 block border border-red-500/25 bg-red-50 p-4 text-sm leading-6 text-red-700">
            {notice}
          </output>
        )}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => save('draft')}
            className="h-12 border-[#241b3f]/15 bg-white"
          >
            {saving ? 'Saving...' : 'Save draft'}
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => save('submitted')}
            className="h-12 bg-emerald-500 font-black text-emerald-950"
          >
            Submit for approval <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
