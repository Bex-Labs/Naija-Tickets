'use client';

import { readImageUploadResponse } from '@/lib/image-upload-response';
import { EVENT_IMAGE_MAX_BYTES } from '@/lib/event-image';

import {
  CheckCircle2,
  Eye,
  EyeOff,
  ImagePlus,
  KeyRound,
  Link2,
  LoaderCircle,
  Save,
  UserRound,
} from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OrganiserPayoutSettings } from '@/components/organiser-payout-settings';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type OrganiserSettingsData = {
  fullName: string;
  accountEmail: string;
  phone: string;
  accountType: 'individual' | 'organisation';
  organisationName: string;
  profileImageUrl: string;
  contactEmail: string;
  description: string;
  websiteUrl: string;
  instagramUrl: string;
  xUrl: string;
  facebookUrl: string;
  tiktokUrl: string;
};

const emptySettings: OrganiserSettingsData = {
  fullName: '',
  accountEmail: '',
  phone: '',
  accountType: 'individual',
  organisationName: '',
  profileImageUrl: '',
  contactEmail: '',
  description: '',
  websiteUrl: '',
  instagramUrl: '',
  xUrl: '',
  facebookUrl: '',
  tiktokUrl: '',
};

async function accessToken() {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new Error('Your session has expired. Log in again.');
  return data.session.access_token;
}

