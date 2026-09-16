import type { ButtonHTMLAttributes } from 'react';

type GoogleAuthButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> & {
  label: string;
};

export function GoogleAuthButton({
  label,
  className = '',
  ...props
}: GoogleAuthButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid h-12 w-12 place-items-center rounded-full border border-[#747775] bg-white shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 18 18"
        className="h-[18px] w-[18px]"
      >
        <path
          fill="#4285F4"
          d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.259h2.909c1.702-1.567 2.684-3.874 2.684-6.616Z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.467-.806 5.956-2.179l-2.909-2.259c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.955v2.332A9 9 0 0 0 9 18Z"
        />
        <path
          fill="#FBBC05"
          d="M3.963 10.707A5.42 5.42 0 0 1 3.682 9c0-.593.102-1.17.281-1.707V4.961H.955A9 9 0 0 0 0 9c0 1.452.347 2.827.955 4.039l3.008-2.332Z"
        />
        <path
          fill="#EA4335"
          d="M9 3.579c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.463.892 11.426 0 9 0A9 9 0 0 0 .955 4.961l3.008 2.332C4.672 5.164 6.656 3.579 9 3.579Z"
        />
      </svg>
    </button>
  );
}
