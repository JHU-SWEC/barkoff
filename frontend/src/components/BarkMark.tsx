export function BarkMark({ className = 'mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4.5h3.5c1.4 0 2.6.9 3 2.2l.4 1.3H19a2 2 0 0 1 2 2v1.2a2.3 2.3 0 0 1-2.3 2.3H16l-1.2 6a1 1 0 0 1-1 .8H9.2a1 1 0 0 1-1-1v-5.6L7 14.8a1.4 1.4 0 0 1-2-.7L3.6 9.9A3.6 3.6 0 0 1 6.9 5.1z" />
      <circle className="mark-eye" cx="13" cy="8.6" r="1" />
    </svg>
  )
}