export function OrganiserSettings() {
  const [settings, setSettings] = useState(emptySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [profileNotice, setProfileNotice] = useState('');
  const [profileError, setProfileError] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);

  const update = (key: keyof OrganiserSettingsData, value: string) =>
    setSettings((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    const load = async () => {
      try {
        const token = await accessToken();
        const response = await fetch('/api/organiser/settings', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const result = (await response.json()) as {
          settings?: OrganiserSettingsData;
          error?: string;
        };
        if (!response.ok || !result.settings) {
          throw new Error(result.error || 'Your settings could not be loaded.');
        }
        setSettings(result.settings);
      } catch (error) {
        setProfileError(
          error instanceof Error
            ? error.message
            : 'Your settings could not be loaded.',
        );
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const uploadProfileImage = async (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setProfileError('Choose a JPEG, PNG or WebP image.');
      return;
    }
    if (file.size > EVENT_IMAGE_MAX_BYTES) {
      setProfileError('Profile images must be 5 MB or smaller.');
      return;
    }

    setImageUploading(true);
    setProfileError('');
    setProfileNotice('');
    try {
      const token = await accessToken();
      const formData = new FormData();
      formData.set('image', file);
      const response = await fetch('/api/organiser/profile-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const url = await readImageUploadResponse(response);
      update('profileImageUrl', url);
      setProfileNotice('Profile image updated.');
    } catch (error) {
      setProfileError(
        error instanceof Error
          ? error.message
          : 'Profile image could not be uploaded.',
      );
    } finally {
      setImageUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const saveProfile = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    setSaving(true);
    setProfileError('');
    setProfileNotice('');
    try {
      const token = await accessToken();
      const response = await fetch('/api/organiser/settings', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      });
      const result = (await response.json()) as {
        settings?: OrganiserSettingsData;
        error?: string;
      };
      if (!response.ok || !result.settings) {
        throw new Error(result.error || 'Your settings could not be saved.');
      }
      setSettings(result.settings);
      setProfileNotice('Organiser profile and social links saved.');
    } catch (error) {
      setProfileError(
        error instanceof Error
          ? error.message
          : 'Your settings could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (name: string) => {
      const value = values.get(name);
      return typeof value === 'string' ? value : '';
    };
    const currentPassword = text('currentPassword');
    const newPassword = text('newPassword');
    const confirmPassword = text('confirmPassword');
    setSaving(true);
    setPasswordError('');
    setPasswordNotice('');
    try {
      if (newPassword !== confirmPassword) {
        throw new Error('The new passwords do not match.');
      }
      const client = getSupabaseBrowserClient();
      const { data } = await client.auth.getUser();
      if (!data.user?.email)
        throw new Error('Your account session is unavailable.');
      const { error: signInError } = await client.auth.signInWithPassword({
        email: data.user.email,
        password: currentPassword,
      });
      if (signInError) throw new Error('Your current password is incorrect.');
      const { error: updateError } = await client.auth.updateUser({
        password: newPassword,
      });
      if (updateError) throw updateError;
      form.reset();
      setPasswordNotice('Password updated successfully.');
    } catch (error) {
      setPasswordError(
        error instanceof Error
          ? error.message
          : 'Your password could not be updated.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-rise max-w-4xl">
      <p className="eyebrow">Workspace preferences</p>
      <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">Settings</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        Keep your public organiser details and account security up to date.
      </p>

      <form
        onSubmit={saveProfile}
        className="mt-8 grid gap-5 border border-[#241b3f]/10 bg-white p-6 sm:grid-cols-2 sm:p-8"
      >
        <div className="sm:col-span-2">
          <h2 className="text-xl font-black">Organiser profile</h2>
          <p className="mt-2 text-sm text-slate-500">
            Your profile picture, organiser name, description and social links
            appear on approved public event pages.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-5 border-b border-[#241b3f]/10 pb-5 sm:col-span-2">
          <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-full border border-[#241b3f]/10 bg-[#fffaf0] text-slate-400">
            {settings.profileImageUrl ? (
              <img
                src={settings.profileImageUrl}
                alt="Organiser profile"
                className="h-full w-full object-cover"
              />
            ) : (
              <UserRound className="h-8 w-8" />
            )}
          </div>
          <div>
            <p className="text-sm font-black">Profile picture</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Upload a JPEG, PNG or WebP image up to 5 MB.
            </p>
            <input
              ref={imageInputRef}
              id="organiser-profile-image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={loading || imageUploading}
              onChange={(event) =>
                void uploadProfileImage(event.target.files?.[0])
              }
              className="sr-only"
            />
            <Button
              type="button"
              variant="outline"
              disabled={loading || imageUploading}
              onClick={() => imageInputRef.current?.click()}
              className="mt-3 min-h-11 border-[#241b3f]/15 bg-white"
            >
              {imageUploading ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              {imageUploading ? 'Uploading...' : 'Choose picture'}
            </Button>
          </div>
        </div>
        <div>
          <label className="auth-label" htmlFor="settings-full-name">
            Full name
          </label>
          <Input
            id="settings-full-name"
            value={settings.fullName}
            onChange={(event) => update('fullName', event.target.value)}
            required
            minLength={2}
            maxLength={120}
            disabled={loading}
            className="auth-input"
          />
        </div>
        <div>
          <label className="auth-label" htmlFor="settings-phone">
            Phone number
          </label>
          <Input
            id="settings-phone"
            type="tel"
            value={settings.phone}
            onChange={(event) => update('phone', event.target.value)}
            required
            minLength={7}
            disabled={loading}
            className="auth-input"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="auth-label" htmlFor="settings-account-type">
            Account type
          </label>
          <Input
            id="settings-account-type"
            value={
              settings.accountType === 'organisation'
                ? 'Organisation organiser'
                : 'Individual organiser'
            }
            readOnly
            disabled
            className="auth-input bg-slate-50 capitalize text-slate-500"
          />
          <p className="mt-2 text-xs text-slate-500">
            Both account types can create events and manage ticket sales.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="auth-label" htmlFor="settings-account-email">
            Account email
          </label>
          <Input
            id="settings-account-email"
            type="email"
            value={settings.accountEmail}
            readOnly
            disabled
            className="auth-input bg-slate-50 text-slate-500"
          />
          <p className="mt-2 text-xs text-slate-500">
            This is the confirmed email used to access your account.
          </p>
        </div>
        <div>
          <label className="auth-label" htmlFor="settings-organisation-name">
            {settings.accountType === 'organisation'
              ? 'Organisation name'
              : 'Public organiser name'}
          </label>
          <Input
            id="settings-organisation-name"
            value={settings.organisationName}
            onChange={(event) => update('organisationName', event.target.value)}
            required
            minLength={2}
            maxLength={120}
            disabled={loading}
            className="auth-input"
          />
        </div>
        <div>
          <label className="auth-label" htmlFor="settings-contact-email">
            Public contact email
          </label>
          <Input
            id="settings-contact-email"
            type="email"
            value={settings.contactEmail}
            onChange={(event) => update('contactEmail', event.target.value)}
            required
            disabled={loading}
            className="auth-input"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="auth-label" htmlFor="settings-description">
            About the organiser
          </label>
          <textarea
            id="settings-description"
            value={settings.description}
            onChange={(event) => update('description', event.target.value)}
            maxLength={1200}
            disabled={loading}
            className="min-h-32 w-full border border-[#241b3f]/10 bg-[#fffaf0] p-3 text-sm outline-none"
          />
          <p className="mt-2 text-right text-xs text-slate-400">
            {settings.description.length}/1200
          </p>
        </div>
        <div className="border-t border-[#241b3f]/10 pt-5 sm:col-span-2">
          <Link2 className="h-5 w-5 text-emerald-600" />
          <h3 className="mt-3 font-black">Website and social links</h3>
          <p className="mt-1 text-sm text-slate-500">
            Add complete public links beginning with https://. Leave any field
            blank if you do not use that platform.
          </p>
        </div>
        {(
          [
            ['websiteUrl', 'Website', 'https://yourwebsite.com'],
            ['instagramUrl', 'Instagram', 'https://instagram.com/yourname'],
            ['xUrl', 'X / Twitter', 'https://x.com/yourname'],
            ['facebookUrl', 'Facebook', 'https://facebook.com/yourname'],
            ['tiktokUrl', 'TikTok', 'https://tiktok.com/@yourname'],
          ] as const
        ).map(([field, label, placeholder]) => (
          <div
            key={field}
            className={field === 'websiteUrl' ? 'sm:col-span-2' : ''}
          >
            <label className="auth-label" htmlFor={`settings-${field}`}>
              {label}
            </label>
            <Input
              id={`settings-${field}`}
              type="url"
              value={settings[field]}
              placeholder={placeholder}
              onChange={(event) => update(field, event.target.value)}
              disabled={loading}
              maxLength={500}
              className="auth-input"
            />
          </div>
        ))}
        {profileNotice && (
          <output className="flex items-center gap-2 border border-emerald-500/25 bg-emerald-50 p-3 text-sm text-emerald-800 sm:col-span-2">
            <CheckCircle2 className="h-4 w-4" /> {profileNotice}
          </output>
        )}
        {profileError && (
          <output className="border border-red-500/25 bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">
            {profileError}
          </output>
        )}
        <Button
          type="submit"
          disabled={loading || saving}
          className="h-11 bg-emerald-500 px-5 font-black text-emerald-950 hover:bg-emerald-400 sm:w-fit"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : 'Save settings'}
        </Button>
      </form>

      <OrganiserPayoutSettings />

      <form
        onSubmit={changePassword}
        className="mt-6 grid gap-5 border border-[#241b3f]/10 bg-white p-6 sm:grid-cols-2 sm:p-8"
      >
        <div className="sm:col-span-2">
          <KeyRound className="h-5 w-5 text-emerald-600" />
          <h2 className="mt-4 text-xl font-black">Password</h2>
          <p className="mt-2 text-sm text-slate-500">
            Confirm your current password before choosing a new one.
          </p>
        </div>
        {['currentPassword', 'newPassword', 'confirmPassword'].map((name) => (
          <div
            key={name}
            className={name === 'currentPassword' ? 'sm:col-span-2' : ''}
          >
            <label className="auth-label" htmlFor={`organiser-${name}`}>
              {name === 'currentPassword'
                ? 'Current password'
                : name === 'newPassword'
                  ? 'New password'
                  : 'Confirm new password'}
            </label>
            <div className="relative">
              <Input
                id={`organiser-${name}`}
                name={name}
                type={showPasswords ? 'text' : 'password'}
                required
                minLength={name === 'currentPassword' ? 8 : 12}
                autoComplete={
                  name === 'currentPassword'
                    ? 'current-password'
                    : 'new-password'
                }
                className="auth-input pr-11"
              />
              <button
                type="button"
                aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'}
                onClick={() => setShowPasswords((current) => !current)}
                className="absolute right-0 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center text-slate-500"
              >
                {showPasswords ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        ))}
        {passwordNotice && (
          <output className="flex items-center gap-2 border border-emerald-500/25 bg-emerald-50 p-3 text-sm text-emerald-800 sm:col-span-2">
            <CheckCircle2 className="h-4 w-4" /> {passwordNotice}
          </output>
        )}
        {passwordError && (
          <output className="border border-red-500/25 bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">
            {passwordError}
          </output>
        )}
        <Button
          type="submit"
          disabled={saving}
          className="h-11 bg-[#241b3f] px-5 font-black text-white hover:bg-[#342755] sm:w-fit"
        >
          Update password
        </Button>
      </form>
    </div>
  );
}
