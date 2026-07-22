'use client';

interface CardBackProps {
  className?: string;
}

export default function CardBack({ className = '' }: CardBackProps) {
  return (
    <div
      className={`aspect-[2.5/3.5] w-full overflow-hidden rounded-lg border border-sk-slate/40 ${className}`}
      aria-hidden="true"
    >
      <img src="/card-back.png" alt="" className="h-full w-full rounded-lg object-cover" />
    </div>
  );
}
