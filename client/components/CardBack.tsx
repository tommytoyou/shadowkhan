'use client';

interface CardBackProps {
  className?: string;
}

export default function CardBack({ className = '' }: CardBackProps) {
  return (
    <div
      className={`aspect-[2.5/3.5] w-full rounded-lg border-2 border-sk-slate bg-neutral-950 ${className}`}
      aria-hidden="true"
    />
  );
}
