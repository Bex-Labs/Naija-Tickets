'use client';

export function AdminSignOut() {
  const signOut = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.reload();
  };

  return (
    <button
      type="button"
      onClick={signOut}
      className="min-h-11 bg-[#241b3f] px-3 text-xs font-black text-white hover:bg-[#342750]"
    >
      Sign out
    </button>
  );
}
